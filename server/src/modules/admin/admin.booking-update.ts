import { Prisma, BookingStatus, type BookingSource } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { assertExpectedTotal, buildTaxInclusivePrice, moneyToCents } from "../booking/booking.pricing.js";
import { parseCreateBookingBody } from "../booking/booking.validation.js";
import { BookingError } from "../booking/booking.errors.js";
import { bookingAccessTokenExpiresAt } from "../booking/booking.access.js";
import { expireStaleBookingHolds } from "../booking/booking.holds.js";
import type { BookingQuote, BookingSelectionInput } from "../booking/booking.types.js";
import { retentionDeadlineFrom } from "../privacy/retention.service.js";
import { enqueueBookingNotification } from "../notifications/notification.service.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import { getAdminBooking } from "./admin.service.js";

const UPDATE_FIELDS = new Set([
  "updatedAt",
  "roomTypeId",
  "arrival",
  "departure",
  "adults",
  "children",
  "extraIds",
  "expectedTotal",
  "guest",
  "specialRequests",
  "reason",
]);
const MAX_TRANSACTION_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAdminError(error: unknown): never {
  if (error instanceof BookingError) {
    throw new AdminApiError(error.statusCode, error.code, error.message);
  }
  throw error;
}

function retryableConflict(error: unknown) {
  if (!isRecord(error)) return false;
  const values = [error.code, error.message, isRecord(error.meta) ? error.meta.code : undefined]
    .filter((value): value is string => typeof value === "string");
  return values.some((value) =>
    value === "P2034"
    || value === "40001"
    || value === "23P01"
    || value.includes("room_allocations_no_active_overlap")
    || value.toLowerCase().includes("serialization failure"),
  );
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function money(value: Prisma.Decimal) {
  return value.toFixed(2);
}

export type AdminBookingUpdateInput = ReturnType<typeof parseAdminBookingUpdateBody>;

export function parseAdminBookingUpdateBody(body: unknown) {
  if (!isRecord(body) || Object.keys(body).some((field) => !UPDATE_FIELDS.has(field))) {
    throw new AdminApiError(400, "INVALID_BOOKING_UPDATE", "La modification contient un champ non autorisé.");
  }
  if (typeof body.updatedAt !== "string") {
    throw new AdminApiError(400, "INVALID_BOOKING_UPDATE", "La version de la réservation est invalide.");
  }
  const updatedAt = new Date(body.updatedAt);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== body.updatedAt) {
    throw new AdminApiError(400, "INVALID_BOOKING_UPDATE", "La version de la réservation est invalide.");
  }
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
    throw new AdminApiError(400, "INVALID_BOOKING_UPDATE", "Le motif de modification est invalide.");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 500) {
    throw new AdminApiError(400, "INVALID_BOOKING_UPDATE", "Le motif est limité à 500 caractères.");
  }

  const { updatedAt: _updatedAt, reason: _reason, ...bookingFields } = body;
  try {
    const booking = parseCreateBookingBody(
      { ...bookingFields, termsAccepted: true },
      { contactRequired: false },
    );
    return { ...booking, updatedAt, reason: reason || null };
  } catch (error) {
    return asAdminError(error);
  }
}

export function bookingPricingChanged(
  current: {
    checkIn: Date;
    checkOut: Date;
    adults: number;
    children: number;
    roomTypeId: string;
    extraIds: string[];
  },
  input: AdminBookingUpdateInput,
) {
  const currentExtras = [...current.extraIds].sort();
  const nextExtras = [...input.extraIds].sort();
  return current.checkIn.getTime() !== input.arrival.getTime()
    || current.checkOut.getTime() !== input.departure.getTime()
    || current.adults !== input.adults
    || current.children !== input.children
    || current.roomTypeId !== input.roomTypeId
    || currentExtras.length !== nextExtras.length
    || currentExtras.some((id, index) => id !== nextExtras[index]);
}

