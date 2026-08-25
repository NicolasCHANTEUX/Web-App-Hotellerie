import { buildTaxInclusivePrice } from "./booking.pricing.js";
import { BookingError } from "./booking.errors.js";
import type { BookingQuote, BookingSelectionInput } from "./booking.types.js";
import { prisma } from "../../lib/prisma.js";

export async function getBookingQuote(input: BookingSelectionInput): Promise<BookingQuote> {
  const now = new Date();
  const nights = Math.round((input.departure.getTime() - input.arrival.getTime()) / 86_400_000);
  const guests = input.adults + input.children;
  const roomType = await prisma.roomType.findUnique({
    where: { id: input.roomTypeId },
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
            },
          },
        },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!roomType || !roomType.isPublished || roomType.archivedAt) {
    throw new BookingError(404, "ROOM_TYPE_NOT_FOUND", "Ce type de chambre est introuvable.");
  }
  if (input.adults > roomType.maxAdults || input.children > roomType.maxChildren || guests > roomType.maxGuests) {
    throw new BookingError(400, "ROOM_CAPACITY_EXCEEDED", "Le nombre de voyageurs dépasse la capacité de cette chambre.");
  }
  if (!roomType.rooms.length) {
    throw new BookingError(409, "ROOM_NOT_AVAILABLE", "Cette chambre n'est plus disponible pour ces dates.");
  }

  const ratePlan = roomType.ratePlans.find((rate) => rate.currency === roomType.property.currency);
  if (!ratePlan) {
    throw new BookingError(409, "RATE_NOT_AVAILABLE", "Aucun tarif TTC n'est disponible pour ce séjour.");
  }
  const promotion = roomType.promotions[0] ?? null;
  const nightlyPrice = promotion?.promotionalPricePerNight ?? ratePlan.basePricePerNight;

  const selectedExtras = input.extraIds.length
    ? await prisma.extra.findMany({
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

  return {
    priceTaxMode: "INCLUSIVE",
    currency: ratePlan.currency,
    nights,
    room: {
      id: roomType.id,
      slug: roomType.slug,
      name: roomType.name,
      unitPrice: Number(nightlyPrice),
      subtotal: Number(price.accommodationSubtotal),
      taxAmount: Number(price.accommodationTax),
      total: Number(price.accommodationTotal),
      promotion: promotion ? {
        id: promotion.id,
        label: promotion.label,
        discountPercent: Number(promotion.discountPercent),
        referenceUnitPrice: Number(promotion.referencePricePerNight),
      } : null,
    },
    extras: price.extras.map(({ item, quantity, unitPrice, pricingUnit, lineSubtotal, taxAmount, lineTotal }) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      unitPrice: Number(unitPrice),
      pricingUnit,
      quantity,
      subtotal: Number(lineSubtotal),
      taxAmount: Number(taxAmount),
      total: Number(lineTotal),
    })),
    accommodationTotal: Number(price.accommodationTotal),
    extrasTotal: Number(price.extrasTotal),
    vatTotalIncluded: Number(price.vatTotal),
    touristTaxTotal: Number(price.touristTaxTotal),
    total: Number(price.total),
  };
}
