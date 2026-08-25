import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNTING_RETENTION_YEARS, retentionDeadlineFrom } from "./retention.service.js";

test("calcule une échéance de conservation dix ans après la date de référence", () => {
  const source = new Date("2026-08-24T12:30:00.000Z");
  assert.equal(ACCOUNTING_RETENTION_YEARS, 10);
  assert.equal(retentionDeadlineFrom(source).toISOString(), "2036-08-24T12:30:00.000Z");
  assert.equal(source.toISOString(), "2026-08-24T12:30:00.000Z");
});

test("accepte une durée explicite pour les politiques futures", () => {
  assert.equal(
    retentionDeadlineFrom(new Date("2026-01-10T00:00:00.000Z"), 3).toISOString(),
    "2029-01-10T00:00:00.000Z",
  );
});
