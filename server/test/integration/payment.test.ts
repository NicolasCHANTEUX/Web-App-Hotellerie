import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { processStripeEvent } from "../../src/modules/payments/payment.service.js";
import {
  bookingRequest,
  checkoutCompleted,
  createStripePayment,
  createTestHotel,
  deliverStripeEvent,
  expireHold,
} from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

async function bookingState(bookingId: string) {
  return prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      hold: true,
      rooms: { include: { allocation: true } },
      payments: true,
      invoices: true,
      notifications: { select: { template: true, recipient: true } },
      auditLogs: { select: { action: true, metadata: true } },
    },
  });
}

function templates(state: Awaited<ReturnType<typeof bookingState>>) {
  return state.notifications.map((item) => item.template);
}

test("confirme la réservation et émet la facture quand le paiement arrive pendant l'option", async () => {
  const hotel = await createTestHotel();
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());
  const payment = await createStripePayment(booking.id);

  const { result } = await checkoutCompleted(payment.id);

  assert.equal(result.status, "processed");
  const state = await bookingState(booking.id);
  assert.equal(state.status, "CONFIRMED");
  assert.equal(state.hold?.status, "CONVERTED");
  assert.equal(state.rooms[0]?.allocation?.source, "BOOKING");
  assert.equal(state.rooms[0]?.allocation?.status, "ACTIVE");
  assert.equal(state.payments[0]?.status, "SUCCEEDED");
  assert.equal(state.invoices.length, 1);
  assert.ok(templates(state).includes("BOOKING_CONFIRMED"));
  assert.ok(templates(state).includes("PAYMENT_SUCCEEDED"));
});

test("confirme quand même un paiement traité après l'option si une chambre est libre", async () => {
  const hotel = await createTestHotel({ rooms: 1 });
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());
  const payment = await createStripePayment(booking.id);
  await expireHold(booking.id);

  await checkoutCompleted(payment.id);

  const state = await bookingState(booking.id);
  assert.equal(state.status, "CONFIRMED");
  assert.equal(state.rooms[0]?.roomId, hotel.rooms[0]!.id);
  assert.equal(state.rooms[0]?.allocation?.status, "ACTIVE");
  assert.equal(state.invoices.length, 1);
  const audit = state.auditLogs.find((item) => item.action === "STRIPE_PAYMENT_SUCCEEDED");
  assert.equal((audit?.metadata as Record<string, unknown> | undefined)?.confirmedAfterHoldExpiry, true);
});

test("enregistre le paiement et alerte l'hôtel quand la chambre a été reprise entre-temps", async () => {
  const hotel = await createTestHotel({ rooms: 1 });
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());
  const payment = await createStripePayment(booking.id);
  await expireHold(booking.id);
  await createBooking(await bookingRequest(hotel), randomUUID());

  const { event, result } = await checkoutCompleted(payment.id);

  assert.equal(result.status, "processed");
  const state = await bookingState(booking.id);
  assert.equal(state.status, "EXPIRED");
  assert.equal(state.payments[0]?.status, "SUCCEEDED");
  assert.equal(state.invoices.length, 0);
  assert.ok(state.auditLogs.some((item) => item.action === "STRIPE_PAYMENT_REQUIRES_ATTENTION"));
  assert.ok(state.notifications.some((item) => item.template === "PAYMENT_REQUIRES_ATTENTION" && item.recipient === hotel.property.email));
  assert.ok(!templates(state).includes("BOOKING_CONFIRMED"));
  const providerEvent = await prisma.paymentProviderEvent.findFirstOrThrow({ where: { providerEventId: event.id } });
  assert.equal(providerEvent.status, "PROCESSED");
});

test("ne confirme jamais une réservation annulée avant la réception du paiement", async () => {
  const hotel = await createTestHotel();
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());
  const payment = await createStripePayment(booking.id);
  await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });

  await checkoutCompleted(payment.id);

  const state = await bookingState(booking.id);
  assert.equal(state.status, "CANCELLED");
  assert.equal(state.payments[0]?.status, "SUCCEEDED");
  assert.ok(templates(state).includes("PAYMENT_REQUIRES_ATTENTION"));
});

test("ne facture qu'une fois malgré un événement rejoué ou un second événement de succès", async () => {
  const hotel = await createTestHotel();
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());
  const payment = await createStripePayment(booking.id);
  const { event } = await checkoutCompleted(payment.id);

  assert.equal((await processStripeEvent(event, Buffer.from("{}"))).status, "duplicate");
  const second = await deliverStripeEvent("payment_intent.succeeded", {
    id: `pi_${randomUUID().replaceAll("-", "")}`,
    metadata: { paymentId: payment.id },
    payment_method_types: ["card"],
  });
  assert.equal(second.result.status, "processed");

  const state = await bookingState(booking.id);
  assert.equal(state.invoices.length, 1);
  assert.equal(state.notifications.filter((item) => item.template === "PAYMENT_SUCCEEDED").length, 1);
});

test("garde l'option ouverte après un paiement refusé", async () => {
  const hotel = await createTestHotel();
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());
  const payment = await createStripePayment(booking.id);

  await deliverStripeEvent("payment_intent.payment_failed", {
    id: `pi_${randomUUID().replaceAll("-", "")}`,
    metadata: { paymentId: payment.id },
    last_payment_error: { message: "Carte refusée" },
  });

  const state = await bookingState(booking.id);
  assert.equal(state.status, "PENDING_PAYMENT");
  assert.equal(state.hold?.status, "ACTIVE");
  assert.equal(state.payments[0]?.status, "FAILED");
  assert.equal(state.payments[0]?.failureReason, "Carte refusée");
});
