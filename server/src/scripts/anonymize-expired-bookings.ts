import { prisma } from "../lib/prisma.js";
import {
  anonymizeExpiredBookings,
  anonymizeExpiredContactRequests,
  previewExpiredBookings,
  previewExpiredContactRequests,
} from "../modules/privacy/retention.service.js";

const apply = process.argv.includes("--apply");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const parsedLimit = Number(limitArgument?.split("=")[1] ?? 100);
const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 1_000 ? parsedLimit : 100;

try {
  const candidates = await previewExpiredBookings(new Date(), limit);
  const contactCandidates = await previewExpiredContactRequests(new Date(), limit);
  if (!apply) {
    console.log(JSON.stringify({
      candidates: candidates.length + contactCandidates.length,
      applied: false,
      bookings: candidates.map((booking) => ({
        reference: booking.reference,
        status: booking.status,
        retainUntil: booking.personalDataRetainUntil?.toISOString() ?? null,
      })),
      contactRequests: contactCandidates.map((contact) => ({
        id: contact.id,
        subject: contact.subject,
        retainUntil: contact.personalDataRetainUntil.toISOString(),
      })),
      hint: "Relancez avec --apply après vérification.",
    }, null, 2));
  } else {
    const result = await anonymizeExpiredBookings(new Date(), limit);
    const contactResult = await anonymizeExpiredContactRequests(new Date(), limit);
    console.log(JSON.stringify({
      candidates: candidates.length + contactCandidates.length,
      applied: true,
      processedBookings: result.processed,
      processedContactRequests: contactResult.processed,
    }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
