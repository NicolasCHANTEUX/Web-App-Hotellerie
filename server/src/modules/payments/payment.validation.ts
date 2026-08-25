import { PaymentApiError } from "./payment.service.js";

const STRIPE_CHECKOUT_SESSION = /^cs_(?:test|live)_[A-Za-z0-9]{16,255}$/;

export function parseStripeCheckoutSessionId(value: unknown) {
  if (typeof value !== "string" || !STRIPE_CHECKOUT_SESSION.test(value.trim())) {
    throw new PaymentApiError(400, "INVALID_CHECKOUT_SESSION", "La session de paiement est invalide.");
  }
  return value.trim();
}
