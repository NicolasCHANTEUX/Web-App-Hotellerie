import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { attachRoomTypeCover } from "../media/media.service.js";
import { AdminApiError } from "./admin.errors.js";
import { discountedPrice } from "../booking/booking.pricing.js";
import {
  slugifyRoomType,
  roomTypeRetirementMode,
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
  promotions: {
    where: { isActive: true },
    orderBy: [{ validFrom: "desc" as const }, { createdAt: "desc" as const }],
  },
  _count: {
    select: { rooms: true, bookingRooms: true, reservationHolds: true },
  },
} satisfies Prisma.RoomTypeInclude;

type AdminRoomTypeRecord = Prisma.RoomTypeGetPayload<{ include: typeof adminRoomTypeInclude }>;

function serializeRoomType(roomType: AdminRoomTypeRecord, canDeleteOverride?: boolean) {
  const rate = roomType.ratePlans[0];
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const promotion = roomType.promotions.find((item) => !item.validUntil || item.validUntil > today) ?? null;
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
    promotion: promotion ? {
      id: promotion.id,
      label: promotion.label,
      discountPercent: Number(promotion.discountPercent),
      referencePrice: Number(promotion.referencePricePerNight),
      promotionalPrice: Number(promotion.promotionalPricePerNight),
      validFrom: promotion.validFrom.toISOString().slice(0, 10),
      validUntil: promotion.validUntil?.toISOString().slice(0, 10) ?? null,
    } : null,
    amenities: roomType.amenities.map(({ amenity }) => amenity.label),
    roomCount: roomType._count.rooms,
    canDelete: canDeleteOverride ?? dependencies === 0,
    updatedAt: roomType.updatedAt.toISOString(),
  };
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.toISOString().slice(0, 10) === right?.toISOString().slice(0, 10);
}

async function recordRatePriceChange(
  transaction: Prisma.TransactionClient,
  ratePlanId: string,
  previousPrice: Prisma.Decimal | null,
  nextPrice: number,
  reason: string,
) {
  if (previousPrice?.equals(nextPrice)) return;
  const now = new Date();
  await transaction.ratePlanPriceHistory.updateMany({
    where: { ratePlanId, validUntil: null },
    data: { validUntil: now },
  });
  await transaction.ratePlanPriceHistory.create({
    data: {
      ratePlanId,
      price: nextPrice,
      priceTaxMode: "INCLUSIVE",
      validFrom: now,
      reason,
    },
  });
}

