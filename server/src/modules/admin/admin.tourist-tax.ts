import { TaxCalculationMode } from "../../generated/prisma/client.js";
import { AdminApiError } from "./admin.errors.js";

const editableFields = ["label", "calculationMode", "amount", "rate", "validFrom", "validUntil", "isActive"] as const;
const allowedCreateFields = new Set<string>(editableFields);
const allowedUpdateFields = new Set<string>(["updatedAt", ...editableFields]);
const allowedDeleteFields = new Set<string>(["updatedAt"]);

export type AdminTouristTaxFields = {
  label: string;
  calculationMode: TaxCalculationMode;
  /** Fixed amount, for every mode except PERCENTAGE. */
  amount: number | null;
  /** Percentage of the accommodation price, for PERCENTAGE only. */
  rate: number | null;
  /** First and last nights in force, both included; null means unbounded. */
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
};

export type AdminTouristTaxUpdateInput = AdminTouristTaxFields & { updatedAt: Date };
export type AdminTouristTaxDeleteInput = { updatedAt: Date };

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_TOURIST_TAX", message);
}

function strictObject(value: unknown, allowedFields: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("Les informations de la taxe sont invalides.");
  }
  const candidate = value as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedFields.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n'est pas autorisé.`);
  return candidate;
}

function decimal(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return invalid(`${label} doit être compris entre ${min} et ${max}.`);
  }
  return Math.round(value * 100) / 100;
}

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalid(`${label} doit respecter le format AAAA-MM-JJ.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return invalid(`${label} est invalide.`);
  return date;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return invalid("La version de la taxe est obligatoire.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return invalid("La version de la taxe est invalide.");
  return date;
}

function absent(value: unknown) {
  return value === null || value === undefined;
}

function parseFields(candidate: Record<string, unknown>): AdminTouristTaxFields {
  if (typeof candidate.label !== "string" || candidate.label.trim().length < 2 || candidate.label.trim().length > 80) {
    return invalid("Le libellé doit contenir entre 2 et 80 caractères.");
  }
  const calculationMode = candidate.calculationMode;
  if (typeof calculationMode !== "string" || !Object.values(TaxCalculationMode).includes(calculationMode as TaxCalculationMode)) {
    return invalid("Le mode de calcul est invalide.");
  }
  const percentage = calculationMode === TaxCalculationMode.PERCENTAGE;
  if (percentage ? !absent(candidate.amount) : !absent(candidate.rate)) {
    return invalid(percentage
      ? "Une taxe en pourcentage se définit par un taux, sans montant."
      : "Une taxe à montant fixe se définit par un montant, sans taux.");
  }
  const validFrom = optionalDate(candidate.validFrom, "La première nuit");
  const validUntil = optionalDate(candidate.validUntil, "La dernière nuit");
  if (validFrom && validUntil && validUntil < validFrom) {
    return invalid("La dernière nuit doit être postérieure ou égale à la première.");
  }
  if (typeof candidate.isActive !== "boolean") return invalid("L'état de la taxe est invalide.");
  return {
    label: candidate.label.trim(),
    calculationMode: calculationMode as TaxCalculationMode,
    amount: percentage ? null : decimal(candidate.amount, "Le montant", 0.01, 100),
    rate: percentage ? decimal(candidate.rate, "Le taux", 0.01, 100) : null,
    validFrom,
    validUntil,
    isActive: candidate.isActive,
  };
}

export function parseAdminTouristTaxCreateBody(body: unknown) {
  return parseFields(strictObject(body, allowedCreateFields));
}

export function parseAdminTouristTaxUpdateBody(body: unknown): AdminTouristTaxUpdateInput {
  const candidate = strictObject(body, allowedUpdateFields);
  return { ...parseFields(candidate), updatedAt: timestamp(candidate.updatedAt) };
}

export function parseAdminTouristTaxDeleteBody(body: unknown): AdminTouristTaxDeleteInput {
  return { updatedAt: timestamp(strictObject(body, allowedDeleteFields).updatedAt) };
}
