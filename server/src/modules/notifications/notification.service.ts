import type { FastifyBaseLogger } from "fastify";
import { Prisma, type NotificationTemplate } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";

const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 8_000;

export type NotificationPayload = {
  propertyName?: string;
  timezone?: string;
  firstName?: string;
  reference: string;
  roomName?: string;
  arrival?: string;
  departure?: string;
  total?: number;
  currency?: string;
  holdExpiresAt?: string;
  reason?: string;
  invoiceNumber?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactSubject?: string;
  contactMessage?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  adults?: number;
  children?: number;
  specialRequests?: string;
  adminUrl?: string;
};

type NotificationTransaction = Pick<Prisma.TransactionClient, "notification" | "property">;

export function adminBookingUrl(bookingId: string) {
  return `${env.frontendUrl.replace(/\/+$/, "")}/admin/reservations?booking=${encodeURIComponent(bookingId)}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number | undefined, currency = "EUR") {
  return typeof value === "number"
    ? new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value)
    : null;
}

function date(value: string | undefined, timezone = "UTC") {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(value.length > 10 ? { hour: "2-digit", minute: "2-digit", timeZone: timezone } : {}),
  }).format(parsed);
}

export function notificationSubject(template: NotificationTemplate, payload: NotificationPayload) {
  switch (template) {
    case "BOOKING_OPTIONED": return `Votre demande de réservation ${payload.reference}`;
    case "BOOKING_CONFIRMED": return `Votre réservation ${payload.reference} est confirmée`;
    case "BOOKING_UPDATED": return `Votre réservation ${payload.reference} a été modifiée`;
    case "BOOKING_CANCELLED": return `Votre réservation ${payload.reference} est annulée`;
    case "PAYMENT_SUCCEEDED": return `Paiement reçu pour la réservation ${payload.reference}`;
    case "PAYMENT_REFUNDED": return `Remboursement de la réservation ${payload.reference}`;
    case "CONTACT_REQUEST_RECEIVED": return `Nouveau message — ${payload.contactSubject ?? "Site internet"}`;
    case "BOOKING_REQUEST_RECEIVED": return `Nouvelle demande de réservation ${payload.reference}`;
    case "PAYMENT_REQUIRES_ATTENTION": return `Action requise : paiement reçu pour ${payload.reference}`;
  }
}

function guestsLabel(adults?: number, children?: number) {
  if (typeof adults !== "number") return null;
  const parts = [`${adults} adulte${adults > 1 ? "s" : ""}`];
  if (children) parts.push(`${children} enfant${children > 1 ? "s" : ""}`);
  return parts.join(", ");
}

function presentParagraphs(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

function renderStaffMessage(
  template: NotificationTemplate,
  payload: NotificationPayload,
  propertyName: string,
  headline: string,
  paragraphs: string[],
) {
  const actionLabel = "Ouvrir dans l'administration";
  const text = presentParagraphs([...paragraphs, payload.adminUrl && `${actionLabel} : ${payload.adminUrl}`]).join("\n\n");
  const action = payload.adminUrl
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(payload.adminUrl)}" style="display:inline-block;background:#28231e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">${actionLabel}</a></p>`
    : "";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f0ea;color:#28231e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #ded4c8;border-radius:14px;padding:32px"><p style="margin:0 0 24px;color:#9a7345;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(propertyName)}</p><h1 style="margin:0 0 24px;font-family:Georgia,serif;font-size:30px;font-weight:500">${escapeHtml(headline)}</h1>${paragraphs.map((paragraph) => `<p style="margin:0 0 16px;line-height:1.65;white-space:pre-wrap">${escapeHtml(paragraph)}</p>`).join("")}${action}</div></div></body></html>`;
  return { subject: notificationSubject(template, payload), text, html };
}

