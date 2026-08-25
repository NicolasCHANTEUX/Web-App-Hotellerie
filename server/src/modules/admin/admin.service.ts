import {
  AllocationSource,
  BookingStatus,
  Prisma,
  RoomStatus,
  type PaymentStatus,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { expireStaleBookingHolds } from "../booking/booking.holds.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import { protectRoomOccupancyIdentity } from "./admin.privacy.js";
import {
  blockingRoomAllocationWhere,
  compareRoomNumbers,
  roomIntervalsOverlap,
  type RoomSortOrder,
} from "./admin.room-query.js";
import {
  blockingAllocationSourcesForRoomUpdate,
  type AdminRoomUpdateInput,
} from "./admin.room-update.js";
import {
  roomHasHistory,
  type AdminRoomCreateInput,
  type AdminRoomDeleteInput,
} from "./admin.room-create-delete.js";
import { bookingStatusTransitionAllowed, type AdminBookingStatusInput } from "./admin.booking-actions.js";
import type { AdminAvailabilityBlockInput } from "./admin.availability-block.js";
import { enqueueBookingNotification } from "../notifications/notification.service.js";

const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

function isRetryableTransactionConflict(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "P2034" ||
    candidate.code === "40001" ||
    (typeof candidate.message === "string" && candidate.message.toLowerCase().includes("serialization failure"));
}

function isUniqueConstraintViolation(error: unknown) {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "P2002";
}

function isForeignKeyConstraintViolation(error: unknown) {
  return typeof error === "object" && error !== null &&
    (error as { code?: unknown }).code === "P2003";
}

const bookingListInclude = {
  guests: {
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    take: 1,
  },
  rooms: {
    orderBy: { createdAt: "asc" },
    include: {
      room: { select: { id: true, number: true } },
      roomType: { select: { id: true, name: true, slug: true } },
    },
  },
  payments: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true },
  },
  hold: { select: { status: true, expiresAt: true, room: { select: { number: true } } } },
} satisfies Prisma.BookingInclude;

function expirePropertyHolds(propertyId: string) {
  return prisma.$transaction((transaction) =>
    expireStaleBookingHolds(transaction, new Date(), propertyId));
}

const bookingDetailInclude = {
  guests: {
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
  rooms: {
    orderBy: { createdAt: "asc" },
    include: {
      room: { select: { id: true, number: true, floor: true, status: true } },
      roomType: { select: { id: true, name: true, slug: true } },
      ratePlan: { select: { id: true, code: true, name: true } },
    },
  },
  extras: {
    orderBy: { createdAt: "asc" },
    include: { extra: { select: { id: true, code: true } } },
  },
  payments: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      parentPaymentId: true,
      provider: true,
      kind: true,
      status: true,
      amount: true,
      currency: true,
      paymentMethodType: true,
      processedAt: true,
      createdAt: true,
    },
  },
  hold: { select: { status: true, expiresAt: true, room: { select: { number: true } } } },
} satisfies Prisma.BookingInclude;

type BookingFilters = {
  search?: string;
  status?: BookingStatus;
  from?: Date;
  to?: Date;
  todayOnly?: boolean;
};

export type BookingListInput = BookingFilters & {
  page: number;
  pageSize: number;
};

export type RoomListInput = {
  page: number;
  pageSize: number;
  search?: string;
  status?: RoomStatus;
  roomTypeId?: string;
  from?: Date;
  to?: Date;
  sortOrder: RoomSortOrder;
};

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isoTimestamp(value: Date | null) {
  return value?.toISOString() ?? null;
}

const editableRoomSelect = {
  id: true,
  number: true,
  floor: true,
  status: true,
  notes: true,
  updatedAt: true,
  roomTypeId: true,
  roomType: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.RoomSelect;

type EditableRoomRecord = Prisma.RoomGetPayload<{ select: typeof editableRoomSelect }>;

const roomDeletionSelect = {
  ...editableRoomSelect,
  _count: {
    select: {
      bookingRooms: true,
      reservationHolds: true,
      availabilityBlocks: true,
      allocations: true,
    },
  },
} satisfies Prisma.RoomSelect;

function serializeEditableRoom(room: EditableRoomRecord) {
  return {
    id: room.id,
    number: room.number,
    floor: room.floor,
    status: room.status,
    notes: room.notes,
    updatedAt: room.updatedAt.toISOString(),
    roomType: room.roomType,
  };
}

function roomAuditSnapshot(room: EditableRoomRecord) {
  return {
    number: room.number,
    roomTypeId: room.roomTypeId,
    floor: room.floor,
    status: room.status,
    notes: room.notes,
    updatedAt: room.updatedAt.toISOString(),
  };
}

function guestName(guest: { firstName: string; lastName: string }) {
  return `${guest.firstName} ${guest.lastName}`.trim();
}

function serializeGuest(
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    countryCode: string | null;
    isPrimary: boolean;
  } | undefined,
  includeContactDetails = true,
) {
  if (!guest) return null;
  return {
    ...(includeContactDetails ? { id: guest.id } : {}),
    firstName: guest.firstName,
    lastName: guest.lastName,
    name: guestName(guest),
    email: includeContactDetails ? guest.email : null,
    phone: includeContactDetails ? guest.phone : null,
    countryCode: includeContactDetails ? guest.countryCode : null,
    isPrimary: guest.isPrimary,
  };
}

