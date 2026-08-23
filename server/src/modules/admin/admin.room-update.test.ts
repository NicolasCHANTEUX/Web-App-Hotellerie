import assert from "node:assert/strict";
import test from "node:test";
import { RoomStatus } from "../../generated/prisma/client.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import {
  blockingAllocationSourcesForRoomUpdate,
  parseAdminRoomUpdateBody,
  requireRoomUpdatePermission,
} from "./admin.room-update.js";

const updatedAt = "2026-08-22T09:15:30.123Z";
const roomTypeId = "123e4567-e89b-42d3-a456-426614174000";

function assertInvalid(action: () => unknown, code = "INVALID_ROOM_UPDATE", statusCode = 400) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
}

test("room update parser normalizes every editable field", () => {
  const result = parseAdminRoomUpdateBody({
    updatedAt,
    number: "  204 B ",
    roomTypeId,
    floor: 2,
    status: RoomStatus.OUT_OF_SERVICE,
    notes: "  Peinture à refaire  ",
  });

  assert.equal(result.updatedAt.toISOString(), updatedAt);
  assert.deepEqual(result.changes, {
    number: "204 B",
    roomTypeId,
    floor: 2,
    status: RoomStatus.OUT_OF_SERVICE,
    notes: "Peinture à refaire",
  });
});

test("room update parser supports explicit nullable fields", () => {
  assert.deepEqual(parseAdminRoomUpdateBody({ updatedAt, floor: null, notes: "  " }).changes, {
    floor: null,
    notes: null,
  });
});

test("room update parser is strict and requires a canonical optimistic version", () => {
  assertInvalid(() => parseAdminRoomUpdateBody(null));
  assertInvalid(() => parseAdminRoomUpdateBody({ number: "101" }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt, number: "101", unexpected: true }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt: "2026-08-22", number: "101" }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt: "2026-08-22T09:15:30.123Z", number: "   " }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt, roomTypeId: "not-a-uuid" }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt, floor: 1.5 }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt, floor: 301 }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt, status: "CLEANING" }));
  assertInvalid(() => parseAdminRoomUpdateBody({ updatedAt, notes: "x".repeat(2_001) }));
});

function membership(role: AdminMembershipContext["role"]): AdminMembershipContext {
  return {
    propertyId: roomTypeId,
    role,
    createdAt: new Date(),
    property: {
      id: roomTypeId,
      name: "Hôtel Rivage",
      slug: "hotel-rivage",
      timezone: "Europe/Paris",
      currency: "EUR",
    },
  };
}

test("only ADMIN memberships can update rooms", () => {
  assert.equal(requireRoomUpdatePermission(membership("ADMIN")).role, "ADMIN");
  for (const role of ["RECEPTION", "ACCOUNTING", "HOUSEKEEPING"] as const) {
    assertInvalid(() => requireRoomUpdatePermission(membership(role)), "ROLE_ACCESS_DENIED", 403);
  }
});

test("room update allocation policy permits blocks for type changes and out-of-service status", () => {
  assert.deepEqual(blockingAllocationSourcesForRoomUpdate(true), ["BOOKING", "HOLD"]);
  assert.deepEqual(
    blockingAllocationSourcesForRoomUpdate(false, RoomStatus.OUT_OF_SERVICE),
    ["BOOKING", "HOLD"],
  );
  assert.deepEqual(blockingAllocationSourcesForRoomUpdate(false, RoomStatus.ACTIVE), []);
});

test("archiving requires the room to be free from every allocation source", () => {
  assert.deepEqual(
    blockingAllocationSourcesForRoomUpdate(false, RoomStatus.ARCHIVED),
    ["BOOKING", "HOLD", "BLOCK"],
  );
  assert.deepEqual(
    blockingAllocationSourcesForRoomUpdate(true, RoomStatus.ARCHIVED),
    ["BOOKING", "HOLD", "BLOCK"],
  );
});
