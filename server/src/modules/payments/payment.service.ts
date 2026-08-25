import { createHash, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { BookingStatus, PaymentStatus, Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { issuePaidInvoice } from "../billing/invoice.service.js";
import { enqueueBookingNotification } from "../notifications/notification.service.js";

export class PaymentApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "PaymentApiError";
  }
}

function stripeClient() {
  if (!env.stripeSecretKey) throw new PaymentApiError(503, "ONLINE_PAYMENT_DISABLED", "Le paiement en ligne n'est pas encore activé.");
  return new Stripe(env.stripeSecretKey);
}

function sameEmail(left: string, right: string) {
  const first = Buffer.from(left.trim().toLowerCase());
  const second = Buffer.from(right.trim().toLowerCase());
  return first.length === second.length && timingSafeEqual(first, second);
}

export function stripeEnabled() {
  return Boolean(env.stripeSecretKey && env.stripeWebhookSecret);
}

export async function createStripeCheckout(reference: string, email: string, requestKey: string) {
  if (!stripeEnabled()) throw new PaymentApiError(503, "ONLINE_PAYMENT_DISABLED", "Le paiement en ligne n'est pas encore activé.");
  const booking = await prisma.booking.findUnique({
    where: { reference },
    include: {
      guests: { where: { isPrimary: true }, take: 1, select: { firstName: true, lastName: true, email: true } },
      rooms: { orderBy: { createdAt: "asc" }, take: 1, select: { roomTypeNameSnapshot: true } },
      hold: true,
    },
  });
  const guest = booking?.guests[0];
  if (!booking || !guest?.email || !sameEmail(guest.email, email)) {
    throw new PaymentApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
  }
  if (booking.status !== BookingStatus.PENDING_PAYMENT || !booking.hold || booking.hold.status !== "ACTIVE" || booking.hold.expiresAt <= new Date()) {
    throw new PaymentApiError(409, "BOOKING_NOT_PAYABLE", "Cette option n'est plus disponible pour un paiement en ligne.");
  }
  if (booking.hold.expiresAt.getTime() - Date.now() < 30 * 60_000) {
    throw new PaymentApiError(409, "HOLD_TOO_SHORT", "L'option expire trop prochainement. Relancez une recherche de disponibilité.");
  }

  const idempotencyKey = `stripe-checkout:${booking.id}:${requestKey}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing?.providerReference?.startsWith("cs_")) {
    const session = await stripeClient().checkout.sessions.retrieve(existing.providerReference);
    if (session.url) return { checkoutUrl: session.url, sessionId: session.id };
  }
  if (existing) throw new PaymentApiError(409, "PAYMENT_ATTEMPT_FAILED", "Cette tentative a échoué. Rechargez la page pour réessayer.");

  const payment = await prisma.payment.create({
    data: {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      provider: "STRIPE",
      idempotencyKey,
      kind: "CHARGE",
      status: "REQUIRES_PAYMENT",
      amount: booking.total,
      currency: booking.currency,
      paymentMethodType: "card",
    },
  });
  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: "payment",
      customer_email: guest.email,
      client_reference_id: booking.reference,
      success_url: `${env.frontendUrl}/confirmation?payment=success&reference=${encodeURIComponent(booking.reference)}`,
      cancel_url: `${env.frontendUrl}/confirmation?payment=cancelled&reference=${encodeURIComponent(booking.reference)}`,
      expires_at: Math.floor(booking.hold.expiresAt.getTime() / 1000),
      metadata: { paymentId: payment.id, bookingId: booking.id, propertyId: booking.propertyId, reference: booking.reference },
      payment_intent_data: { metadata: { paymentId: payment.id, bookingId: booking.id, propertyId: booking.propertyId, reference: booking.reference } },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: booking.currency.toLowerCase(),
          unit_amount: booking.total.mul(100).toDecimalPlaces(0).toNumber(),
          product_data: { name: `Séjour Hôtel Rivage - ${booking.rooms[0]?.roomTypeNameSnapshot ?? booking.reference}`, description: `Réservation ${booking.reference}` },
        },
      }],
    }, { idempotencyKey });
    if (!session.url) throw new Error("Stripe Checkout did not return a URL.");
    await prisma.payment.update({ where: { id: payment.id }, data: { providerReference: session.id, status: PaymentStatus.PROCESSING } });
    return { checkoutUrl: session.url, sessionId: session.id };
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failureReason: error instanceof Error ? error.message.slice(0, 500) : "Stripe checkout error" },
    });
    if (error instanceof PaymentApiError) throw error;
    throw new PaymentApiError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "Le service de paiement est momentanément indisponible.");
  }
}

function paymentIdFromEvent(event: Stripe.Event) {
  if (!("metadata" in event.data.object)) return null;
  const value = event.data.object.metadata?.paymentId;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

async function finalizePayment(transaction: Prisma.TransactionClient, paymentId: string, providerReference?: string, method = "card") {
  const payment = await transaction.payment.findUnique({
    where: { id: paymentId },
    include: {
      booking: {
        include: {
          hold: { include: { allocation: true, room: { select: { number: true } } } },
          rooms: { orderBy: { createdAt: "asc" }, take: 1 },
          guests: { where: { isPrimary: true }, take: 1, select: { firstName: true, email: true } },
        },
      },
    },
  });
  if (!payment || payment.provider !== "STRIPE") throw new PaymentApiError(404, "PAYMENT_NOT_FOUND", "Paiement introuvable.");
  const booking = payment.booking;

  if (booking.status === BookingStatus.PENDING_PAYMENT) {
    const hold = booking.hold;
    const room = booking.rooms[0];
    if (!hold || hold.status !== "ACTIVE" || hold.expiresAt <= new Date() || !hold.allocation || hold.allocation.status !== "ACTIVE" || !room) {
      throw new PaymentApiError(409, "PAID_BOOKING_HOLD_EXPIRED", "Le paiement a été reçu après l'expiration de l'option. Une intervention est requise.");
    }
    await transaction.roomAllocation.update({ where: { id: hold.allocation.id }, data: { status: "RELEASED" } });
    await transaction.reservationHold.update({ where: { id: hold.id }, data: { status: "CONVERTED" } });
    await transaction.bookingRoom.update({ where: { id: room.id }, data: { roomId: hold.roomId, roomNumberSnapshot: hold.room.number } });
    await transaction.roomAllocation.create({
      data: { roomId: hold.roomId, bookingRoomId: room.id, source: "BOOKING", status: "ACTIVE", checkIn: booking.checkIn, checkOut: booking.checkOut },
    });
    await transaction.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date() } });
  } else if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) {
    throw new PaymentApiError(409, "BOOKING_NOT_CONFIRMABLE", "Le paiement concerne une réservation qui ne peut plus être confirmée automatiquement.");
  }

  const updated = await transaction.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.SUCCEEDED, providerReference: providerReference ?? payment.providerReference, paymentMethodType: method, processedAt: new Date(), failureReason: null },
  });
  const invoice = await issuePaidInvoice(transaction, booking.id);
  await transaction.auditLog.create({
    data: {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      action: "STRIPE_PAYMENT_SUCCEEDED",
      entityType: "Payment",
      entityId: payment.id,
      before: { paymentStatus: payment.status, bookingStatus: booking.status },
      after: { paymentStatus: updated.status, bookingStatus: BookingStatus.CONFIRMED },
      metadata: { invoiceNumber: invoice.number },
    },
  });
  const guest = booking.guests[0];
  if (guest?.email) {
    await enqueueBookingNotification(transaction, {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      recipient: guest.email,
      template: "BOOKING_CONFIRMED",
      idempotencyKey: `booking:${booking.id}:confirmed`,
      payload: { firstName: guest.firstName, reference: booking.reference, roomName: booking.rooms[0]?.roomTypeNameSnapshot, arrival: booking.checkIn.toISOString().slice(0, 10), departure: booking.checkOut.toISOString().slice(0, 10), total: Number(booking.total), currency: booking.currency },
    });
    await enqueueBookingNotification(transaction, {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      recipient: guest.email,
      template: "PAYMENT_SUCCEEDED",
      idempotencyKey: `payment:${payment.id}:succeeded`,
      payload: { firstName: guest.firstName, reference: booking.reference, total: Number(payment.amount), currency: payment.currency, invoiceNumber: invoice.number },
    });
  }
}

export function constructStripeEvent(rawBody: Buffer, signature: string) {
  if (!env.stripeWebhookSecret) throw new PaymentApiError(503, "STRIPE_WEBHOOK_DISABLED", "Le webhook Stripe n'est pas configuré.");
  try {
    return stripeClient().webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch {
    throw new PaymentApiError(400, "INVALID_STRIPE_SIGNATURE", "La signature Stripe est invalide.");
  }
}

export async function processStripeEvent(event: Stripe.Event, rawBody: Buffer) {
  const paymentId = paymentIdFromEvent(event);
  if (!paymentId) return { status: "ignored" as const };
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, propertyId: true } });
  if (!payment) return { status: "ignored" as const };
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const existing = await prisma.paymentProviderEvent.findUnique({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } } });
  if (existing?.status === "PROCESSED" || existing?.status === "IGNORED") return { status: "duplicate" as const };
  if (!existing) {
    await prisma.paymentProviderEvent.create({
      data: { propertyId: payment.propertyId, paymentId: payment.id, provider: "STRIPE", providerEventId: event.id, eventType: event.type, payloadHash, livemode: event.livemode },
    });
  }

  try {
    let handled = true;
    await prisma.$transaction(async (transaction) => {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          if (session.payment_status === "paid") {
            const reference = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
            await finalizePayment(transaction, paymentId, reference, session.payment_method_types?.[0] ?? "card");
          }
          break;
        }
        case "payment_intent.succeeded":
          await finalizePayment(transaction, paymentId, event.data.object.id, event.data.object.payment_method_types[0] ?? "card");
          break;
        case "payment_intent.payment_failed":
          await transaction.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.FAILED, providerReference: event.data.object.id, failureReason: event.data.object.last_payment_error?.message?.slice(0, 500) ?? "Payment failed" } });
          break;
        case "checkout.session.expired":
          await transaction.payment.updateMany({ where: { id: paymentId, status: { in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING] } }, data: { status: PaymentStatus.CANCELLED } });
          break;
        default:
          handled = false;
      }
      await transaction.paymentProviderEvent.update({
        where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } },
        data: { status: handled ? "PROCESSED" : "IGNORED", processedAt: new Date(), errorMessage: null },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { status: handled ? "processed" as const : "ignored" as const };
  } catch (error) {
    await prisma.paymentProviderEvent.update({
      where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } },
      data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Webhook processing error" },
    });
    throw error;
  }
}