async function resolveUpdatedPricing(
  transaction: Prisma.TransactionClient,
  propertyId: string,
  bookingId: string,
  input: BookingSelectionInput,
  reason: string | null = null,
  preferredRoomId?: string | null,
) {
  const now = new Date();
  const nights = Math.round((input.departure.getTime() - input.arrival.getTime()) / 86_400_000);
  const guests = input.adults + input.children;
  const roomType = await transaction.roomType.findFirst({
    where: { id: input.roomTypeId, propertyId },
    include: {
      property: {
        select: {
          currency: true,
          taxRules: {
            where: {
              isActive: true,
              kind: "TOURIST_TAX",
              AND: [
                { OR: [{ validFrom: null }, { validFrom: { lte: input.arrival } }] },
                { OR: [{ validUntil: null }, { validUntil: { gte: input.departure } }] },
              ],
            },
            orderBy: [{ priority: "asc" }, { code: "asc" }],
          },
        },
      },
      ratePlans: {
        where: {
          isActive: true,
          minNights: { lte: nights },
          priceTaxMode: "INCLUSIVE",
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: input.arrival } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: input.departure } }] },
          ],
        },
        orderBy: { basePricePerNight: "asc" },
      },
      promotions: {
        where: {
          isActive: true,
          validFrom: { lte: input.arrival },
          OR: [{ validUntil: null }, { validUntil: { gte: input.departure } }],
        },
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
      rooms: {
        where: {
          status: "ACTIVE",
          allocations: {
            none: {
              status: "ACTIVE",
              checkIn: { lt: input.departure },
              checkOut: { gt: input.arrival },
              OR: [
                { source: { in: ["BOOKING", "BLOCK"] } },
                {
                  source: "HOLD",
                  reservationHold: { is: { status: "ACTIVE", expiresAt: { gt: now } } },
                },
              ],
              NOT: {
                OR: [
                  { bookingRoom: { is: { bookingId } } },
                  { reservationHold: { is: { bookingId } } },
                ],
              },
            },
          },
        },
        orderBy: { number: "asc" },
        select: { id: true, number: true },
      },
    },
  });

  if (!roomType || !roomType.isPublished || roomType.archivedAt) {
    throw new AdminApiError(404, "ROOM_TYPE_NOT_FOUND", "Ce type de chambre est introuvable.");
  }
  if (input.adults > roomType.maxAdults || input.children > roomType.maxChildren || guests > roomType.maxGuests) {
    throw new AdminApiError(400, "ROOM_CAPACITY_EXCEEDED", "Le nombre de voyageurs dépasse la capacité de cette chambre.");
  }
  const room = roomType.rooms.find((candidate) => candidate.id === preferredRoomId) ?? roomType.rooms[0];
  if (!room) throw new AdminApiError(409, "ROOM_NOT_AVAILABLE", "Aucune chambre n'est disponible pour ces dates.");

  const ratePlan = roomType.ratePlans.find((rate) => rate.currency === roomType.property.currency);
  if (!ratePlan) throw new AdminApiError(409, "RATE_NOT_AVAILABLE", "Aucun tarif TTC n'est disponible pour ce séjour.");
  const promotion = roomType.promotions[0] ?? null;
  const nightlyPrice = promotion?.promotionalPricePerNight ?? ratePlan.basePricePerNight;
  const selectedExtras = input.extraIds.length
    ? await transaction.extra.findMany({
        where: {
          id: { in: input.extraIds },
          propertyId,
          currency: roomType.property.currency,
          priceTaxMode: "INCLUSIVE",
          isActive: true,
        },
        orderBy: { displayOrder: "asc" },
      })
    : [];
  if (selectedExtras.length !== input.extraIds.length) {
    throw new AdminApiError(400, "EXTRA_NOT_AVAILABLE", "Une ou plusieurs options ne sont pas disponibles.");
  }

  const price = buildTaxInclusivePrice({
    nightlyPrice,
    accommodationTaxRate: ratePlan.taxRate,
    nights,
    adults: input.adults,
    children: input.children,
    extras: selectedExtras.map((extra) => ({
      item: extra,
      price: extra.price,
      pricingUnit: extra.pricingUnit,
      taxRate: extra.taxRate,
    })),
    taxRules: roomType.property.taxRules
      .filter((rule) => rule.currency === null || rule.currency === roomType.property.currency)
      .map((rule) => ({
        rule,
        calculationMode: rule.calculationMode,
        rate: rule.rate,
        amount: rule.amount,
      })),
  });
  const pricedExtras = price.extras.map(({ item, ...values }) => ({ extra: item, ...values }));

  const pricingSnapshot = {
    version: 4,
    priceTaxMode: "INCLUSIVE",
    revision: { channel: "ADMIN_BOOKING_UPDATE", reason },
    nights,
    roomType: { id: roomType.id, slug: roomType.slug, name: roomType.name },
    ratePlan: {
      id: ratePlan.id,
      code: ratePlan.code,
      name: ratePlan.name,
      baseNightlyPriceTtc: money(ratePlan.basePricePerNight),
      nightlyPriceTtc: money(nightlyPrice),
      taxRate: ratePlan.taxRate.toFixed(2),
      taxAmountIncluded: money(price.accommodationTax),
      refundable: ratePlan.refundable,
    },
    promotion: promotion ? {
      id: promotion.id,
      label: promotion.label,
      discountPercent: promotion.discountPercent.toFixed(2),
      referenceNightlyPriceTtc: money(promotion.referencePricePerNight),
      promotionalNightlyPriceTtc: money(promotion.promotionalPricePerNight),
      validFrom: dateOnly(promotion.validFrom),
      validUntil: promotion.validUntil ? dateOnly(promotion.validUntil) : null,
    } : null,
    extras: pricedExtras.map(({ extra, quantity, lineSubtotal, lineTotal, taxRate, taxAmount }) => ({
      id: extra.id,
      code: extra.code,
      name: extra.name,
      pricingUnit: extra.pricingUnit,
      unitPriceTtc: money(extra.price),
      quantity,
      lineSubtotalExcludingTax: money(lineSubtotal),
      lineTotal: money(lineTotal),
      taxRate: taxRate.toFixed(2),
      taxAmountIncluded: money(taxAmount),
    })),
    accommodationSubtotalExcludingTax: money(price.accommodationSubtotal),
    accommodationTotalIncludingTax: money(price.accommodationTotal),
    extrasSubtotalExcludingTax: money(price.extrasSubtotal),
    extrasTotalIncludingTax: money(price.extrasTotal),
    vatTotalIncluded: money(price.vatTotal),
    touristTaxTotal: money(price.touristTaxTotal),
    taxTotal: money(price.taxTotal),
    total: money(price.total),
    currency: ratePlan.currency,
  };

  return { nights, roomType, room, ratePlan, nightlyPrice, price, pricedExtras, pricingSnapshot };
}

