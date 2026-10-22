import assert from "node:assert/strict";
import test from "node:test";
import type { AdminMembershipContext } from "./admin.auth.js";
import { requireDashboardPermission } from "./admin.dashboard.service.js";
import { startOfPropertyDay } from "../../lib/property-time.js";
import { AdminApiError } from "./admin.errors.js";

test("fait commencer la journée à minuit, heure de l'établissement", () => {
  assert.equal(startOfPropertyDay("2026-10-01", "Europe/Paris").toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(startOfPropertyDay("2026-12-01", "Europe/Paris").toISOString(), "2026-11-30T23:00:00.000Z");
  assert.equal(startOfPropertyDay("2026-07-01", "America/New_York").toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(startOfPropertyDay("2026-07-01", "UTC").toISOString(), "2026-07-01T00:00:00.000Z");
});

test("ouvre le tableau de bord à tous les rôles sauf la gouvernance", () => {
  const membership = (role: AdminMembershipContext["role"]): AdminMembershipContext => ({
    propertyId: "p",
    role,
    createdAt: new Date(),
    property: { id: "p", name: "H", slug: "h", timezone: "Europe/Paris", currency: "EUR" },
  });
  for (const role of ["ADMIN", "RECEPTION", "ACCOUNTING"] as const) assert.equal(requireDashboardPermission(membership(role)).role, role);
  assert.throws(
    () => requireDashboardPermission(membership("HOUSEKEEPING")),
    (error) => error instanceof AdminApiError && error.code === "ROLE_ACCESS_DENIED",
  );
});