export function bookingWhere(
  propertyId: string,
  input: BookingFilters,
  today: Date,
  includeStatus = true,
  includeContactSearch = true,
): Prisma.BookingWhereInput {
  const search = input.search?.trim();
  return {
    propertyId,
    ...(includeStatus && input.status ? { status: input.status } : {}),
    ...(input.from ? { checkOut: { gt: input.from } } : {}),
    ...(input.to ? { checkIn: { lte: input.to } } : {}),
    ...(input.todayOnly ? { AND: [{ checkIn: { lte: today } }, { checkOut: { gte: today } }] } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" } },
            {
              guests: {
                some: {
                  OR: [
                    { firstName: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                    ...(includeContactSearch ? [
                      { email: { contains: search, mode: "insensitive" as const } },
                      { phone: { contains: search, mode: "insensitive" as const } },
                    ] : []),
                  ],
                },
              },
            },
            {
              rooms: {
                some: {
                  OR: [
                    { roomTypeNameSnapshot: { contains: search, mode: "insensitive" } },
                    { roomNumberSnapshot: { contains: search, mode: "insensitive" } },
                    { room: { is: { number: { contains: search, mode: "insensitive" } } } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}

function fetchBookingPage(where: Prisma.BookingWhereInput, input: BookingListInput) {
  return prisma.booking.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { checkIn: "asc" }],
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
    include: bookingListInclude,
  });
}

type BookingListRecord = Awaited<ReturnType<typeof fetchBookingPage>>[number];

function serializeBookingListItem(booking: BookingListRecord, includeContactDetails: boolean) {
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    source: booking.source,
    checkIn: isoDate(booking.checkIn),
    checkOut: isoDate(booking.checkOut),
    adults: booking.adults,
    children: booking.children,
    total: Number(booking.total),
    currency: booking.currency,
    createdAt: booking.createdAt.toISOString(),
    guest: serializeGuest(booking.guests[0], includeContactDetails),
    rooms: booking.rooms.map((bookingRoom, index) => ({
      id: bookingRoom.id,
      roomTypeId: bookingRoom.roomType.id,
      roomTypeName: bookingRoom.roomTypeNameSnapshot,
      roomNumber: bookingRoom.room?.number ?? bookingRoom.roomNumberSnapshot ?? (index === 0 ? booking.hold?.room.number : null),
    })),
    paymentStatus: (booking.payments[0]?.status ?? null) as PaymentStatus | null,
    hold: booking.hold ? {
      status: booking.hold.status,
      expiresAt: booking.hold.expiresAt.toISOString(),
      isActive: booking.hold.status === "ACTIVE" && booking.hold.expiresAt > new Date(),
    } : null,
  };
}

function emptyBookingStatusCounts() {
  return Object.fromEntries(
    Object.values(BookingStatus).map((status) => [status, 0]),
  ) as Record<BookingStatus, number>;
}

export function propertyDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) return new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

export async function listAdminBookings(
  membership: AdminMembershipContext,
  input: BookingListInput,
) {
  await expirePropertyHolds(membership.propertyId);
  const today = propertyDate(membership.property.timezone);
  const includeContactDetails = membership.role !== "ACCOUNTING";
  const where = bookingWhere(membership.propertyId, input, today, true, includeContactDetails);
  const summaryWhere = bookingWhere(membership.propertyId, input, today, false, includeContactDetails);
  const operationalStatuses: BookingStatus[] = [
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.CONFIRMED,
  ];

  const [bookings, total, summaryTotal, statusGroups, arrivalsToday, departuresToday] =
    await Promise.all([
      fetchBookingPage(where, input),
      prisma.booking.count({ where }),
      prisma.booking.count({ where: summaryWhere }),
      prisma.booking.groupBy({
        by: ["status"],
        where: summaryWhere,
        _count: { _all: true },
      }),
      prisma.booking.count({
        where: {
          AND: [summaryWhere, { checkIn: today, status: { in: operationalStatuses } }],
        },
      }),
      prisma.booking.count({
        where: {
          AND: [summaryWhere, { checkOut: today, status: { in: operationalStatuses } }],
        },
      }),
    ]);

  const byStatus = emptyBookingStatusCounts();
  for (const group of statusGroups) byStatus[group.status] = group._count._all;

  return {
    items: bookings.map((booking) => serializeBookingListItem(booking, includeContactDetails)),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
    summary: {
      total: summaryTotal,
      byStatus,
      arrivalsToday,
      departuresToday,
    },
  };
}

export async function getAdminBooking(propertyId: string, bookingId: string, includeContactDetails = true) {
  await expirePropertyHolds(propertyId);
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, propertyId },
    include: bookingDetailInclude,
  });
  if (!booking) return null;

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    source: booking.source,
    checkIn: isoDate(booking.checkIn),
    checkOut: isoDate(booking.checkOut),
    adults: booking.adults,
    children: booking.children,
    currency: booking.currency,
    priceTaxMode: booking.priceTaxMode,
    accommodationSubtotal: Number(booking.accommodationSubtotal),
    extrasSubtotal: Number(booking.extrasSubtotal),
    touristTaxTotal: Number(booking.touristTaxTotal),
    taxTotal: Number(booking.taxTotal),
    total: Number(booking.total),
    specialRequests: includeContactDetails ? booking.specialRequests : null,
    confirmedAt: isoTimestamp(booking.confirmedAt),
    cancelledAt: isoTimestamp(booking.cancelledAt),
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    guest: serializeGuest(booking.guests[0], includeContactDetails),
    paymentStatus: booking.payments[0]?.status ?? null,
    hold: booking.hold ? {
      status: booking.hold.status,
      expiresAt: booking.hold.expiresAt.toISOString(),
      isActive: booking.hold.status === "ACTIVE" && booking.hold.expiresAt > new Date(),
    } : null,
    guests: booking.guests.map((guest) => serializeGuest(guest, includeContactDetails)!),
    rooms: booking.rooms.map((bookingRoom, index) => ({
      id: bookingRoom.id,
      roomTypeId: bookingRoom.roomType.id,
      roomId: bookingRoom.room?.id ?? null,
      roomType: bookingRoom.roomType,
      room: bookingRoom.room,
      ratePlan: bookingRoom.ratePlan,
      roomTypeName: bookingRoom.roomTypeNameSnapshot,
      roomNumber: bookingRoom.room?.number ?? bookingRoom.roomNumberSnapshot ?? (index === 0 ? booking.hold?.room.number : null),
      nightlyPrice: Number(bookingRoom.nightlyPriceSnapshot),
      taxRate: Number(bookingRoom.taxRateSnapshot),
      lineTotal: Number(bookingRoom.lineTotal),
    })),
    extras: booking.extras.map((bookingExtra) => ({
      id: bookingExtra.id,
      extraId: bookingExtra.extra.id,
      code: bookingExtra.extra.code,
      name: bookingExtra.nameSnapshot,
      unitPrice: Number(bookingExtra.unitPriceSnapshot),
      pricingUnit: bookingExtra.pricingUnitSnapshot,
      quantity: bookingExtra.quantity,
      lineTotal: Number(bookingExtra.lineTotal),
    })),
    payments: booking.payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
      processedAt: payment.processedAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    })),
  };
}