export async function getAdminBookingUpdateQuote(
  propertyId: string,
  bookingId: string,
  input: BookingSelectionInput,
): Promise<BookingQuote> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, propertyId },
    select: {
      rooms: { orderBy: { createdAt: "asc" }, take: 1, select: { roomId: true } },
      hold: { select: { roomId: true } },
    },
  });
  if (!booking) throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
  const resolved = await prisma.$transaction(async (transaction) => {
    await expireStaleBookingHolds(transaction, new Date(), propertyId);
    return resolveUpdatedPricing(
      transaction,
      propertyId,
      bookingId,
      input,
      null,
      booking.rooms[0]?.roomId ?? booking.hold?.roomId,
    );
  });
  return {
    priceTaxMode: "INCLUSIVE",
    currency: resolved.ratePlan.currency,
    nights: resolved.nights,
    room: {
      id: resolved.roomType.id,
      slug: resolved.roomType.slug,
      name: resolved.roomType.name,
      unitPrice: Number(resolved.nightlyPrice),
      subtotal: Number(resolved.price.accommodationSubtotal),
      taxAmount: Number(resolved.price.accommodationTax),
      total: Number(resolved.price.accommodationTotal),
      promotion: resolved.roomType.promotions[0] ? {
        id: resolved.roomType.promotions[0].id,
        label: resolved.roomType.promotions[0].label,
        discountPercent: Number(resolved.roomType.promotions[0].discountPercent),
        referenceUnitPrice: Number(resolved.roomType.promotions[0].referencePricePerNight),
      } : null,
    },
    extras: resolved.pricedExtras.map(({ extra, quantity, unitPrice, pricingUnit, lineSubtotal, taxAmount, lineTotal }) => ({
      id: extra.id,
      code: extra.code,
      name: extra.name,
      unitPrice: Number(unitPrice),
      pricingUnit,
      quantity,
      subtotal: Number(lineSubtotal),
      taxAmount: Number(taxAmount),
      total: Number(lineTotal),
    })),
    accommodationTotal: Number(resolved.price.accommodationTotal),
    extrasTotal: Number(resolved.price.extrasTotal),
    vatTotalIncluded: Number(resolved.price.vatTotal),
    touristTaxTotal: Number(resolved.price.touristTaxTotal),
    total: Number(resolved.price.total),
  };
}

