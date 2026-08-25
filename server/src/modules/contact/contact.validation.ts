import { ContactApiError, invalidContact } from "./contact.errors.js";
import type { ContactRequestInput } from "./contact.types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9 ()'.-]+$/;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FIELDS = new Set(["fullName", "email", "phone", "subject", "message", "privacyAccepted"]);
const SUBJECTS = new Set<ContactRequestInput["subject"]>(["BOOKING_QUESTION", "ARRIVAL", "SPECIAL_REQUEST", "OTHER"]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidContact();
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !FIELDS.has(key))) throw invalidContact("Le formulaire contient un champ non autorisé.");
  return candidate;
}

function text(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw invalidContact(`${label} est invalide.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum || CONTROL_CHARACTER.test(normalized)) {
    throw invalidContact(`${label} est invalide.`);
  }
  return normalized;
}

export function parseContactRequestBody(body: unknown): ContactRequestInput {
  const candidate = record(body);
  const fullName = text(candidate.fullName, "Le nom", 2, 120);
  const email = text(candidate.email, "L'adresse email", 3, 254).toLowerCase();
  if (!EMAIL.test(email)) throw invalidContact("L'adresse email est invalide.");

  let phone: string | undefined;
  if (candidate.phone !== undefined && candidate.phone !== null && candidate.phone !== "") {
    phone = text(candidate.phone, "Le numéro de téléphone", 7, 30);
    if (!PHONE.test(phone) || phone.replace(/\D/g, "").length < 7) throw invalidContact("Le numéro de téléphone est invalide.");
  }
  if (typeof candidate.subject !== "string" || !SUBJECTS.has(candidate.subject as ContactRequestInput["subject"])) {
    throw invalidContact("Le sujet est invalide.");
  }
  if (candidate.privacyAccepted !== true) throw invalidContact("Votre accord est nécessaire pour envoyer le formulaire.");

  return {
    fullName,
    email,
    ...(phone ? { phone } : {}),
    subject: candidate.subject as ContactRequestInput["subject"],
    message: text(candidate.message, "Le message", 20, 4_000),
    privacyAccepted: true,
  };
}

export function parseContactIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new ContactApiError(400, "INVALID_IDEMPOTENCY_KEY", "La demande ne peut pas être identifiée correctement.");
  }
  return value.trim().toLowerCase();
}
