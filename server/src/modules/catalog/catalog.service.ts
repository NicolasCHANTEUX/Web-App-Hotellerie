import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { priceStayNights, type StayPromotion, type StaySeason, type StaySeasonRate } from "../booking/booking.stay-rates.js";

// "From" prices look at the nights of the coming year.
const CATALOG_HORIZON_NIGHTS = 365;

function today() {
  return new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
}

function catalogRoomTypeInclude() {
  return {
    amenities: {
      orderBy: { sortOrder: "asc" as const },
      include: { amenity: true },
    },
    ratePlans: {
      where: { isActive: true, priceTaxMode: "INCLUSIVE" as const },
      orderBy: { basePricePerNight: "asc" as const },
    },
    promotions: {
      where: { isActive: true, OR: [{ validUntil: null }, { validUntil: { gt: today() } }] },
      orderBy: { validFrom: "asc" as const },
    },
    seasonRates: {
      where: { season: { validUntil: { gte: today() } } },
      include: { season: true },
    },
  };
}

type CatalogRoomTypeFields = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  description: string;
  maxGuests: number;
  maxAdults: number;
  maxChildren: number;
  surfaceSqm: number;
  bedLabel: string;
  coverImageUrl: string;
  gallery: Prisma.JsonValue;
  amenities: Array<{ amenity: { label: string } }>;
};

type CatalogRate = { taxRate: Prisma.Decimal; currency: string; refundable: boolean };

/** Nightly price shown for a room type, with its regular price when promoted. */
export type NightlyOffer = {
  price: Prisma.Decimal;
  originalPrice: Prisma.Decimal | null;
  promotion: StayPromotion | null;
};

function imageGallery(value: unknown, coverImageUrl: string) {
  if (!Array.isArray(value)) return [coverImageUrl];
  const images = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return images.length ? images : [coverImageUrl];
}

/**
 * Lowest nightly price actually offered over the coming year, seasons,
 * weekends and promotions included: the "from" price of the catalogue.
 */
export function lowestNightlyOffer(
  roomType: { promotions: StayPromotion[]; seasonRates: Array<StaySeasonRate & { season: StaySeason }> },
  basePrice: Prisma.Decimal,
  from = today(),
): NightlyOffer {
  const { nights } = priceStayNights({
    arrival: from,
    nights: CATALOG_HORIZON_NIGHTS,
    basePrice,
    seasons: roomType.seasonRates.map((rate) => rate.season),
    rates: roomType.seasonRates,
    promotions: roomType.promotions,
  });
  const cheapest = nights.reduce((best, night) => (night.price.lessThan(best.price) ? night : best));
  return {
    price: cheapest.price,
    originalPrice: cheapest.promotion ? cheapest.regularPrice : null,
    promotion: cheapest.promotion,
  };
}

export function serializeRoomType(roomType: CatalogRoomTypeFields, rate: CatalogRate, offer: NightlyOffer) {
  const { promotion } = offer;
  return {
    id: roomType.id,
    slug: roomType.slug,
    name: roomType.name,
    category: roomType.shortName?.trim() || "Hébergement",
    shortDescription: roomType.description,
    description: roomType.description,
    price: Number(offer.price),
    originalPrice: offer.originalPrice ? Number(offer.originalPrice) : undefined,
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

type CatalogRoomType = Awaited<ReturnType<typeof findRoomTypes>>[number];

function serializeCatalogRoomType(roomType: CatalogRoomType) {
  const rate = roomType.ratePlans[0];
  if (!rate) return null;
  return serializeRoomType(roomType, rate, lowestNightlyOffer(roomType, rate.basePricePerNight));
}

export function findRoomTypes() {
  return prisma.roomType.findMany({
    where: { property: { slug: env.publicPropertySlug }, isPublished: true, archivedAt: null },
    orderBy: { displayOrder: "asc" },
    include: catalogRoomTypeInclude(),
  });
}

export async function listRoomTypes() {
  const roomTypes = await findRoomTypes();
  return roomTypes.map(serializeCatalogRoomType).filter((item) => item !== null);
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
  legalName: string | null;
  legalForm: string | null;
  shareCapital: string | null;
  siret: string | null;
  registrationCity: string | null;
  vatNumber: string | null;
  publicationDirector: string | null;
  hostingProvider: string | null;
  mediator: string | null;
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
    // Legal notice of the operating company, public by nature.
    legal: {
      legalName: property.legalName,
      legalForm: property.legalForm,
      shareCapital: property.shareCapital,
      siret: property.siret,
      registrationCity: property.registrationCity,
      vatNumber: property.vatNumber,
      publicationDirector: property.publicationDirector,
      hostingProvider: property.hostingProvider,
      mediator: property.mediator,
    },
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
      legalName: true,
      legalForm: true,
      shareCapital: true,
      siret: true,
      registrationCity: true,
      vatNumber: true,
      publicationDirector: true,
      hostingProvider: true,
      mediator: true,
      _count: { select: { rooms: { where: { status: "ACTIVE" } } } },
    },
  });
  return property ? serializePublicProperty(property) : null;
}

export async function findRoomTypeBySlug(slug: string) {
  const roomType = await prisma.roomType.findFirst({
    where: { property: { slug: env.publicPropertySlug }, slug, isPublished: true, archivedAt: null },
    include: catalogRoomTypeInclude(),
  });
  return roomType ? serializeCatalogRoomType(roomType) : null;
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
