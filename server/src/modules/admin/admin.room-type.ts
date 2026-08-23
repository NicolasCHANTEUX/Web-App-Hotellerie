import { AdminApiError } from "./admin.errors.js";

const MAX_EMBEDDED_IMAGE_LENGTH = 600_000;
const allowedCreateFields = new Set([
  "name",
  "shortName",
  "description",
  "surfaceSqm",
  "maxAdults",
  "maxChildren",
  "maxGuests",
  "bedLabel",
  "coverImageUrl",
  "displayOrder",
  "isPublished",
  "price",
  "taxRate",
  "amenities",
]);
const allowedUpdateFields = new Set(["updatedAt", ...allowedCreateFields]);
const allowedDeleteFields = new Set(["updatedAt"]);

export type AdminRoomTypeFields = {
  name: string;
  shortName: string | null;
  description: string;
  surfaceSqm: number;
  maxAdults: number;
  maxChildren: number;
  maxGuests: number;
  bedLabel: string;
  coverImageUrl: string;
  displayOrder: number;
  isPublished: boolean;
  price: number;
  taxRate: number;
  amenities: string[];
};

export type AdminRoomTypeUpdateInput = AdminRoomTypeFields & { updatedAt: Date };
export type AdminRoomTypeDeleteInput = { updatedAt: Date };

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_ROOM_TYPE", message);
}

function strictObject(value: unknown, allowedFields: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Les informations du type de chambre sont invalides.");
  }
  const candidate = value as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n’est pas autorisé.`);
  return candidate;
}

function requiredString(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") return invalid(`${label} est obligatoire.`);
  const parsed = value.trim();
  if (parsed.length < min || parsed.length > max) {
    return invalid(`${label} doit contenir entre ${min} et ${max} caractères.`);
  }
  return parsed;
}

function optionalString(value: unknown, label: string, max: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return invalid(`${label} est invalide.`);
  const parsed = value.trim();
  if (parsed.length > max) return invalid(`${label} est limité à ${max} caractères.`);
  return parsed || null;
}

function integer(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return invalid(`${label} doit être un nombre entier compris entre ${min} et ${max}.`);
  }
  return value;
}

function decimal(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return invalid(`${label} doit être compris entre ${min} et ${max}.`);
  }
  return Math.round(value * 100) / 100;
}

function coverImage(value: unknown) {
  if (typeof value !== "string") return invalid("L’image de couverture est obligatoire.");
  const parsed = value.trim();
  if (/^https:\/\//i.test(parsed)) {
    try {
      const url = new URL(parsed);
      if (url.protocol !== "https:") throw new Error();
      if (parsed.length > 2_048) return invalid("L’adresse de l’image est trop longue.");
      return parsed;
    } catch {
      return invalid("L’adresse de l’image de couverture est invalide.");
    }
  }
  const embedded = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=]+)$/i.exec(parsed);
  if (!embedded?.[1] || !embedded[2]) {
    return invalid("L’image de couverture doit être une image JPEG, PNG ou WebP valide.");
  }
  if (parsed.length > MAX_EMBEDDED_IMAGE_LENGTH) {
    return invalid("L’image de couverture est trop volumineuse après compression.");
  }
  const bytes = Buffer.from(embedded[2], "base64");
  const mime = embedded[1].toLowerCase();
  const signatureIsValid = mime === "jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === "png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!signatureIsValid) return invalid("Le contenu de l’image de couverture est invalide.");
  return parsed;
}

function amenities(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) {
    return invalid("La liste des équipements est invalide.");
  }
  const labels = value.map((item) => requiredString(item, "Chaque équipement", 2, 60));
  const uniqueLabels = new Map<string, string>();
  for (const label of labels) {
    const key = label.toLocaleLowerCase("fr");
    if (!uniqueLabels.has(key)) uniqueLabels.set(key, label);
  }
  return [...uniqueLabels.values()];
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return invalid("La version du type de chambre est obligatoire.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return invalid("La version du type de chambre est invalide.");
  }
  return date;
}

function parseFields(candidate: Record<string, unknown>): AdminRoomTypeFields {
  const parsed = {
    name: requiredString(candidate.name, "Le nom", 3, 100),
    shortName: optionalString(candidate.shortName, "Le libellé court", 80),
    description: requiredString(candidate.description, "La description", 20, 2_000),
    surfaceSqm: integer(candidate.surfaceSqm, "La surface", 8, 250),
    maxAdults: integer(candidate.maxAdults, "Le nombre maximal d’adultes", 1, 10),
    maxChildren: integer(candidate.maxChildren, "Le nombre maximal d’enfants", 0, 10),
    maxGuests: integer(candidate.maxGuests, "La capacité totale", 1, 12),
    bedLabel: requiredString(candidate.bedLabel, "La literie", 2, 120),
    coverImageUrl: coverImage(candidate.coverImageUrl),
    displayOrder: integer(candidate.displayOrder, "L’ordre d’affichage", 0, 999),
    isPublished: typeof candidate.isPublished === "boolean"
      ? candidate.isPublished
      : invalid("L’état de publication est invalide."),
    price: decimal(candidate.price, "Le prix par nuit", 1, 10_000),
    taxRate: decimal(candidate.taxRate, "Le taux de taxe", 0, 100),
    amenities: amenities(candidate.amenities),
  };

  if (parsed.maxGuests < parsed.maxAdults || parsed.maxGuests > parsed.maxAdults + parsed.maxChildren) {
    return invalid("La capacité totale doit être comprise entre le nombre d’adultes et la capacité adultes + enfants.");
  }
  return parsed;
}

export function slugifyRoomType(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function parseAdminRoomTypeCreateBody(body: unknown) {
  return parseFields(strictObject(body, allowedCreateFields));
}

export function parseAdminRoomTypeUpdateBody(body: unknown): AdminRoomTypeUpdateInput {
  const candidate = strictObject(body, allowedUpdateFields);
  return { ...parseFields(candidate), updatedAt: timestamp(candidate.updatedAt) };
}

export function parseAdminRoomTypeDeleteBody(body: unknown): AdminRoomTypeDeleteInput {
  const candidate = strictObject(body, allowedDeleteFields);
  return { updatedAt: timestamp(candidate.updatedAt) };
}
