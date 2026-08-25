import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { priceTaxRule, roundMoney } from "../booking/booking.pricing.js";
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
      promotions: {
        where: {
          isActive: true,
          validFrom: { lte: input.arrival },
          OR: [{ validUntil: null }, { validUntil: { gte: input.departure } }],
        },
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
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
      },
    },
  });

  const availableRoomTypes = roomTypes.flatMap((roomType) => {
    if (!roomType.rooms.length) return [];
    const serialized = serializeRoomType(roomType, { arrival: input.arrival, departure: input.departure });
    if (!serialized) return [];
    const accommodationSubtotal = new Prisma.Decimal(serialized.price).mul(nights);
    const touristTaxTotal = roundMoney(
      roomType.property.taxRules
        .filter((rule) => rule.currency === null || rule.currency === roomType.property.currency)
        .reduce(
          (total, rule) => total.add(
            priceTaxRule(rule, accommodationSubtotal, nights, input.adults, input.children).amount,
          ),
          new Prisma.Decimal(0),
        ),
    );
    return [{
      ...serialized,
      availableUnits: roomType.rooms.length,
      totalPrice: serialized.price * nights,
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
  };
}
