import { BlockReason } from "../../generated/prisma/client.js";
import { AdminApiError } from "./admin.errors.js";

const allowedFields = new Set(["checkIn", "checkOut", "reason", "note"]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export type AdminAvailabilityBlockInput = {
  checkIn: Date;
  checkOut: Date;
  reason: BlockReason;
  note: string | null;
};

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_AVAILABILITY_BLOCK", message);
}

function dateOnly(value: unknown, label: string) {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return invalid(`${label} est invalide.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return invalid(`${label} est invalide.`);
  return date;
}

export function parseAdminAvailabilityBlockBody(body: unknown): AdminAvailabilityBlockInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("Le blocage est invalide.");
  const candidate = body as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n’est pas autorisé.`);
  const checkIn = dateOnly(candidate.checkIn, "La date de début");
  const checkOut = dateOnly(candidate.checkOut, "La date de fin");
  const nights = (checkOut.getTime() - checkIn.getTime()) / 86_400_000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 366) {
    return invalid("La période doit être comprise entre 1 et 366 jours.");
  }
  if (typeof candidate.reason !== "string" || !Object.values(BlockReason).includes(candidate.reason as BlockReason)) {
    return invalid("Le motif du blocage est invalide.");
  }
  if (candidate.note !== undefined && candidate.note !== null && typeof candidate.note !== "string") {
    return invalid("La note est invalide.");
  }
  const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
  if (note.length > 1_000) return invalid("La note est limitée à 1 000 caractères.");
  return { checkIn, checkOut, reason: candidate.reason as BlockReason, note: note || null };
}
