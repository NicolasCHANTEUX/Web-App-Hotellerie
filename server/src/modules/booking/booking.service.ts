import { randomUUID } from "node:crypto";
import { Prisma, type BookingSource } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { BookingError } from "./booking.errors.js";
import { expireStaleBookingHolds } from "./booking.holds.js";
import {
  assertIdempotencyRequestMatches,
  bookingReferenceFromIdempotencyKey,
  bookingRequestHash,
} from "./booking.idempotency.js";
import { assertExpectedTotal, buildTaxInclusivePrice } from "./booking.pricing.js";
import type { BookingConfirmation, CreateBookingInput } from "./booking.types.js";
import { enqueueBookingNotification } from "../notifications/notification.service.js";
import { retentionDeadlineFrom } from "../privacy/retention.service.js";
import { bookingAccessToken, bookingAccessTokenExpiresAt, bookingAccessTokenHash } from "./booking.access.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
const HOLD_DURATION_MS = 24 * 60 * 60 * 1_000;

export type BookingCreationOptions = {
  propertyId: string;
  source: BookingSource;
  acceptanceChannel: "ADMIN";
  recordedByAdminUserId: string;
  notifyOptioned?: boolean;
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function moneySnapshot(value: Prisma.Decimal) {
  return value.toFixed(2);
}

function errorValues(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
    meta?: { code?: unknown; database_error?: { code?: unknown; message?: unknown } };
  };
  return [
    candidate.code,
    candidate.message,
    candidate.meta?.code,
    candidate.meta?.database_error?.code,
    candidate.meta?.database_error?.message,
    ...(candidate.cause ? errorValues(candidate.cause) : []),
  ].filter((value): value is string => typeof value === "string");
}

function isRetryableBookingConflict(error: unknown) {
  const values = errorValues(error);
  return values.some((value) =>
    value === "P2034" ||
    value === "P2002" ||
    value === "40001" ||
    value === "40P01" ||
    value === "23P01" ||
    value.includes("room_allocations_no_active_overlap") ||
    value.toLowerCase().includes("serialization failure"),
  );
}

function idempotencyRequestHash(snapshot: unknown) {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return undefined;
  const metadata = (snapshot as Record<string, unknown>).idempotency;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined;
  const requestHash = (metadata as Record<string, unknown>).requestHash;
  return typeof requestHash === "string" ? requestHash : undefined;
}

