import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { priceTaxRule, roundMoney, touristTaxPeriodFilter } from "../booking/booking.pricing.js";
import { priceStayNights, staySeasonsSelection, stayPricingRelations } from "../booking/booking.stay-rates.js";
import { serializeRoomType } from "../catalog/catalog.service.js";

export type AvailabilityInput = {
  arrival: Date;
  departure: Date;
  adults: number;
  children: number;
};

export async function searchAvailability(input: AvailabilityInput, propertyId?: string) {
  const now = new Date();
  const totalGuests = input.adults + input.children;
  const nights = Math.round((input.departure.getTime() - input.arrival.getTime()) / 86_400_000);

  const roomTypes = await prisma.roomType.findMany({
    where: {
      ...(propertyId ? { propertyId } : {}),
      isPublished: true,
      archivedAt: null,
      maxGuests: { gte: totalGuests },
      maxAdults: { gte: input.adults },
      maxChildren: { gte: input.children },
    },
    orderBy: { displayOrder: "asc" },
    include: {
      property: {
        select: {
          currency: true,
          seasons: staySeasonsSelection(input.arrival, input.departure),
          taxRules: {
            where: {
              isActive: true,
              kind: "TOURIST_TAX",
              ...touristTaxPeriodFilter(input.arrival, input.departure),
            },
            orderBy: [{ priority: "asc" }, { code: "asc" }],
          },
        },
      },
      amenities: { orderBy: { sortOrder: "asc" }, include: { amenity: true } },
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
      ...stayPricingRelations(input.arrival, input.departure),
      _count: {
        select: {
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
          },
        },
      },
    },
  });

  // Seasons belong to the property: a minimum stay applies to every room type.
  let minStay: { minNights: number; seasonLabel: string } | null = null;
  const availableRoomTypes = roomTypes.flatMap((roomType) => {
    const rate = roomType.ratePlans[0];
    if (!roomType._count.rooms || !rate) return [];
    const stayRates = priceStayNights({
      arrival: input.arrival,
      nights,
      basePrice: rate.basePricePerNight,
      seasons: roomType.property.seasons,
      rates: roomType.seasonRates,
      promotions: roomType.promotions,
    });
    if (stayRates.minStay) {
      minStay = stayRates.minStay;
      return [];
    }
    const serialized = serializeRoomType(roomType, rate, {
      price: stayRates.averagePrice,
      originalPrice: stayRates.promotion ? roundMoney(stayRates.regularTotal.div(nights)) : null,
      promotion: stayRates.promotion,
    });
    const stay = {
      arrival: input.arrival,
      nightlyPrices: stayRates.nights.map((night) => night.price),
      adults: input.adults,
      children: input.children,
    };
    const touristTaxTotal = roundMoney(
      roomType.property.taxRules
        .filter((rule) => rule.currency === null || rule.currency === roomType.property.currency)
        .reduce((total, rule) => total.add(priceTaxRule(rule, stay).amount), new Prisma.Decimal(0)),
    );
    return [{
      ...serialized,
      availableUnits: roomType._count.rooms,
      // Exact sums of the nights: `price` is only their average.
      totalPrice: Number(stayRates.total),
      ...(stayRates.promotion ? { originalTotalPrice: Number(stayRates.regularTotal) } : {}),
      touristTaxTotal: Number(touristTaxTotal),
    }];
  });

  return {
    query: {
      arrival: input.arrival.toISOString().slice(0, 10),
      departure: input.departure.toISOString().slice(0, 10),
      adults: input.adults,
      children: input.children,
    },
    nights,
    roomTypes: availableRoomTypes,
    minStay: minStay as { minNights: number; seasonLabel: string } | null,
  };
}
