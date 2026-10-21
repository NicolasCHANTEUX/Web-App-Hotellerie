import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import type { AdminPropertyUpdateInput } from "./admin.property.js";

const propertySettingsSelect = {
  id: true,
  slug: true,
  name: true,
  legalName: true,
  email: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  city: true,
  countryCode: true,
  timezone: true,
  currency: true,
  checkInTime: true,
  checkOutTime: true,
  legalForm: true,
  shareCapital: true,
  siret: true,
  registrationCity: true,
  vatNumber: true,
  publicationDirector: true,
  hostingProvider: true,
  mediator: true,
  updatedAt: true,
} satisfies Prisma.PropertySelect;

type PropertySettingsRecord = Prisma.PropertyGetPayload<{ select: typeof propertySettingsSelect }>;

function serializeSettings(property: PropertySettingsRecord) {
  return { ...property, updatedAt: property.updatedAt.toISOString() };
}

export async function getAdminPropertySettings(propertyId: string) {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: propertySettingsSelect });
  if (!property) throw new AdminApiError(404, "PROPERTY_NOT_FOUND", "Établissement introuvable.");
  return serializeSettings(property);
}

export async function updateAdminPropertySettings(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminPropertyUpdateInput,
  ipAddress?: string,
) {
  const { updatedAt, ...settings } = input;
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.property.findUnique({ where: { id: membership.propertyId }, select: propertySettingsSelect });
    if (!current) throw new AdminApiError(404, "PROPERTY_NOT_FOUND", "Établissement introuvable.");
    if (current.updatedAt.getTime() !== updatedAt.getTime()) {
      throw new AdminApiError(409, "PROPERTY_VERSION_CONFLICT", "Les informations ont été modifiées entre-temps. Rechargez la page avant de réessayer.");
    }
    // Invoices and bookings keep their own copy: changes only apply from now on.
    const updated = await transaction.property.update({
      where: { id: current.id },
      data: settings,
      select: propertySettingsSelect,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "PROPERTY_UPDATED",
        entityType: "Property",
        entityId: current.id,
        before: serializeSettings(current),
        after: serializeSettings(updated),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeSettings(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
