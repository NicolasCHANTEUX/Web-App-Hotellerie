import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingAccessToken,
  bookingAccessTokenExpiresAt,
  bookingAccessTokenHash,
  parseBookingAccessToken,
  publicBookingUrl,
} from "./booking.access.js";

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

test("ne fournit un lien personnel que tant que l'accès public est valide", () => {
  const id = "10000000-0000-4000-8000-000000000002";
  const token = bookingAccessToken(id);
  const now = new Date("2026-10-20T10:00:00.000Z");
  const booking = {
    id,
    publicAccessTokenHash: bookingAccessTokenHash(token),
    publicAccessTokenExpiresAt: new Date("2026-11-30T00:00:00.000Z"),
  };

  const url = publicBookingUrl(booking, now);
  assert.ok(url?.endsWith(`/confirmation#acces=${token}`), url);
  assert.equal(publicBookingUrl({ ...booking, publicAccessTokenExpiresAt: now }, now), undefined);
  assert.equal(publicBookingUrl({ ...booking, publicAccessTokenHash: null }, now), undefined);
  assert.equal(publicBookingUrl({ ...booking, publicAccessTokenHash: bookingAccessTokenHash("bkg_autre") }, now), undefined);
});
