import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import { confirmAdminBooking } from "../../src/modules/admin/admin.service.js";
import { recordManualPayment, refundPayment } from "../../src/modules/billing/billing.service.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { bookingRequest, createReceptionist, createTestHotel, type TestHotel } from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

const year = new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date());

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

async function confirmedBooking(hotel: TestHotel, reception: Awaited<ReturnType<typeof createReceptionist>>, arrivalInDays = 30) {
  const booking = await createBooking(await bookingRequest(hotel, { arrivalInDays }), randomUUID());
  await confirmAdminBooking(reception.membership, reception.adminUserId, booking.id);
  return booking;
}

test("confirme une demande depuis la réception en transformant l'option en séjour", async () => {
  const hotel = await createTestHotel();
  const reception = await createReceptionist(hotel);
  const booking = await createBooking(await bookingRequest(hotel), randomUUID());

  await confirmAdminBooking(reception.membership, reception.adminUserId, booking.id);

  const state = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: { hold: { include: { allocation: true } }, rooms: { include: { allocation: true } }, auditLogs: true },
  });
  assert.equal(state.status, "CONFIRMED");
  assert.equal(state.hold?.status, "CONVERTED");
  assert.equal(state.hold?.allocation?.status, "RELEASED");
  assert.equal(state.rooms[0]?.allocation?.source, "BOOKING");
  assert.equal(state.rooms[0]?.allocation?.status, "ACTIVE");
  assert.ok(state.auditLogs.some((item) => item.adminUserId === reception.adminUserId));
});

test("n'encaisse un règlement manuel qu'une fois la réservation confirmée, et une seule fois", async () => {
  const hotel = await createTestHotel();
  const reception = await createReceptionist(hotel);
  const pending = await createBooking(await bookingRequest(hotel, { arrivalInDays: 20 }), randomUUID());
  await assert.rejects(
    () => recordManualPayment(reception.membership, reception.adminUserId, pending.id, `manual:${randomUUID()}`, { paymentMethodType: "Espèces" }),
    adminError("BOOKING_NOT_PAYABLE"),
  );

  const booking = await confirmedBooking(hotel, reception);
  const key = `manual:${randomUUID()}`;
  const paid = await recordManualPayment(reception.membership, reception.adminUserId, booking.id, key, { paymentMethodType: "Carte bancaire" });
  const replayed = await recordManualPayment(reception.membership, reception.adminUserId, booking.id, key, { paymentMethodType: "Carte bancaire" });

  assert.equal(paid.status, "SUCCEEDED");
  assert.equal(paid.invoiceNumber, `FAC-${year}-000001`);
  assert.deepEqual(replayed, paid);
  await assert.rejects(
    () => recordManualPayment(reception.membership, reception.adminUserId, booking.id, `manual:${randomUUID()}`, { paymentMethodType: "Espèces" }),
    adminError("BOOKING_ALREADY_PAID"),
  );
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { bookingId: booking.id } });
  assert.equal(Number(invoice.total), booking.total);
});

test("numérote les factures sans trou par établissement", async () => {
  const hotel = await createTestHotel({ rooms: 2 });
  const reception = await createReceptionist(hotel);
  const numbers = [];
  for (const arrivalInDays of [30, 60]) {
    const booking = await confirmedBooking(hotel, reception, arrivalInDays);
    numbers.push((await recordManualPayment(reception.membership, reception.adminUserId, booking.id, `manual:${randomUUID()}`, { paymentMethodType: "Virement" })).invoiceNumber);
  }
  assert.deepEqual(numbers, [`FAC-${year}-000001`, `FAC-${year}-000002`]);
});

test("rembourse partiellement avec un avoir, sans dépasser le montant encaissé", async () => {
  const hotel = await createTestHotel();
  const reception = await createReceptionist(hotel);
  const booking = await confirmedBooking(hotel, reception);
  const charge = await recordManualPayment(reception.membership, reception.adminUserId, booking.id, `manual:${randomUUID()}`, { paymentMethodType: "Espèces" });

  const refund = await refundPayment(reception.membership, reception.adminUserId, booking.id, `refund:${randomUUID()}`, {
    paymentId: charge.paymentId,
    amount: 50,
    reason: "Geste commercial",
  });

  assert.equal(refund.status, "SUCCEEDED");
  assert.equal(refund.invoiceNumber, `AV-${year}-000001`);
  const parent = await prisma.payment.findUniqueOrThrow({ where: { id: charge.paymentId } });
  assert.equal(parent.status, "PARTIALLY_REFUNDED");
  const creditNote = await prisma.invoice.findFirstOrThrow({ where: { bookingId: booking.id, documentType: "CREDIT_NOTE" } });
  assert.equal(Number(creditNote.total), 50);
  assert.equal(creditNote.originalInvoiceId, (await prisma.invoice.findFirstOrThrow({ where: { bookingId: booking.id, documentType: "INVOICE" } })).id);

  await assert.rejects(
    () => refundPayment(reception.membership, reception.adminUserId, booking.id, `refund:${randomUUID()}`, {
      paymentId: charge.paymentId,
      amount: booking.total,
      reason: "Remboursement intégral",
    }),
    adminError("INVALID_REFUND_AMOUNT"),
  );
});