function sourceContactValid(source: BookingSource, input: AdminBookingUpdateInput) {
  if (source === "PHONE" && !input.guest.phone) {
    throw new AdminApiError(400, "BOOKING_PHONE_REQUIRED", "Un numéro de téléphone est requis pour cette réservation.");
  }
  if (source === "EMAIL" && !input.guest.email) {
    throw new AdminApiError(400, "BOOKING_EMAIL_REQUIRED", "Une adresse e-mail est requise pour cette réservation.");
  }
}

export async function updateAdminBooking(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  input: AdminBookingUpdateInput,
  ipAddress?: string,
) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(async (transaction) => {
        await expireStaleBookingHolds(transaction, new Date(), membership.propertyId);
        const booking = await transaction.booking.findFirst({
          where: { id: bookingId, propertyId: membership.propertyId },
          include: {
            rooms: { orderBy: { createdAt: "asc" }, take: 1, include: { allocation: true } },
            extras: { select: { extraId: true } },
            guests: { where: { isPrimary: true }, orderBy: { createdAt: "asc" }, take: 1 },
            hold: { include: { allocation: true } },
            _count: { select: { payments: true, invoices: true } },
          },
        });
        const bookingRoom = booking?.rooms[0];
        const primaryGuest = booking?.guests[0];
        if (!booking || !bookingRoom || !primaryGuest) {
          throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
        }
        if (booking.updatedAt.getTime() !== input.updatedAt.getTime()) {
          throw new AdminApiError(409, "BOOKING_UPDATE_CONFLICT", "La réservation a changé. Rechargez-la avant de recommencer.");
        }
        if (booking.anonymizedAt) {
          throw new AdminApiError(409, "BOOKING_ANONYMIZED", "Une réservation anonymisée ne peut plus être modifiée.");
        }
        if (booking.status !== BookingStatus.PENDING_PAYMENT && booking.status !== BookingStatus.CONFIRMED) {
          throw new AdminApiError(409, "BOOKING_NOT_EDITABLE", "Seule une réservation en attente ou confirmée peut être modifiée.");
        }
        sourceContactValid(booking.source, input);

        const pricingChanged = bookingPricingChanged({
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          adults: booking.adults,
          children: booking.children,
          roomTypeId: bookingRoom.roomTypeId,
          extraIds: booking.extras.map((extra) => extra.extraId),
        }, input);
        if (pricingChanged && (booking._count.payments > 0 || booking._count.invoices > 0)) {
          throw new AdminApiError(
            409,
            "BOOKING_HAS_FINANCIAL_HISTORY",
            "Le séjour ne peut plus être retarifé après la création d'un paiement ou d'un document comptable.",
          );
        }

        const resolved = pricingChanged
          ? await resolveUpdatedPricing(
              transaction,
              membership.propertyId,
              booking.id,
              input,
              input.reason,
              bookingRoom.roomId ?? booking.hold?.roomId,
            )
          : null;
        if (resolved) assertExpectedTotal(input.expectedTotal, resolved.price.total);
        if (!pricingChanged && input.expectedTotal !== moneyToCents(booking.total)) {
          throw new AdminApiError(409, "PRICE_CHANGED", "Le montant actuel de la réservation a changé. Rechargez-la.");
        }

        const retainedUntil = pricingChanged
          ? retentionDeadlineFrom(input.departure)
          : booking.personalDataRetainUntil;
        const claimed = await transaction.booking.updateMany({
          where: { id: booking.id, updatedAt: input.updatedAt },
          data: {
            checkIn: input.arrival,
            checkOut: input.departure,
            adults: input.adults,
            children: input.children,
            specialRequests: input.specialRequests ?? null,
            ...(resolved ? {
              currency: resolved.ratePlan.currency,
              priceTaxMode: "INCLUSIVE",
              accommodationSubtotal: resolved.price.accommodationTotal,
              extrasSubtotal: resolved.price.extrasTotal,
              touristTaxTotal: resolved.price.touristTaxTotal,
              taxTotal: resolved.price.taxTotal,
              total: resolved.price.total,
              pricingSnapshot: resolved.pricingSnapshot,
              personalDataRetainUntil: retainedUntil,
              publicAccessTokenExpiresAt: bookingAccessTokenExpiresAt(input.departure),
            } : {}),
          },
        });
        if (claimed.count !== 1) {
          throw new AdminApiError(409, "BOOKING_UPDATE_CONFLICT", "La réservation a changé. Rechargez-la avant de recommencer.");
        }

        await transaction.guest.update({
          where: { id: primaryGuest.id },
          data: {
            firstName: input.guest.firstName,
            lastName: input.guest.lastName,
            email: input.guest.email ?? null,
            phone: input.guest.phone ?? null,
            countryCode: input.guest.countryCode ?? null,
          },
        });

        if (input.guest.email) {
          await enqueueBookingNotification(transaction, {
            propertyId: membership.propertyId,
            bookingId: booking.id,
            recipient: input.guest.email,
            template: "BOOKING_UPDATED",
            idempotencyKey: `booking:${booking.id}:updated:${input.updatedAt.toISOString()}`,
            payload: {
              firstName: input.guest.firstName,
              reference: booking.reference,
              roomName: resolved?.roomType.name ?? bookingRoom.roomTypeNameSnapshot,
              arrival: dateOnly(input.arrival),
              departure: dateOnly(input.departure),
              total: Number(resolved?.price.total ?? booking.total),
              currency: resolved?.ratePlan.currency ?? booking.currency,
            },
          });
        }

        if (resolved) {
          if (booking.status === BookingStatus.CONFIRMED) {
            if (bookingRoom.allocation) {
              await transaction.roomAllocation.update({
                where: { id: bookingRoom.allocation.id },
                data: { roomId: resolved.room.id, checkIn: input.arrival, checkOut: input.departure },
              });
            } else {
              await transaction.roomAllocation.create({
                data: {
                  roomId: resolved.room.id,
                  bookingRoomId: bookingRoom.id,
                  source: "BOOKING",
                  status: "ACTIVE",
                  checkIn: input.arrival,
                  checkOut: input.departure,
                },
              });
            }
          } else {
            if (!booking.hold || booking.hold.status !== "ACTIVE" || booking.hold.expiresAt <= new Date() || !booking.hold.allocation) {
              throw new AdminApiError(409, "BOOKING_HOLD_EXPIRED", "L'option de cette réservation a expiré.");
            }
            await transaction.reservationHold.update({
              where: { id: booking.hold.id },
              data: {
                roomTypeId: resolved.roomType.id,
                roomId: resolved.room.id,
                checkIn: input.arrival,
                checkOut: input.departure,
                adults: input.adults,
                children: input.children,
              },
            });
            await transaction.roomAllocation.update({
              where: { id: booking.hold.allocation.id },
              data: { roomId: resolved.room.id, checkIn: input.arrival, checkOut: input.departure },
            });
          }

          await transaction.bookingRoom.update({
            where: { id: bookingRoom.id },
            data: {
              roomTypeId: resolved.roomType.id,
              ratePlanId: resolved.ratePlan.id,
              roomId: booking.status === BookingStatus.CONFIRMED ? resolved.room.id : null,
              roomTypeNameSnapshot: resolved.roomType.name,
              roomNumberSnapshot: booking.status === BookingStatus.CONFIRMED ? resolved.room.number : null,
              nightlyPriceSnapshot: resolved.nightlyPrice,
              taxRateSnapshot: resolved.ratePlan.taxRate,
              taxAmountSnapshot: resolved.price.accommodationTax,
              priceTaxModeSnapshot: "INCLUSIVE",
              lineTotal: resolved.price.accommodationTotal,
            },
          });

          await transaction.bookingExtra.deleteMany({ where: { bookingId: booking.id } });
          if (resolved.pricedExtras.length) {
            await transaction.bookingExtra.createMany({
              data: resolved.pricedExtras.map(({ extra, quantity, lineTotal, taxRate, taxAmount }) => ({
                bookingId: booking.id,
                extraId: extra.id,
                nameSnapshot: extra.name,
                unitPriceSnapshot: extra.price,
                pricingUnitSnapshot: extra.pricingUnit,
                priceTaxModeSnapshot: "INCLUSIVE",
                taxRateSnapshot: taxRate,
                taxAmountSnapshot: taxAmount,
                quantity,
                lineTotal,
              })),
            });
          }

          await transaction.bookingTaxLine.deleteMany({ where: { bookingId: booking.id } });
          await transaction.bookingTaxLine.createMany({
            data: [
              {
                bookingId: booking.id,
                kind: "VAT",
                labelSnapshot: "TVA hébergement",
                calculationModeSnapshot: "PERCENTAGE",
                rateSnapshot: resolved.ratePlan.taxRate,
                quantitySnapshot: 1,
                taxableBase: resolved.price.accommodationSubtotal,
                amount: resolved.price.accommodationTax,
                sortOrder: 0,
              },
              ...resolved.pricedExtras.map(({ extra, lineSubtotal, taxRate, taxAmount }, index) => ({
                bookingId: booking.id,
                kind: "VAT" as const,
                labelSnapshot: `TVA ${extra.name}`,
                calculationModeSnapshot: "PERCENTAGE" as const,
                rateSnapshot: taxRate,
                quantitySnapshot: new Prisma.Decimal(1),
                taxableBase: lineSubtotal,
                amount: taxAmount,
                sortOrder: index + 1,
              })),
              ...resolved.price.touristTaxes.map(({ rule, quantity, taxableBase, amount }, index) => ({
                bookingId: booking.id,
                taxRuleId: rule.id,
                kind: rule.kind,
                labelSnapshot: rule.label,
                calculationModeSnapshot: rule.calculationMode,
                rateSnapshot: rule.rate,
                unitAmountSnapshot: rule.amount,
                quantitySnapshot: quantity,
                taxableBase,
                amount,
                metadataSnapshot: rule.metadata ?? undefined,
                sortOrder: resolved.pricedExtras.length + index + 1,
              })),
            ],
          });
        }

        await transaction.auditLog.create({
          data: {
            propertyId: membership.propertyId,
            adminUserId,
            bookingId: booking.id,
            action: "BOOKING_UPDATED_BY_ADMIN",
            entityType: "Booking",
            entityId: booking.id,
            before: {
              checkIn: dateOnly(booking.checkIn),
              checkOut: dateOnly(booking.checkOut),
              adults: booking.adults,
              children: booking.children,
              roomTypeId: bookingRoom.roomTypeId,
              extraIds: booking.extras.map((extra) => extra.extraId),
              total: money(booking.total),
            },
            after: {
              checkIn: dateOnly(input.arrival),
              checkOut: dateOnly(input.departure),
              adults: input.adults,
              children: input.children,
              roomTypeId: input.roomTypeId,
              extraIds: input.extraIds,
              total: resolved ? money(resolved.price.total) : money(booking.total),
            },
            metadata: {
              source: "ADMIN_BOOKING_UPDATE",
              pricingChanged,
              guestUpdated: true,
              reason: input.reason,
            },
            ...(ipAddress ? { ipAddress } : {}),
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return getAdminBooking(membership.propertyId, bookingId);
    } catch (error) {
      if (retryableConflict(error) && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      if (retryableConflict(error)) {
        throw new AdminApiError(409, "ROOM_NOT_AVAILABLE", "La chambre vient d'être réservée. Choisissez une autre disponibilité.");
      }
      throw error;
    }
  }
  throw new AdminApiError(409, "BOOKING_UPDATE_CONFLICT", "La réservation n'a pas pu être modifiée.");
}
