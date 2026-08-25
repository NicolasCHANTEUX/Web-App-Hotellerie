import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

export const ACCOUNTING_RETENTION_YEARS = 10;

export function retentionDeadlineFrom(date: Date, years = ACCOUNTING_RETENTION_YEARS) {
  const deadline = new Date(date);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + years);
  return deadline;
}

export async function previewExpiredBookings(now = new Date(), limit = 100) {
  return prisma.booking.findMany({
    where: {
      anonymizedAt: null,
      personalDataRetainUntil: { lte: now },
    },
    orderBy: { personalDataRetainUntil: "asc" },
    take: limit,
    select: {
      id: true,
      propertyId: true,
      reference: true,
      status: true,
      personalDataRetainUntil: true,
    },
  });
}

export async function anonymizeExpiredBookings(now = new Date(), limit = 100) {
  const candidates = await previewExpiredBookings(now, limit);

  for (const candidate of candidates) {
    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.booking.updateMany({
        where: {
          id: candidate.id,
          anonymizedAt: null,
          personalDataRetainUntil: { lte: now },
        },
        data: {
          specialRequests: null,
          anonymizedAt: now,
        },
      });
      if (claimed.count !== 1) return;

      await transaction.guest.updateMany({
        where: { bookingId: candidate.id },
        data: {
          firstName: "Client",
          lastName: "anonymisé",
          email: null,
          phone: null,
          countryCode: null,
        },
      });

      await transaction.notification.updateMany({
        where: {
          bookingId: candidate.id,
          status: { in: ["PENDING", "PROCESSING", "FAILED"] },
        },
        data: { status: "CANCELLED" },
      });
      await transaction.notification.updateMany({
        where: { bookingId: candidate.id },
        data: {
          recipient: `anonymized-${candidate.id}@invalid.local`,
          subject: "Notification anonymisée",
          payload: { anonymized: true, reference: candidate.reference } as Prisma.InputJsonObject,
          providerReference: null,
          lastError: null,
        },
      });

      await transaction.invoice.updateMany({
        where: { bookingId: candidate.id },
        data: {
          customerSnapshot: {
            firstName: "Client",
            lastName: "anonymisé",
            email: null,
            phone: null,
            countryCode: null,
          } as Prisma.InputJsonObject,
        },
      });

      await transaction.auditLog.create({
        data: {
          propertyId: candidate.propertyId,
          bookingId: candidate.id,
          action: "BOOKING_PERSONAL_DATA_ANONYMIZED",
          entityType: "Booking",
          entityId: candidate.id,
          before: { anonymizedAt: null },
          after: { anonymizedAt: now.toISOString() },
          metadata: { source: "RETENTION_JOB", retentionDeadline: candidate.personalDataRetainUntil?.toISOString() },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  return { processed: candidates.length };
}