export async function confirmAdminBooking(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  ipAddress?: string,
) {
  await expirePropertyHolds(membership.propertyId);

  let confirmedBookingId: string | undefined;
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      confirmedBookingId = await prisma.$transaction(async (transaction) => {
    const booking = await transaction.booking.findFirst({
      where: { id: bookingId, propertyId: membership.propertyId },
      include: {
        hold: { include: { allocation: true, room: { select: { number: true } } } },
        rooms: { orderBy: { createdAt: "asc" }, take: 1 },
        guests: { where: { isPrimary: true }, take: 1 },
      },
    });

    if (!booking) {
      throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
    }
    if (booking.status === BookingStatus.CONFIRMED) return booking.id;
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new AdminApiError(
        409,
        "BOOKING_NOT_CONFIRMABLE",
        "Cette réservation ne peut plus être confirmée.",
      );
    }

    const hold = booking.hold;
    const bookingRoom = booking.rooms[0];
    if (
      !hold ||
      hold.status !== "ACTIVE" ||
      hold.expiresAt <= new Date() ||
      !hold.allocation ||
      hold.allocation.status !== "ACTIVE" ||
      !bookingRoom
    ) {
      throw new AdminApiError(
        409,
        "BOOKING_HOLD_EXPIRED",
        "L'option sur cette chambre a expiré. Relancez une recherche de disponibilité.",
      );
    }

    await transaction.roomAllocation.update({
      where: { id: hold.allocation.id },
      data: { status: "RELEASED" },
    });
    await transaction.reservationHold.update({
      where: { id: hold.id },
      data: { status: "CONVERTED" },
    });
    await transaction.bookingRoom.update({
      where: { id: bookingRoom.id },
      data: { roomId: hold.roomId, roomNumberSnapshot: hold.room.number },
    });
    await transaction.roomAllocation.create({
      data: {
        roomId: hold.roomId,
        bookingRoomId: bookingRoom.id,
        source: "BOOKING",
        status: "ACTIVE",
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
      },
    });
    await transaction.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date() },
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        bookingId: booking.id,
        action: "BOOKING_CONFIRMED_MANUALLY",
        entityType: "Booking",
        entityId: booking.id,
        before: { status: BookingStatus.PENDING_PAYMENT, holdStatus: "ACTIVE" },
        after: { status: BookingStatus.CONFIRMED, holdStatus: "CONVERTED" },
        metadata: { source: "ADMIN_MVP" },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });

    const primaryGuest = booking.guests[0];
    if (primaryGuest?.email) {
      await enqueueBookingNotification(transaction, {
        propertyId: membership.propertyId,
        bookingId: booking.id,
        recipient: primaryGuest.email,
        template: "BOOKING_CONFIRMED",
        idempotencyKey: `booking:${booking.id}:confirmed`,
        payload: {
          firstName: primaryGuest.firstName,
          reference: booking.reference,
          roomName: booking.rooms[0]?.roomTypeNameSnapshot,
          arrival: booking.checkIn.toISOString().slice(0, 10),
          departure: booking.checkOut.toISOString().slice(0, 10),
          total: Number(booking.total),
          currency: booking.currency,
        },
      });
    }

        return booking.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (!isRetryableTransactionConflict(error) || attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS) throw error;
    }
  }

  if (!confirmedBookingId) {
    throw new AdminApiError(409, "BOOKING_CONFIRMATION_CONFLICT", "La réservation a changé. Rechargez-la avant de réessayer.");
  }

  return getAdminBooking(membership.propertyId, confirmedBookingId);
}

