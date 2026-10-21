import { AdminApiError } from "./admin.errors.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9 ()'.-]+$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SINGLE_LINE_CONTROL = /[\u0000-\u001f\u007f]/;
const MULTI_LINE_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;

const fields = [
  "name",
  "legalName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "countryCode",
  "checkInTime",
  "checkOutTime",
  "legalForm",
  "shareCapital",
  "siret",
  "registrationCity",
  "vatNumber",
  "publicationDirector",
  "hostingProvider",
  "mediator",
] as const;
const allowedFields = new Set<string>(["updatedAt", ...fields]);

export type AdminPropertySettings = {
  name: string;
  legalName: string | null;
  email: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  checkInTime: string;
  checkOutTime: string;
  legalForm: string | null;
  shareCapital: string | null;
  siret: string | null;
  registrationCity: string | null;
  vatNumber: string | null;
  publicationDirector: string | null;
  hostingProvider: string | null;
  mediator: string | null;
};

export type AdminPropertyUpdateInput = AdminPropertySettings & { updatedAt: Date };

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_PROPERTY", message);
}

function text(value: unknown, label: string, max: number, { required = false, multiline = false } = {}) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return required ? invalid(`${label} est obligatoire.`) : null;
  }
  if (typeof value !== "string") return invalid(`${label} est invalide.`);
  const parsed = value.trim();
  if (parsed.length > max) return invalid(`${label} est limité à ${max} caractères.`);
  if ((multiline ? MULTI_LINE_CONTROL : SINGLE_LINE_CONTROL).test(parsed)) return invalid(`${label} contient des caractères invalides.`);
  return parsed;
}

function required(value: unknown, label: string, max: number) {
  return text(value, label, max, { required: true }) as string;
}

function time(value: unknown, label: string) {
  if (typeof value !== "string" || !TIME.test(value)) return invalid(`${label} doit respecter le format HH:MM.`);
  return value;
}

function siret(value: unknown) {
  const parsed = text(value, "Le SIRET", 20);
  if (parsed === null) return null;
  const digits = parsed.replace(/\s/g, "");
  if (!/^\d{14}$/.test(digits)) return invalid("Le SIRET doit contenir 14 chiffres.");
  return digits;
}

function vatNumber(value: unknown) {
  const parsed = text(value, "Le numéro de TVA", 20);
  if (parsed === null) return null;
  const normalized = parsed.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(normalized)) return invalid("Le numéro de TVA intracommunautaire est invalide.");
  return normalized;
}

export function parseAdminPropertyUpdateBody(body: unknown): AdminPropertyUpdateInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("Les informations de l'établissement sont invalides.");
  const candidate = body as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n'est pas autorisé.`);
  const missing = fields.find((field) => !Object.prototype.hasOwnProperty.call(candidate, field));
  if (missing) return invalid(`Le champ ${missing} est obligatoire.`);

  if (typeof candidate.updatedAt !== "string") return invalid("La version de l'établissement est obligatoire.");
  const updatedAt = new Date(candidate.updatedAt);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== candidate.updatedAt) {
    return invalid("La version de l'établissement est invalide.");
  }

  const email = required(candidate.email, "L'adresse e-mail", 320).toLowerCase();
  if (!EMAIL.test(email)) return invalid("L'adresse e-mail est invalide.");
  const phone = text(candidate.phone, "Le téléphone", 30);
  if (phone && !PHONE.test(phone)) return invalid("Le téléphone est invalide.");
  const countryCode = required(candidate.countryCode, "Le pays", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return invalid("Le pays doit être un code à deux lettres, par exemple FR.");

  return {
    name: required(candidate.name, "Le nom de l'établissement", 120),
    legalName: text(candidate.legalName, "La raison sociale", 160),
    email,
    phone,
    addressLine1: required(candidate.addressLine1, "L'adresse", 160),
    addressLine2: text(candidate.addressLine2, "Le complément d'adresse", 160),
    postalCode: required(candidate.postalCode, "Le code postal", 12),
    city: required(candidate.city, "La ville", 80),
    countryCode,
    checkInTime: time(candidate.checkInTime, "L'heure d'arrivée"),
    checkOutTime: time(candidate.checkOutTime, "L'heure de départ"),
    legalForm: text(candidate.legalForm, "La forme juridique", 60),
    shareCapital: text(candidate.shareCapital, "Le capital social", 40),
    siret: siret(candidate.siret),
    registrationCity: text(candidate.registrationCity, "La ville du RCS", 80),
    vatNumber: vatNumber(candidate.vatNumber),
    publicationDirector: text(candidate.publicationDirector, "Le directeur de la publication", 120),
    hostingProvider: text(candidate.hostingProvider, "L'hébergeur", 400, { multiline: true }),
    mediator: text(candidate.mediator, "Le médiateur", 400, { multiline: true }),
    updatedAt,
  };
}
