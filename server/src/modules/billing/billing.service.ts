import { PaymentKind, PaymentProvider, PaymentStatus, Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "../admin/admin.auth.js";
import { AdminApiError } from "../admin/admin.errors.js";
import { enqueueBookingNotification } from "../notifications/notification.service.js";
import { issueCreditNote, issuePaidInvoice } from "./invoice.service.js";
import type { ManualPaymentInput, RefundInput } from "./billing.validation.js";
import Stripe from "stripe";

type BillingResult = { paymentId: string; invoiceId: string; invoiceNumber: string };

function decimalSum(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
}

function successful(status: PaymentStatus) {
  return status === PaymentStatus.SUCCEEDED || status === PaymentStatus.PARTIALLY_REFUNDED || status === PaymentStatus.REFUNDED;
}

function primaryGuest(booking: { guests: Array<{ firstName: string; email: string | null }> }) {
  return booking.guests[0];
}

function stripe() {
  if (!env.stripeSecretKey) throw new AdminApiError(503, "STRIPE_DISABLED", "Le paiement Stripe n'est pas configuré.");
  return new Stripe(env.stripeSecretKey);
}

type RefundLookupClient = Pick<Prisma.TransactionClient, "payment" | "invoice">;

async function existingRefundResult(
  client: RefundLookupClient,
  membership: AdminMembershipContext,
  bookingId: string,
  idempotencyKey: string,
  input: RefundInput,
): Promise<BillingResult | null> {
  const existing = await client.payment.findUnique({ where: { idempotencyKey } });
  if (!existing) return null;
  if (
    existing.propertyId !== membership.propertyId
    || existing.bookingId !== bookingId
    || existing.kind !== PaymentKind.REFUND
    || existing.parentPaymentId !== input.paymentId
    || (input.amount !== undefined && !existing.amount.equals(input.amount))
  ) {
    throw new AdminApiError(409, "IDEMPOTENCY_KEY_REUSED", "Cette clé de remboursement a déjà été utilisée pour une autre opération.");
  }
  const credit = await client.invoice.findFirst({
    where: { bookingId, documentType: "CREDIT_NOTE", creditReason: { contains: `[remboursement ${existing.id}]` } },
  });
  if (!credit) throw new AdminApiError(409, "REFUND_CREDIT_NOTE_PENDING", "Le remboursement existe mais son avoir doit être régularisé.");
  if (credit.creditReason !== `${input.reason} [remboursement ${existing.id}]`) {
    throw new AdminApiError(409, "IDEMPOTENCY_KEY_REUSED", "Cette clé de remboursement a déjà été utilisée avec un autre motif.");
  }
  return { paymentId: existing.id, invoiceId: credit.id, invoiceNumber: credit.number };
}

export async function recordManualPayment(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  idempotencyKey: string,
  input: ManualPaymentInput,
  ipAddress?: string,
): Promise<BillingResult> {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      const invoice = await transaction.invoice.findFirst({ where: { bookingId: existing.bookingId, documentType: "INVOICE" } });
      if (!invoice) throw new AdminApiError(409, "PAYMENT_INVOICE_PENDING", "Le paiement existe mais sa facture doit être régularisée.");
      return { paymentId: existing.id, invoiceId: invoice.id, invoiceNumber: invoice.number };
    }

    const booking = await transaction.booking.findFirst({
      where: { id: bookingId, propertyId: membership.propertyId },
      include: {
        guests: { where: { isPrimary: true }, take: 1, select: { firstName: true, email: true } },
        payments: { select: { kind: true, status: true, amount: true } },
      },
    });
    if (!booking) throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
    if (!["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(booking.status)) {
      throw new AdminApiError(409, "BOOKING_NOT_PAYABLE", "Confirmez la réservation avant d'enregistrer son règlement.");
    }

    const charges = decimalSum(booking.payments.filter((payment) => payment.kind === PaymentKind.CHARGE && successful(payment.status)).map((payment) => payment.amount));
    const refunds = decimalSum(booking.payments.filter((payment) => payment.kind === PaymentKind.REFUND && payment.status === PaymentStatus.SUCCEEDED).map((payment) => payment.amount));
    const outstanding = booking.total.minus(charges.minus(refunds)).toDecimalPlaces(2);
    if (outstanding.lte(0)) throw new AdminApiError(409, "BOOKING_ALREADY_PAID", "Cette réservation est déjà intégralement réglée.");

    const payment = await transaction.payment.create({
      data: {
        propertyId: booking.propertyId,
        bookingId: booking.id,
        provider: PaymentProvider.MANUAL,
        idempotencyKey,
        kind: PaymentKind.CHARGE,
        status: PaymentStatus.SUCCEEDED,
        amount: outstanding,
        currency: booking.currency,
        paymentMethodType: input.paymentMethodType,
        processedAt: new Date(),
      },
    });
    const invoice = await issuePaidInvoice(transaction, booking.id);
    await transaction.auditLog.create({
      data: {
        propertyId: booking.propertyId,
        adminUserId,
        bookingId: booking.id,
        action: "MANUAL_PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        after: { status: payment.status, amount: payment.amount.toString(), currency: payment.currency, method: input.paymentMethodType },
        metadata: { note: input.note, invoiceNumber: invoice.number },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    const guest = primaryGuest(booking);
    if (guest?.email) {
      await enqueueBookingNotification(transaction, {
        propertyId: booking.propertyId,
        bookingId: booking.id,
        recipient: guest.email,
        template: "PAYMENT_SUCCEEDED",
        idempotencyKey: `payment:${payment.id}:succeeded`,
        payload: { firstName: guest.firstName, reference: booking.reference, total: Number(payment.amount), currency: booking.currency, invoiceNumber: invoice.number },
      });
    }
    return { paymentId: payment.id, invoiceId: invoice.id, invoiceNumber: invoice.number };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function refundPayment(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  idempotencyKey: string,
  input: RefundInput,
  ipAddress?: string,
): Promise<BillingResult> {
  const completedAttempt = await existingRefundResult(prisma, membership, bookingId, idempotencyKey, input);
  if (completedAttempt) return completedAttempt;

  const charge = await prisma.payment.findFirst({
    where: {
      id: input.paymentId,
      bookingId,
      propertyId: membership.propertyId,
      kind: PaymentKind.CHARGE,
      status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] },
    },
    include: { refunds: { where: { status: PaymentStatus.SUCCEEDED }, select: { amount: true } } },
  });
  if (!charge) throw new AdminApiError(404, "PAYMENT_NOT_REFUNDABLE", "Ce paiement est introuvable ou ne peut plus être remboursé.");
  const alreadyRefunded = decimalSum(charge.refunds.map((refund) => refund.amount));
  const refundable = charge.amount.minus(alreadyRefunded).toDecimalPlaces(2);
  const amount = new Prisma.Decimal(input.amount ?? refundable);
  if (amount.lte(0) || amount.gt(refundable)) throw new AdminApiError(409, "INVALID_REFUND_AMOUNT", `Le montant remboursable maximal est de ${refundable.toFixed(2)} ${charge.currency}.`);

  let providerReference: string | undefined;
  if (charge.provider === PaymentProvider.STRIPE) {
    if (!charge.providerReference?.startsWith("pi_")) throw new AdminApiError(409, "STRIPE_PAYMENT_REFERENCE_MISSING", "La référence Stripe du paiement est absente.");
    const stripeRefund = await stripe().refunds.create({
      payment_intent: charge.providerReference,
      amount: amount.mul(100).toDecimalPlaces(0).toNumber(),
      reason: "requested_by_customer",
      metadata: { bookingId, paymentId: charge.id, reason: input.reason.slice(0, 450) },
    }, { idempotencyKey });
    providerReference = stripeRefund.id;
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const concurrentAttempt = await existingRefundResult(transaction, membership, bookingId, idempotencyKey, input);
      if (concurrentAttempt) return concurrentAttempt;
    const current = await transaction.payment.findUnique({
      where: { id: charge.id },
      include: { refunds: { where: { status: PaymentStatus.SUCCEEDED }, select: { amount: true } }, booking: { include: { guests: { where: { isPrimary: true }, take: 1, select: { firstName: true, email: true } } } } },
    });
    if (!current || !successful(current.status)) throw new AdminApiError(409, "PAYMENT_CHANGED", "Le paiement a changé. Rechargez avant de réessayer.");
    const refundedNow = decimalSum(current.refunds.map((refund) => refund.amount));
    if (amount.gt(current.amount.minus(refundedNow))) throw new AdminApiError(409, "PAYMENT_CHANGED", "Le montant remboursable a changé.");

    const refund = await transaction.payment.create({
      data: {
        propertyId: current.propertyId,
        bookingId: current.bookingId,
        parentPaymentId: current.id,
        provider: current.provider,
        providerReference,
        idempotencyKey,
        kind: PaymentKind.REFUND,
        status: PaymentStatus.SUCCEEDED,
        amount,
        currency: current.currency,
        paymentMethodType: current.paymentMethodType,
        processedAt: new Date(),
      },
    });
    const fullyRefunded = refundedNow.add(amount).gte(current.amount);
    await transaction.payment.update({ where: { id: current.id }, data: { status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED } });
    const originalInvoice = await issuePaidInvoice(transaction, current.bookingId);
    const creditReason = `${input.reason} [remboursement ${refund.id}]`;
    const credit = await issueCreditNote(transaction, originalInvoice.id, amount, creditReason);
    await transaction.auditLog.create({
      data: {
        propertyId: current.propertyId,
        adminUserId,
        bookingId: current.bookingId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: refund.id,
        before: { parentStatus: current.status },
        after: { parentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED, amount: amount.toString() },
        metadata: { reason: input.reason, creditNoteNumber: credit.number, provider: current.provider },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    const guest = primaryGuest(current.booking);
    if (guest?.email) {
      await enqueueBookingNotification(transaction, {
        propertyId: current.propertyId,
        bookingId: current.bookingId,
        recipient: guest.email,
        template: "PAYMENT_REFUNDED",
        idempotencyKey: `payment:${refund.id}:refunded`,
        payload: { firstName: guest.firstName, reference: current.booking.reference, total: Number(amount), currency: current.currency, reason: input.reason, invoiceNumber: credit.number },
      });
    }
      return { paymentId: refund.id, invoiceId: credit.id, invoiceNumber: credit.number };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const recovered = await existingRefundResult(prisma, membership, bookingId, idempotencyKey, input);
      if (recovered) return recovered;
    }
    throw error;
  }
}
