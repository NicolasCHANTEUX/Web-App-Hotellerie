import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin.errors.js";
import {
  parseAdminTouristTaxCreateBody,
  parseAdminTouristTaxDeleteBody,
  parseAdminTouristTaxUpdateBody,
} from "./admin.tourist-tax.js";

const valid = {
  label: "  Taxe de séjour 2027 ",
  calculationMode: "PER_ADULT_PER_NIGHT",
  amount: 2.304,
  rate: null,
  validFrom: "2027-01-01",
  validUntil: "2027-12-31",
  isActive: true,
};

function assertInvalid(action: () => unknown, pattern: RegExp) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.code, "INVALID_TOURIST_TAX");
    assert.match(error.message, pattern);
    return true;
  });
}

test("normalise une taxe à montant fixe sur une période", () => {
  assert.deepEqual(parseAdminTouristTaxCreateBody(valid), {
    label: "Taxe de séjour 2027",
    calculationMode: "PER_ADULT_PER_NIGHT",
    amount: 2.3,
    rate: null,
    validFrom: new Date("2027-01-01T00:00:00.000Z"),
    validUntil: new Date("2027-12-31T00:00:00.000Z"),
    isActive: true,
  });
  const unbounded = parseAdminTouristTaxCreateBody({ ...valid, validFrom: null, validUntil: "" });
  assert.equal(unbounded.validFrom, null);
  assert.equal(unbounded.validUntil, null);
});

test("associe le taux au pourcentage et le montant aux autres modes", () => {
  const percentage = parseAdminTouristTaxCreateBody({ ...valid, calculationMode: "PERCENTAGE", amount: null, rate: 5 });
  assert.equal(percentage.rate, 5);
  assert.equal(percentage.amount, null);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, calculationMode: "PERCENTAGE", rate: 5 }), /sans montant/);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, rate: 5 }), /sans taux/);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, amount: null }), /montant/i);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, amount: 0 }), /montant/i);
});

test("refuse une période ou des valeurs incohérentes", () => {
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, validUntil: "2026-12-31" }), /dernière nuit/);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, validFrom: "2027-02-30" }), /première nuit/);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, calculationMode: "PER_WEEK" }), /mode de calcul/);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, label: "x" }), /libellé/);
  assertInvalid(() => parseAdminTouristTaxCreateBody({ ...valid, kind: "VAT" }), /kind/);
});

test("exige une version canonique pour modifier ou supprimer", () => {
  const updatedAt = "2026-10-21T08:00:00.000Z";
  assert.equal(parseAdminTouristTaxUpdateBody({ ...valid, updatedAt }).updatedAt.toISOString(), updatedAt);
  assert.equal(parseAdminTouristTaxDeleteBody({ updatedAt }).updatedAt.toISOString(), updatedAt);
  assertInvalid(() => parseAdminTouristTaxUpdateBody(valid), /version/);
});
