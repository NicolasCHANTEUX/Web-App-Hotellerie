import assert from "node:assert/strict";
import test from "node:test";
import { BookingError } from "./booking.errors.js";
import { parseCreateBookingBody } from "./booking.validation.js";

const ROOM_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const BREAKFAST_ID = "22222222-2222-4222-8222-222222222222";
const PARKING_ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

function dateFromToday(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validBody() {
  return {
    roomTypeId: ROOM_TYPE_ID,
    arrival: dateFromToday(30),
    departure: dateFromToday(33),
    adults: 2,
    children: 1,
    extraIds: [BREAKFAST_ID, PARKING_ID],
    expectedTotal: 49_950,
    guest: {
      firstName: "  Sophie ",
      lastName: " Martin  ",
      email: " SOPHIE.MARTIN@EXAMPLE.COM ",
      phone: "+33 6 12 34 56 78",
      countryCode: "fr",
    },
    specialRequests: "  Chambre au calme  ",
  };
}

function assertInvalid(body: unknown) {
  assert.throws(
    () => parseCreateBookingBody(body),
    (error: unknown) => {
      assert.ok(error instanceof BookingError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_BOOKING");
      return true;
    },
  );
}

test("accepte et normalise une réservation valide avec des dates futures", () => {
  const body = validBody();
  const parsed = parseCreateBookingBody(body);

  assert.equal(parsed.roomTypeId, ROOM_TYPE_ID);
  assert.equal(parsed.arrival.toISOString().slice(0, 10), body.arrival);
  assert.equal(parsed.departure.toISOString().slice(0, 10), body.departure);
  assert.equal(parsed.adults, 2);
  assert.equal(parsed.children, 1);
  assert.deepEqual(parsed.extraIds, [BREAKFAST_ID, PARKING_ID]);
  assert.equal(parsed.expectedTotal, 49_950);
  assert.deepEqual(parsed.guest, {
    firstName: "Sophie",
    lastName: "Martin",
    email: "sophie.martin@example.com",
    phone: "+33 6 12 34 56 78",
    countryCode: "FR",
  });
  assert.equal(parsed.specialRequests, "Chambre au calme");
});

test("refuse une date d'arrivée passée", () => {
  assertInvalid({
    ...validBody(),
    arrival: dateFromToday(-2),
    departure: dateFromToday(-1),
  });
});

test("refuse les champs inconnus à la racine et dans le client", () => {
  assertInvalid({ ...validBody(), total: 1 });

  const body = validBody();
  assertInvalid({
    ...body,
    guest: { ...body.guest, isAdmin: true },
  });
});

test("refuse les UUID invalides", () => {
  assertInvalid({ ...validBody(), roomTypeId: "not-a-uuid" });
  assertInvalid({ ...validBody(), extraIds: [BREAKFAST_ID, "not-a-uuid"] });
});

test("refuse les options dupliquées, sans tenir compte de la casse", () => {
  assertInvalid({
    ...validBody(),
    extraIds: [PARKING_ID, PARKING_ID.toLowerCase()],
  });
});

test("accepte les bornes globales de voyageurs validées par le parseur", () => {
  const parsed = parseCreateBookingBody({ ...validBody(), adults: 10, children: 10 });
  assert.equal(parsed.adults, 10);
  assert.equal(parsed.children, 10);
});

test("refuse les nombres de voyageurs hors bornes ou non entiers", () => {
  for (const adults of [0, 11, 1.5, "2"]) {
    assertInvalid({ ...validBody(), adults });
  }
  for (const children of [-1, 11, 0.5, "0"]) {
    assertInvalid({ ...validBody(), children });
  }
});

test("refuse un montant attendu absent, négatif, décimal ou démesuré", () => {
  const { expectedTotal: _missing, ...withoutExpectedTotal } = validBody();
  assertInvalid(withoutExpectedTotal);
  for (const expectedTotal of [-1, 1.5, 100_000_001, "49950"]) {
    assertInvalid({ ...validBody(), expectedTotal });
  }
});
