import { AdminApiError } from "../admin/admin.errors.js";

export type ManualPaymentInput = {
  paymentMethodType: string;
  note?: string;
};

export type RefundInput = {
  paymentId: string;
  amount?: number;
  reason: string;
};

function objectBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AdminApiError(400, "INVALID_BILLING_INPUT", "Les informations de paiement sont invalides.");
  }
  return body as Record<string, unknown>;
}

function exactFields(body: Record<string, unknown>, allowed: readonly string[]) {
  const unexpected = Object.keys(body).find((key) => !allowed.includes(key));
  if (unexpected) throw new AdminApiError(400, "INVALID_BILLING_INPUT", `Le champ ${unexpected} n'est pas accepté.`);
}

function text(value: unknown, label: string, max: number, required = true) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim().length < (required ? 1 : 0) || value.trim().length > max) {
    throw new AdminApiError(400, "INVALID_BILLING_INPUT", `${label} est invalide.`);
  }
  return value.trim();
}

export function parseManualPaymentBody(body: unknown): ManualPaymentInput {
  const value = objectBody(body);
  exactFields(value, ["paymentMethodType", "note"]);
  return {
    paymentMethodType: text(value.paymentMethodType, "Le moyen de paiement", 50)!,
    note: text(value.note, "La note", 500, false),
  };
}

export function parseRefundBody(body: unknown): RefundInput {
  const value = objectBody(body);
  exactFields(value, ["paymentId", "amount", "reason"]);
  const paymentId = text(value.paymentId, "Le paiement", 36)!;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
    throw new AdminApiError(400, "INVALID_BILLING_INPUT", "Le paiement est invalide.");
  }
  let amount: number | undefined;
  if (value.amount !== undefined) {
    if (typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount <= 0 || value.amount > 1_000_000) {
      throw new AdminApiError(400, "INVALID_BILLING_INPUT", "Le montant du remboursement est invalide.");
    }
    amount = Math.round(value.amount * 100) / 100;
  }
  return { paymentId, amount, reason: text(value.reason, "Le motif", 500)! };
}

export function parseIdempotencyKey(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || candidate.length < 16 || candidate.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(candidate)) {
    throw new AdminApiError(400, "INVALID_IDEMPOTENCY_KEY", "Une clé d'idempotence valide est requise.");
  }
  return candidate;
}
