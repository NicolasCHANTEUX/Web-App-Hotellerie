import assert from "node:assert/strict";
import test from "node:test";
import type { AdminMembershipContext } from "./admin.auth.js";
import {
  parseAdminContactRequestFilter,
  parseAdminContactRequestHandlingBody,
  requireContactRequestPermission,
} from "./admin.contact.js";
import { AdminApiError } from "./admin.errors.js";

function membership(role: AdminMembershipContext["role"]): AdminMembershipContext {
  return {
    propertyId: "11111111-1111-4111-8111-111111111111",
    role,
    createdAt: new Date(),
    property: { id: "11111111-1111-4111-8111-111111111111", name: "Hôtel", slug: "hotel", timezone: "Europe/Paris", currency: "EUR" },
  };
}

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

test("réserve les demandes de contact à l'administration et à la réception", () => {
  assert.equal(requireContactRequestPermission(membership("ADMIN")).role, "ADMIN");
  assert.equal(requireContactRequestPermission(membership("RECEPTION")).role, "RECEPTION");
  assert.throws(() => requireContactRequestPermission(membership("ACCOUNTING")), adminError("ROLE_ACCESS_DENIED"));
  assert.throws(() => requireContactRequestPermission(membership("HOUSEKEEPING")), adminError("ROLE_ACCESS_DENIED"));
});

test("affiche par défaut les demandes à traiter", () => {
  assert.equal(parseAdminContactRequestFilter(undefined), "OPEN");
  assert.equal(parseAdminContactRequestFilter(""), "OPEN");
  assert.equal(parseAdminContactRequestFilter("HANDLED"), "HANDLED");
  assert.equal(parseAdminContactRequestFilter("ALL"), "ALL");
  assert.throws(() => parseAdminContactRequestFilter("handled"), adminError("INVALID_QUERY"));
});

test("valide le passage d'une demande à traitée", () => {
  const updatedAt = "2026-10-22T08:00:00.000Z";
  assert.deepEqual(parseAdminContactRequestHandlingBody({ handled: true, updatedAt }), { handled: true, updatedAt: new Date(updatedAt) });
  assert.throws(() => parseAdminContactRequestHandlingBody({ handled: "oui", updatedAt }), adminError("INVALID_CONTACT_REQUEST"));
  assert.throws(() => parseAdminContactRequestHandlingBody({ handled: true }), adminError("INVALID_CONTACT_REQUEST"));
  assert.throws(() => parseAdminContactRequestHandlingBody({ handled: true, updatedAt: "2026-10-22" }), adminError("INVALID_CONTACT_REQUEST"));
  assert.throws(() => parseAdminContactRequestHandlingBody({ handled: true, updatedAt, note: "x" }), adminError("INVALID_CONTACT_REQUEST"));
  assert.throws(() => parseAdminContactRequestHandlingBody(null), adminError("INVALID_CONTACT_REQUEST"));
});
