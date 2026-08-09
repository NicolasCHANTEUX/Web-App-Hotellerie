import { prisma } from "../../lib/prisma.js";

const roomTypeInclude = {
  amenities: {
    orderBy: { sortOrder: "asc" as const },
    include: { amenity: true },
  },
  ratePlans: {
    where: { isActive: true },
    orderBy: { basePricePerNight: "asc" as const },
  },
} as const;

type CatalogRoomType = Awaited<ReturnType<typeof findRoomTypes>>[number];

function imageGallery(value: unknown, coverImageUrl: string) {
  if (!Array.isArray(value)) return [coverImageUrl];
  const images = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return images.length ? images : [coverImageUrl];
}

function categoryFor(slug: string) {
  if (slug === "suite-rivage") return "Suite signature";
  if (slug === "chambre-deluxe") return "Chambre deluxe";
  if (slug === "chambre-elegance") return "Chambre supérieure";
  return "Chambre double";
}

export function serializeRoomType(roomType: CatalogRoomType) {
  const rate = roomType.ratePlans[0];
  if (!rate) return null;

  return {
    id: roomType.id,
    slug: roomType.slug,
    name: roomType.name,
    category: categoryFor(roomType.slug),
    shortDescription: roomType.description,
    description: roomType.description,
    price: Number(rate.basePricePerNight),
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
    where: { isPublished: true },
    orderBy: { displayOrder: "asc" },
    include: roomTypeInclude,
  });
}

export async function listRoomTypes() {
  const roomTypes = await findRoomTypes();
  return roomTypes.map(serializeRoomType).filter((item) => item !== null);
}

export async function findRoomTypeBySlug(slug: string) {
  const roomType = await prisma.roomType.findFirst({
    where: { slug, isPublished: true },
    include: roomTypeInclude,
  });
  return roomType ? serializeRoomType(roomType) : null;
}

export async function listExtras() {
  const extras = await prisma.extra.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
  });

  return extras.map((extra) => ({
    id: extra.id,
    code: extra.code,
    name: extra.name,
    description: extra.description,
    price: Number(extra.price),
    currency: extra.currency,
    unit: extra.pricingUnit,
  }));
}
