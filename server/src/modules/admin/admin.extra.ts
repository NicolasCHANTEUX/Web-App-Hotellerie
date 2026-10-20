import { PricingUnit } from "../../generated/prisma/client.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";

const editableFields = ["name", "description", "price", "pricingUnit", "taxRate", "isActive", "displayOrder"] as const;
const allowedCreateFields = new Set<string>(editableFields);
const allowedUpdateFields = new Set<string>(["updatedAt", ...editableFields]);
const allowedDeleteFields = new Set<string>(["updatedAt"]);

export type AdminExtraFields = {
  name: string;
  description: string;
  price: number;
  pricingUnit: PricingUnit;
  taxRate: number;
  isActive: boolean;
  displayOrder: number;
};

export type AdminExtraUpdateInput = AdminExtraFields & { updatedAt: Date };
export type AdminExtraDeleteInput = { updatedAt: Date };

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_EXTRA", message);
}

function strictObject(value: unknown, allowedFields: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Les informations de l'option sont invalides.");
  }
  const candidate = value as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n'est pas autorisé.`);
  return candidate;
}

function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") return invalid(`${label} est obligatoire.`);
  const parsed = value.trim();
  if (parsed.length < min || parsed.length > max) {
    return invalid(min > 0
      ? `${label} doit contenir entre ${min} et ${max} caractères.`
      : `${label} est limitée à ${max} caractères.`);
  }
  return parsed;
}

function decimal(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return invalid(`${label} doit être compris entre ${min} et ${max}.`);
  }
  return Math.round(value * 100) / 100;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return invalid("La version de l'option est obligatoire.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return invalid("La version de l'option est invalide.");
  }
  return date;
}

function parseFields(candidate: Record<string, unknown>): AdminExtraFields {
  if (typeof candidate.pricingUnit !== "string" || !Object.values(PricingUnit).includes(candidate.pricingUnit as PricingUnit)) {
    return invalid("L'unité de tarification est invalide.");
  }
  const displayOrder = candidate.displayOrder;
  if (typeof displayOrder !== "number" || !Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 999) {
    return invalid("L'ordre d'affichage doit être un nombre entier compris entre 0 et 999.");
  }
  if (typeof candidate.isActive !== "boolean") return invalid("L'état de l'option est invalide.");
  return {
    name: text(candidate.name, "Le nom", 2, 80),
    description: text(candidate.description, "La description", 0, 300),
    price: decimal(candidate.price, "Le prix TTC", 0, 10_000),
    pricingUnit: candidate.pricingUnit as PricingUnit,
    taxRate: decimal(candidate.taxRate, "Le taux de TVA", 0, 100),
    isActive: candidate.isActive,
    displayOrder,
  };
}

/**
 * Stable identifier stored with the option, derived from its first name. It
 * never changes afterwards, so that renaming an option keeps its history.
 */
export function extraCodeFromName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function requireCatalogPermission(membership: AdminMembershipContext) {
  if (membership.role !== "ADMIN") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de gérer le catalogue.");
  }
  return membership;
}

export function parseAdminExtraCreateBody(body: unknown) {
  return parseFields(strictObject(body, allowedCreateFields));
}

export function parseAdminExtraUpdateBody(body: unknown): AdminExtraUpdateInput {
  const candidate = strictObject(body, allowedUpdateFields);
  return { ...parseFields(candidate), updatedAt: timestamp(candidate.updatedAt) };
}

export function parseAdminExtraDeleteBody(body: unknown): AdminExtraDeleteInput {
  return { updatedAt: timestamp(strictObject(body, allowedDeleteFields).updatedAt) };
}
