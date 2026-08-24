import { Prisma, type PricingUnit } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { BookingError } from "./booking.errors.js";
import { expireStaleBookingHolds } from "./booking.holds.js";
import {
  assertIdempotencyRequestMatches,
  bookingReferenceFromIdempotencyKey,
  bookingRequestHash,
} from "./booking.idempotency.js";
import {
  assertExpectedTotal,
  percentageTax,
  priceTaxRule,
  roundMoney,
} from "./booking.pricing.js";
import type { BookingConfirmation, CreateBookingInput } from "./booking.types.js";

const MAX_TRANSACTION_ATTEMPTS = 3;
const HOLD_DURATION_MS = 24 * 60 * 60 * 1_000;

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function moneySnapshot(value: Prisma.Decimal) {
  return value.toFixed(2);
}

function quantityForExtra(unit: PricingUnit, nights: number, guests: number) {
  if (unit === "PER_PERSON_PER_NIGHT") return nights * guests;
  if (unit === "PER_NIGHT") return nights;
  return 1;
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
): Promise<BookingConfirmation> {
  const reference = bookingReferenceFromIdempotencyKey(idempotencyKey);
  const requestHash = bookingRequestHash(input);

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
            email: existingGuest.email ?? input.guest.email,
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
                AND: [
                  { OR: [{ validFrom: null }, { validFrom: { lte: input.arrival } }] },
                  { OR: [{ validUntil: null }, { validUntil: { gte: input.departure } }] },
                ],
              },
              orderBy: { basePricePerNight: "asc" },
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

        if (!roomType || !roomType.isPublished) {
          throw new BookingError(404, "ROOM_TYPE_NOT_FOUND", "Ce type de chambre est introuvable.");
        }
        if (input.adults > roomType.maxAdults || input.children > roomType.maxChildren || guests > roomType.maxGuests) {
          throw new BookingError(400, "ROOM_CAPACITY_EXCEEDED", "Le nombre de voyageurs dépasse la capacité de cette chambre.");
        }

        const ratePlan = roomType.ratePlans.find((rate) => rate.currency === roomType.property.currency);
        if (!ratePlan) {
          throw new BookingError(409, "RATE_NOT_AVAILABLE", "Aucun tarif n'est disponible pour ce séjour.");
        }

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
                isActive: true,
              },
              orderBy: { displayOrder: "asc" },
            })
          : [];

        if (selectedExtras.length !== input.extraIds.length) {
          throw new BookingError(400, "EXTRA_NOT_AVAILABLE", "Une ou plusieurs options ne sont pas disponibles.");
        }

        const accommodationSubtotal = roundMoney(ratePlan.basePricePerNight.mul(nights));
        const pricedExtras = selectedExtras.map((extra) => {
          const quantity = quantityForExtra(extra.pricingUnit, nights, guests);
          const lineTotal = roundMoney(extra.price.mul(quantity));
          const taxRate = extra.taxRate ?? ratePlan.taxRate;
          return {
            extra,
            quantity,
            lineTotal,
            taxRate,
            taxAmount: percentageTax(lineTotal, taxRate),
          };
        });
        const extrasSubtotal = roundMoney(
          pricedExtras.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0)),
        );
        const subtotal = accommodationSubtotal.add(extrasSubtotal);
        const accommodationTax = percentageTax(accommodationSubtotal, ratePlan.taxRate);
        const extrasTax = roundMoney(
          pricedExtras.reduce((total, item) => total.add(item.taxAmount), new Prisma.Decimal(0)),
        );
        const touristTaxLines = roomType.property.taxRules
          .filter((rule) => rule.currency === null || rule.currency === roomType.property.currency)
          .map((rule) => ({
            rule,
            ...priceTaxRule(rule, accommodationSubtotal, nights, input.adults, input.children),
          }));
        const touristTaxTotal = roundMoney(
          touristTaxLines.reduce((total, item) => total.add(item.amount), new Prisma.Decimal(0)),
        );
        const taxTotal = roundMoney(accommodationTax.add(extrasTax).add(touristTaxTotal));
        const total = roundMoney(subtotal.add(taxTotal));
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
            }
          : {
              source: "RATE_PLAN_FALLBACK",
              refundable: ratePlan.refundable,
              ratePlanCode: ratePlan.code,
              acceptedAt: now.toISOString(),
            };

        const pricingSnapshot = {
          version: 2,
          idempotency: { key: idempotencyKey, requestHash },
          nights,
          roomType: { id: roomType.id, slug: roomType.slug, name: roomType.name },
          ratePlan: {
            id: ratePlan.id,
            code: ratePlan.code,
            name: ratePlan.name,
            nightlyPrice: moneySnapshot(ratePlan.basePricePerNight),
            taxRate: ratePlan.taxRate.toFixed(2),
            taxAmount: moneySnapshot(accommodationTax),
            refundable: ratePlan.refundable,
          },
          extras: pricedExtras.map(({ extra, quantity, lineTotal, taxRate, taxAmount }) => ({
            id: extra.id,
            code: extra.code,
            name: extra.name,
            pricingUnit: extra.pricingUnit,
            unitPrice: moneySnapshot(extra.price),
            quantity,
            lineTotal: moneySnapshot(lineTotal),
            taxRate: taxRate.toFixed(2),
            taxAmount: moneySnapshot(taxAmount),
          })),
          taxes: [
            {
              kind: "VAT",
              label: "TVA hébergement",
              calculationMode: "PERCENTAGE",
              rate: ratePlan.taxRate.toFixed(2),
              taxableBase: moneySnapshot(accommodationSubtotal),
              amount: moneySnapshot(accommodationTax),
            },
            ...pricedExtras.map(({ extra, lineTotal, taxRate, taxAmount }) => ({
              kind: "VAT",
              label: `TVA ${extra.name}`,
              calculationMode: "PERCENTAGE",
              rate: taxRate.toFixed(2),
              taxableBase: moneySnapshot(lineTotal),
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
          accommodationSubtotal: moneySnapshot(accommodationSubtotal),
          extrasSubtotal: moneySnapshot(extrasSubtotal),
          touristTaxTotal: moneySnapshot(touristTaxTotal),
          taxTotal: moneySnapshot(taxTotal),
          total: moneySnapshot(total),
          currency: ratePlan.currency,
        };

        await expireStaleBookingHolds(transaction, now, roomType.propertyId);

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

        const booking = await transaction.booking.create({
          data: {
            propertyId: roomType.propertyId,
            reference,
            status: "PENDING_PAYMENT",
            source: "WEBSITE",
            checkIn: input.arrival,
            checkOut: input.departure,
            adults: input.adults,
            children: input.children,
            currency: ratePlan.currency,
            accommodationSubtotal,
            extrasSubtotal,
            touristTaxTotal,
            taxTotal,
            total,
            pricingSnapshot,
            termsVersionId: termsVersion?.id,
            termsSnapshot,
            specialRequests: input.specialRequests,
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
                  taxableBase: accommodationSubtotal,
                  amount: accommodationTax,
                  sortOrder: 0,
                },
                ...pricedExtras.map(({ extra, lineTotal, taxRate, taxAmount }, index) => ({
                  kind: "VAT" as const,
                  labelSnapshot: `TVA ${extra.name}`,
                  calculationModeSnapshot: "PERCENTAGE" as const,
                  rateSnapshot: taxRate,
                  quantitySnapshot: 1,
                  taxableBase: lineTotal,
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
            nightlyPriceSnapshot: ratePlan.basePricePerNight,
            taxRateSnapshot: ratePlan.taxRate,
            taxAmountSnapshot: accommodationTax,
            lineTotal: accommodationSubtotal,
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
          email: input.guest.email,
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
