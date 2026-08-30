import { PaymentKind, PaymentProvider, PaymentStatus, Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "../admin/admin.auth.js";
import { AdminApiError } from "../admin/admin.errors.js";
import { enqueueBookingNotification } from "../notifications/notification.service.js";
import { issueCreditNote, issuePaidInvoice } from "./invoice.service.js";
import type { ManualPaymentInput, RefundInput } from "./billing.validation.js";
import Stripe from "stripe";

type BillingResult = {
  paymentId: string;
  status: PaymentStatus;
  invoiceId?: string;
  invoiceNumber?: string;
};

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
    || existing.refundReason !== input.reason
  ) {
    throw new AdminApiError(409, "IDEMPOTENCY_KEY_REUSED", "Cette clé de remboursement a déjà été utilisée pour une autre opération.");
  }
  if (existing.status !== PaymentStatus.SUCCEEDED) {
    return { paymentId: existing.id, status: existing.status };
  }
  const credit = await client.invoice.findFirst({
    where: { bookingId, documentType: "CREDIT_NOTE", creditReason: { contains: `[remboursement ${existing.id}]` } },
  });
  if (!credit) throw new AdminApiError(409, "REFUND_CREDIT_NOTE_PENDING", "Le remboursement existe mais son avoir doit être régularisé.");
  return { paymentId: existing.id, status: existing.status, invoiceId: credit.id, invoiceNumber: credit.number };
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
      if (
        existing.propertyId !== membership.propertyId
        || existing.bookingId !== bookingId
        || existing.provider !== PaymentProvider.MANUAL
        || existing.kind !== PaymentKind.CHARGE
        || existing.paymentMethodType !== input.paymentMethodType
      ) {
        throw new AdminApiError(409, "IDEMPOTENCY_KEY_REUSED", "Cette clé de paiement a déjà été utilisée pour une autre opération.");
      }
      const invoice = await transaction.invoice.findFirst({ where: { bookingId: existing.bookingId, documentType: "INVOICE" } });
      if (!invoice) throw new AdminApiError(409, "PAYMENT_INVOICE_PENDING", "Le paiement existe mais sa facture doit être régularisée.");
      return { paymentId: existing.id, status: existing.status, invoiceId: invoice.id, invoiceNumber: invoice.number };
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
    return { paymentId: payment.id, status: payment.status, invoiceId: invoice.id, invoiceNumber: invoice.number };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function finalizeRefundPayment(
  transaction: Prisma.TransactionClient,
  refundId: string,
  providerReference?: string,
): Promise<BillingResult> {
  const refund = await transaction.payment.findUnique({
    where: { id: refundId },
    include: {
      parentPayment: { include: { refunds: { where: { status: PaymentStatus.SUCCEEDED }, select: { amount: true } } } },
      booking: { include: { guests: { where: { isPrimary: true }, take: 1, select: { firstName: true, email: true } } } },
    },
  });
  if (!refund || refund.kind !== PaymentKind.REFUND || !refund.parentPayment) {
    throw new AdminApiError(404, "REFUND_NOT_FOUND", "Le remboursement est introuvable.");
  }

  if (refund.status === PaymentStatus.SUCCEEDED) {
    const credit = await transaction.invoice.findFirst({
      where: { bookingId: refund.bookingId, documentType: "CREDIT_NOTE", creditReason: { contains: `[remboursement ${refund.id}]` } },
    });
    if (!credit) throw new AdminApiError(409, "REFUND_CREDIT_NOTE_PENDING", "Le remboursement existe mais son avoir doit être régularisé.");
    return { paymentId: refund.id, status: refund.status, invoiceId: credit.id, invoiceNumber: credit.number };
  }
  if (refund.status !== PaymentStatus.PROCESSING && refund.status !== PaymentStatus.REQUIRES_PAYMENT) {
    return { paymentId: refund.id, status: refund.status };
  }

  const parent = refund.parentPayment;
  const refundedBefore = decimalSum(parent.refunds.map((item) => item.amount));
  if (refund.amount.gt(parent.amount.minus(refundedBefore))) {
    throw new AdminApiError(409, "PAYMENT_CHANGED", "Le montant remboursable a changé.");
  }
  const parentStatus = refundedBefore.add(refund.amount).gte(parent.amount)
    ? PaymentStatus.REFUNDED
    : PaymentStatus.PARTIALLY_REFUNDED;
  const updatedRefund = await transaction.payment.update({
    where: { id: refund.id },
    data: {
      status: PaymentStatus.SUCCEEDED,
      providerReference: providerReference ?? refund.providerReference,
      processedAt: new Date(),
      failureReason: null,
    },
  });
  await transaction.payment.update({ where: { id: parent.id }, data: { status: parentStatus } });
  const originalInvoice = await issuePaidInvoice(transaction, refund.bookingId);
  const reason = refund.refundReason ?? "Remboursement client";
  const credit = await issueCreditNote(transaction, originalInvoice.id, refund.amount, `${reason} [remboursement ${refund.id}]`);
  await transaction.auditLog.create({
    data: {
      propertyId: refund.propertyId,
      bookingId: refund.bookingId,
      action: "PAYMENT_REFUNDED",
      entityType: "Payment",
      entityId: refund.id,
      before: { refundStatus: refund.status, parentStatus: parent.status },
      after: { refundStatus: updatedRefund.status, parentStatus, amount: refund.amount.toString() },
      metadata: { reason, creditNoteNumber: credit.number, provider: refund.provider },
    },
  });
  const guest = primaryGuest(refund.booking);
  if (guest?.email) {
    await enqueueBookingNotification(transaction, {
      propertyId: refund.propertyId,
      bookingId: refund.bookingId,
      recipient: guest.email,
      template: "PAYMENT_REFUNDED",
      idempotencyKey: `payment:${refund.id}:refunded`,
      payload: { firstName: guest.firstName, reference: refund.booking.reference, total: Number(refund.amount), currency: refund.currency, reason, invoiceNumber: credit.number },
    });
  }
  return { paymentId: refund.id, status: updatedRefund.status, invoiceId: credit.id, invoiceNumber: credit.number };
}

