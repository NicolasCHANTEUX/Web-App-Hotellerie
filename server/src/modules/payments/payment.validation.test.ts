import assert from "node:assert/strict";
import test from "node:test";
import { PaymentApiError } from "./payment.service.js";
import { parseStripeCheckoutSessionId } from "./payment.validation.js";

test("valide un identifiant de session Checkout sans le transformer", () => {
  const id = "cs_test_a1234567890BCDEFGHIJK";
  assert.equal(parseStripeCheckoutSessionId(` ${id} `), id);
});

test("refuse une référence de réservation ou un identifiant de paiement", () => {
  for (const value of [undefined, "RVG-DEMO-001", "pi_1234567890", "cs_test_short", "cs_unknown_a1234567890BCDEFGHIJK"]) {
    assert.throws(
      () => parseStripeCheckoutSessionId(value),
      (error: unknown) => error instanceof PaymentApiError && error.code === "INVALID_CHECKOUT_SESSION",
    );
  }
});
