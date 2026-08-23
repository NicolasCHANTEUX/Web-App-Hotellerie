import { prisma } from "../../lib/prisma.js";
import { serializeRoomType } from "../catalog/catalog.service.js";

export type AvailabilityInput = {
  arrival: Date;
  departure: Date;
  adults: number;
  children: number;
};

export async function searchAvailability(input: AvailabilityInput) {
  const now = new Date();
  const totalGuests = input.adults + input.children;
  const nights = Math.round((input.departure.getTime() - input.arrival.getTime()) / 86_400_000);

  const roomTypes = await prisma.roomType.findMany({
    where: {
      isPublished: true,
      maxGuests: { gte: totalGuests },
      maxAdults: { gte: input.adults },
      maxChildren: { gte: input.children },
    },
    orderBy: { displayOrder: "asc" },
    include: {
      amenities: { orderBy: { sortOrder: "asc" }, include: { amenity: true } },
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
        select: { id: true },
      },
    },
  });

  const availableRoomTypes = roomTypes.flatMap((roomType) => {
    if (!roomType.rooms.length) return [];
    const serialized = serializeRoomType(roomType);
    if (!serialized) return [];
    return [{
      ...serialized,
      availableUnits: roomType.rooms.length,
      totalPrice: serialized.price * nights,
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
