import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { enqueueNotification } from "../notifications/notification.service.js";
import { CONTACT_RETENTION_YEARS, retentionDeadlineFrom } from "../privacy/retention.service.js";
import { ContactApiError } from "./contact.errors.js";
import type { ContactRequestInput } from "./contact.types.js";

const SUBJECT_LABELS: Record<ContactRequestInput["subject"], string> = {
  BOOKING_QUESTION: "Question sur une réservation",
  ARRIVAL: "Préparer mon arrivée",
  SPECIAL_REQUEST: "Demande particulière",
  OTHER: "Autre demande",
};

function requestHash(input: ContactRequestInput) {
  return createHash("sha256").update(JSON.stringify({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone ?? null,
    subject: input.subject,
    message: input.message,
    privacyAccepted: input.privacyAccepted,
  })).digest("hex");
}

function response(contact: { id: string; createdAt: Date }) {
  return { id: contact.id, status: "RECEIVED" as const, receivedAt: contact.createdAt.toISOString() };
}

function assertSameRequest(storedHash: string, submittedHash: string) {
  if (storedHash !== submittedHash) {
    throw new ContactApiError(409, "IDEMPOTENCY_KEY_REUSED", "Cette tentative d'envoi correspond à un autre message. Réessayez.");
  }
}

export async function createContactRequest(input: ContactRequestInput, idempotencyKey: string) {
  const submittedHash = requestHash(input);
  const existing = await prisma.contactRequest.findUnique({ where: { idempotencyKey } });
  if (existing) {
    assertSameRequest(existing.requestHash, submittedHash);
    return response(existing);
  }

  const property = await prisma.property.findUnique({
    where: { slug: env.publicPropertySlug },
    select: { id: true, email: true },
  });
  if (!property) throw new ContactApiError(503, "PROPERTY_UNAVAILABLE", "Le formulaire est momentanément indisponible.");

  const now = new Date();
  try {
    return await prisma.$transaction(async (transaction) => {
      const contact = await transaction.contactRequest.create({
        data: {
          propertyId: property.id,
          idempotencyKey,
          requestHash: submittedHash,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          subject: SUBJECT_LABELS[input.subject],
          message: input.message,
          privacyAcceptedAt: now,
          personalDataRetainUntil: retentionDeadlineFrom(now, CONTACT_RETENTION_YEARS),
        },
      });
      await enqueueNotification(transaction, {
        propertyId: property.id,
        recipient: property.email,
        template: "CONTACT_REQUEST_RECEIVED",
        idempotencyKey: `contact:${contact.id}:received`,
        payload: {
          reference: contact.id,
          contactName: input.fullName,
          contactEmail: input.email,
          contactPhone: input.phone,
          contactSubject: SUBJECT_LABELS[input.subject],
          contactMessage: input.message,
        },
      });
      return response(contact);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.contactRequest.findUnique({ where: { idempotencyKey } });
      if (concurrent) {
        assertSameRequest(concurrent.requestHash, submittedHash);
        return response(concurrent);
      }
    }
    throw error;
  }
}