export async function updateAdminBookingStatus(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  input: AdminBookingStatusInput,
  ipAddress?: string,
) {
  let updatedBookingId: string | undefined;
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      updatedBookingId = await prisma.$transaction(async (transaction) => {
        const booking = await transaction.booking.findFirst({
          where: { id: bookingId, propertyId: membership.propertyId },
          select: {
            id: true,
            reference: true,
            status: true,
            checkIn: true,
            checkOut: true,
            total: true,
            currency: true,
            guests: { where: { isPrimary: true }, take: 1, select: { firstName: true, email: true } },
            rooms: { orderBy: { createdAt: "asc" }, take: 1, select: { roomTypeNameSnapshot: true } },
          },
        });
        if (!booking) throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
        if (booking.status === input.status) return booking.id;
        if (!bookingStatusTransitionAllowed(booking.status, input.status)) {
          throw new AdminApiError(409, "BOOKING_STATUS_TRANSITION_DENIED", "Ce changement de statut n’est pas autorisé.");
        }

        const today = propertyDate(membership.property.timezone);
        if (input.status === BookingStatus.COMPLETED && booking.checkOut > today) {
          throw new AdminApiError(409, "BOOKING_NOT_FINISHABLE", "Le séjour ne peut être terminé avant sa date de départ.");
        }
        if (input.status === BookingStatus.NO_SHOW && booking.checkIn > today) {
          throw new AdminApiError(409, "BOOKING_NOT_NO_SHOW", "L’absence ne peut être constatée avant la date d’arrivée.");
        }

        await transaction.roomAllocation.updateMany({
          where: {
            status: "ACTIVE",
            OR: [
              { bookingRoom: { is: { bookingId: booking.id } } },
              { reservationHold: { is: { bookingId: booking.id } } },
            ],
          },
          data: { status: "RELEASED" },
        });
        await transaction.reservationHold.updateMany({
          where: { bookingId: booking.id, status: "ACTIVE" },
          data: { status: "RELEASED" },
        });
        const now = new Date();
        await transaction.booking.update({
          where: { id: booking.id },
          data: {
            status: input.status,
            ...(input.status === BookingStatus.CANCELLED ? { cancelledAt: now } : {}),
          },
        });
        await transaction.auditLog.create({
          data: {
            propertyId: membership.propertyId,
            adminUserId,
            bookingId: booking.id,
            action: "BOOKING_STATUS_CHANGED",
            entityType: "Booking",
            entityId: booking.id,
            before: { status: booking.status },
            after: { status: input.status },
            metadata: { reason: input.reason, source: "ADMIN_BOOKING_ACTION" },
            ...(ipAddress ? { ipAddress } : {}),
          },
        });
        const primaryGuest = booking.guests[0];
        if (input.status === BookingStatus.CANCELLED && primaryGuest?.email) {
          await enqueueBookingNotification(transaction, {
            propertyId: membership.propertyId,
            bookingId: booking.id,
            recipient: primaryGuest.email,
            template: "BOOKING_CANCELLED",
            idempotencyKey: `booking:${booking.id}:cancelled`,
            payload: {
              firstName: primaryGuest.firstName,
              reference: booking.reference,
              roomName: booking.rooms[0]?.roomTypeNameSnapshot,
              arrival: booking.checkIn.toISOString().slice(0, 10),
              departure: booking.checkOut.toISOString().slice(0, 10),
              total: Number(booking.total),
              currency: booking.currency,
              reason: input.reason ?? undefined,
            },
          });
        }
        return booking.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (!isRetryableTransactionConflict(error) || attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS) throw error;
    }
  }
  if (!updatedBookingId) throw new AdminApiError(409, "BOOKING_UPDATE_CONFLICT", "La réservation a changé. Rechargez-la.");
  return getAdminBooking(membership.propertyId, updatedBookingId);
}

export async function listAvailableRoomsForBooking(propertyId: string, bookingId: string) {
  const now = new Date();
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, propertyId },
    select: {
      checkIn: true,
      checkOut: true,
      rooms: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { roomTypeId: true, roomId: true, allocation: { select: { id: true } } },
      },
    },
  });
  const bookingRoom = booking?.rooms[0];
  if (!booking || !bookingRoom) throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");

  const rooms = await prisma.room.findMany({
    where: {
      propertyId,
      roomTypeId: bookingRoom.roomTypeId,
      status: "ACTIVE",
      OR: [
        ...(bookingRoom.roomId ? [{ id: bookingRoom.roomId }] : []),
        {
          allocations: {
            none: {
              ...blockingRoomAllocationWhere(now),
              checkIn: { lt: booking.checkOut },
              checkOut: { gt: booking.checkIn },
              ...(bookingRoom.allocation ? { NOT: { id: bookingRoom.allocation.id } } : {}),
            },
          },
        },
      ],
    },
    orderBy: { number: "asc" },
    select: { id: true, number: true, floor: true },
  });
  return rooms.map((room) => ({ ...room, selected: room.id === bookingRoom.roomId }));
}

