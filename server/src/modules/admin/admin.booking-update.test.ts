import assert from "node:assert/strict";
import test from "node:test";
import { bookingPricingChanged, parseAdminBookingUpdateBody } from "./admin.booking-update.js";

const body = {
  updatedAt: "2026-08-30T12:00:00.000Z",
  roomTypeId: "123e4567-e89b-42d3-a456-426614174000",
  arrival: "2026-09-10",
  departure: "2026-09-12",
  adults: 2,
  children: 0,
  extraIds: ["223e4567-e89b-42d3-a456-426614174000"],
  expectedTotal: 24_000,
  guest: { firstName: "Nicolas", lastName: "Martin", email: "nicolas@example.com", countryCode: "fr" },
  specialRequests: "Arrivée vers 18h",
  reason: "Séjour prolongé",
};

test("normalise une modification complète de réservation", () => {
  const parsed = parseAdminBookingUpdateBody(body);
  assert.equal(parsed.updatedAt.toISOString(), body.updatedAt);
  assert.equal(parsed.guest.countryCode, "FR");
  assert.equal(parsed.reason, "Séjour prolongé");
});

test("refuse les champs inattendus et les versions non canoniques", () => {
  assert.throws(() => parseAdminBookingUpdateBody({ ...body, total: 1 }));
  assert.throws(() => parseAdminBookingUpdateBody({ ...body, updatedAt: "2026-08-30" }));
});

test("détecte les changements de séjour indépendamment de l'ordre des options", () => {
  const parsed = parseAdminBookingUpdateBody(body);
  const current = {
    checkIn: parsed.arrival,
    checkOut: parsed.departure,
    adults: parsed.adults,
    children: parsed.children,
    roomTypeId: parsed.roomTypeId,
    extraIds: [...parsed.extraIds].reverse(),
  };
  assert.equal(bookingPricingChanged(current, parsed), false);
  assert.equal(bookingPricingChanged({ ...current, adults: 1 }, parsed), true);
});