export async function failRefundPayment(
  transaction: Prisma.TransactionClient,
  refundId: string,
  failureReason: string,
  cancelled = false,
) {
  await transaction.payment.updateMany({
    where: { id: refundId, kind: PaymentKind.REFUND, status: { in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING] } },
    data: { status: cancelled ? PaymentStatus.CANCELLED : PaymentStatus.FAILED, failureReason: failureReason.slice(0, 500), processedAt: new Date() },
  });
}

async function submitStripeRefund(refundId: string, idempotencyKey: string): Promise<BillingResult> {
  const refund = await prisma.payment.findUnique({ where: { id: refundId }, include: { parentPayment: true } });
  if (!refund || refund.kind !== PaymentKind.REFUND || !refund.parentPayment) {
    throw new AdminApiError(404, "REFUND_NOT_FOUND", "Le remboursement est introuvable.");
  }
  if (refund.status !== PaymentStatus.PROCESSING) return { paymentId: refund.id, status: refund.status };
  if (refund.providerReference) return { paymentId: refund.id, status: refund.status };
  if (!refund.parentPayment.providerReference?.startsWith("pi_")) {
    throw new AdminApiError(409, "STRIPE_PAYMENT_REFERENCE_MISSING", "La référence Stripe du paiement est absente.");
  }

  try {
    const stripeRefund = await stripe().refunds.create({
      payment_intent: refund.parentPayment.providerReference,
      amount: refund.amount.mul(100).toDecimalPlaces(0).toNumber(),
      reason: "requested_by_customer",
      metadata: {
        bookingId: refund.bookingId,
        parentPaymentId: refund.parentPayment.id,
        refundPaymentId: refund.id,
      },
    }, { idempotencyKey });

    if (stripeRefund.status === "succeeded") {
      return prisma.$transaction(
        (transaction) => finalizeRefundPayment(transaction, refund.id, stripeRefund.id),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }
    if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
      await prisma.$transaction((transaction) => failRefundPayment(
        transaction,
        refund.id,
        stripeRefund.failure_reason ?? `Stripe refund ${stripeRefund.status}`,
        stripeRefund.status === "canceled",
      ));
      throw new AdminApiError(502, "REFUND_PROVIDER_FAILED", "Stripe n'a pas pu exécuter le remboursement.");
    }
    await prisma.payment.update({
      where: { id: refund.id },
      data: { providerReference: stripeRefund.id, failureReason: null },
    });
    return { paymentId: refund.id, status: PaymentStatus.PROCESSING };
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    await prisma.payment.updateMany({
      where: { id: refund.id, status: PaymentStatus.PROCESSING },
      data: { failureReason: error instanceof Error ? error.message.slice(0, 500) : "Stripe refund error" },
    });
    throw new AdminApiError(502, "REFUND_PROVIDER_UNAVAILABLE", "Stripe ne répond pas. Vous pouvez relancer la même demande sans risque de doublon.");
  }
}

