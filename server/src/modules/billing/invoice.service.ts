import PDFDocument from "pdfkit";
import { InvoiceDocumentType, InvoiceStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AdminApiError } from "../admin/admin.errors.js";
import { retentionDeadlineFrom } from "../privacy/retention.service.js";

type BillingTransaction = Prisma.TransactionClient;

export type InvoiceLineDraft = {
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  sortOrder: number;
  originalInvoiceLineId?: string;
};

const cents = (value: Prisma.Decimal | string | number) => new Prisma.Decimal(value).toDecimalPlaces(2);

export function invoiceNumber(prefix: string, year: number, sequence: number) {
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}

function calendarYear(date: Date, timezone: string) {
  return Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: timezone }).format(date));
}

function nights(checkIn: Date, checkOut: Date) {
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}

export function buildInvoiceLines(booking: {
  checkIn: Date;
  checkOut: Date;
  rooms: Array<{
    roomTypeNameSnapshot: string;
    roomNumberSnapshot: string | null;
    taxRateSnapshot: Prisma.Decimal;
    taxAmountSnapshot: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }>;
  extras: Array<{
    nameSnapshot: string;
    quantity: number;
    taxRateSnapshot: Prisma.Decimal | null;
    taxAmountSnapshot: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }>;
  taxLines: Array<{
    kind: string;
    labelSnapshot: string;
    quantitySnapshot: Prisma.Decimal;
    amount: Prisma.Decimal;
  }>;
}) {
  const result: InvoiceLineDraft[] = [];
  const stayNights = nights(booking.checkIn, booking.checkOut);

  booking.rooms.forEach((room, index) => {
    const subtotal = cents(room.lineTotal.minus(room.taxAmountSnapshot));
    result.push({
      description: `${room.roomTypeNameSnapshot}${room.roomNumberSnapshot ? ` - chambre ${room.roomNumberSnapshot}` : ""} (${stayNights} nuit${stayNights > 1 ? "s" : ""})`,
      quantity: new Prisma.Decimal(stayNights),
      unitPrice: cents(subtotal.div(stayNights)),
      taxRate: room.taxRateSnapshot,
      subtotal,
      taxAmount: room.taxAmountSnapshot,
      lineTotal: room.lineTotal,
      sortOrder: index,
    });
  });

  booking.extras.forEach((extra, index) => {
    const subtotal = cents(extra.lineTotal.minus(extra.taxAmountSnapshot));
    result.push({
      description: extra.nameSnapshot,
      quantity: new Prisma.Decimal(extra.quantity),
      unitPrice: cents(subtotal.div(Math.max(1, extra.quantity))),
      taxRate: extra.taxRateSnapshot ?? new Prisma.Decimal(0),
      subtotal,
      taxAmount: extra.taxAmountSnapshot,
      lineTotal: extra.lineTotal,
      sortOrder: booking.rooms.length + index,
    });
  });

  booking.taxLines.filter((line) => line.kind !== "VAT").forEach((line, index) => {
    result.push({
      description: line.labelSnapshot,
      quantity: line.quantitySnapshot,
      unitPrice: line.quantitySnapshot.gt(0) ? cents(line.amount.div(line.quantitySnapshot)) : line.amount,
      taxRate: new Prisma.Decimal(0),
      subtotal: line.amount,
      taxAmount: new Prisma.Decimal(0),
      lineTotal: line.amount,
      sortOrder: booking.rooms.length + booking.extras.length + index,
    });
  });
  return result;
}

