import { RoomStatus } from "../../generated/prisma/client.js";

export const editableRoomFields = ["number", "roomTypeId", "floor", "status", "notes"] as const;

type InvalidRoomInput = (message: string) => never;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseStrictRoomObject(
  body: unknown,
  allowedFields: ReadonlySet<string>,
  invalid: InvalidRoomInput,
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("Le corps de la requête doit être un objet JSON.");
  }
  const candidate = body as Record<string, unknown>;
  const unknownField = Object.keys(candidate).find((key) => !allowedFields.has(key));
  if (unknownField) {
    return invalid(`Le champ ${unknownField} n'est pas autorisé.`);
  }
  return candidate;
}

export function parseRoomNumber(value: unknown, invalid: InvalidRoomInput) {
  if (typeof value !== "string") {
    return invalid("Le numéro de chambre est invalide.");
  }
  const number = value.trim();
  if (!number || number.length > 32) {
    return invalid("Le numéro de chambre doit contenir entre 1 et 32 caractères.");
  }
  return number;
}

export function parseRoomTypeId(value: unknown, invalid: InvalidRoomInput) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    return invalid("Le type de chambre est invalide.");
  }
  return value;
}

export function parseRoomFloor(value: unknown, invalid: InvalidRoomInput) {
  if (
    value !== null &&
    (!Number.isInteger(value) || (value as number) < -20 || (value as number) > 300)
  ) {
    return invalid("L'étage doit être un entier compris entre -20 et 300, ou null.");
  }
  return value as number | null;
}

export function parseRoomStatus(value: unknown, invalid: InvalidRoomInput) {
  if (typeof value !== "string" || !Object.values(RoomStatus).includes(value as RoomStatus)) {
    return invalid("Le statut de chambre est invalide.");
  }
  return value as RoomStatus;
}

export function parseRoomNotes(value: unknown, invalid: InvalidRoomInput) {
  if (value !== null && typeof value !== "string") {
    return invalid("Les notes de la chambre sont invalides.");
  }
  const notes = typeof value === "string" ? value.trim() : null;
  if (notes && notes.length > 2_000) {
    return invalid("Les notes sont limitées à 2 000 caractères.");
  }
  return notes || null;
}

export function parseCanonicalUpdatedAt(value: unknown, invalid: InvalidRoomInput) {
  if (typeof value !== "string") {
    return invalid("La version updatedAt est obligatoire.");
  }
  if (!canonicalTimestampPattern.test(value)) {
    return invalid("La version updatedAt doit être un horodatage ISO valide.");
  }
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== value) {
    return invalid("La version updatedAt doit être un horodatage ISO valide.");
  }
  return updatedAt;
}
