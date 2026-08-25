import assert from "node:assert/strict";
import test from "node:test";
import { ContactApiError } from "./contact.errors.js";
import { parseContactIdempotencyKey, parseContactRequestBody } from "./contact.validation.js";

const validBody = {
  fullName: "  Camille Martin  ",
  email: " Camille.Martin@example.com ",
  phone: " +33 6 12 34 56 78 ",
  subject: "ARRIVAL",
  message: "  Nous arriverons probablement après vingt-deux heures.  ",
  privacyAccepted: true,
};

test("normalise une demande de contact valide", () => {
  assert.deepEqual(parseContactRequestBody(validBody), {
    fullName: "Camille Martin",
    email: "camille.martin@example.com",
    phone: "+33 6 12 34 56 78",
    subject: "ARRIVAL",
    message: "Nous arriverons probablement après vingt-deux heures.",
    privacyAccepted: true,
  });
});

test("rejette les demandes incomplètes, inattendues ou sans consentement", () => {
  const invalid = (body: unknown) => assert.throws(
    () => parseContactRequestBody(body),
    (error: unknown) => error instanceof ContactApiError && error.statusCode === 400,
  );
  invalid({ ...validBody, email: "camille" });
  invalid({ ...validBody, message: "Trop court" });
  invalid({ ...validBody, privacyAccepted: false });
  invalid({ ...validBody, company: "robot" });
});

test("valide une clé d'idempotence UUID", () => {
  assert.equal(parseContactIdempotencyKey(" 550e8400-e29b-41d4-a716-446655440000 "), "550e8400-e29b-41d4-a716-446655440000");
  assert.throws(() => parseContactIdempotencyKey("contact-1"), ContactApiError);
});
