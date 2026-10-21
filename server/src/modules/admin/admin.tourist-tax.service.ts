import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { catalogCodeFromName, nextAvailableCode } from "./admin.catalog.js";
import { AdminApiError } from "./admin.errors.js";
import type {
  AdminTouristTaxDeleteInput,
  AdminTouristTaxFields,
  AdminTouristTaxUpdateInput,
} from "./admin.tourist-tax.js";

const touristTaxInclude = {
  _count: { select: { taxLines: true } },
} satisfies Prisma.TaxRuleInclude;

type TouristTaxRecord = Prisma.TaxRuleGetPayload<{ include: typeof touristTaxInclude }>;

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function serializeTouristTax(rule: TouristTaxRecord) {
  return {
    id: rule.id,
    code: rule.code,
    label: rule.label,
    calculationMode: rule.calculationMode,
    amount: rule.amount === null ? null : Number(rule.amount),
    rate: rule.rate === null ? null : Number(rule.rate),
    currency: rule.currency,
    validFrom: dateOnly(rule.validFrom),
    validUntil: dateOnly(rule.validUntil),
    isActive: rule.isActive,
    usageCount: rule._count.taxLines,
    // Bookings keep their own amounts; a used rule stays for the history and
    // is ended with a last night or deactivated instead.
    canDelete: rule._count.taxLines === 0,
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function auditSnapshot(rule: TouristTaxRecord) {
  const { usageCount: _usageCount, canDelete: _canDelete, ...snapshot } = serializeTouristTax(rule);
  return snapshot;
}

function ruleData(input: AdminTouristTaxFields) {
  return {
    label: input.label,
    calculationMode: input.calculationMode,
    amount: input.amount,
    rate: input.rate,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    isActive: input.isActive,
  };
}

async function findTouristTax(transaction: Prisma.TransactionClient, propertyId: string, ruleId: string, updatedAt: Date) {
  const rule = await transaction.taxRule.findFirst({
    where: { id: ruleId, propertyId, kind: "TOURIST_TAX" },
    include: touristTaxInclude,
  });
  if (!rule) throw new AdminApiError(404, "TOURIST_TAX_NOT_FOUND", "Taxe de séjour introuvable.");
  if (rule.updatedAt.getTime() !== updatedAt.getTime()) {
    throw new AdminApiError(409, "TOURIST_TAX_VERSION_CONFLICT", "Cette taxe a été modifiée entre-temps. Rechargez-la avant de réessayer.");
  }
  return rule;
}

export async function listAdminTouristTaxes(propertyId: string) {
  const rules = await prisma.taxRule.findMany({
    where: { propertyId, kind: "TOURIST_TAX" },
    orderBy: [{ validFrom: { sort: "asc", nulls: "first" } }, { label: "asc" }],
    include: touristTaxInclude,
  });
  return rules.map(serializeTouristTax);
}

export async function createAdminTouristTax(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminTouristTaxFields,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const base = catalogCodeFromName(input.label);
    if (!base) throw new AdminApiError(400, "INVALID_TOURIST_TAX", "Le libellé doit contenir au moins une lettre ou un chiffre.");
    const taken = await transaction.taxRule.findMany({
      where: { propertyId: membership.propertyId, code: { startsWith: base } },
      select: { code: true },
    });
    const created = await transaction.taxRule.create({
      data: {
        propertyId: membership.propertyId,
        code: nextAvailableCode(base, new Set(taken.map((rule) => rule.code))),
        kind: "TOURIST_TAX",
        currency: membership.property.currency,
        ...ruleData(input),
      },
      include: touristTaxInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "TOURIST_TAX_CREATED",
        entityType: "TaxRule",
        entityId: created.id,
        before: Prisma.DbNull,
        after: auditSnapshot(created),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeTouristTax(created);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateAdminTouristTax(
  membership: AdminMembershipContext,
  adminUserId: string,
  ruleId: string,
  input: AdminTouristTaxUpdateInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const current = await findTouristTax(transaction, membership.propertyId, ruleId, input.updatedAt);
    // Bookings keep their tax lines: a change only applies to new requests.
    const updated = await transaction.taxRule.update({
      where: { id: current.id },
      data: ruleData(input),
      include: touristTaxInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "TOURIST_TAX_UPDATED",
        entityType: "TaxRule",
        entityId: current.id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeTouristTax(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteAdminTouristTax(
  membership: AdminMembershipContext,
  adminUserId: string,
  ruleId: string,
  input: AdminTouristTaxDeleteInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const rule = await findTouristTax(transaction, membership.propertyId, ruleId, input.updatedAt);
    if (rule._count.taxLines > 0) {
      throw new AdminApiError(409, "TOURIST_TAX_IN_USE", "Cette taxe a déjà été facturée : fixez sa dernière nuit ou désactivez-la plutôt que de la supprimer.");
    }
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "TOURIST_TAX_DELETED",
        entityType: "TaxRule",
        entityId: rule.id,
        before: auditSnapshot(rule),
        after: Prisma.DbNull,
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    await transaction.taxRule.delete({ where: { id: rule.id } });
    return { id: rule.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
