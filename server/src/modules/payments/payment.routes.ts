import type { FastifyInstance, FastifyReply } from "fastify";
import { createStripeCheckout, constructStripeEvent, PaymentApiError, processStripeEvent, stripeEnabled } from "./payment.service.js";

type CheckoutBody = { reference?: unknown; email?: unknown };

function sendPaymentError(reply: FastifyReply, error: unknown) {
  if (error instanceof PaymentApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
  throw error;
}

function idempotencyKey(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || candidate.length < 16 || candidate.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(candidate)) {
    throw new PaymentApiError(400, "INVALID_IDEMPOTENCY_KEY", "Une clé d'idempotence valide est requise.");
  }
  return candidate;
}

export async function paymentRoutes(app: FastifyInstance) {
  app.get("/payments/config", async () => ({ data: { stripeEnabled: stripeEnabled() } }));
  app.post<{ Body: CheckoutBody }>("/payments/stripe/checkout", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    try {
      const keys = request.body && typeof request.body === "object" ? Object.keys(request.body) : [];
      if (keys.some((key) => !["reference", "email"].includes(key))) throw new PaymentApiError(400, "INVALID_PAYMENT_INPUT", "La demande de paiement est invalide.");
      const reference = typeof request.body?.reference === "string" ? request.body.reference.trim() : "";
      const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
      if (!/^RVG-[A-Za-z0-9-]{6,80}$/.test(reference) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new PaymentApiError(400, "INVALID_PAYMENT_INPUT", "La demande de paiement est invalide.");
      }
      return { data: await createStripeCheckout(reference, email, idempotencyKey(request.headers["idempotency-key"])) };
    } catch (error) {
      return sendPaymentError(reply, error);
    }
  });
}

export async function stripeWebhookRoutes(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.post<{ Body: Buffer }>("/payments/stripe/webhook", async (request, reply) => {
    try {
      const signatureHeader = request.headers["stripe-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature || !Buffer.isBuffer(request.body)) throw new PaymentApiError(400, "INVALID_STRIPE_SIGNATURE", "La signature Stripe est absente.");
      const event = constructStripeEvent(request.body, signature);
      return { received: true, ...(await processStripeEvent(event, request.body)) };
    } catch (error) {
      return sendPaymentError(reply, error);
    }
  });
}
