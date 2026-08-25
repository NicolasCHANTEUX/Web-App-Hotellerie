import assert from "node:assert/strict";
import test from "node:test";
import { parseManualPaymentBody, parseRefundBody } from "./billing.validation.js";

test("normalise un paiement manuel", () => {
  assert.deepEqual(parseManualPaymentBody({ paymentMethodType: "  Carte sur place ", note: " Réglé " }), {
    paymentMethodType: "Carte sur place",
    note: "Réglé",
  });
});

test("refuse les champs de paiement inattendus", () => {
  assert.throws(() => parseManualPaymentBody({ paymentMethodType: "Espèces", amount: 1 }));
});

test("arrondit le montant d'un remboursement", () => {
  const input = parseRefundBody({
    paymentId: "a7d40444-9b7b-4d36-8fb7-e02818b7a1f0",
    amount: 10.129,
    reason: "Geste commercial",
  });
  assert.equal(input.amount, 10.13);
});
