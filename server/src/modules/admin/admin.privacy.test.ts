import assert from "node:assert/strict";
import test from "node:test";
import { protectRoomOccupancyIdentity } from "./admin.privacy.js";

const occupancy = {
  kind: "BOOKING" as const,
  bookingId: "booking-1",
  bookingReference: "RIV-SECRET",
  status: "CONFIRMED" as const,
  checkIn: "2026-08-17",
  checkOut: "2026-08-20",
  guest: { firstName: "Sophie", lastName: "Martin" },
  holdExpiresAt: null,
};

test("ADMIN et RECEPTION conservent l'identite d'occupation", () => {
  for (const role of ["ADMIN", "RECEPTION"] as const) {
    assert.deepEqual(protectRoomOccupancyIdentity(occupancy, role), occupancy);
  }
});

test("ACCOUNTING et HOUSEKEEPING ne recoivent aucun identifiant de reservation ou client", () => {
  for (const role of ["ACCOUNTING", "HOUSEKEEPING"] as const) {
    const protectedOccupancy = protectRoomOccupancyIdentity(occupancy, role);

    assert.equal("bookingId" in protectedOccupancy, false);
    assert.equal("bookingReference" in protectedOccupancy, false);
    assert.equal("guest" in protectedOccupancy, false);
    assert.equal(protectedOccupancy.kind, "BOOKING");
    assert.equal(protectedOccupancy.status, "CONFIRMED");
    assert.equal(protectedOccupancy.checkIn, "2026-08-17");
    assert.equal(protectedOccupancy.checkOut, "2026-08-20");
  }
});