export function renderNotification(template: NotificationTemplate, payload: NotificationPayload) {
  const propertyName = payload.propertyName?.trim() || "Votre établissement";
  const teamSignature = payload.propertyName?.trim()
    ? `L'équipe de ${propertyName}`
    : "L'équipe de votre établissement";
  const stay = payload.arrival && payload.departure
    ? `Séjour du ${date(payload.arrival, payload.timezone)} au ${date(payload.departure, payload.timezone)}${payload.roomName ? ` - ${payload.roomName}` : ""}.`
    : payload.roomName ? `Hébergement : ${payload.roomName}.` : null;
  const total = money(payload.total, payload.currency);

  if (template === "CONTACT_REQUEST_RECEIVED") {
    return renderStaffMessage(template, payload, propertyName, "Nouveau message depuis le site", presentParagraphs([
      `Nom : ${payload.contactName ?? "Non renseigné"}`,
      `Email : ${payload.contactEmail ?? "Non renseigné"}`,
      payload.contactPhone && `Téléphone : ${payload.contactPhone}`,
      `Sujet : ${payload.contactSubject ?? "Autre demande"}`,
      payload.contactMessage ?? "Message vide",
    ]));
  }

  if (template === "BOOKING_REQUEST_RECEIVED" || template === "PAYMENT_REQUIRES_ATTENTION") {
    const guestDetails = [
      `Client : ${payload.guestName ?? "Non renseigné"}`,
      payload.guestEmail && `E-mail : ${payload.guestEmail}`,
      payload.guestPhone && `Téléphone : ${payload.guestPhone}`,
      stay,
      guestsLabel(payload.adults, payload.children) && `Voyageurs : ${guestsLabel(payload.adults, payload.children)}`,
    ];
    if (template === "BOOKING_REQUEST_RECEIVED") {
      return renderStaffMessage(template, payload, propertyName, "Nouvelle demande de réservation", presentParagraphs([
        `Référence : ${payload.reference}`,
        ...guestDetails,
        total && `Montant : ${total}`,
        payload.specialRequests && `Demande particulière : ${payload.specialRequests}`,
        payload.holdExpiresAt
          && `La chambre est optionnée jusqu'au ${date(payload.holdExpiresAt, payload.timezone)}. Sans paiement en ligne ni confirmation de votre part, la demande expirera automatiquement.`,
      ]));
    }
    return renderStaffMessage(template, payload, propertyName, "Paiement reçu à traiter", presentParagraphs([
      `Un paiement en ligne${total ? ` de ${total}` : ""} a été reçu pour la réservation ${payload.reference}, mais elle n'a pas pu être confirmée automatiquement.`,
      payload.reason && `Motif : ${payload.reason}`,
      ...guestDetails,
      "Contactez le client pour lui proposer une solution, ou remboursez le paiement depuis l'administration.",
    ]));
  }

  const greeting = payload.firstName ? `Bonjour ${payload.firstName},` : "Bonjour,";
  let headline: string;
  let message: string;

  switch (template) {
    case "BOOKING_OPTIONED":
      headline = "Votre chambre est optionnée";
      message = `Votre demande ${payload.reference} a bien été enregistrée.${payload.holdExpiresAt ? ` Elle est réservée provisoirement jusqu'au ${date(payload.holdExpiresAt, payload.timezone)}.` : ""}`;
      break;
    case "BOOKING_CONFIRMED":
      headline = "Votre séjour est confirmé";
      message = `La réservation ${payload.reference} est désormais confirmée.`;
      break;
    case "BOOKING_UPDATED":
      headline = "Votre séjour a été mis à jour";
      message = `Les informations de la réservation ${payload.reference} ont été modifiées par notre équipe.`;
      break;
    case "BOOKING_CANCELLED":
      headline = "Votre réservation est annulée";
      message = `La réservation ${payload.reference} a été annulée.${payload.reason ? ` Motif : ${payload.reason}` : ""}`;
      break;
    case "PAYMENT_SUCCEEDED":
      headline = "Votre paiement a été reçu";
      message = `Nous avons bien reçu${total ? ` votre règlement de ${total}` : " votre règlement"} pour la réservation ${payload.reference}.${payload.invoiceNumber ? ` Facture : ${payload.invoiceNumber}.` : ""}`;
      break;
    case "PAYMENT_REFUNDED":
      headline = "Votre remboursement a été enregistré";
      message = `Un remboursement${total ? ` de ${total}` : ""} a été enregistré pour la réservation ${payload.reference}.${payload.invoiceNumber ? ` Avoir : ${payload.invoiceNumber}.` : ""}`;
      break;
  }

  const updatedTotal = template === "BOOKING_UPDATED" && total
    ? `Nouveau total du séjour : ${total}.`
    : null;
  const paragraphs = [greeting, message, stay, updatedTotal, teamSignature]
    .filter((value): value is string => Boolean(value));
  const text = paragraphs.join("\n\n");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f0ea;color:#28231e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #ded4c8;border-radius:14px;padding:32px"><p style="margin:0 0 24px;color:#9a7345;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(propertyName)}</p><h1 style="margin:0 0 24px;font-family:Georgia,serif;font-size:30px;font-weight:500">${escapeHtml(headline)}</h1>${paragraphs.map((paragraph) => `<p style="margin:0 0 16px;line-height:1.65">${escapeHtml(paragraph)}</p>`).join("")}<p style="margin:28px 0 0;color:#776f66;font-size:12px">Message automatique - merci de ne pas transmettre votre référence de réservation.</p></div></div></body></html>`;
  return { subject: notificationSubject(template, payload), text, html };
}

