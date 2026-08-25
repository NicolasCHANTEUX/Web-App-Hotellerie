import { invalidBooking } from "./booking.errors.js";
import type { BookingGuestInput, BookingSelectionInput, CreateBookingInput } from "./booking.types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9 ()'.-]+$/;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const ROOT_FIELDS = new Set([
  "roomTypeId",
  "arrival",
  "departure",
  "adults",
  "children",
  "extraIds",
  "expectedTotal",
  "termsAccepted",
  "guest",
  "specialRequests",
]);
const QUOTE_FIELDS = new Set(["roomTypeId", "arrival", "departure", "adults", "children", "extraIds"]);
const REQUIRED_QUOTE_FIELDS = ["roomTypeId", "arrival", "departure", "adults", "children", "extraIds"] as const;
const REQUIRED_ROOT_FIELDS = ["roomTypeId", "arrival", "departure", "adults", "children", "extraIds", "expectedTotal", "termsAccepted", "guest"] as const;
const GUEST_FIELDS = new Set(["firstName", "lastName", "email", "phone", "countryCode"]);
const REQUIRED_GUEST_FIELDS = ["firstName", "lastName", "email", "phone"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidBooking(`${label} contient un champ non autorisé.`);
  }
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw invalidBooking(`Des informations obligatoires manquent dans ${label.toLowerCase()}.`);
  }
}

function parseString(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string") throw invalidBooking(`${label} doit être une chaîne de caractères.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || CONTROL_CHARACTER.test(normalized)) {
    throw invalidBooking(`${label} est invalide.`);
  }
  return normalized;
}

function parseOptionalString(value: unknown, label: string, maximumLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalidBooking(`${label} doit être une chaîne de caractères.`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximumLength || CONTROL_CHARACTER.test(normalized)) {
    throw invalidBooking(`${label} est invalide.`);
  }
  return normalized;
}

function parseInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidBooking(`${label} est invalide.`);
  }
  return value as number;
}

function parseIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw invalidBooking(`${label} doit respecter le format AAAA-MM-JJ.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidBooking(`${label} est invalide.`);
  }
  return date;
}

function parseGuest(value: unknown): BookingGuestInput {
  if (!isRecord(value)) throw invalidBooking("Les coordonnées du client sont invalides.");
  assertExactFields(value, GUEST_FIELDS, REQUIRED_GUEST_FIELDS, "Les coordonnées du client");

  const firstName = parseString(value.firstName, "Le prénom", 100);
  const lastName = parseString(value.lastName, "Le nom", 100);
  const email = parseString(value.email, "L'adresse email", 254).toLowerCase();
  const phone = parseString(value.phone, "Le numéro de téléphone", 30);

  if (!EMAIL.test(email)) throw invalidBooking("L'adresse email est invalide.");
  if (!PHONE.test(phone) || phone.replace(/\D/g, "").length < 7) {
    throw invalidBooking("Le numéro de téléphone est invalide.");
  }

  let countryCode: string | undefined;
  if (value.countryCode !== undefined) {
    if (typeof value.countryCode !== "string" || !COUNTRY_CODE.test(value.countryCode)) {
      throw invalidBooking("Le code pays est invalide.");
    }
    countryCode = value.countryCode.toUpperCase();
  }

  return { firstName, lastName, email, phone, ...(countryCode ? { countryCode } : {}) };
}

function parseExtraIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) {
    throw invalidBooking("La sélection d'options est invalide.");
  }
  if (value.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw invalidBooking("La sélection d'options est invalide.");
  }
  const ids = value as string[];
  if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    throw invalidBooking("Une option ne peut être sélectionnée qu'une seule fois.");
  }
  return ids;
}

export function parseBookingQuoteBody(body: unknown): BookingSelectionInput {
  if (!isRecord(body)) throw invalidBooking();
  assertExactFields(body, QUOTE_FIELDS, REQUIRED_QUOTE_FIELDS, "La demande de devis");

  if (typeof body.roomTypeId !== "string" || !UUID.test(body.roomTypeId)) {
    throw invalidBooking("Le type de chambre est invalide.");
  }

  const arrival = parseIsoDate(body.arrival, "La date d'arrivée");
  const departure = parseIsoDate(body.departure, "La date de départ");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (arrival < today) {
    throw invalidBooking("La date d'arrivée ne peut pas être dans le passé.");
  }
  const nights = (departure.getTime() - arrival.getTime()) / 86_400_000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
    throw invalidBooking("La durée du séjour doit être comprise entre 1 et 365 nuits.");
  }

  return {
    roomTypeId: body.roomTypeId,
    arrival,
    departure,
    adults: parseInteger(body.adults, "Le nombre d'adultes", 1, 10),
    children: parseInteger(body.children, "Le nombre d'enfants", 0, 10),
    extraIds: parseExtraIds(body.extraIds),
  };
}

export function parseCreateBookingBody(body: unknown): CreateBookingInput {
  if (!isRecord(body)) throw invalidBooking();
  assertExactFields(body, ROOT_FIELDS, REQUIRED_ROOT_FIELDS, "La demande de réservation");

  if (typeof body.roomTypeId !== "string" || !UUID.test(body.roomTypeId)) {
    throw invalidBooking("Le type de chambre est invalide.");
  }

  const arrival = parseIsoDate(body.arrival, "La date d'arrivée");
  const departure = parseIsoDate(body.departure, "La date de départ");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (arrival < today) {
    throw invalidBooking("La date d'arrivée ne peut pas être dans le passé.");
  }
  const nights = (departure.getTime() - arrival.getTime()) / 86_400_000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
    throw invalidBooking("La durée du séjour doit être comprise entre 1 et 365 nuits.");
  }

  const adults = parseInteger(body.adults, "Le nombre d'adultes", 1, 10);
  const children = parseInteger(body.children, "Le nombre d'enfants", 0, 10);
  const extraIds = parseExtraIds(body.extraIds);
  const expectedTotal = parseInteger(body.expectedTotal, "Le montant attendu", 0, 100_000_000);
  if (body.termsAccepted !== true) {
    throw invalidBooking("Vous devez accepter les conditions générales de vente pour réserver.");
  }
  const guest = parseGuest(body.guest);
  const specialRequests = parseOptionalString(body.specialRequests, "La demande particulière", 2_000);

  return {
    roomTypeId: body.roomTypeId,
    arrival,
    departure,
    adults,
    children,
    extraIds,
    expectedTotal,
    termsAccepted: true,
    guest,
    ...(specialRequests ? { specialRequests } : {}),
  };
}
