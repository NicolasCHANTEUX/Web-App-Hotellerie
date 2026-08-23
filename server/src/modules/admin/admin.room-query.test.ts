import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin.errors.js";
import {
  blockingRoomAllocationWhere,
  compareRoomNumbers,
  parseRoomPeriodQuery,
  roomIntervalsOverlap,
} from "./admin.room-query.js";

function assertInvalidQuery(action: () => unknown) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "INVALID_QUERY");
    return true;
  });
}

test("room period query defaults to ascending room numbers", () => {
  assert.deepEqual(parseRoomPeriodQuery({}), {
    from: undefined,
    to: undefined,
    sortOrder: "asc",
  });
});

test("room period query accepts a 366-night period and descending order", () => {
  const parsed = parseRoomPeriodQuery({
    from: "2024-01-01",
    to: "2025-01-01",
    sortOrder: "desc",
  });

  assert.equal(parsed.from?.toISOString(), "2024-01-01T00:00:00.000Z");
  assert.equal(parsed.to?.toISOString(), "2025-01-01T00:00:00.000Z");
  assert.equal(parsed.sortOrder, "desc");
});

test("room period query requires both dates and a strictly increasing bounded period", () => {
  assertInvalidQuery(() => parseRoomPeriodQuery({ from: "2026-08-21" }));
  assertInvalidQuery(() => parseRoomPeriodQuery({ to: "2026-08-22" }));
  assertInvalidQuery(() => parseRoomPeriodQuery({ from: "2026-08-21", to: "2026-08-21" }));
  assertInvalidQuery(() => parseRoomPeriodQuery({ from: "2026-08-22", to: "2026-08-21" }));
  assertInvalidQuery(() => parseRoomPeriodQuery({ from: "2024-01-01", to: "2025-01-02" }));
  assertInvalidQuery(() => parseRoomPeriodQuery({ from: "2026-02-30", to: "2026-03-02" }));
  assertInvalidQuery(() => parseRoomPeriodQuery({ sortOrder: "newest" }));
});

test("room interval overlap follows arrival-inclusive and departure-exclusive semantics", () => {
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
  const selectedFrom = date("2026-08-21");
  const selectedTo = date("2026-08-24");

  assert.equal(roomIntervalsOverlap(date("2026-08-20"), date("2026-08-22"), selectedFrom, selectedTo), true);
  assert.equal(roomIntervalsOverlap(date("2026-08-23"), date("2026-08-25"), selectedFrom, selectedTo), true);
  assert.equal(roomIntervalsOverlap(date("2026-08-20"), selectedFrom, selectedFrom, selectedTo), false);
  assert.equal(roomIntervalsOverlap(selectedTo, date("2026-08-25"), selectedFrom, selectedTo), false);
});

test("room blocking predicate treats standalone holds and linked booking statuses consistently", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const predicate = blockingRoomAllocationWhere(now);
  const sources = predicate.OR as Array<Record<string, unknown>>;
  const holdSource = sources[1] as {
    reservationHold: {
      is: {
        status: string;
        expiresAt: { gt: Date };
        OR: Array<Record<string, unknown>>;
      };
    };
  };

  assert.equal(predicate.status, "ACTIVE");
  assert.equal(holdSource.reservationHold.is.status, "ACTIVE");
  assert.equal(holdSource.reservationHold.is.expiresAt.gt, now);
  assert.deepEqual(holdSource.reservationHold.is.OR[0], { bookingId: null });
  assert.deepEqual(
    holdSource.reservationHold.is.OR[1],
    { booking: { is: { status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } } } },
  );
});

test("room numbers use natural ascending and descending order", () => {
  const rooms = [
    { number: "10", floor: 1 },
    { number: "2", floor: 1 },
    { number: "101 B", floor: 1 },
    { number: "101 A", floor: 1 },
  ];

  assert.deepEqual(
    [...rooms].sort((first, second) => compareRoomNumbers(first, second, "asc")).map((room) => room.number),
    ["2", "10", "101 A", "101 B"],
  );
  assert.deepEqual(
    [...rooms].sort((first, second) => compareRoomNumbers(first, second, "desc")).map((room) => room.number),
    ["101 B", "101 A", "10", "2"],
  );
});
