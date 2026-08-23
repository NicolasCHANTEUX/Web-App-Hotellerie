import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import {
  slugifyRoomType,
  type AdminRoomTypeDeleteInput,
  type AdminRoomTypeFields,
  type AdminRoomTypeUpdateInput,
} from "./admin.room-type.js";

const adminRoomTypeInclude = {
  amenities: {
    orderBy: { sortOrder: "asc" as const },
    include: { amenity: { select: { label: true } } },
  },
  ratePlans: {
    where: { isActive: true },
    orderBy: [{ basePricePerNight: "asc" as const }, { createdAt: "asc" as const }],
  },
  _count: {
    select: { rooms: true, bookingRooms: true, reservationHolds: true },
  },
} satisfies Prisma.RoomTypeInclude;

type AdminRoomTypeRecord = Prisma.RoomTypeGetPayload<{ include: typeof adminRoomTypeInclude }>;

function serializeRoomType(roomType: AdminRoomTypeRecord) {
  const rate = roomType.ratePlans[0];
  const dependencies = roomType._count.rooms + roomType._count.bookingRooms + roomType._count.reservationHolds;
  return {
    id: roomType.id,
    slug: roomType.slug,
    name: roomType.name,
    shortName: roomType.shortName,
    description: roomType.description,
    surfaceSqm: roomType.surfaceSqm,
    maxAdults: roomType.maxAdults,
    maxChildren: roomType.maxChildren,
    maxGuests: roomType.maxGuests,
    bedLabel: roomType.bedLabel,
    coverImageUrl: roomType.coverImageUrl,
    displayOrder: roomType.displayOrder,
    isPublished: roomType.isPublished,
    price: rate ? Number(rate.basePricePerNight) : 0,
    currency: rate?.currency ?? "EUR",
    taxRate: rate ? Number(rate.taxRate) : 10,
    refundable: rate?.refundable ?? true,
    amenities: roomType.amenities.map(({ amenity }) => amenity.label),
    roomCount: roomType._count.rooms,
    canDelete: dependencies === 0,
    updatedAt: roomType.updatedAt.toISOString(),
  };
}

function auditImage(value: string) {
  return value.startsWith("data:image/") ? "[image intégrée]" : value;
}

function auditSnapshot(roomType: AdminRoomTypeRecord) {
  const serialized = serializeRoomType(roomType);
  return { ...serialized, coverImageUrl: auditImage(serialized.coverImageUrl) };
}

function rateCode(slug: string) {
  return `WEB_${slug.replaceAll("-", "_").toUpperCase()}`;
}

async function replaceAmenities(
  transaction: Prisma.TransactionClient,
  propertyId: string,
  roomTypeId: string,
  labels: string[],
) {
  await transaction.roomTypeAmenity.deleteMany({ where: { roomTypeId } });
  for (const [sortOrder, label] of labels.entries()) {
    const slug = slugifyRoomType(label);
    const amenity = await transaction.amenity.upsert({
      where: { propertyId_slug: { propertyId, slug } },
      update: { label },
      create: { propertyId, slug, label },
      select: { id: true },
    });
    await transaction.roomTypeAmenity.create({
      data: { roomTypeId, amenityId: amenity.id, featured: true, sortOrder },
    });
  }
}

function roomTypeData(input: AdminRoomTypeFields) {
  return {
    name: input.name,
    shortName: input.shortName,
    description: input.description,
    surfaceSqm: input.surfaceSqm,
    maxAdults: input.maxAdults,
    maxChildren: input.maxChildren,
    maxGuests: input.maxGuests,
    bedLabel: input.bedLabel,
    coverImageUrl: input.coverImageUrl,
    displayOrder: input.displayOrder,
    isPublished: input.isPublished,
  };
}

function galleryWithCover(value: unknown, previousCover: string, nextCover: string) {
  const gallery = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return [nextCover, ...gallery.filter((image) => image !== previousCover && image !== nextCover)];
}

export async function listAdminRoomTypes(propertyId: string) {
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: adminRoomTypeInclude,
  });
  return roomTypes.map(serializeRoomType);
}