async function syncPromotion(
  transaction: Prisma.TransactionClient,
  membership: AdminMembershipContext,
  roomTypeId: string,
  ratePlanId: string,
  input: AdminRoomTypeFields["promotion"],
) {
  const activePromotions = await transaction.roomTypePromotion.findMany({
    where: { roomTypeId, isActive: true },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
  });
  const current = activePromotions[0] ?? null;
  if (!input) {
    if (activePromotions.length) {
      await transaction.roomTypePromotion.updateMany({
        where: { roomTypeId, isActive: true },
        data: { isActive: false },
      });
    }
    return;
  }

  if (
    current
    && current.label === input.label
    && current.discountPercent.equals(input.discountPercent)
    && sameDate(current.validFrom, input.validFrom)
    && sameDate(current.validUntil, input.validUntil)
  ) return;

  await transaction.roomTypePromotion.updateMany({
    where: { roomTypeId, isActive: true },
    data: { isActive: false },
  });

  const now = new Date();
  const referenceWindowStart = new Date(now.getTime() - 30 * 86_400_000);
  const [priceHistory, previousPromotions, ratePlan] = await Promise.all([
    transaction.ratePlanPriceHistory.findMany({
      where: {
        ratePlanId,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: referenceWindowStart } }],
      },
      select: { price: true },
    }),
    transaction.roomTypePromotion.findMany({
      where: {
        roomTypeId,
        createdAt: { gte: referenceWindowStart },
      },
      select: { promotionalPricePerNight: true },
    }),
    transaction.ratePlan.findUniqueOrThrow({ where: { id: ratePlanId } }),
  ]);
  const referencePrice = [...priceHistory.map((item) => item.price),
    ...previousPromotions.map((item) => item.promotionalPricePerNight),
    ratePlan.basePricePerNight,
  ].reduce((lowest, price) => price.lessThan(lowest) ? price : lowest);
  const promotionalPrice = discountedPrice(referencePrice, new Prisma.Decimal(input.discountPercent));

  await transaction.roomTypePromotion.create({
    data: {
      propertyId: membership.propertyId,
      roomTypeId,
      label: input.label,
      discountPercent: input.discountPercent,
      referencePricePerNight: referencePrice,
      promotionalPricePerNight: promotionalPrice,
      currency: membership.property.currency,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    },
  });
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
    where: { propertyId, archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: adminRoomTypeInclude,
  });
  const ids = roomTypes.map((roomType) => roomType.id);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const now = new Date();
  const [blockingBookings, blockingHolds] = ids.length ? await Promise.all([
    prisma.bookingRoom.findMany({
      where: {
        roomTypeId: { in: ids },
        booking: {
          status: { in: ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"] },
          checkOut: { gte: today },
        },
      },
      distinct: ["roomTypeId"],
      select: { roomTypeId: true },
    }),
    prisma.reservationHold.findMany({
      where: { roomTypeId: { in: ids }, status: "ACTIVE", expiresAt: { gt: now } },
      distinct: ["roomTypeId"],
      select: { roomTypeId: true },
    }),
  ]) : [[], []];
  const blockedIds = new Set([
    ...blockingBookings.map((item) => item.roomTypeId),
    ...blockingHolds.map((item) => item.roomTypeId),
  ]);
  return roomTypes.map((roomType) => serializeRoomType(roomType, !blockedIds.has(roomType.id)));
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

      const ratePlan = await transaction.ratePlan.create({
        data: {
          propertyId: membership.propertyId,
          roomTypeId: roomType.id,
          code: rateCode(slug),
          name: "Tarif flexible",
          basePricePerNight: input.price,
          priceTaxMode: "INCLUSIVE",
          currency: membership.property.currency,
          taxRate: input.taxRate,
        },
      });
      await recordRatePriceChange(transaction, ratePlan.id, null, input.price, "ROOM_TYPE_CREATED");
      await syncPromotion(transaction, membership, roomType.id, ratePlan.id, input.promotion);
      await replaceAmenities(transaction, membership.propertyId, roomType.id, input.amenities);
      await attachRoomTypeCover(transaction, membership.propertyId, roomType.id, input.coverImageFileId);

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
      where: { id: roomTypeId, propertyId: membership.propertyId, archivedAt: null },
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
    let ratePlanId: string;
    if (rate) {
      await transaction.ratePlan.update({
        where: { id: rate.id },
        data: { basePricePerNight: input.price, priceTaxMode: "INCLUSIVE", taxRate: input.taxRate },
      });
      await recordRatePriceChange(transaction, rate.id, rate.basePricePerNight, input.price, "ADMIN_UPDATE");
      ratePlanId = rate.id;
    } else {
      const createdRate = await transaction.ratePlan.create({
        data: {
          propertyId: membership.propertyId,
          roomTypeId: current.id,
          code: rateCode(current.slug),
          name: "Tarif flexible",
          basePricePerNight: input.price,
          priceTaxMode: "INCLUSIVE",
          currency: membership.property.currency,
          taxRate: input.taxRate,
        },
      });
      await recordRatePriceChange(transaction, createdRate.id, null, input.price, "ADMIN_CREATE");
      ratePlanId = createdRate.id;
    }
    await syncPromotion(transaction, membership, current.id, ratePlanId, input.promotion);
    await replaceAmenities(transaction, membership.propertyId, current.id, input.amenities);
    await attachRoomTypeCover(transaction, membership.propertyId, current.id, input.coverImageFileId);

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
      where: { id: roomTypeId, propertyId: membership.propertyId, archivedAt: null },
      include: adminRoomTypeInclude,
    });
    if (!roomType) throw new AdminApiError(404, "ROOM_TYPE_NOT_FOUND", "Type de chambre introuvable.");
    if (roomType.updatedAt.getTime() !== input.updatedAt.getTime()) {
      throw new AdminApiError(409, "ROOM_TYPE_VERSION_CONFLICT", "Ce type de chambre a été modifié. Rechargez-le avant de réessayer.");
    }
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const now = new Date();
    const [blockingBookings, blockingHolds] = await Promise.all([
      transaction.bookingRoom.count({
        where: {
          roomTypeId: roomType.id,
          booking: {
            status: { in: ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN"] },
            checkOut: { gte: today },
          },
        },
      }),
      transaction.reservationHold.count({
        where: { roomTypeId: roomType.id, status: "ACTIVE", expiresAt: { gt: now } },
      }),
    ]);
    const dependencies = roomType._count.rooms + roomType._count.bookingRooms + roomType._count.reservationHolds;
    const retirementMode = roomTypeRetirementMode({ blockingBookings, blockingHolds, dependencies });
    if (retirementMode === "BLOCKED") {
      throw new AdminApiError(409, "ROOM_TYPE_HAS_FUTURE_STAYS", "Ce type possède encore une réservation future ou une option active.");
    }

    if (retirementMode === "DELETE") {
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
      return { id: roomType.id, archived: false };
    }

    await transaction.ratePlan.updateMany({ where: { roomTypeId: roomType.id }, data: { isActive: false } });
    await transaction.roomTypePromotion.updateMany({ where: { roomTypeId: roomType.id, isActive: true }, data: { isActive: false } });
    await transaction.roomType.update({
      where: { id: roomType.id },
      data: { isPublished: false, archivedAt: now },
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "ROOM_TYPE_ARCHIVED",
        entityType: "RoomType",
        entityId: roomType.id,
        before: auditSnapshot(roomType),
        after: { archivedAt: now.toISOString(), isPublished: false },
        metadata: { role: membership.role, source: "ADMIN_ROOM_TYPE_ARCHIVE" },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return { id: roomType.id, archived: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
