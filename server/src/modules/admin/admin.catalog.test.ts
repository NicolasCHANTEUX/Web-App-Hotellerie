import assert from "node:assert/strict";
import test from "node:test";
import type { AdminMembershipContext } from "./admin.auth.js";
import { catalogCodeFromName, nextAvailableCode, requireCatalogPermission } from "./admin.catalog.js";
import { AdminApiError } from "./admin.errors.js";

test("dérive un code technique stable depuis le nom", () => {
  assert.equal(catalogCodeFromName("Petit-déjeuner continental"), "PETIT_DEJEUNER_CONTINENTAL");
  assert.equal(catalogCodeFromName("  Lit bébé (0-3 ans) "), "LIT_BEBE_0_3_ANS");
  assert.equal(catalogCodeFromName("!!!"), "");
});

test("choisit le premier code libre", () => {
  assert.equal(nextAvailableCode("PARKING", new Set()), "PARKING");
  assert.equal(nextAvailableCode("PARKING", new Set(["PARKING", "PARKING_2"])), "PARKING_3");
});

test("réserve la gestion du catalogue aux administrateurs", () => {
  const membership = (role: AdminMembershipContext["role"]) => ({ role }) as AdminMembershipContext;
  assert.equal(requireCatalogPermission(membership("ADMIN")).role, "ADMIN");
  for (const role of ["RECEPTION", "ACCOUNTING", "HOUSEKEEPING"] as const) {
    assert.throws(
      () => requireCatalogPermission(membership(role)),
      (error) => error instanceof AdminApiError && error.statusCode === 403,
    );
  }
});
