import { BookingStatus, PaymentKind, PaymentStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { startOfPropertyDay } from "../../lib/property-time.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import { bookingListInclude, expirePropertyHolds, propertyDate, serializeBookingListItem } from "./admin.service.js";

const DAY_MS = 86_400_000;
const OCCUPANCY_NIGHTS = 7;
const PENDING_OPTIONS_SHOWN = 8;

export function requireDashboardPermission(membership: AdminMembershipContext) {
  if (membership.role === "HOUSEKEEPING") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de consulter le tableau de bord.");
  }
  return membership;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Rooms sold or held and rooms blocked, night by night from `firstNight`. */
async function occupancy(propertyId: string, firstNight: Date) {
  const lastCheckOut = new Date(firstNight.getTime() + OCCUPANCY_NIGHTS * DAY_MS);
  const [rooms, allocations] = await Promise.all([
    prisma.room.findMany({ where: { propertyId, status: "ACTIVE" }, select: { id: true } }),
    prisma.roomAllocation.findMany({
      where: { room: { propertyId, status: "ACTIVE" }, status: "ACTIVE", checkIn: { lt: lastCheckOut }, checkOut: { gt: firstNight } },
      select: { roomId: true, source: true, checkIn: true, checkOut: true },
    }),
  ]);
  return Array.from({ length: OCCUPANCY_NIGHTS }, (_, index) => {
    const night = new Date(firstNight.getTime() + index * DAY_MS);
    const covering = allocations.filter((allocation) => allocation.checkIn <= night && allocation.checkOut > night);
    const occupied = new Set(covering.filter((allocation) => allocation.source !== "BLOCK").map((allocation) => allocation.roomId));
    const blocked = new Set(covering.filter((allocation) => allocation.source === "BLOCK" && !occupied.has(allocation.roomId)).map((allocation) => allocation.roomId));
    return { date: isoDate(night), occupied: occupied.size, blocked: blocked.size, available: rooms.length - blocked.size };
  });
}

/** Money received since the first of the month, net of refunds, and the bookings recorded meanwhile. */
async function monthFinance(membership: AdminMembershipContext, today: Date) {
  const monthStartDate = `${isoDate(today).slice(0, 8)}01`;
  const since = startOfPropertyDay(monthStartDate, membership.property.timezone);
  const propertyId = membership.propertyId;
  const [charges, refunds, bookings] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        propertyId,
        kind: PaymentKind.CHARGE,
        status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] },
        processedAt: { gte: since },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { propertyId, kind: PaymentKind.REFUND, status: PaymentStatus.SUCCEEDED, processedAt: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.booking.aggregate({
      where: {
        propertyId,
        createdAt: { gte: since },
        status: { in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);
  const collected = Number(charges._sum.amount ?? 0);
  const refunded = Number(refunds._sum.amount ?? 0);
  return {
    currency: membership.property.currency,
    monthStart: monthStartDate,
    collected,
    refunded,
    net: Math.round((collected - refunded) * 100) / 100,
    bookingsCount: bookings._count._all,
    bookingsTotal: Number(bookings._sum.total ?? 0),
  };
}

/**
 * What the team needs at a glance: today's movements, the options awaiting
 * confirmation and the coming week. Money is shown to the roles handling it.
 */
export async function getAdminDashboard(membership: AdminMembershipContext, now = new Date()) {
  const propertyId = membership.propertyId;
  await expirePropertyHolds(propertyId);
  const today = propertyDate(membership.property.timezone, now);
  const includeContactDetails = membership.role !== "ACCOUNTING";
  const seesContactRequests = membership.role === "ADMIN" || membership.role === "RECEPTION";
  const seesFinance = membership.role === "ADMIN" || membership.role === "ACCOUNTING";
  const pendingWhere = { propertyId, status: BookingStatus.PENDING_PAYMENT, hold: { is: { status: "ACTIVE" as const, expiresAt: { gt: now } } } };

  const [arrivals, departures, pendingOptions, pendingOptionsTotal, nights, openContactRequests, finance] = await Promise.all([
    prisma.booking.findMany({
      where: { propertyId, checkIn: today, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
      include: bookingListInclude,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    prisma.booking.findMany({
      where: { propertyId, checkOut: today, status: { in: [BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED, BookingStatus.COMPLETED] } },
      include: bookingListInclude,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    prisma.booking.findMany({
      where: pendingWhere,
      include: bookingListInclude,
      orderBy: { hold: { expiresAt: "asc" } },
      take: PENDING_OPTIONS_SHOWN,
    }),
    prisma.booking.count({ where: pendingWhere }),
    occupancy(propertyId, today),
    seesContactRequests ? prisma.contactRequest.count({ where: { propertyId, handledAt: null } }) : null,
    seesFinance ? monthFinance(membership, today) : null,
  ]);

  return {
    date: isoDate(today),
    arrivals: arrivals.map((booking) => serializeBookingListItem(booking, includeContactDetails)),
    departures: departures.map((booking) => serializeBookingListItem(booking, includeContactDetails)),
    pendingOptions: pendingOptions.map((booking) => serializeBookingListItem(booking, includeContactDetails)),
    pendingOptionsTotal,
    occupancy: nights,
    openContactRequests,
    finance,
  };
}
