import type { FastifyInstance, FastifyReply } from "fastify";
import { createStripeCheckout, constructStripeEvent, getPublicBooking, getStripeCheckoutStatus, PaymentApiError, processStripeEvent, stripeEnabled } from "./payment.service.js";
import { parseStripeCheckoutSessionId } from "./payment.validation.js";
import { parseBookingAccessToken } from "../booking/booking.access.js";
import { BookingError } from "../booking/booking.errors.js";

type CheckoutBody = { accessToken?: unknown };

function sendPaymentError(reply: FastifyReply, error: unknown) {
  if (error instanceof PaymentApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
  if (error instanceof BookingError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
  throw error;
}

function accessTokenHeader(value: string | string[] | undefined) {
  return parseBookingAccessToken(Array.isArray(value) ? value[0] : value);
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
  app.get("/bookings/public", {
    config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    try {
      return { data: await getPublicBooking(accessTokenHeader(request.headers["x-booking-access-token"])) };
    } catch (error) {
      return sendPaymentError(reply, error);
    }
  });
  app.get<{ Querystring: { sessionId?: unknown } }>("/payments/stripe/status", {
    config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    try {
      return { data: await getStripeCheckoutStatus(
        parseStripeCheckoutSessionId(request.query.sessionId),
        accessTokenHeader(request.headers["x-booking-access-token"]),
      ) };
    } catch (error) {
      return sendPaymentError(reply, error);
    }
  });
  app.post<{ Body: CheckoutBody }>("/payments/stripe/checkout", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    try {
      const keys = request.body && typeof request.body === "object" ? Object.keys(request.body) : [];
      if (keys.some((key) => key !== "accessToken")) throw new PaymentApiError(400, "INVALID_PAYMENT_INPUT", "La demande de paiement est invalide.");
      return { data: await createStripeCheckout(
        parseBookingAccessToken(request.body?.accessToken),
        idempotencyKey(request.headers["idempotency-key"]),
      ) };
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
