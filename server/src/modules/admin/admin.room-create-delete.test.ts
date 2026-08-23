import assert from "node:assert/strict";
import test from "node:test";
import { RoomStatus } from "../../generated/prisma/client.js";
import { AdminApiError } from "./admin.errors.js";
import {
  parseAdminRoomCreateBody,
  parseAdminRoomDeleteBody,
  roomHasHistory,
} from "./admin.room-create-delete.js";
import { requireRoomManagementPermission } from "./admin.room-update.js";
import type { AdminMembershipContext } from "./admin.auth.js";

const roomTypeId = "123e4567-e89b-42d3-a456-426614174000";
const updatedAt = "2026-08-22T09:15:30.123Z";

function assertInvalid(action: () => unknown, code: string, statusCode = 400) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
}

test("room creation parser normalizes fields and applies safe defaults", () => {
  assert.deepEqual(parseAdminRoomCreateBody({
    number: "  205 B ",
    roomTypeId,
  }), {
    number: "205 B",
    roomTypeId,
    floor: null,
    status: RoomStatus.ACTIVE,
    notes: null,
  });

  assert.deepEqual(parseAdminRoomCreateBody({
    number: "206",
    roomTypeId,
    floor: -1,
    status: RoomStatus.OUT_OF_SERVICE,
    notes: "  Peinture à refaire  ",
  }), {
    number: "206",
    roomTypeId,
    floor: -1,
    status: RoomStatus.OUT_OF_SERVICE,
    notes: "Peinture à refaire",
  });
});

test("room creation parser is strict and rejects archived rooms", () => {
  assertInvalid(() => parseAdminRoomCreateBody(null), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ roomTypeId }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101" }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: " ", roomTypeId }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101", roomTypeId: "bad" }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101", roomTypeId, floor: 1.5 }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101", roomTypeId, floor: -21 }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101", roomTypeId, notes: "x".repeat(2_001) }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101", roomTypeId, status: RoomStatus.ARCHIVED }), "INVALID_ROOM_CREATE");
  assertInvalid(() => parseAdminRoomCreateBody({ number: "101", roomTypeId, updatedAt }), "INVALID_ROOM_CREATE");
});

test("room deletion parser only accepts a canonical optimistic version", () => {
  assert.equal(parseAdminRoomDeleteBody({ updatedAt }).updatedAt.toISOString(), updatedAt);
  assertInvalid(() => parseAdminRoomDeleteBody(null), "INVALID_ROOM_DELETE");
  assertInvalid(() => parseAdminRoomDeleteBody({}), "INVALID_ROOM_DELETE");
  assertInvalid(() => parseAdminRoomDeleteBody({ updatedAt: "2026-08-22" }), "INVALID_ROOM_DELETE");
  assertInvalid(() => parseAdminRoomDeleteBody({ updatedAt, force: true }), "INVALID_ROOM_DELETE");
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

test("only ADMIN memberships can create or delete rooms", () => {
  assert.equal(requireRoomManagementPermission(membership("ADMIN")).role, "ADMIN");
  for (const role of ["RECEPTION", "ACCOUNTING", "HOUSEKEEPING"] as const) {
    assertInvalid(
      () => requireRoomManagementPermission(membership(role)),
      "ROLE_ACCESS_DENIED",
      403,
    );
  }
});

test("every room relation is considered immutable history", () => {
  const empty = {
    bookingRooms: 0,
    reservationHolds: 0,
    availabilityBlocks: 0,
    allocations: 0,
  };
  assert.equal(roomHasHistory(empty), false);
  for (const relation of Object.keys(empty) as (keyof typeof empty)[]) {
    assert.equal(roomHasHistory({ ...empty, [relation]: 1 }), true, relation);
  }
});
