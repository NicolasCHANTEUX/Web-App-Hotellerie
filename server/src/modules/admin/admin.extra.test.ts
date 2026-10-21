import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin.errors.js";
import { parseAdminExtraCreateBody, parseAdminExtraDeleteBody, parseAdminExtraUpdateBody } from "./admin.extra.js";

const validExtra = {
  name: "  Petit-déjeuner  ",
  description: "  Buffet maison chaque matin  ",
  price: 18.005,
  pricingUnit: "PER_PERSON_PER_NIGHT",
  taxRate: 10,
  isActive: true,
  displayOrder: 2,
};

function assertInvalid(action: () => unknown, pattern?: RegExp) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "INVALID_EXTRA");
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("normalise une option du catalogue", () => {
  assert.deepEqual(parseAdminExtraCreateBody(validExtra), {
    name: "Petit-déjeuner",
    description: "Buffet maison chaque matin",
    price: 18.01,
    pricingUnit: "PER_PERSON_PER_NIGHT",
    taxRate: 10,
    isActive: true,
    displayOrder: 2,
  });
  assert.equal(parseAdminExtraCreateBody({ ...validExtra, description: "", price: 0 }).price, 0);
});

test("refuse une option incomplète ou incohérente", () => {
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, name: " x " }), /nom/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, price: -1 }), /prix/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, price: "18" }), /prix/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, pricingUnit: "PER_WEEK" }), /unité/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, taxRate: 120 }), /TVA/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, displayOrder: 1.5 }), /ordre/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, isActive: "oui" }), /état/i);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, code: "BREAKFAST" }), /code/);
  assertInvalid(() => parseAdminExtraCreateBody({ ...validExtra, description: "x".repeat(301) }), /description/i);
});

test("exige une version canonique pour modifier ou supprimer", () => {
  const updatedAt = "2026-10-20T10:15:30.123Z";
  assert.equal(parseAdminExtraUpdateBody({ ...validExtra, updatedAt }).updatedAt.toISOString(), updatedAt);
  assert.equal(parseAdminExtraDeleteBody({ updatedAt }).updatedAt.toISOString(), updatedAt);
  assertInvalid(() => parseAdminExtraUpdateBody(validExtra), /version/i);
  assertInvalid(() => parseAdminExtraDeleteBody({ updatedAt: "2026-10-20" }), /version/i);
  assertInvalid(() => parseAdminExtraDeleteBody({ updatedAt, name: "Parking" }), /name/);
});
