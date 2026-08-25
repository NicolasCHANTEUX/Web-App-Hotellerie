import assert from "node:assert/strict";
import test from "node:test";
import { BookingStatus } from "../../generated/prisma/client.js";
import { bookingStatusTransitionAllowed, parseAdminBookingRoomAssignmentBody, parseAdminBookingStatusBody } from "./admin.booking-actions.js";

test("booking lifecycle only permits operational terminal transitions", () => {
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED), true);
  assert.equal(bookingStatusTransitionAllowed(BookingStatus.CONFIRMED, BookingStatus.COMPLETED), true);
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
  assert.deepEqual(parseAdminBookingStatusBody({ status: "CANCELLED", reason: "  Demande du client  " }), {
    status: BookingStatus.CANCELLED,
    reason: "Demande du client",
  });
  assert.throws(() => parseAdminBookingStatusBody({ status: "CONFIRMED" }));
  assert.throws(() => parseAdminBookingStatusBody({ status: "CANCELLED", force: true }));
});
