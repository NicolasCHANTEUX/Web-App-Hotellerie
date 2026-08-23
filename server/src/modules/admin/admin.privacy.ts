import type { AdminMembershipContext } from "./admin.auth.js";

type RoomOccupancyIdentity = {
  bookingId?: unknown;
  bookingReference?: unknown;
  guest?: unknown;
};

export function canReadRoomOccupancyIdentity(role: AdminMembershipContext["role"]) {
  return role === "ADMIN" || role === "RECEPTION";
}

export function protectRoomOccupancyIdentity<T extends RoomOccupancyIdentity>(
  occupancy: T,
  role: AdminMembershipContext["role"],
): T | Omit<T, "bookingId" | "bookingReference" | "guest"> {
  if (canReadRoomOccupancyIdentity(role)) return occupancy;

  const {
    bookingId: _bookingId,
    bookingReference: _bookingReference,
    guest: _guest,
    ...operationalOccupancy
  } = occupancy;
  return operationalOccupancy;
}
