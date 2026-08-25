import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAdminBookingCreateBody,
  parseAdminBookingIdempotencyKey,
  parseAdminBookingOptionsQuery,
} from "./admin.booking-create.js";

const ROOM_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const EXTRA_ID = "22222222-2222-4222-8222-222222222222";

function validBooking() {
  return {
    source: "PHONE",
    roomTypeId: ROOM_TYPE_ID,
    arrival: "2026-09-10",
    departure: "2026-09-12",
    adults: 2,
    children: 0,
    extraIds: [EXTRA_ID],
    expectedTotal: 24_000,
    termsAccepted: true,
    guest: {
      firstName: " Camille ",
      lastName: " Martin ",
      email: "CAMILLE@example.com",
      phone: "+33 6 12 34 56 78",
      countryCode: "fr",
    },
    specialRequests: " Lit bébé ",
  };
}

test("normalise une réservation saisie par la réception", () => {
  const booking = parseAdminBookingCreateBody(validBooking());

  assert.equal(booking.source, "PHONE");
  assert.equal(booking.guest.firstName, "Camille");
  assert.equal(booking.guest.email, "camille@example.com");
  assert.equal(booking.guest.countryCode, "FR");
  assert.equal(booking.specialRequests, "Lit bébé");
});

test("refuse une origine publique ou un champ inattendu", () => {
  assert.throws(
    () => parseAdminBookingCreateBody({ ...validBooking(), source: "WEBSITE" }),
    /origine de la réservation/i,
  );
  assert.throws(
    () => parseAdminBookingCreateBody({ ...validBooking(), status: "CONFIRMED" }),
    /champ non autorisé/i,
  );
});

test("adapte les coordonnées obligatoires au canal de réservation", () => {
  const withoutContacts = {
    ...validBooking(),
    source: "WALK_IN",
    guest: { firstName: "Camille", lastName: "Martin", countryCode: "FR" },
  };
  assert.deepEqual(parseAdminBookingCreateBody(withoutContacts).guest, {
    firstName: "Camille",
    lastName: "Martin",
    countryCode: "FR",
  });
  assert.throws(
    () => parseAdminBookingCreateBody({ ...withoutContacts, source: "PHONE" }),
    /numéro de téléphone est requis/i,
  );
  assert.throws(
    () => parseAdminBookingCreateBody({ ...withoutContacts, source: "EMAIL" }),
    /adresse e-mail est requise/i,
  );
});

test("valide les critères de disponibilité et la clé d'idempotence", () => {
  const options = parseAdminBookingOptionsQuery({
    arrival: "2026-09-10",
    departure: "2026-09-12",
    adults: "2",
    children: "1",
  });
  assert.equal(options.adults, 2);
  assert.equal(options.children, 1);
  assert.equal(options.arrival.toISOString().slice(0, 10), "2026-09-10");
  assert.equal(
    parseAdminBookingIdempotencyKey("550E8400-E29B-41D4-A716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000",
  );
});
