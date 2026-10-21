import assert from "node:assert/strict";
import test from "node:test";
import { issuerLegalNotice } from "../billing/invoice.service.js";
import { AdminApiError } from "./admin.errors.js";
import { parseAdminPropertyUpdateBody } from "./admin.property.js";

const valid = {
  updatedAt: "2026-10-21T08:00:00.000Z",
  name: "  Hôtel Rivage ",
  legalName: "Rivage Hôtellerie",
  email: " CONTACT@hotel-rivage.fr ",
  phone: "+33 4 93 00 12 34",
  addressLine1: "26 avenue des Pins",
  addressLine2: "",
  postalCode: "06400",
  city: "Cannes",
  countryCode: "fr",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  legalForm: "SAS",
  shareCapital: "10 000 €",
  siret: "812 345 678 00012",
  registrationCity: "Cannes",
  vatNumber: "fr 12 812345678",
  publicationDirector: "Claire Martin",
  hostingProvider: "Hébergeur SAS\n1 rue du Serveur, 75000 Paris",
  mediator: null,
};

function assertInvalid(body: unknown, pattern: RegExp) {
  assert.throws(() => parseAdminPropertyUpdateBody(body), (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.code, "INVALID_PROPERTY");
    assert.match(error.message, pattern);
    return true;
  });
}

test("normalise les coordonnées et les mentions légales", () => {
  const parsed = parseAdminPropertyUpdateBody(valid);
  assert.equal(parsed.name, "Hôtel Rivage");
  assert.equal(parsed.email, "contact@hotel-rivage.fr");
  assert.equal(parsed.addressLine2, null);
  assert.equal(parsed.countryCode, "FR");
  assert.equal(parsed.siret, "81234567800012");
  assert.equal(parsed.vatNumber, "FR12812345678");
  assert.equal(parsed.hostingProvider, "Hébergeur SAS\n1 rue du Serveur, 75000 Paris");
  assert.equal(parsed.mediator, null);
  assert.equal(parsed.updatedAt.toISOString(), valid.updatedAt);
});

test("refuse des coordonnées ou des identifiants invalides", () => {
  assertInvalid({ ...valid, email: "contact" }, /e-mail/);
  assertInvalid({ ...valid, name: " " }, /nom/);
  assertInvalid({ ...valid, checkInTime: "25:00" }, /arrivée/);
  assertInvalid({ ...valid, siret: "812 345 678" }, /SIRET/);
  assertInvalid({ ...valid, vatNumber: "12345" }, /TVA/);
  assertInvalid({ ...valid, countryCode: "FRA" }, /pays/i);
  assertInvalid({ ...valid, legalName: "Rivage\nHôtellerie" }, /caractères invalides/);
  assertInvalid({ ...valid, slug: "autre" }, /slug/);
  const { mediator: _mediator, ...withoutMediator } = valid;
  assertInvalid(withoutMediator, /mediator/);
  assertInvalid({ ...valid, updatedAt: "2026-10-21" }, /version/);
});

test("compose les mentions légales d'une facture", () => {
  assert.equal(
    issuerLegalNotice({ legalForm: "SAS", shareCapital: "10 000 €", siret: "81234567800012", registrationCity: "Cannes", vatNumber: "FR12812345678" }),
    "SAS au capital de 10 000 € · SIRET 812 345 678 00012 · RCS Cannes · TVA FR12812345678",
  );
  assert.equal(issuerLegalNotice({ siret: "81234567800012" }), "SIRET 812 345 678 00012");
  assert.equal(issuerLegalNotice({ name: "Hôtel Rivage" }), "");
});
