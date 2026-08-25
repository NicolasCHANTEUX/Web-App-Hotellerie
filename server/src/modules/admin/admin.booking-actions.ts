import { BookingStatus } from "../../generated/prisma/client.js";
import { AdminApiError } from "./admin.errors.js";

const allowedFields = new Set(["status", "reason"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionableStatuses = new Set<BookingStatus>([
  BookingStatus.CANCELLED,
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
]);

export type AdminBookingStatusInput = {
  status: typeof BookingStatus.CANCELLED | typeof BookingStatus.COMPLETED | typeof BookingStatus.NO_SHOW;
  reason: string | null;
};

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_BOOKING_ACTION", message);
}

export function parseAdminBookingStatusBody(body: unknown): AdminBookingStatusInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("L’action sur la réservation est invalide.");
  }
  const candidate = body as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n’est pas autorisé.`);
  if (typeof candidate.status !== "string" || !actionableStatuses.has(candidate.status as BookingStatus)) {
    return invalid("Le nouveau statut est invalide.");
  }
  if (candidate.reason !== undefined && candidate.reason !== null && typeof candidate.reason !== "string") {
    return invalid("Le motif est invalide.");
  }
  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
  if (reason.length > 500) return invalid("Le motif est limité à 500 caractères.");
  return {
    status: candidate.status as AdminBookingStatusInput["status"],
    reason: reason || null,
  };
}

export function bookingStatusTransitionAllowed(current: BookingStatus, next: BookingStatus) {
  if (current === next) return true;
  if (next === BookingStatus.CANCELLED) {
    return current === BookingStatus.DRAFT
      || current === BookingStatus.PENDING_PAYMENT
      || current === BookingStatus.CONFIRMED;
  }
  if (next === BookingStatus.COMPLETED || next === BookingStatus.NO_SHOW) {
    return current === BookingStatus.CONFIRMED;
  }
  return false;
}

export function parseAdminBookingRoomAssignmentBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("L’affectation de chambre est invalide.");
  }
  const candidate = body as Record<string, unknown>;
  if (Object.keys(candidate).some((field) => field !== "roomId")) {
    return invalid("L’affectation contient un champ non autorisé.");
  }
  if (typeof candidate.roomId !== "string" || !uuidPattern.test(candidate.roomId)) {
    return invalid("La chambre sélectionnée est invalide.");
  }
  return { roomId: candidate.roomId };
}