export async function enqueueNotification(
  transaction: NotificationTransaction,
  input: {
    propertyId: string;
    bookingId?: string;
    recipient: string;
    template: NotificationTemplate;
    idempotencyKey: string;
    payload: NotificationPayload;
  },
) {
  const property = await transaction.property.findUnique({
    where: { id: input.propertyId },
    select: { name: true, timezone: true },
  });
  const payload: NotificationPayload = {
    ...input.payload,
    ...(property ? { propertyName: property.name, timezone: property.timezone } : {}),
  };
  const rendered = renderNotification(input.template, payload);
  return transaction.notification.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      propertyId: input.propertyId,
      ...(input.bookingId ? { bookingId: input.bookingId } : {}),
      recipient: input.recipient.trim().toLowerCase(),
      template: input.template,
      subject: rendered.subject,
      payload: payload as Prisma.InputJsonValue,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function enqueueBookingNotification(
  transaction: NotificationTransaction,
  input: {
    propertyId: string;
    bookingId: string;
    recipient: string;
    template: NotificationTemplate;
    idempotencyKey: string;
    payload: NotificationPayload;
  },
) {
  return enqueueNotification(transaction, input);
}

async function sendWithResend(recipient: string, subject: string, html: string, text: string, replyTo?: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.emailFrom, to: [recipient], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
  if (!response.ok || typeof body?.id !== "string") {
    throw new Error(typeof body?.message === "string" ? body.message : `Resend HTTP ${response.status}`);
  }
  return body.id;
}

export async function dispatchPendingNotifications(logger?: FastifyBaseLogger) {
  if (env.notificationDelivery === "disabled") return { processed: 0, sent: 0, failed: 0 };
  const now = new Date();
  const candidates = await prisma.notification.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
        { status: "PROCESSING", updatedAt: { lte: new Date(now.getTime() - 10 * 60_000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: { property: { select: { name: true, timezone: true } } },
  });

  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimed = await prisma.notification.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: { status: "PROCESSING", attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
    });
    if (claimed.count !== 1) continue;
    try {
      const payload = {
        ...(candidate.payload as NotificationPayload),
        propertyName: candidate.property.name,
        timezone: candidate.property.timezone,
      };
      const rendered = renderNotification(candidate.template, payload);
      const providerReference = env.notificationDelivery === "resend"
        ? await sendWithResend(candidate.recipient, candidate.subject, rendered.html, rendered.text, payload.contactEmail ?? payload.guestEmail)
        : `log-${candidate.id}`;
      await prisma.notification.update({
        where: { id: candidate.id },
        data: { status: "SENT", sentAt: new Date(), providerReference, lastError: null },
      });
      logger?.info({ notificationId: candidate.id, template: candidate.template }, "Notification delivered");
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error";
      const retryMinutes = Math.min(60, 2 ** (candidate.attempts + 1));
      await prisma.notification.update({
        where: { id: candidate.id },
        data: { status: "FAILED", lastError: message, nextAttemptAt: new Date(Date.now() + retryMinutes * 60_000) },
      });
      logger?.warn({ notificationId: candidate.id, error: message }, "Notification delivery failed");
      failed += 1;
    }
  }
  return { processed: sent + failed, sent, failed };
}

export function startNotificationWorker(logger?: FastifyBaseLogger, unref = true) {
  if (env.notificationDelivery === "disabled") return null;
  void dispatchPendingNotifications(logger).catch((error) => logger?.error(error, "Notification worker failed"));
  const timer = setInterval(() => {
    void dispatchPendingNotifications(logger).catch((error) => logger?.error(error, "Notification worker failed"));
  }, 30_000);
  if (unref) timer.unref();
  return timer;
}
