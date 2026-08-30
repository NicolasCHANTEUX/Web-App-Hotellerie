import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNTING_RETENTION_YEARS,
  CONTACT_RETENTION_YEARS,
  anonymizedPricingSnapshot,
  retentionDeadlineFrom,
} from "./retention.service.js";

test("calcule une échéance de conservation dix ans après la date de référence", () => {
  const source = new Date("2026-08-24T12:30:00.000Z");
  assert.equal(ACCOUNTING_RETENTION_YEARS, 10);
  assert.equal(retentionDeadlineFrom(source).toISOString(), "2036-08-24T12:30:00.000Z");
  assert.equal(source.toISOString(), "2026-08-24T12:30:00.000Z");
});

test("accepte une durée explicite pour les politiques futures", () => {
  assert.equal(CONTACT_RETENTION_YEARS, 3);
  assert.equal(
    retentionDeadlineFrom(new Date("2026-01-10T00:00:00.000Z"), 3).toISOString(),
    "2029-01-10T00:00:00.000Z",
  );
});

test("retire l'empreinte derivee des coordonnees du snapshot tarifaire", () => {
  assert.deepEqual(
    anonymizedPricingSnapshot({
      version: 3,
      idempotency: { key: "request-key", requestHash: "personal-data-derived-hash" },
      total: { amount: "204.00", currency: "EUR" },
    }),
    {
      version: 3,
      idempotency: { key: "request-key" },
      total: { amount: "204.00", currency: "EUR" },
    },
  );
});