export async function createBooking(
  input: CreateBookingInput,
  idempotencyKey: string,
  options?: BookingCreationOptions,
): Promise<BookingConfirmation> {
  const reference = bookingReferenceFromIdempotencyKey(idempotencyKey, env.bookingReferencePrefix);
  const bookingId = randomUUID();
  const requestHash = bookingRequestHash(input, options ? {
    propertyId: options.propertyId,
    source: options.source,
    acceptanceChannel: options.acceptanceChannel,
  } : undefined);

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const now = new Date();
        const existingBooking = await transaction.booking.findUnique({
          where: { reference },
          include: {
            rooms: { orderBy: { createdAt: "asc" }, take: 1 },
            extras: { orderBy: { createdAt: "asc" } },
            guests: {
              where: { isPrimary: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            hold: true,
          },
        });

        if (existingBooking) {
          assertIdempotencyRequestMatches(
            idempotencyRequestHash(existingBooking.pricingSnapshot),
            requestHash,
          );

          const existingRoom = existingBooking.rooms[0];
          const existingGuest = existingBooking.guests[0];
          if (!existingRoom || !existingGuest || !existingBooking.hold) {
            throw new BookingError(
              409,
              "IDEMPOTENCY_RECORD_INVALID",
              "La réservation existante ne peut pas être relue correctement.",
            );
          }

          let existingStatus = existingBooking.status;
          const accessToken = bookingAccessToken(existingBooking.id);
          const accessTokenHash = bookingAccessTokenHash(accessToken);
          const accessTokenExpiresAt = bookingAccessTokenExpiresAt(existingBooking.checkOut);
          if (
            existingBooking.publicAccessTokenHash !== accessTokenHash
            || existingBooking.publicAccessTokenExpiresAt?.getTime() !== accessTokenExpiresAt.getTime()
          ) {
            await transaction.booking.update({
              where: { id: existingBooking.id },
              data: { publicAccessTokenHash: accessTokenHash, publicAccessTokenExpiresAt: accessTokenExpiresAt },
            });
          }
          if (
            existingBooking.status === "PENDING_PAYMENT" &&
            (existingBooking.hold.status === "EXPIRED" ||
              (existingBooking.hold.status === "ACTIVE" && existingBooking.hold.expiresAt <= now))
          ) {
            await transaction.roomAllocation.updateMany({
              where: { reservationHoldId: existingBooking.hold.id, status: "ACTIVE" },
              data: { status: "EXPIRED" },
            });
            await transaction.reservationHold.update({
              where: { id: existingBooking.hold.id },
              data: { status: "EXPIRED" },
            });
            await transaction.booking.update({
              where: { id: existingBooking.id },
              data: { status: "EXPIRED" },
            });
            existingStatus = "EXPIRED";
          }

          return {
            id: existingBooking.id,
            reference: existingBooking.reference,
            status: existingStatus,
            room: {
              name: existingRoom.roomTypeNameSnapshot,
            },
            arrival: dateOnly(existingBooking.checkIn),
            departure: dateOnly(existingBooking.checkOut),
            adults: existingBooking.adults,
            children: existingBooking.children,
            options: existingBooking.extras.map((extra) => extra.nameSnapshot),
            total: Number(existingBooking.total),
            currency: existingBooking.currency,
            email: existingGuest.email ?? input.guest.email ?? "",
            ...(!options ? { accessToken } : {}),
            holdExpiresAt: existingBooking.hold.expiresAt.toISOString(),
          };
        }

        const nights = Math.round((input.departure.getTime() - input.arrival.getTime()) / 86_400_000);
        const guests = input.adults + input.children;
        const roomType = await transaction.roomType.findUnique({
          where: { id: input.roomTypeId },
          include: {
            property: {
              select: {
                id: true,
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
                contractTerms: {
                  where: {
                    code: "BOOKING_TERMS",
                    isActive: true,
                    effectiveFrom: { lte: now },
                    OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
                  },
                  orderBy: { version: "desc" },
                  take: 1,
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
                  },
                },
              },
              orderBy: { number: "asc" },
              take: 1,
              select: { id: true, number: true },
            },
          },
        });

        if (
          !roomType
          || !roomType.isPublished
          || roomType.archivedAt
          || (options && roomType.propertyId !== options.propertyId)
        ) {
          throw new BookingError(404, "ROOM_TYPE_NOT_FOUND", "Ce type de chambre est introuvable.");
        }
        if (input.adults > roomType.maxAdults || input.children > roomType.maxChildren || guests > roomType.maxGuests) {
          throw new BookingError(400, "ROOM_CAPACITY_EXCEEDED", "Le nombre de voyageurs dépasse la capacité de cette chambre.");
        }

        const ratePlan = roomType.ratePlans.find((rate) => rate.currency === roomType.property.currency);
        if (!ratePlan) {
          throw new BookingError(409, "RATE_NOT_AVAILABLE", "Aucun tarif n'est disponible pour ce séjour.");
        }
        const promotion = roomType.promotions[0] ?? null;
        const nightlyPrice = promotion?.promotionalPricePerNight ?? ratePlan.basePricePerNight;

        const room = roomType.rooms[0];
        if (!room) {
          throw new BookingError(409, "ROOM_NOT_AVAILABLE", "Cette chambre n'est plus disponible pour ces dates.");
        }

        const selectedExtras = input.extraIds.length
          ? await transaction.extra.findMany({
              where: {
                id: { in: input.extraIds },
                propertyId: roomType.propertyId,
                currency: roomType.property.currency,
                priceTaxMode: "INCLUSIVE",
                isActive: true,
              },
              orderBy: { displayOrder: "asc" },
            })
          : [];

        if (selectedExtras.length !== input.extraIds.length) {
          throw new BookingError(400, "EXTRA_NOT_AVAILABLE", "Une ou plusieurs options ne sont pas disponibles.");
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
        const pricedExtras = price.extras.map(({ item, ...pricedExtra }) => ({
          extra: item,
          ...pricedExtra,
        }));
        const accommodationSubtotal = price.accommodationTotal;
        const extrasSubtotal = price.extrasTotal;
        const accommodationTax = price.accommodationTax;
        const touristTaxLines = price.touristTaxes;
        const touristTaxTotal = price.touristTaxTotal;
        const taxTotal = price.taxTotal;
        const total = price.total;
        assertExpectedTotal(input.expectedTotal, total);

        const termsVersion = roomType.property.contractTerms[0];
        const termsSnapshot = termsVersion
          ? {
              source: "CONTRACT_TERMS_VERSION",
              id: termsVersion.id,
              code: termsVersion.code,
              version: termsVersion.version,
              title: termsVersion.title,
              body: termsVersion.body,
              checksumSha256: termsVersion.checksumSha256,
              cancellationPolicy: termsVersion.cancellationPolicy,
              acceptedAt: now.toISOString(),
              acceptedExplicitly: input.termsAccepted,
              acceptanceChannel: options?.acceptanceChannel ?? "WEBSITE",
              ...(options ? { recordedByAdminUserId: options.recordedByAdminUserId } : {}),
            }
          : {
              source: "RATE_PLAN_FALLBACK",
              refundable: ratePlan.refundable,
              ratePlanCode: ratePlan.code,
              acceptedAt: now.toISOString(),
              acceptedExplicitly: input.termsAccepted,
              acceptanceChannel: options?.acceptanceChannel ?? "WEBSITE",
              ...(options ? { recordedByAdminUserId: options.recordedByAdminUserId } : {}),
            };

        const pricingSnapshot = {
          version: 3,
          priceTaxMode: "INCLUSIVE",
          idempotency: { key: idempotencyKey, requestHash },
          nights,
          roomType: { id: roomType.id, slug: roomType.slug, name: roomType.name },
          ratePlan: {
            id: ratePlan.id,
            code: ratePlan.code,
            name: ratePlan.name,
            baseNightlyPriceTtc: moneySnapshot(ratePlan.basePricePerNight),
            nightlyPriceTtc: moneySnapshot(nightlyPrice),
            taxRate: ratePlan.taxRate.toFixed(2),
            taxAmountIncluded: moneySnapshot(accommodationTax),
            refundable: ratePlan.refundable,
          },
          promotion: promotion ? {
            id: promotion.id,
            label: promotion.label,
            discountPercent: promotion.discountPercent.toFixed(2),
            referenceNightlyPriceTtc: moneySnapshot(promotion.referencePricePerNight),
            promotionalNightlyPriceTtc: moneySnapshot(promotion.promotionalPricePerNight),
            validFrom: dateOnly(promotion.validFrom),
            validUntil: promotion.validUntil ? dateOnly(promotion.validUntil) : null,
          } : null,
          extras: pricedExtras.map(({ extra, quantity, lineSubtotal, lineTotal, taxRate, taxAmount }) => ({
            id: extra.id,
            code: extra.code,
            name: extra.name,
            pricingUnit: extra.pricingUnit,
            unitPriceTtc: moneySnapshot(extra.price),
            quantity,
            lineSubtotalExcludingTax: moneySnapshot(lineSubtotal),
            lineTotal: moneySnapshot(lineTotal),
            taxRate: taxRate.toFixed(2),
            taxAmountIncluded: moneySnapshot(taxAmount),
          })),
          taxes: [
            {
              kind: "VAT",
              label: "TVA hébergement",
              calculationMode: "PERCENTAGE",
              rate: ratePlan.taxRate.toFixed(2),
              taxableBase: moneySnapshot(price.accommodationSubtotal),
              amount: moneySnapshot(accommodationTax),
            },
            ...pricedExtras.map(({ extra, lineSubtotal, taxRate, taxAmount }) => ({
              kind: "VAT",
              label: `TVA ${extra.name}`,
              calculationMode: "PERCENTAGE",
              rate: taxRate.toFixed(2),
              taxableBase: moneySnapshot(lineSubtotal),
              amount: moneySnapshot(taxAmount),
            })),
            ...touristTaxLines.map(({ rule, quantity, taxableBase, amount }) => ({
              kind: rule.kind,
              code: rule.code,
              label: rule.label,
              calculationMode: rule.calculationMode,
              rate: rule.rate?.toFixed(2) ?? null,
              unitAmount: rule.amount ? moneySnapshot(rule.amount) : null,
              quantity: quantity.toFixed(2),
              taxableBase: moneySnapshot(taxableBase),
              amount: moneySnapshot(amount),
            })),
          ],
          accommodationSubtotalExcludingTax: moneySnapshot(price.accommodationSubtotal),
          accommodationTotalIncludingTax: moneySnapshot(price.accommodationTotal),
          extrasSubtotalExcludingTax: moneySnapshot(price.extrasSubtotal),
          extrasTotalIncludingTax: moneySnapshot(price.extrasTotal),
          vatTotalIncluded: moneySnapshot(price.vatTotal),
          touristTaxTotal: moneySnapshot(touristTaxTotal),
          taxTotal: moneySnapshot(taxTotal),
          total: moneySnapshot(total),
          currency: ratePlan.currency,
          creation: {
            source: options?.source ?? "WEBSITE",
            channel: options?.acceptanceChannel ?? "WEBSITE",
          },
        };

        await expireStaleBookingHolds(transaction, now, roomType.propertyId);

        if (!options) {
          if (!input.guest.email || !input.guest.phone) {
            throw new BookingError(400, "INVALID_BOOKING", "Les coordonnées du client sont incomplètes.");
          }
          const activeRequestsForContact = await transaction.booking.count({
            where: {
              propertyId: roomType.propertyId,
              status: "PENDING_PAYMENT",
              hold: { is: { status: "ACTIVE", expiresAt: { gt: now } } },
              guests: {
                some: {
                  OR: [
                    { email: input.guest.email },
                    { phone: input.guest.phone },
                  ],
                },
              },
            },
          });
          if (activeRequestsForContact >= 2) {
            throw new BookingError(
              429,
              "BOOKING_CONTACT_LIMITED",
              "Deux demandes sont déjà actives pour ces coordonnées. Contactez l'hôtel pour réserver plusieurs chambres.",
            );
          }
        }

        const booking = await transaction.booking.create({
          data: {
            id: bookingId,
            propertyId: roomType.propertyId,
            reference,
            status: "PENDING_PAYMENT",
            source: options?.source ?? "WEBSITE",
            checkIn: input.arrival,
            checkOut: input.departure,
            adults: input.adults,
            children: input.children,
            currency: ratePlan.currency,
            priceTaxMode: "INCLUSIVE",
            accommodationSubtotal,
            extrasSubtotal,
            touristTaxTotal,
            taxTotal,
            total,
            pricingSnapshot,
            termsVersionId: termsVersion?.id,
            termsSnapshot,
            specialRequests: input.specialRequests,
            personalDataRetainUntil: retentionDeadlineFrom(input.departure),
            publicAccessTokenHash: bookingAccessTokenHash(bookingAccessToken(bookingId)),
            publicAccessTokenExpiresAt: bookingAccessTokenExpiresAt(input.departure),
            guests: {
              create: {
                isPrimary: true,
                firstName: input.guest.firstName,
                lastName: input.guest.lastName,
                email: input.guest.email,
                phone: input.guest.phone,
                countryCode: input.guest.countryCode,
              },
            },
            taxLines: {
              create: [
                {
                  kind: "VAT",
                  labelSnapshot: "TVA hébergement",
                  calculationModeSnapshot: "PERCENTAGE",
                  rateSnapshot: ratePlan.taxRate,
                  quantitySnapshot: 1,
                  taxableBase: price.accommodationSubtotal,
                  amount: accommodationTax,
                  sortOrder: 0,
                },
                ...pricedExtras.map(({ extra, lineSubtotal, taxRate, taxAmount }, index) => ({
                  kind: "VAT" as const,
                  labelSnapshot: `TVA ${extra.name}`,
                  calculationModeSnapshot: "PERCENTAGE" as const,
                  rateSnapshot: taxRate,
                  quantitySnapshot: 1,
                  taxableBase: lineSubtotal,
                  amount: taxAmount,
                  sortOrder: index + 1,
                })),
                ...touristTaxLines.map(({ rule, quantity, taxableBase, amount }, index) => ({
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
                  sortOrder: pricedExtras.length + index + 1,
                })),
              ],
            },
            extras: pricedExtras.length
              ? {
                  create: pricedExtras.map(({ extra, quantity, lineTotal, taxRate, taxAmount }) => ({
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
                }
              : undefined,
          },
          select: { id: true, reference: true, status: true },
        });

        await transaction.bookingRoom.create({
          data: {
            bookingId: booking.id,
            roomTypeId: roomType.id,
            ratePlanId: ratePlan.id,
            roomTypeNameSnapshot: roomType.name,
            nightlyPriceSnapshot: nightlyPrice,
            priceTaxModeSnapshot: "INCLUSIVE",
            taxRateSnapshot: ratePlan.taxRate,
            taxAmountSnapshot: accommodationTax,
            lineTotal: price.accommodationTotal,
          },
        });

        const hold = await transaction.reservationHold.create({
          data: {
            propertyId: roomType.propertyId,
            roomTypeId: roomType.id,
            roomId: room.id,
            bookingId: booking.id,
            checkIn: input.arrival,
            checkOut: input.departure,
            adults: input.adults,
            children: input.children,
            status: "ACTIVE",
            expiresAt: new Date(now.getTime() + HOLD_DURATION_MS),
          },
          select: { id: true, expiresAt: true },
        });

        await transaction.roomAllocation.create({
          data: {
            roomId: room.id,
            reservationHoldId: hold.id,
            source: "HOLD",
            status: "ACTIVE",
            checkIn: input.arrival,
            checkOut: input.departure,
          },
        });

        if (options?.notifyOptioned !== false && input.guest.email) {
          await enqueueBookingNotification(transaction, {
            propertyId: roomType.propertyId,
            bookingId: booking.id,
            recipient: input.guest.email,
            template: "BOOKING_OPTIONED",
            idempotencyKey: `booking:${booking.id}:optioned`,
            payload: {
              firstName: input.guest.firstName,
              reference: booking.reference,
              roomName: roomType.name,
              arrival: dateOnly(input.arrival),
              departure: dateOnly(input.departure),
              total: Number(total),
              currency: ratePlan.currency,
              holdExpiresAt: hold.expiresAt.toISOString(),
            },
          });
        }

        return {
          id: booking.id,
          reference: booking.reference,
          status: "PENDING_PAYMENT",
          room: { name: roomType.name },
          arrival: dateOnly(input.arrival),
          departure: dateOnly(input.departure),
          adults: input.adults,
          children: input.children,
          options: pricedExtras.map(({ extra }) => extra.name),
          total: Number(total),
          currency: ratePlan.currency,
          email: input.guest.email ?? "",
          ...(!options ? { accessToken: bookingAccessToken(booking.id) } : {}),
          holdExpiresAt: hold.expiresAt.toISOString(),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof BookingError) throw error;
      if (!isRetryableBookingConflict(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw new BookingError(409, "ROOM_NOT_AVAILABLE", "Cette chambre n'est plus disponible pour ces dates.");
      }
    }
  }

  throw new BookingError(409, "ROOM_NOT_AVAILABLE", "Cette chambre n'est plus disponible pour ces dates.");
}
