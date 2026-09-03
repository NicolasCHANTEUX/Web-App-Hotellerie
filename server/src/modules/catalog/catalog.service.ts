import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

const roomTypeInclude = {
  amenities: {
    orderBy: { sortOrder: "asc" as const },
    include: { amenity: true },
  },
  ratePlans: {
    where: { isActive: true, priceTaxMode: "INCLUSIVE" as const },
    orderBy: { basePricePerNight: "asc" as const },
  },
  promotions: {
    where: { isActive: true },
    orderBy: { validFrom: "desc" as const },
  },
} as const;

type CatalogRoomType = Awaited<ReturnType<typeof findRoomTypes>>[number];

function imageGallery(value: unknown, coverImageUrl: string) {
  if (!Array.isArray(value)) return [coverImageUrl];
  const images = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return images.length ? images : [coverImageUrl];
}

export function serializeRoomType(
  roomType: CatalogRoomType,
  promotionPeriod?: { arrival: Date; departure: Date },
) {
  const rate = roomType.ratePlans[0];
  if (!rate) return null;
  const arrival = promotionPeriod?.arrival ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const departure = promotionPeriod?.departure ?? new Date(arrival.getTime() + 86_400_000);
  const promotion = roomType.promotions.find((item) =>
    item.isActive
    && item.validFrom <= arrival
    && (!item.validUntil || item.validUntil >= departure),
  );

  return {
    id: roomType.id,
    slug: roomType.slug,
    name: roomType.name,
    category: roomType.shortName?.trim() || "Hébergement",
    shortDescription: roomType.description,
    description: roomType.description,
    price: Number(promotion?.promotionalPricePerNight ?? rate.basePricePerNight),
    originalPrice: promotion ? Number(promotion.referencePricePerNight) : undefined,
    promotion: promotion ? {
      label: promotion.label,
      discountPercent: Number(promotion.discountPercent),
      validUntil: promotion.validUntil?.toISOString().slice(0, 10) ?? null,
    } : undefined,
    taxRate: Number(rate.taxRate),
    currency: rate.currency,
    refundable: rate.refundable,
    capacity: roomType.maxGuests,
    maxAdults: roomType.maxAdults,
    maxChildren: roomType.maxChildren,
    surface: `${roomType.surfaceSqm} m²`,
    surfaceSqm: roomType.surfaceSqm,
    rooms: roomType.bedLabel,
    hero: roomType.coverImageUrl,
    gallery: imageGallery(roomType.gallery, roomType.coverImageUrl),
    amenities: roomType.amenities.map(({ amenity }) => amenity.label),
  };
}

export function findRoomTypes() {
  return prisma.roomType.findMany({
    where: { property: { slug: env.publicPropertySlug }, isPublished: true, archivedAt: null },
    orderBy: { displayOrder: "asc" },
    include: roomTypeInclude,
  });
}

export async function listRoomTypes() {
  const roomTypes = await findRoomTypes();
  return roomTypes.map((roomType) => serializeRoomType(roomType)).filter((item) => item !== null);
}

type PublicPropertyRecord = {
  slug: string;
  name: string;
  email: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
  _count: { rooms: number };
};

export function serializePublicProperty(property: PublicPropertyRecord) {
  return {
    slug: property.slug,
    name: property.name,
    email: property.email,
    phone: property.phone,
    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2,
    postalCode: property.postalCode,
    city: property.city,
    countryCode: property.countryCode,
    timezone: property.timezone,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    roomCount: property._count.rooms,
  };
}

export async function getPublicProperty() {
  const property = await prisma.property.findUnique({
    where: { slug: env.publicPropertySlug },
    select: {
      slug: true,
      name: true,
      email: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      city: true,
      countryCode: true,
      timezone: true,
      checkInTime: true,
      checkOutTime: true,
      _count: { select: { rooms: { where: { status: "ACTIVE" } } } },
    },
  });
  return property ? serializePublicProperty(property) : null;
}

export async function findRoomTypeBySlug(slug: string) {
  const roomType = await prisma.roomType.findFirst({
    where: { property: { slug: env.publicPropertySlug }, slug, isPublished: true, archivedAt: null },
    include: roomTypeInclude,
  });
  return roomType ? serializeRoomType(roomType) : null;
}

export async function listExtras(propertyId?: string) {
  const extras = await prisma.extra.findMany({
    where: {
      ...(propertyId ? { propertyId } : { property: { slug: env.publicPropertySlug } }),
      isActive: true,
      priceTaxMode: "INCLUSIVE",
    },
    orderBy: { displayOrder: "asc" },
  });

  return extras.map((extra) => ({
    id: extra.id,
    code: extra.code,
    name: extra.name,
    description: extra.description,
    price: Number(extra.price),
    taxRate: extra.taxRate === null ? null : Number(extra.taxRate),
    currency: extra.currency,
    unit: extra.pricingUnit,
  }));
}
