import { AdminApiError } from "./admin.errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const editableFields = ["label", "validFrom", "validUntil", "minNights", "rates"] as const;
const allowedCreateFields = new Set<string>(editableFields);
const allowedUpdateFields = new Set<string>(["updatedAt", ...editableFields]);
const allowedDeleteFields = new Set<string>(["updatedAt"]);
const allowedRateFields = new Set(["roomTypeId", "nightlyPrice", "weekendNightlyPrice"]);

export type AdminSeasonRateInput = {
  roomTypeId: string;
  nightlyPrice: number;
  weekendNightlyPrice: number | null;
};

export type AdminSeasonFields = {
  label: string;
  /** First and last nights of the season, both included. */
  validFrom: Date;
  validUntil: Date;
  minNights: number | null;
  /** Room types without a rate keep their base price during the season. */
  rates: AdminSeasonRateInput[];
};

export type AdminSeasonUpdateInput = AdminSeasonFields & { updatedAt: Date };
export type AdminSeasonDeleteInput = { updatedAt: Date };

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_SEASON", message);
}

function strictObject(value: unknown, allowedFields: Set<string>, label = "Les informations de la saison") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`${label} sont invalides.`);
  const candidate = value as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n'est pas autorisé.`);
  return candidate;
}

function night(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid(`${label} doit respecter le format AAAA-MM-JJ.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return invalid(`${label} est invalide.`);
  return date;
}

function price(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 10_000) {
    return invalid(`${label} doit être compris entre 1 et 10 000.`);
  }
  return Math.round(value * 100) / 100;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return invalid("La version de la saison est obligatoire.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return invalid("La version de la saison est invalide.");
  return date;
}

function rates(value: unknown): AdminSeasonRateInput[] {
  if (!Array.isArray(value) || value.length > 100) return invalid("La grille de prix est invalide.");
  const seen = new Set<string>();
  return value.map((item) => {
    const rate = strictObject(item, allowedRateFields, "Les prix d'un type de chambre");
    if (typeof rate.roomTypeId !== "string" || !UUID.test(rate.roomTypeId)) return invalid("Un type de chambre de la grille est invalide.");
    const roomTypeId = rate.roomTypeId.toLowerCase();
    if (seen.has(roomTypeId)) return invalid("Un type de chambre figure deux fois dans la grille.");
    seen.add(roomTypeId);
    return {
      roomTypeId,
      nightlyPrice: price(rate.nightlyPrice, "Le prix par nuit"),
      weekendNightlyPrice: rate.weekendNightlyPrice === null || rate.weekendNightlyPrice === undefined
        ? null
        : price(rate.weekendNightlyPrice, "Le prix du week-end"),
    };
  });
}

function parseFields(candidate: Record<string, unknown>): AdminSeasonFields {
  if (typeof candidate.label !== "string" || candidate.label.trim().length < 2 || candidate.label.trim().length > 60) {
    return invalid("Le nom de la saison doit contenir entre 2 et 60 caractères.");
  }
  const validFrom = night(candidate.validFrom, "La première nuit");
  const validUntil = night(candidate.validUntil, "La dernière nuit");
  if (validUntil < validFrom) return invalid("La dernière nuit doit être postérieure ou égale à la première.");
  const minNights = candidate.minNights;
  if (minNights !== null && minNights !== undefined && (typeof minNights !== "number" || !Number.isInteger(minNights) || minNights < 1 || minNights > 30)) {
    return invalid("La durée minimale doit être un nombre de nuits entre 1 et 30.");
  }
  return {
    label: candidate.label.trim(),
    validFrom,
    validUntil,
    minNights: typeof minNights === "number" ? minNights : null,
    rates: rates(candidate.rates),
  };
}

export function parseAdminSeasonCreateBody(body: unknown) {
  return parseFields(strictObject(body, allowedCreateFields));
}

export function parseAdminSeasonUpdateBody(body: unknown): AdminSeasonUpdateInput {
  const candidate = strictObject(body, allowedUpdateFields);
  return { ...parseFields(candidate), updatedAt: timestamp(candidate.updatedAt) };
}

export function parseAdminSeasonDeleteBody(body: unknown): AdminSeasonDeleteInput {
  return { updatedAt: timestamp(strictObject(body, allowedDeleteFields).updatedAt) };
}
