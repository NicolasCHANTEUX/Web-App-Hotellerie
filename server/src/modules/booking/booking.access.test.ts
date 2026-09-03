import assert from "node:assert/strict";
import test from "node:test";
import { bookingAccessToken, bookingAccessTokenExpiresAt, bookingAccessTokenHash, parseBookingAccessToken } from "./booking.access.js";

test("produit un jeton public opaque et stable pour une réservation", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const first = bookingAccessToken(id);
  assert.match(first, /^bkg_[A-Za-z0-9_-]{43}$/);
  assert.equal(first, bookingAccessToken(id));
  assert.equal(bookingAccessTokenHash(first).length, 64);
  assert.equal(parseBookingAccessToken(first), first);
});

test("refuse les jetons publics mal formés", () => {
  assert.throws(() => parseBookingAccessToken("RVG-123"), /Réservation introuvable/);
});

test("accepte les anciens jetons Rivage pendant la transition", () => {
  const legacyToken = `rvg_${"a".repeat(43)}`;
  assert.equal(parseBookingAccessToken(legacyToken), legacyToken);
});

test("conserve l'accès jusqu'à trente jours après le départ", () => {
  assert.equal(bookingAccessTokenExpiresAt(new Date("2026-09-15T00:00:00.000Z")).toISOString(), "2026-10-15T00:00:00.000Z");
});