export async function refundPayment(
  membership: AdminMembershipContext,
  adminUserId: string,
  bookingId: string,
  idempotencyKey: string,
  input: RefundInput,
  ipAddress?: string,
): Promise<BillingResult> {
  const existing = await existingRefundResult(prisma, membership, bookingId, idempotencyKey, input);
  if (existing) {
    if (existing.status === PaymentStatus.PROCESSING) return submitStripeRefund(existing.paymentId, idempotencyKey);
    return existing;
  }

  let refund: { id: string; provider: PaymentProvider };
  try {
    refund = await prisma.$transaction(async (transaction) => {
      const concurrentAttempt = await existingRefundResult(transaction, membership, bookingId, idempotencyKey, input);
      if (concurrentAttempt) {
        const payment = await transaction.payment.findUniqueOrThrow({ where: { id: concurrentAttempt.paymentId }, select: { id: true, provider: true } });
        return payment;
      }
      const charge = await transaction.payment.findFirst({
        where: {
          id: input.paymentId,
          bookingId,
          propertyId: membership.propertyId,
          kind: PaymentKind.CHARGE,
          status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        include: { refunds: { where: { status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING] } }, select: { amount: true } } },
      });
      if (!charge) throw new AdminApiError(404, "PAYMENT_NOT_REFUNDABLE", "Ce paiement est introuvable ou ne peut plus être remboursé.");
      const reserved = decimalSum(charge.refunds.map((item) => item.amount));
      const refundable = charge.amount.minus(reserved).toDecimalPlaces(2);
      const amount = new Prisma.Decimal(input.amount ?? refundable);
      if (amount.lte(0) || amount.gt(refundable)) {
        throw new AdminApiError(409, "INVALID_REFUND_AMOUNT", `Le montant remboursable maximal est de ${refundable.toFixed(2)} ${charge.currency}.`);
      }
      const createdRefund = await transaction.payment.create({
        data: {
          propertyId: charge.propertyId,
          bookingId: charge.bookingId,
          parentPaymentId: charge.id,
          provider: charge.provider,
          idempotencyKey,
          kind: PaymentKind.REFUND,
          status: PaymentStatus.PROCESSING,
          amount,
          currency: charge.currency,
          paymentMethodType: charge.paymentMethodType,
          refundReason: input.reason,
          failureReason: null,
        },
        select: { id: true, provider: true },
      });
      await transaction.auditLog.create({
        data: {
          propertyId: charge.propertyId,
          adminUserId,
          bookingId: charge.bookingId,
          action: "PAYMENT_REFUND_REQUESTED",
          entityType: "Payment",
          entityId: createdRefund.id,
          after: { status: PaymentStatus.PROCESSING, amount: amount.toString(), currency: charge.currency },
          metadata: { reason: input.reason, provider: charge.provider },
          ...(ipAddress ? { ipAddress } : {}),
        },
      });
      return createdRefund;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const recovered = await existingRefundResult(prisma, membership, bookingId, idempotencyKey, input);
      if (recovered) return recovered.status === PaymentStatus.PROCESSING
        ? submitStripeRefund(recovered.paymentId, idempotencyKey)
        : recovered;
    }
    throw error;
  }

  if (refund.provider === PaymentProvider.STRIPE) return submitStripeRefund(refund.id, idempotencyKey);
  return prisma.$transaction(
    (transaction) => finalizeRefundPayment(transaction, refund.id),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
