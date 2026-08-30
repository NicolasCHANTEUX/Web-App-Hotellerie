import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { bookingAccessToken, bookingAccessTokenHash } from "../modules/booking/booking.access.js";

const app = await buildApp();
const suffix = randomUUID().replaceAll("-", "");
const checkoutSessionId = `cs_test_${suffix}`;
let paymentId: string | null = null;
let bookingToRestore: { id: string; publicAccessTokenHash: string | null; publicAccessTokenExpiresAt: Date | null } | null = null;

try {
  const booking = await prisma.booking.findFirst({ select: { id: true, propertyId: true, reference: true, total: true, currency: true, publicAccessTokenHash: true, publicAccessTokenExpiresAt: true } });
  assert.ok(booking, "Une réservation est nécessaire pour tester le statut Stripe.");
  bookingToRestore = {
    id: booking.id,
    publicAccessTokenHash: booking.publicAccessTokenHash,
    publicAccessTokenExpiresAt: booking.publicAccessTokenExpiresAt,
  };
  const accessToken = bookingAccessToken(booking.id);
  await prisma.booking.update({
    where: { id: booking.id },
    data: { publicAccessTokenHash: bookingAccessTokenHash(accessToken), publicAccessTokenExpiresAt: new Date(Date.now() + 60_000) },
  });
  const payment = await prisma.payment.create({
    data: {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      provider: "STRIPE",
      providerReference: checkoutSessionId,
      checkoutSessionId,
      idempotencyKey: `smoke-stripe-status:${suffix}`,
      kind: "CHARGE",
      status: "PROCESSING",
      amount: booking.total,
      currency: booking.currency,
      paymentMethodType: "card",
    },
  });
  paymentId = payment.id;

  const unauthorizedResponse = await app.inject({
    method: "GET",
    url: `/payments/stripe/status?sessionId=${encodeURIComponent(checkoutSessionId)}`,
  });
  assert.equal(unauthorizedResponse.statusCode, 404, unauthorizedResponse.body);

  const response = await app.inject({
    method: "GET",
    url: `/payments/stripe/status?sessionId=${encodeURIComponent(checkoutSessionId)}`,
    headers: { "x-booking-access-token": accessToken },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { data?: { paymentStatus?: string; booking?: { reference?: string } } };
  assert.equal(body.data?.paymentStatus, "PROCESSING");
  assert.equal(body.data?.booking?.reference, booking.reference);
  console.log("Stripe status smoke test passed: checkout session resolves to server booking state.");
} finally {
  if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
  if (bookingToRestore) {
    await prisma.booking.update({
      where: { id: bookingToRestore.id },
      data: {
        publicAccessTokenHash: bookingToRestore.publicAccessTokenHash,
        publicAccessTokenExpiresAt: bookingToRestore.publicAccessTokenExpiresAt,
      },
    });
  }
  await app.close();
}
