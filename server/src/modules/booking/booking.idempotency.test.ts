import assert from "node:assert/strict";
import test from "node:test";
import { BookingError } from "./booking.errors.js";
import {
  assertIdempotencyRequestMatches,
  bookingReferenceFromIdempotencyKey,
  bookingRequestHash,
  parseIdempotencyKey,
} from "./booking.idempotency.js";
import type { CreateBookingInput } from "./booking.types.js";

const KEY = "123E4567-E89B-42D3-A456-426614174000";

function input(): CreateBookingInput {
  return {
    roomTypeId: "11111111-1111-4111-8111-111111111111",
    arrival: new Date("2027-01-10T00:00:00.000Z"),
    departure: new Date("2027-01-13T00:00:00.000Z"),
    adults: 2,
    children: 0,
    extraIds: [
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
    ],
    expectedTotal: 49_950,
    guest: {
      firstName: "Sophie",
      lastName: "Martin",
      email: "sophie@example.com",
      phone: "+33 6 12 34 56 78",
      countryCode: "FR",
    },
    specialRequests: "Chambre au calme",
  };
}

test("valide et normalise une clé d'idempotence UUID", () => {
  assert.equal(parseIdempotencyKey(`  ${KEY}  `), KEY.toLowerCase());
  assert.throws(
    () => parseIdempotencyKey(undefined),
    (error: unknown) => error instanceof BookingError && error.code === "INVALID_IDEMPOTENCY_KEY",
  );
  assert.throws(
    () => parseIdempotencyKey("not-a-uuid"),
    (error: unknown) => error instanceof BookingError && error.statusCode === 400,
  );
});

test("dérive une référence stable et insensible à la casse", () => {
  assert.equal(
    bookingReferenceFromIdempotencyKey(KEY),
    bookingReferenceFromIdempotencyKey(KEY.toLowerCase()),
  );
  assert.equal(bookingReferenceFromIdempotencyKey(KEY), "RVG-123E4567E89B42D3A456426614174000");
});

test("le hash est stable quand seul l'ordre des options change", () => {
  const first = input();
  const second = { ...input(), extraIds: [...input().extraIds].reverse() };
  assert.equal(bookingRequestHash(first), bookingRequestHash(second));
});

test("le hash change si le payload ou le prix attendu change", () => {
  const original = input();
  assert.notEqual(bookingRequestHash(original), bookingRequestHash({ ...input(), adults: 1 }));
  assert.notEqual(bookingRequestHash(original), bookingRequestHash({ ...input(), expectedTotal: 50_000 }));
  assert.notEqual(
    bookingRequestHash(original),
    bookingRequestHash({ ...input(), guest: { ...input().guest, email: "autre@example.com" } }),
  );
});

test("refuse explicitement le réemploi d'une clé avec un autre payload", () => {
  assert.doesNotThrow(() => assertIdempotencyRequestMatches("same", "same"));
  assert.throws(
    () => assertIdempotencyRequestMatches("first", "second"),
    (error: unknown) =>
      error instanceof BookingError && error.statusCode === 409 && error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});