async function nextNumber(
  transaction: BillingTransaction,
  propertyId: string,
  documentType: InvoiceDocumentType,
  timezone: string,
  issuedAt: Date,
) {
  const year = calendarYear(issuedAt, timezone);
  const prefix = documentType === InvoiceDocumentType.INVOICE ? "FAC" : "AV";
  const sequence = await transaction.invoiceSequence.upsert({
    where: { propertyId_documentType_calendarYear: { propertyId, documentType, calendarYear: year } },
    create: { propertyId, documentType, calendarYear: year, prefix, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return invoiceNumber(sequence.prefix, year, sequence.lastNumber);
}

export async function issuePaidInvoice(transaction: BillingTransaction, bookingId: string) {
  const existing = await transaction.invoice.findFirst({
    where: { bookingId, documentType: InvoiceDocumentType.INVOICE },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (existing) return existing;

  const booking = await transaction.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: true,
      guests: { where: { isPrimary: true }, take: 1 },
      rooms: { orderBy: { createdAt: "asc" } },
      extras: { orderBy: { createdAt: "asc" } },
      taxLines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!booking) throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
  const customer = booking.guests[0];
  if (!customer) throw new AdminApiError(409, "BOOKING_CUSTOMER_MISSING", "Le client principal est introuvable.");

  const issuedAt = new Date();
  const number = await nextNumber(transaction, booking.propertyId, InvoiceDocumentType.INVOICE, booking.property.timezone, issuedAt);
  const lines = buildInvoiceLines(booking);
  const vatTotal = booking.taxLines
    .filter((line) => line.kind === "VAT")
    .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));

  const invoice = await transaction.invoice.create({
    data: {
      propertyId: booking.propertyId,
      bookingId: booking.id,
      number,
      documentType: InvoiceDocumentType.INVOICE,
      status: InvoiceStatus.PAID,
      issuedAt,
      dueAt: issuedAt,
      serviceDate: booking.checkOut,
      currency: booking.currency,
      subtotal: cents(booking.total.minus(vatTotal)),
      taxTotal: cents(vatTotal),
      total: booking.total,
      issuerSnapshot: {
        name: booking.property.name,
        legalName: booking.property.legalName,
        email: booking.property.email,
        phone: booking.property.phone,
        addressLine1: booking.property.addressLine1,
        addressLine2: booking.property.addressLine2,
        postalCode: booking.property.postalCode,
        city: booking.property.city,
        countryCode: booking.property.countryCode,
      },
      customerSnapshot: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        countryCode: customer.countryCode,
      },
      lines: { create: lines },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  const retentionDeadline = retentionDeadlineFrom(issuedAt);
  await transaction.booking.updateMany({
    where: {
      id: booking.id,
      OR: [
        { personalDataRetainUntil: null },
        { personalDataRetainUntil: { lt: retentionDeadline } },
      ],
    },
    data: { personalDataRetainUntil: retentionDeadline },
  });
  return invoice;
}

type OriginalInvoiceLineForCredit = {
  id: string;
  description: string;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  sortOrder: number;
  creditLines: Array<{
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }>;
};

function decimalSumOrZero(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
}

function minimum(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.lte(right) ? left : right;
}

function maximum(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.gte(right) ? left : right;
}

export function buildCreditNoteLines(originalLines: OriginalInvoiceLineForCredit[], requestedAmount: Prisma.Decimal) {
  const amount = cents(requestedAmount);
  const remaining = originalLines.map((line) => {
    const creditedSubtotal = decimalSumOrZero(line.creditLines.map((credit) => credit.subtotal));
    const creditedTax = decimalSumOrZero(line.creditLines.map((credit) => credit.taxAmount));
    const remainingSubtotal = maximum(new Prisma.Decimal(0), cents(line.subtotal.minus(creditedSubtotal)));
    const remainingTax = maximum(new Prisma.Decimal(0), cents(line.taxAmount.minus(creditedTax)));
    return {
      ...line,
      remainingSubtotal,
      remainingTax,
      remainingTotal: cents(remainingSubtotal.add(remainingTax)),
    };
  }).filter((line) => line.remainingTotal.gt(0));

  const totalRemaining = cents(decimalSumOrZero(remaining.map((line) => line.remainingTotal)));
  if (amount.lte(0) || amount.gt(totalRemaining) || remaining.length === 0) {
    throw new AdminApiError(409, "INVALID_CREDIT_AMOUNT", `Le montant maximal de l'avoir est de ${totalRemaining.toFixed(2)}.`);
  }

  const requestedCents = amount.mul(100).toDecimalPlaces(0).toNumber();
  const remainingCents = totalRemaining.mul(100).toDecimalPlaces(0).toNumber();
  const shares = remaining.map((line) => {
    const capacity = line.remainingTotal.mul(100).toDecimalPlaces(0).toNumber();
    const exact = new Prisma.Decimal(requestedCents).mul(capacity).div(remainingCents);
    const allocated = Math.min(capacity, exact.floor().toNumber());
    return { line, capacity, allocated, remainder: exact.minus(allocated) };
  });

  let undistributed = requestedCents - shares.reduce((sum, share) => sum + share.allocated, 0);
  const distributionOrder = [...shares].sort((left, right) => {
    const remainderOrder = right.remainder.comparedTo(left.remainder);
    return remainderOrder || left.line.sortOrder - right.line.sortOrder;
  });
  for (const share of distributionOrder) {
    if (undistributed === 0) break;
    if (share.allocated >= share.capacity) continue;
    share.allocated += 1;
    undistributed -= 1;
  }
  if (undistributed !== 0) throw new AdminApiError(409, "CREDIT_ALLOCATION_FAILED", "La ventilation de l'avoir n'a pas pu être équilibrée.");

  return shares.filter((share) => share.allocated > 0).map(({ line, allocated, capacity }) => {
    const lineTotal = new Prisma.Decimal(allocated).div(100);
    let taxAmount: Prisma.Decimal;
    let subtotal: Prisma.Decimal;
    if (allocated === capacity) {
      taxAmount = line.remainingTax;
      subtotal = line.remainingSubtotal;
    } else {
      const calculatedTax = line.taxRate.gt(0)
        ? cents(lineTotal.mul(line.taxRate).div(line.taxRate.add(100)))
        : new Prisma.Decimal(0);
      const minimumTax = maximum(new Prisma.Decimal(0), cents(lineTotal.minus(line.remainingSubtotal)));
      taxAmount = minimum(line.remainingTax, maximum(minimumTax, calculatedTax));
      subtotal = cents(lineTotal.minus(taxAmount));
    }
    return {
      description: `Avoir — ${line.description}`,
      quantity: new Prisma.Decimal(1),
      unitPrice: subtotal,
      taxRate: line.taxRate,
      subtotal,
      taxAmount,
      lineTotal,
      sortOrder: line.sortOrder,
      originalInvoiceLineId: line.id,
    } satisfies InvoiceLineDraft;
  });
}

export async function issueCreditNote(
  transaction: BillingTransaction,
  originalInvoiceId: string,
  amount: Prisma.Decimal,
  reason: string,
) {
  const original = await transaction.invoice.findUnique({
    where: { id: originalInvoiceId },
    include: {
      property: { select: { timezone: true } },
      lines: {
        orderBy: { sortOrder: "asc" },
        include: {
          creditLines: {
            where: { invoice: { status: { not: InvoiceStatus.VOID } } },
            select: { subtotal: true, taxAmount: true, lineTotal: true },
          },
        },
      },
    },
  });
  if (!original || original.documentType !== InvoiceDocumentType.INVOICE) {
    throw new AdminApiError(409, "INVOICE_NOT_FOUND", "La facture d'origine est introuvable.");
  }
  const issuedAt = new Date();
  const number = await nextNumber(transaction, original.propertyId, InvoiceDocumentType.CREDIT_NOTE, original.property.timezone, issuedAt);
  const lines = buildCreditNoteLines(original.lines, amount);
  const subtotal = cents(lines.reduce((sum, line) => sum.add(line.subtotal), new Prisma.Decimal(0)));
  const taxAmount = cents(lines.reduce((sum, line) => sum.add(line.taxAmount), new Prisma.Decimal(0)));
  const total = cents(lines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0)));

  const creditNote = await transaction.invoice.create({
    data: {
      propertyId: original.propertyId,
      bookingId: original.bookingId,
      originalInvoiceId: original.id,
      number,
      documentType: InvoiceDocumentType.CREDIT_NOTE,
      status: InvoiceStatus.ISSUED,
      issuedAt,
      serviceDate: original.serviceDate,
      currency: original.currency,
      subtotal,
      taxTotal: taxAmount,
      total,
      issuerSnapshot: original.issuerSnapshot as Prisma.InputJsonObject,
      customerSnapshot: original.customerSnapshot as Prisma.InputJsonObject,
      creditReason: reason,
      lines: { create: lines },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  const retentionDeadline = retentionDeadlineFrom(issuedAt);
  await transaction.booking.updateMany({
    where: {
      id: original.bookingId,
      OR: [
        { personalDataRetainUntil: null },
        { personalDataRetainUntil: { lt: retentionDeadline } },
      ],
    },
    data: { personalDataRetainUntil: retentionDeadline },
  });
  return creditNote;
}

export async function listBookingInvoices(propertyId: string, bookingId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { propertyId, bookingId },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true, documentType: true, status: true, issuedAt: true, currency: true, total: true, originalInvoiceId: true },
  });
  return invoices.map((invoice) => ({
    ...invoice,
    total: Number(invoice.total),
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
  }));
}

export async function getInvoiceForProperty(propertyId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, propertyId },
    include: {
      booking: { select: { reference: true, checkIn: true, checkOut: true } },
      originalInvoice: { select: { number: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
}

function snapshot(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatMoney(value: Prisma.Decimal, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(Number(value));
}

function formatDate(value: Date | null) {
  return value ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value) : "-";
}

export async function renderInvoicePdf(invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceForProperty>>>) {
  const issuer = snapshot(invoice.issuerSnapshot);
  const customer = snapshot(invoice.customerSnapshot);
  const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: invoice.number, Author: stringValue(issuer.legalName) ?? stringValue(issuer.name) ?? "Hôtel Rivage" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const gold = "#9a7345";
  const dark = "#28231e";
  const muted = "#776f66";
  const line = "#ded4c8";
  const title = invoice.documentType === InvoiceDocumentType.INVOICE ? "FACTURE" : "AVOIR";
  const issuerName = stringValue(issuer.legalName) ?? stringValue(issuer.name) ?? "Hôtel Rivage";
  const issuerAddress = [stringValue(issuer.addressLine1), stringValue(issuer.addressLine2), [stringValue(issuer.postalCode), stringValue(issuer.city)].filter(Boolean).join(" ")].filter(Boolean);
  const customerName = [stringValue(customer.firstName), stringValue(customer.lastName)].filter(Boolean).join(" ") || "Client";

  document.fillColor(gold).font("Helvetica-Bold").fontSize(11).text("HÔTEL RIVAGE", 48, 48, { characterSpacing: 1.4 });
  document.fillColor(dark).font("Times-Roman").fontSize(32).text(title, 48, 75);
  document.fillColor(dark).font("Helvetica-Bold").fontSize(13).text(invoice.number, 350, 55, { align: "right", width: 197 });
  document.fillColor(muted).font("Helvetica").fontSize(9).text(`Émise le ${formatDate(invoice.issuedAt)}`, 350, 76, { align: "right", width: 197 });
  document.text(`Réservation ${invoice.booking.reference}`, 350, 91, { align: "right", width: 197 });
  if (invoice.originalInvoice) document.text(`Facture d'origine ${invoice.originalInvoice.number}`, 350, 106, { align: "right", width: 197 });

  document.moveTo(48, 130).lineTo(547, 130).strokeColor(line).stroke();
  document.fillColor(muted).font("Helvetica-Bold").fontSize(9).text("ÉMETTEUR", 48, 154);
  document.fillColor(dark).font("Helvetica-Bold").fontSize(11).text(issuerName, 48, 172);
  document.fillColor(muted).font("Helvetica").fontSize(9);
  issuerAddress.forEach((address, index) => document.text(String(address), 48, 190 + index * 14));
  if (stringValue(issuer.email)) document.text(stringValue(issuer.email)!, 48, 190 + issuerAddress.length * 14);

  document.fillColor(muted).font("Helvetica-Bold").fontSize(9).text("CLIENT", 322, 154);
  document.fillColor(dark).font("Helvetica-Bold").fontSize(11).text(customerName, 322, 172);
  document.fillColor(muted).font("Helvetica").fontSize(9);
  if (stringValue(customer.email)) document.text(stringValue(customer.email)!, 322, 190);
  if (stringValue(customer.phone)) document.text(stringValue(customer.phone)!, 322, 204);

  let y = 260;
  const columns = { description: 48, quantity: 305, unit: 350, tax: 420, total: 476 };
  document.rect(48, y, 499, 26).fill("#f0ebe3");
  document.fillColor(dark).font("Helvetica-Bold").fontSize(8);
  document.text("DÉSIGNATION", columns.description + 8, y + 9);
  document.text("QTÉ", columns.quantity, y + 9, { width: 35, align: "right" });
  document.text("PU HT", columns.unit, y + 9, { width: 60, align: "right" });
  document.text("TVA", columns.tax, y + 9, { width: 40, align: "right" });
  document.text("TOTAL TTC", columns.total, y + 9, { width: 71, align: "right" });
  y += 38;

  for (const item of invoice.lines) {
    if (y > 690) {
      document.addPage();
      y = 60;
    }
    document.fillColor(dark).font("Helvetica").fontSize(8.5);
    document.text(item.description, columns.description, y, { width: 245 });
    document.text(Number(item.quantity).toLocaleString("fr-FR"), columns.quantity, y, { width: 35, align: "right" });
    document.text(formatMoney(item.unitPrice, invoice.currency), columns.unit, y, { width: 60, align: "right" });
    document.text(`${Number(item.taxRate).toLocaleString("fr-FR")} %`, columns.tax, y, { width: 40, align: "right" });
    document.font("Helvetica-Bold").text(formatMoney(item.lineTotal, invoice.currency), columns.total, y, { width: 71, align: "right" });
    y += Math.max(30, document.heightOfString(item.description, { width: 245 }) + 14);
    document.moveTo(48, y - 8).lineTo(547, y - 8).strokeColor("#eee8e0").stroke();
  }

  y = Math.max(y + 18, 520);
  const totalsX = 355;
  document.fillColor(muted).font("Helvetica").fontSize(9).text("Sous-total HT", totalsX, y, { width: 100 });
  document.fillColor(dark).text(formatMoney(invoice.subtotal, invoice.currency), 457, y, { width: 90, align: "right" });
  document.fillColor(muted).text("TVA incluse", totalsX, y + 21, { width: 100 });
  document.fillColor(dark).text(formatMoney(invoice.taxTotal, invoice.currency), 457, y + 21, { width: 90, align: "right" });
  document.rect(totalsX - 10, y + 43, 202, 38).fill("#f0ebe3");
  document.fillColor(dark).font("Helvetica-Bold").fontSize(11).text("TOTAL TTC", totalsX, y + 57);
  document.fontSize(12).text(formatMoney(invoice.total, invoice.currency), 457, y + 56, { width: 80, align: "right" });

  if (invoice.creditReason) {
    document.fillColor(muted).font("Helvetica").fontSize(8.5).text(`Motif de l'avoir : ${invoice.creditReason}`, 48, y + 104, { width: 499 });
  }
  document.fillColor(muted).fontSize(8).text("Prix exprimés en euros. TVA incluse dans les montants TTC.", 48, 760, { width: 499, align: "center" });
  document.end();
  return finished;
}
