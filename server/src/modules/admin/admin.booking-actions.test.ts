import assert from "node:assert/strict";
import test from "node:test";
import { BookingStatus } from "../../generated/prisma/client.js";
import {
  assertBookingStatusTiming,
  bookingStatusTransitionAllowed,
  parseAdminBookingRoomAssignmentBody,
  parseAdminBookingStatusBody,
} from "./admin.booking-actions.js";
import { AdminApiError } from "./admin.errors.js";

test("booking lifecycle only permits operational terminal transitions", () => {
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED), true);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN), true);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.CHECKED_IN, BookingStatus.COMPLETED), true);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.CONFIRMED, BookingStatus.COMPLETED), false);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.CONFIRMED, BookingStatus.NO_SHOW), true);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.CANCELLED, BookingStatus.CONFIRMED), false);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.COMPLETED, BookingStatus.CANCELLED), false);
});

test("room assignment requires one canonical room identifier", () => {
  const roomId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseAdminBookingRoomAssignmentBody({ roomId }), { roomId });
  assert.throws(() => parseAdminBookingRoomAssignmentBody({ roomId: "invalid" }));
  assert.throws(() => parseAdminBookingRoomAssignmentBody({ roomId, force: true }));
});

test("booking action parser is strict and normalizes the reason", () => {
  assert.deepEqual(parseAdminBookingStatusBody({ status: "CHECKED_IN" }), {
    status: BookingStatus.CHECKED_IN,
    reason: null,
  });
  assert.deepEqual(parseAdminBookingStatusBody({ status: "CANCELLED", reason: "  Demande du client  " }), {
    status: BookingStatus.CANCELLED,
    reason: "Demande du client",
  });
  assert.throws(() => parseAdminBookingStatusBody({ status: "CONFIRMED" }));
  assert.throws(() => parseAdminBookingStatusBody({ status: "CANCELLED", force: true }));
});

test("daily lifecycle actions respect the hotel business date", () => {
  const today = new Date("2026-08-25T00:00:00.000Z");
  const assertDenied = (action: () => void, code: string) => assert.throws(action, (error) => (
    error instanceof AdminApiError && error.code === code && error.statusCode === 409
  ));

  assertDenied(
    () => assertBookingStatusTiming(BookingStatus.CHECKED_IN, new Date("2026-08-26T00:00:00.000Z"), new Date("2026-08-28T00:00:00.000Z"), today),
    "BOOKING_NOT_CHECK_IN_READY",
  );
  assert.doesNotThrow(() => assertBookingStatusTiming(
    BookingStatus.CHECKED_IN,
    new Date("2026-08-25T00:00:00.000Z"),
    new Date("2026-08-28T00:00:00.000Z"),
    today,
  ));
  assertDenied(
    () => assertBookingStatusTiming(BookingStatus.COMPLETED, new Date("2026-08-22T00:00:00.000Z"), new Date("2026-08-26T00:00:00.000Z"), today),
    "BOOKING_NOT_FINISHABLE",
  );
  assert.doesNotThrow(() => assertBookingStatusTiming(
    BookingStatus.COMPLETED,
    new Date("2026-08-22T00:00:00.000Z"),
    today,
    today,
  ));
  assertDenied(
    () => assertBookingStatusTiming(BookingStatus.NO_SHOW, new Date("2026-08-26T00:00:00.000Z"), new Date("2026-08-28T00:00:00.000Z"), today),
    "BOOKING_NOT_NO_SHOW",
  );
});
