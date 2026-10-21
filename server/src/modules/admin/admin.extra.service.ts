import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { catalogCodeFromName, nextAvailableCode } from "./admin.catalog.js";
import { AdminApiError } from "./admin.errors.js";
import {
  type AdminExtraDeleteInput,
  type AdminExtraFields,
  type AdminExtraUpdateInput,
} from "./admin.extra.js";

const adminExtraInclude = {
  _count: { select: { bookingExtras: true } },
} satisfies Prisma.ExtraInclude;

type AdminExtraRecord = Prisma.ExtraGetPayload<{ include: typeof adminExtraInclude }>;

function serializeExtra(extra: AdminExtraRecord) {
  return {
    id: extra.id,
    code: extra.code,
    name: extra.name,
    description: extra.description,
    price: Number(extra.price),
    currency: extra.currency,
    pricingUnit: extra.pricingUnit,
    taxRate: extra.taxRate === null ? null : Number(extra.taxRate),
    isActive: extra.isActive,
    displayOrder: extra.displayOrder,
    bookingCount: extra._count.bookingExtras,
    // Booked options stay referenced by their bookings: they can only be deactivated.
    canDelete: extra._count.bookingExtras === 0,
    updatedAt: extra.updatedAt.toISOString(),
  };
}

function auditSnapshot(extra: AdminExtraRecord) {
  const { bookingCount: _bookingCount, canDelete: _canDelete, ...snapshot } = serializeExtra(extra);
  return snapshot;
}

function extraData(input: AdminExtraFields) {
  return {
    name: input.name,
    description: input.description,
    price: input.price,
    pricingUnit: input.pricingUnit,
    taxRate: input.taxRate,
    isActive: input.isActive,
    displayOrder: input.displayOrder,
  };
}

async function assertNameAvailable(transaction: Prisma.TransactionClient, propertyId: string, name: string, exceptId?: string) {
  const duplicate = await transaction.extra.findFirst({
    where: { propertyId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (duplicate) throw new AdminApiError(409, "EXTRA_NAME_CONFLICT", "Une option porte déjà ce nom.");
}

async function availableCode(transaction: Prisma.TransactionClient, propertyId: string, name: string) {
  const base = catalogCodeFromName(name);
  if (!base) throw new AdminApiError(400, "INVALID_EXTRA", "Le nom doit contenir au moins une lettre ou un chiffre.");
  const taken = await transaction.extra.findMany({
    where: { propertyId, code: { startsWith: base } },
    select: { code: true },
  });
  return nextAvailableCode(base, new Set(taken.map((extra) => extra.code)));
}

async function findExtra(transaction: Prisma.TransactionClient, propertyId: string, extraId: string, updatedAt: Date) {
  const extra = await transaction.extra.findFirst({
    where: { id: extraId, propertyId },
    include: adminExtraInclude,
  });
  if (!extra) throw new AdminApiError(404, "EXTRA_NOT_FOUND", "Option introuvable.");
  if (extra.updatedAt.getTime() !== updatedAt.getTime()) {
    throw new AdminApiError(409, "EXTRA_VERSION_CONFLICT", "Cette option a été modifiée entre-temps. Rechargez-la avant de réessayer.");
  }
  return extra;
}

export async function listAdminExtras(propertyId: string) {
  const extras = await prisma.extra.findMany({
    where: { propertyId },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: adminExtraInclude,
  });
  return extras.map(serializeExtra);
}

export async function createAdminExtra(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminExtraFields,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    await assertNameAvailable(transaction, membership.propertyId, input.name);
    const created = await transaction.extra.create({
      data: {
        propertyId: membership.propertyId,
        code: await availableCode(transaction, membership.propertyId, input.name),
        currency: membership.property.currency,
        priceTaxMode: "INCLUSIVE",
        ...extraData(input),
      },
      include: adminExtraInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "EXTRA_CREATED",
        entityType: "Extra",
        entityId: created.id,
        before: Prisma.DbNull,
        after: auditSnapshot(created),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeExtra(created);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateAdminExtra(
  membership: AdminMembershipContext,
  adminUserId: string,
  extraId: string,
  input: AdminExtraUpdateInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const current = await findExtra(transaction, membership.propertyId, extraId, input.updatedAt);
    await assertNameAvailable(transaction, membership.propertyId, input.name, current.id);
    // Bookings keep their own snapshot: a new price only applies to new requests.
    const updated = await transaction.extra.update({
      where: { id: current.id },
      data: extraData(input),
      include: adminExtraInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "EXTRA_UPDATED",
        entityType: "Extra",
        entityId: current.id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeExtra(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteAdminExtra(
  membership: AdminMembershipContext,
  adminUserId: string,
  extraId: string,
  input: AdminExtraDeleteInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const extra = await findExtra(transaction, membership.propertyId, extraId, input.updatedAt);
    if (extra._count.bookingExtras > 0) {
      throw new AdminApiError(409, "EXTRA_IN_USE", "Cette option figure dans des réservations : désactivez-la plutôt que de la supprimer.");
    }
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "EXTRA_DELETED",
        entityType: "Extra",
        entityId: extra.id,
        before: auditSnapshot(extra),
        after: Prisma.DbNull,
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    await transaction.extra.delete({ where: { id: extra.id } });
    return { id: extra.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
