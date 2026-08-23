import { Prisma } from "../../generated/prisma/client.js";

/**
 * Lazily closes expired public booking holds in the same transaction as the
 * caller. It is intentionally exported so read paths can run the same cleanup
 * before reporting operational booking/room counts.
 */
export async function expireStaleBookingHolds(
  transaction: Prisma.TransactionClient,
  now: Date,
  propertyId: string,
) {
  const bookings = await transaction.booking.updateMany({
    where: {
      status: "PENDING_PAYMENT",
      propertyId,
      hold: { is: { status: "ACTIVE", expiresAt: { lte: now } } },
    },
    data: { status: "EXPIRED" },
  });
  const allocations = await transaction.roomAllocation.updateMany({
    where: {
      source: "HOLD",
      status: "ACTIVE",
      reservationHold: { is: { propertyId } },
      OR: [
        { reservationHold: { is: { status: { not: "ACTIVE" } } } },
        { reservationHold: { is: { status: "ACTIVE", expiresAt: { lte: now } } } },
      ],
    },
    data: { status: "EXPIRED" },
  });
  const holds = await transaction.reservationHold.updateMany({
    where: { propertyId, status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });

  return {
    bookings: bookings.count,
    allocations: allocations.count,
    holds: holds.count,
  };
}