export async function createAdminRoomType(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminRoomTypeFields,
  ipAddress?: string,
) {
  const slug = slugifyRoomType(input.name);
  if (!slug) throw new AdminApiError(400, "INVALID_ROOM_TYPE", "Le nom ne permet pas de créer une adresse valide.");

  try {
    return await prisma.$transaction(async (transaction) => {
      const roomType = await transaction.roomType.create({
        data: {
          propertyId: membership.propertyId,
          slug,
          ...roomTypeData(input),
          gallery: [input.coverImageUrl],
        },
        include: adminRoomTypeInclude,
      });

      await transaction.ratePlan.create({
        data: {
          propertyId: membership.propertyId,
          roomTypeId: roomType.id,
          code: rateCode(slug),
          name: "Tarif flexible",
          basePricePerNight: input.price,
          currency: membership.property.currency,
          taxRate: input.taxRate,
        },
      });
      await replaceAmenities(transaction, membership.propertyId, roomType.id, input.amenities);

      const created = await transaction.roomType.findUniqueOrThrow({
        where: { id: roomType.id },
        include: adminRoomTypeInclude,
      });
      await transaction.auditLog.create({
        data: {
          propertyId: membership.propertyId,
          adminUserId,
          action: "ROOM_TYPE_CREATED",
          entityType: "RoomType",
          entityId: created.id,
          before: Prisma.DbNull,
          after: auditSnapshot(created),
          metadata: { role: membership.role, source: "ADMIN_ROOM_TYPE_CREATE" },
          ...(ipAddress ? { ipAddress } : {}),
        },
      });
      return serializeRoomType(created);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
      throw new AdminApiError(409, "ROOM_TYPE_NAME_CONFLICT", "Un type de chambre portant ce nom existe déjà.");
    }
    throw error;
  }
}

export async function updateAdminRoomType(
  membership: AdminMembershipContext,
  adminUserId: string,
  roomTypeId: string,
  input: AdminRoomTypeUpdateInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.roomType.findFirst({
      where: { id: roomTypeId, propertyId: membership.propertyId },
      include: adminRoomTypeInclude,
    });
    if (!current) throw new AdminApiError(404, "ROOM_TYPE_NOT_FOUND", "Type de chambre introuvable.");
    if (current.updatedAt.getTime() !== input.updatedAt.getTime()) {
      throw new AdminApiError(409, "ROOM_TYPE_VERSION_CONFLICT", "Ce type de chambre a été modifié. Rechargez-le avant de réessayer.");
    }

    await transaction.roomType.update({
      where: { id: current.id },
      data: {
        ...roomTypeData(input),
        gallery: galleryWithCover(current.gallery, current.coverImageUrl, input.coverImageUrl),
      },
    });

    const rate = current.ratePlans[0];
    if (rate) {
      await transaction.ratePlan.update({
        where: { id: rate.id },
        data: { basePricePerNight: input.price, taxRate: input.taxRate },
      });
    } else {
      await transaction.ratePlan.create({
        data: {
          propertyId: membership.propertyId,
          roomTypeId: current.id,
          code: rateCode(current.slug),
          name: "Tarif flexible",
          basePricePerNight: input.price,
          currency: membership.property.currency,
          taxRate: input.taxRate,
        },
      });
    }
    await replaceAmenities(transaction, membership.propertyId, current.id, input.amenities);

    const updated = await transaction.roomType.findUniqueOrThrow({
      where: { id: current.id },
      include: adminRoomTypeInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "ROOM_TYPE_UPDATED",
        entityType: "RoomType",
        entityId: current.id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        metadata: { role: membership.role, source: "ADMIN_ROOM_TYPE_UPDATE" },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeRoomType(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteAdminRoomType(
  membership: AdminMembershipContext,
  adminUserId: string,
  roomTypeId: string,
  input: AdminRoomTypeDeleteInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const roomType = await transaction.roomType.findFirst({
      where: { id: roomTypeId, propertyId: membership.propertyId },
      include: adminRoomTypeInclude,
    });
    if (!roomType) throw new AdminApiError(404, "ROOM_TYPE_NOT_FOUND", "Type de chambre introuvable.");
    if (roomType.updatedAt.getTime() !== input.updatedAt.getTime()) {
      throw new AdminApiError(409, "ROOM_TYPE_VERSION_CONFLICT", "Ce type de chambre a été modifié. Rechargez-le avant de réessayer.");
    }
    if (!serializeRoomType(roomType).canDelete) {
      throw new AdminApiError(409, "ROOM_TYPE_IN_USE", "Ce type est lié à des chambres ou à un historique de réservation. Dépubliez-le plutôt que de le supprimer.");
    }

    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "ROOM_TYPE_DELETED",
        entityType: "RoomType",
        entityId: roomType.id,
        before: auditSnapshot(roomType),
        after: Prisma.DbNull,
        metadata: { role: membership.role, source: "ADMIN_ROOM_TYPE_DELETE" },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    await transaction.roomType.delete({ where: { id: roomType.id } });
    return { id: roomType.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