export async function assignAdminBookingRoom(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  roomId: string,
  ipAddress?: string,
) {
  const now = new Date();
  const updatedBookingId = await prisma.$transaction(async (transaction) => {
    const booking = await transaction.booking.findFirst({
      where: { id: bookingId, propertyId: membership.propertyId },
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        rooms: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, roomTypeId: true, roomId: true, roomNumberSnapshot: true, allocation: true },
        },
      },
    });
    const bookingRoom = booking?.rooms[0];
    if (!booking || !bookingRoom) throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new AdminApiError(409, "BOOKING_ROOM_NOT_ASSIGNABLE", "Seule une réservation confirmée peut changer de chambre.");
    }
    if (bookingRoom.roomId === roomId) return booking.id;

    const room = await transaction.room.findFirst({
      where: { id: roomId, propertyId: membership.propertyId, roomTypeId: bookingRoom.roomTypeId, status: "ACTIVE" },
      select: { id: true, number: true },
    });
    if (!room) throw new AdminApiError(400, "INVALID_BOOKING_ROOM", "Cette chambre ne correspond pas au type réservé.");
    const conflict = await transaction.roomAllocation.findFirst({
      where: {
        roomId: room.id,
        ...blockingRoomAllocationWhere(now),
        checkIn: { lt: booking.checkOut },
        checkOut: { gt: booking.checkIn },
        ...(bookingRoom.allocation ? { NOT: { id: bookingRoom.allocation.id } } : {}),
      },
      select: { id: true },
    });
    if (conflict) throw new AdminApiError(409, "BOOKING_ROOM_UNAVAILABLE", "Cette chambre n’est plus disponible sur le séjour.");

    if (bookingRoom.allocation) {
      await transaction.roomAllocation.update({ where: { id: bookingRoom.allocation.id }, data: { roomId: room.id } });
    } else {
      await transaction.roomAllocation.create({
        data: {
          roomId: room.id,
          bookingRoomId: bookingRoom.id,
          source: "BOOKING",
          status: "ACTIVE",
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
        },
      });
    }
    await transaction.bookingRoom.update({
      where: { id: bookingRoom.id },
      data: { roomId: room.id, roomNumberSnapshot: room.number },
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        bookingId: booking.id,
        action: "BOOKING_ROOM_ASSIGNED",
        entityType: "BookingRoom",
        entityId: bookingRoom.id,
        before: { roomId: bookingRoom.roomId, roomNumber: bookingRoom.roomNumberSnapshot },
        after: { roomId: room.id, roomNumber: room.number },
        metadata: { source: "ADMIN_BOOKING_ROOM_ASSIGNMENT" },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return booking.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return getAdminBooking(membership.propertyId, updatedBookingId);
}

export async function createAdminAvailabilityBlock(
  membership: AdminMembershipContext,
  adminUserId: string,
  roomId: string,
  input: AdminAvailabilityBlockInput,
  ipAddress?: string,
) {
  const now = new Date();
  try {
    return await prisma.$transaction(async (transaction) => {
      const room = await transaction.room.findFirst({
        where: { id: roomId, propertyId: membership.propertyId, status: { not: "ARCHIVED" } },
        select: { id: true, number: true },
      });
      if (!room) throw new AdminApiError(404, "ROOM_NOT_FOUND", "Chambre introuvable.");
      const conflict = await transaction.roomAllocation.findFirst({
        where: {
          roomId: room.id,
          ...blockingRoomAllocationWhere(now),
          checkIn: { lt: input.checkOut },
          checkOut: { gt: input.checkIn },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new AdminApiError(409, "ROOM_BLOCK_CONFLICT", "La chambre possède déjà une réservation, une option ou un blocage sur cette période.");
      }
      const block = await transaction.availabilityBlock.create({
        data: {
          propertyId: membership.propertyId,
          roomId: room.id,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          reason: input.reason,
          note: input.note,
        },
      });
      await transaction.roomAllocation.create({
        data: {
          roomId: room.id,
          availabilityBlockId: block.id,
          source: "BLOCK",
          status: "ACTIVE",
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        },
      });
      await transaction.auditLog.create({
        data: {
          propertyId: membership.propertyId,
          adminUserId,
          action: "ROOM_AVAILABILITY_BLOCK_CREATED",
          entityType: "AvailabilityBlock",
          entityId: block.id,
          before: Prisma.DbNull,
          after: {
            roomId: room.id,
            roomNumber: room.number,
            checkIn: isoDate(input.checkIn),
            checkOut: isoDate(input.checkOut),
            reason: input.reason,
            note: input.note,
          },
          metadata: { source: "ADMIN_ROOM_BLOCK" },
          ...(ipAddress ? { ipAddress } : {}),
        },
      });
      return { id: block.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isRetryableTransactionConflict(error)) {
      throw new AdminApiError(409, "ROOM_BLOCK_CONFLICT", "La disponibilité de cette chambre a changé. Rechargez la vue.");
    }
    throw error;
  }
}

export async function releaseAdminAvailabilityBlock(
  membership: AdminMembershipContext,
  adminUserId: string,
  blockId: string,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const block = await transaction.availabilityBlock.findFirst({
      where: { id: blockId, propertyId: membership.propertyId },
      include: { allocation: true, room: { select: { number: true } } },
    });
    if (!block) throw new AdminApiError(404, "ROOM_BLOCK_NOT_FOUND", "Blocage introuvable.");
    if (!block.allocation || block.allocation.status !== "ACTIVE") return { id: block.id, released: true };
    await transaction.roomAllocation.update({
      where: { id: block.allocation.id },
      data: { status: "RELEASED" },
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "ROOM_AVAILABILITY_BLOCK_RELEASED",
        entityType: "AvailabilityBlock",
        entityId: block.id,
        before: { status: "ACTIVE", roomNumber: block.room.number },
        after: { status: "RELEASED" },
        metadata: { source: "ADMIN_ROOM_BLOCK_RELEASE" },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return { id: block.id, released: true };
  });
}

function roomWhere(
  propertyId: string,
  input: RoomListInput,
): Prisma.RoomWhereInput {
  const search = input.search?.trim();
  return {
    propertyId,
    ...(input.status ? { status: input.status } : {}),
    ...(input.roomTypeId ? { roomTypeId: input.roomTypeId } : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" } },
            { roomType: { is: { name: { contains: search, mode: "insensitive" } } } },
            { roomType: { is: { slug: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

function activeRoomAllocationWhere(today: Date, now: Date): Prisma.RoomAllocationWhereInput {
  return {
    ...blockingRoomAllocationWhere(now),
    checkOut: { gt: today },
  };
}

function periodRoomAllocationWhere(
  from: Date,
  to: Date,
  now: Date,
): Prisma.RoomAllocationWhereInput {
  return {
    ...blockingRoomAllocationWhere(now),
    checkIn: { lt: to },
    checkOut: { gt: from },
  };
}

const roomAllocationDetails = {
  bookingRoom: {
    include: {
      booking: {
        select: {
          id: true,
          reference: true,
          status: true,
          checkIn: true,
          checkOut: true,
          guests: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
            select: { firstName: true, lastName: true },
          },
        },
      },
    },
  },
  reservationHold: {
    select: {
      status: true,
      expiresAt: true,
      booking: {
        select: {
          id: true,
          reference: true,
          status: true,
          checkIn: true,
          checkOut: true,
          guests: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
            select: { firstName: true, lastName: true },
          },
        },
      },
    },
  },
  availabilityBlock: { select: { id: true, reason: true, note: true } },
} satisfies Prisma.RoomAllocationInclude;

async function fetchRoomPage(where: Prisma.RoomWhereInput, input: RoomListInput, today: Date, now: Date) {
  const candidates = await prisma.room.findMany({
    where,
    select: { id: true, number: true, floor: true },
  });
  candidates.sort((first, second) => {
    const comparison = compareRoomNumbers(first, second, input.sortOrder);
    return comparison || first.id.localeCompare(second.id);
  });
  const pageRoomIds = candidates
    .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
    .map((room) => room.id);
  if (pageRoomIds.length === 0) return [];

  const rooms = await prisma.room.findMany({
    where: { AND: [where, { id: { in: pageRoomIds } }] },
    include: {
      roomType: { select: { id: true, name: true, slug: true } },
      allocations: {
        where: activeRoomAllocationWhere(today, now),
        orderBy: { checkIn: "asc" },
        take: 2,
        include: roomAllocationDetails,
      },
    },
  });
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  return pageRoomIds.flatMap((id) => {
    const room = roomsById.get(id);
    return room ? [room] : [];
  });
}

function fetchRoomPeriodConflicts(
  roomIds: string[],
  from: Date,
  to: Date,
  now: Date,
) {
  if (roomIds.length === 0) return Promise.resolve([]);
  return prisma.roomAllocation.findMany({
    where: {
      roomId: { in: roomIds },
      ...periodRoomAllocationWhere(from, to, now),
    },
    orderBy: [{ roomId: "asc" }, { checkIn: "asc" }, { checkOut: "asc" }],
    include: roomAllocationDetails,
  });
}

type RoomListRecord = Awaited<ReturnType<typeof fetchRoomPage>>[number];
type RoomAllocationRecord = RoomListRecord["allocations"][number];
type RoomPeriodConflictRecord = Awaited<ReturnType<typeof fetchRoomPeriodConflicts>>[number];

function serializeOccupancy(
  allocation: RoomAllocationRecord | RoomPeriodConflictRecord | undefined,
  role: AdminMembershipContext["role"],
) {
  if (!allocation) return null;
  if (allocation.source === "BLOCK") {
    return protectRoomOccupancyIdentity({
      kind: "BLOCK" as const,
      blockId: allocation.availabilityBlock?.id ?? null,
      bookingId: null,
      bookingReference: null,
      status: null,
      checkIn: isoDate(allocation.checkIn),
      checkOut: isoDate(allocation.checkOut),
      guest: null,
      holdExpiresAt: null,
      blockReason: allocation.availabilityBlock?.reason ?? "OTHER",
      note: allocation.availabilityBlock?.note ?? null,
    }, role);
  }

  const booking = allocation.bookingRoom?.booking ?? allocation.reservationHold?.booking;
  if (allocation.source === "BOOKING" && !booking) return null;
  const guest = booking?.guests[0];
  return protectRoomOccupancyIdentity({
    kind: allocation.source === "HOLD" ? "HOLD" as const : "BOOKING" as const,
    blockId: null,
    bookingId: booking?.id ?? null,
    bookingReference: booking?.reference ?? null,
    status: booking?.status ?? null,
    checkIn: isoDate(allocation.checkIn),
    checkOut: isoDate(allocation.checkOut),
    guest: guest ? { firstName: guest.firstName, lastName: guest.lastName } : null,
    holdExpiresAt: allocation.reservationHold?.expiresAt.toISOString() ?? null,
    blockReason: null,
    note: null,
  }, role);
}

function serializeRoom(
  room: RoomListRecord,
  today: Date,
  role: AdminMembershipContext["role"],
  period: { from: Date; to: Date } | null,
  periodConflicts: RoomPeriodConflictRecord[],
) {
  const current = room.allocations.find(
    (allocation) => allocation.checkIn <= today && allocation.checkOut > today,
  );
  const next = room.allocations.find((allocation) => allocation.checkIn > today);
  const conflicts = period
    ? periodConflicts
        .filter((allocation) =>
          roomIntervalsOverlap(allocation.checkIn, allocation.checkOut, period.from, period.to))
        .map((allocation) => serializeOccupancy(allocation, role))
        .filter((conflict) => conflict !== null)
    : [];
  return {
    id: room.id,
    number: room.number,
    floor: room.floor,
    status: room.status,
    notes: room.notes,
    updatedAt: room.updatedAt.toISOString(),
    roomType: room.roomType,
    currentOccupancy: serializeOccupancy(current, role),
    nextOccupancy: serializeOccupancy(next, role),
    periodAvailability: period ? {
      from: isoDate(period.from),
      to: isoDate(period.to),
      available: room.status === RoomStatus.ACTIVE && conflicts.length === 0,
      conflicts,
    } : null,
  };
}

function emptyRoomStatusCounts() {
  return Object.fromEntries(
    Object.values(RoomStatus).map((status) => [status, 0]),
  ) as Record<RoomStatus, number>;
}

export async function listAdminRooms(
  membership: AdminMembershipContext,
  input: RoomListInput,
) {
  await expirePropertyHolds(membership.propertyId);
  const now = new Date();
  const today = propertyDate(membership.property.timezone);
  const where = roomWhere(membership.propertyId, input);
  const period = input.from && input.to ? { from: input.from, to: input.to } : null;
  const activeAllocationWhere = activeRoomAllocationWhere(today, now);
  const currentAllocationWhere = {
    ...activeAllocationWhere,
    checkIn: { lte: today },
    checkOut: { gt: today },
  } satisfies Prisma.RoomAllocationWhereInput;

  const [
    rooms,
    total,
    statusGroups,
    roomTypes,
    occupiedNow,
    heldNow,
    blockedNow,
    unavailableNow,
    periodAvailable,
  ] = await Promise.all([
    fetchRoomPage(where, input, today, now),
    prisma.room.count({ where }),
    prisma.room.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.roomType.findMany({
      where: { propertyId: membership.propertyId },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    prisma.room.count({
      where: {
        AND: [
          where,
          {
            status: RoomStatus.ACTIVE,
            allocations: {
              some: {
                ...currentAllocationWhere,
                source: "BOOKING",
              },
            },
          },
        ],
      },
    }),
    prisma.room.count({
      where: {
        AND: [where, { status: RoomStatus.ACTIVE, allocations: { some: { ...currentAllocationWhere, source: "HOLD" } } }],
      },
    }),
    prisma.room.count({
      where: {
        AND: [where, { status: RoomStatus.ACTIVE, allocations: { some: { ...currentAllocationWhere, source: "BLOCK" } } }],
      },
    }),
    prisma.room.count({
      where: {
        AND: [where, { status: RoomStatus.ACTIVE, allocations: { some: currentAllocationWhere } }],
      },
    }),
    period
      ? prisma.room.count({
          where: {
            AND: [
              where,
              {
                status: RoomStatus.ACTIVE,
                allocations: {
                  none: periodRoomAllocationWhere(period.from, period.to, now),
                },
              },
            ],
          },
        })
      : Promise.resolve(null),
  ]);

  const periodConflictRows = period
    ? await fetchRoomPeriodConflicts(rooms.map((room) => room.id), period.from, period.to, now)
    : [];
  const conflictsByRoom = new Map<string, RoomPeriodConflictRecord[]>();
  for (const conflict of periodConflictRows) {
    const roomConflicts = conflictsByRoom.get(conflict.roomId) ?? [];
    roomConflicts.push(conflict);
    conflictsByRoom.set(conflict.roomId, roomConflicts);
  }

  const byStatus = emptyRoomStatusCounts();
  for (const group of statusGroups) byStatus[group.status] = group._count._all;

  return {
    items: rooms.map((room) => serializeRoom(
      room,
      today,
      membership.role,
      period,
      conflictsByRoom.get(room.id) ?? [],
    )),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
    summary: {
      total,
      byStatus,
      roomTypes,
      occupiedNow,
      heldNow,
      blockedNow,
      availableNow: Math.max(0, byStatus.ACTIVE - unavailableNow),
      period: period && periodAvailable !== null ? {
        from: isoDate(period.from),
        to: isoDate(period.to),
        available: periodAvailable,
        unavailable: Math.max(0, total - periodAvailable),
      } : null,
    },
  };
}

export async function updateAdminRoom(
  membership: AdminMembershipContext,
  adminUserId: string,
  roomId: string,
  input: AdminRoomUpdateInput,
  ipAddress?: string,
) {
  await expirePropertyHolds(membership.propertyId);
  const now = new Date();
  const today = propertyDate(membership.property.timezone, now);

  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const room = await transaction.room.findFirst({
          where: { id: roomId, propertyId: membership.propertyId },
          select: editableRoomSelect,
        });
        if (!room) {
          throw new AdminApiError(404, "ROOM_NOT_FOUND", "Chambre introuvable.");
        }
        if (room.updatedAt.getTime() !== input.updatedAt.getTime()) {
          throw new AdminApiError(
            409,
            "ROOM_VERSION_CONFLICT",
            "Cette chambre a été modifiée depuis son chargement. Rechargez-la avant de réessayer.",
          );
        }

        const changes = input.changes;
        const hasChange = (field: keyof typeof changes) =>
          Object.prototype.hasOwnProperty.call(changes, field);
        const updateData: Prisma.RoomUncheckedUpdateManyInput = {};

        if (hasChange("number") && changes.number !== room.number) {
          const duplicate = await transaction.room.findFirst({
            where: {
              propertyId: membership.propertyId,
              number: changes.number,
              NOT: { id: room.id },
            },
            select: { id: true },
          });
          if (duplicate) {
            throw new AdminApiError(
              409,
              "ROOM_NUMBER_CONFLICT",
              "Ce numéro est déjà utilisé par une autre chambre.",
            );
          }
          updateData.number = changes.number;
        }

        if (hasChange("roomTypeId")) {
          const roomType = await transaction.roomType.findFirst({
            where: { id: changes.roomTypeId, propertyId: membership.propertyId },
            select: { id: true },
          });
          if (!roomType) {
            throw new AdminApiError(
              400,
              "INVALID_ROOM_TYPE",
              "Le type de chambre n'appartient pas à cet établissement.",
            );
          }
          if (changes.roomTypeId !== room.roomTypeId) updateData.roomTypeId = changes.roomTypeId;
        }

        if (hasChange("floor") && changes.floor !== room.floor) updateData.floor = changes.floor;
        const nextStatus = hasChange("status") && changes.status !== room.status
          ? changes.status
          : undefined;
        if (nextStatus) updateData.status = nextStatus;
        if (hasChange("notes") && changes.notes !== room.notes) updateData.notes = changes.notes;

        if (Object.keys(updateData).length === 0) {
          throw new AdminApiError(
            400,
            "NO_ROOM_CHANGES",
            "Aucune modification effective n'a été détectée.",
          );
        }

        const changesRoomType = updateData.roomTypeId !== undefined;
        const blockingSources = blockingAllocationSourcesForRoomUpdate(changesRoomType, nextStatus);
        if (blockingSources.length > 0) {
          const allocation = await transaction.roomAllocation.findFirst({
            where: {
              roomId: room.id,
              checkOut: { gt: today },
              ...blockingRoomAllocationWhere(now),
              source: { in: blockingSources },
            },
            select: { id: true },
          });
          if (allocation) {
            throw new AdminApiError(
              409,
              "ROOM_HAS_BLOCKING_ALLOCATIONS",
              blockingSources.includes(AllocationSource.BLOCK)
                ? "Cette chambre possède une réservation, une option ou un blocage actuel ou futur."
                : "Cette chambre possède une réservation ou une option actuelle ou future.",
            );
          }
        }

        const nextUpdatedAt = new Date(Math.max(Date.now(), room.updatedAt.getTime() + 1));
        updateData.updatedAt = nextUpdatedAt;
        const updateResult = await transaction.room.updateMany({
          where: {
            id: room.id,
            propertyId: membership.propertyId,
            updatedAt: input.updatedAt,
          },
          data: updateData,
        });
        if (updateResult.count !== 1) {
          throw new AdminApiError(
            409,
            "ROOM_VERSION_CONFLICT",
            "Cette chambre a été modifiée depuis son chargement. Rechargez-la avant de réessayer.",
          );
        }

        const updatedRoom = await transaction.room.findUniqueOrThrow({
          where: { id: room.id },
          select: editableRoomSelect,
        });
        await transaction.auditLog.create({
          data: {
            propertyId: membership.propertyId,
            adminUserId,
            action: "ROOM_UPDATED",
            entityType: "Room",
            entityId: room.id,
            before: roomAuditSnapshot(room),
            after: roomAuditSnapshot(updatedRoom),
            metadata: { role: membership.role, source: "ADMIN_ROOM_EDIT" },
            ...(ipAddress ? { ipAddress } : {}),
          },
        });

        return serializeEditableRoom(updatedRoom);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new AdminApiError(
          409,
          "ROOM_NUMBER_CONFLICT",
          "Ce numéro est déjà utilisé par une autre chambre.",
        );
      }
      if (!isRetryableTransactionConflict(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS) {
        throw new AdminApiError(
          409,
          "ROOM_UPDATE_CONFLICT",
          "La chambre a changé pendant la modification. Rechargez-la avant de réessayer.",
        );
      }
    }
  }

  throw new AdminApiError(
    409,
    "ROOM_UPDATE_CONFLICT",
    "La chambre a changé pendant la modification. Rechargez-la avant de réessayer.",
  );
}

export async function createAdminRoom(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminRoomCreateInput,
  ipAddress?: string,
) {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const roomType = await transaction.roomType.findFirst({
          where: { id: input.roomTypeId, propertyId: membership.propertyId },
          select: { id: true },
        });
        if (!roomType) {
          throw new AdminApiError(
            400,
            "INVALID_ROOM_TYPE",
            "Le type de chambre n'appartient pas à cet établissement.",
          );
        }

        const duplicate = await transaction.room.findFirst({
          where: { propertyId: membership.propertyId, number: input.number },
          select: { id: true },
        });
        if (duplicate) {
          throw new AdminApiError(
            409,
            "ROOM_NUMBER_CONFLICT",
            "Ce numéro est déjà utilisé par une chambre, éventuellement archivée.",
          );
        }

        let room: EditableRoomRecord;
        try {
          room = await transaction.room.create({
            data: {
              propertyId: membership.propertyId,
              roomTypeId: input.roomTypeId,
              number: input.number,
              floor: input.floor,
              status: input.status,
              notes: input.notes,
            },
            select: editableRoomSelect,
          });
        } catch (error) {
          if (isForeignKeyConstraintViolation(error)) {
            throw new AdminApiError(
              400,
              "INVALID_ROOM_TYPE",
              "Le type de chambre n'appartient plus à cet établissement.",
            );
          }
          throw error;
        }

        await transaction.auditLog.create({
          data: {
            propertyId: membership.propertyId,
            adminUserId,
            action: "ROOM_CREATED",
            entityType: "Room",
            entityId: room.id,
            before: Prisma.DbNull,
            after: roomAuditSnapshot(room),
            metadata: { role: membership.role, source: "ADMIN_ROOM_CREATE" },
            ...(ipAddress ? { ipAddress } : {}),
          },
        });

        return serializeEditableRoom(room);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new AdminApiError(
          409,
          "ROOM_NUMBER_CONFLICT",
          "Ce numéro est déjà utilisé par une chambre, éventuellement archivée.",
        );
      }
      if (!isRetryableTransactionConflict(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS) {
        throw new AdminApiError(
          409,
          "ROOM_CREATE_CONFLICT",
          "L'inventaire a changé pendant la création. Réessayez dans quelques instants.",
        );
      }
    }
  }

  throw new AdminApiError(
    409,
    "ROOM_CREATE_CONFLICT",
    "L'inventaire a changé pendant la création. Réessayez dans quelques instants.",
  );
}

export async function deleteAdminRoom(
  membership: AdminMembershipContext,
  adminUserId: string,
  roomId: string,
  input: AdminRoomDeleteInput,
  ipAddress?: string,
) {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const room = await transaction.room.findFirst({
          where: { id: roomId, propertyId: membership.propertyId },
          select: roomDeletionSelect,
        });
        if (!room) {
          throw new AdminApiError(404, "ROOM_NOT_FOUND", "Chambre introuvable.");
        }
        if (room.updatedAt.getTime() !== input.updatedAt.getTime()) {
          throw new AdminApiError(
            409,
            "ROOM_VERSION_CONFLICT",
            "Cette chambre a été modifiée depuis son chargement. Rechargez-la avant de réessayer.",
          );
        }
        if (roomHasHistory(room._count)) {
          throw new AdminApiError(
            409,
            "ROOM_HAS_HISTORY",
            "Cette chambre possède un historique et ne peut pas être supprimée. Archivez-la pour la retirer de l'inventaire actif.",
          );
        }

        await transaction.auditLog.create({
          data: {
            propertyId: membership.propertyId,
            adminUserId,
            action: "ROOM_DELETED",
            entityType: "Room",
            entityId: room.id,
            before: roomAuditSnapshot(room),
            after: Prisma.DbNull,
            metadata: { role: membership.role, source: "ADMIN_ROOM_DELETE" },
            ...(ipAddress ? { ipAddress } : {}),
          },
        });

        let deletion: { count: number };
        try {
          deletion = await transaction.room.deleteMany({
            where: {
              id: room.id,
              propertyId: membership.propertyId,
              updatedAt: input.updatedAt,
            },
          });
        } catch (error) {
          if (isForeignKeyConstraintViolation(error)) {
            throw new AdminApiError(
              409,
              "ROOM_HAS_HISTORY",
              "Cette chambre possède désormais un historique et ne peut pas être supprimée. Archivez-la pour la retirer de l'inventaire actif.",
            );
          }
          throw error;
        }
        if (deletion.count !== 1) {
          throw new AdminApiError(
            409,
            "ROOM_VERSION_CONFLICT",
            "Cette chambre a été modifiée depuis son chargement. Rechargez-la avant de réessayer.",
          );
        }

        return { id: room.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS) {
        throw new AdminApiError(
          409,
          "ROOM_VERSION_CONFLICT",
          "Cette chambre a changé pendant la suppression. Rechargez-la avant de réessayer.",
        );
      }
    }
  }

  throw new AdminApiError(
    409,
    "ROOM_VERSION_CONFLICT",
    "Cette chambre a changé pendant la suppression. Rechargez-la avant de réessayer.",
  );
}
