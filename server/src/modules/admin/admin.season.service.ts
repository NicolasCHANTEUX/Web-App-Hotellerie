import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import type { AdminSeasonDeleteInput, AdminSeasonFields, AdminSeasonUpdateInput } from "./admin.season.js";

const seasonInclude = { rates: { orderBy: { createdAt: "asc" as const } } } satisfies Prisma.SeasonInclude;

type SeasonRecord = Prisma.SeasonGetPayload<{ include: typeof seasonInclude }>;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function serializeSeason(season: SeasonRecord) {
  return {
    id: season.id,
    label: season.label,
    validFrom: dateOnly(season.validFrom),
    validUntil: dateOnly(season.validUntil),
    minNights: season.minNights,
    rates: season.rates.map((rate) => ({
      roomTypeId: rate.roomTypeId,
      nightlyPrice: Number(rate.nightlyPrice),
      weekendNightlyPrice: rate.weekendNightlyPrice === null ? null : Number(rate.weekendNightlyPrice),
    })),
    updatedAt: season.updatedAt.toISOString(),
  };
}

function auditSnapshot(season: SeasonRecord) {
  const { updatedAt: _updatedAt, ...snapshot } = serializeSeason(season);
  return snapshot;
}

/** The database exclusion constraint, hit when two saves race on overlapping periods. */
function isOverlapViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown; meta?: unknown };
  const text = [candidate.code, candidate.message, JSON.stringify(candidate.meta ?? null)].join(" ");
  return text.includes("23P01") || text.includes("seasons_no_overlap") || isOverlapViolation(candidate.cause);
}

async function assertNoOverlap(transaction: Prisma.TransactionClient, propertyId: string, input: AdminSeasonFields, exceptId?: string) {
  const overlapping = await transaction.season.findFirst({
    where: {
      propertyId,
      validFrom: { lte: input.validUntil },
      validUntil: { gte: input.validFrom },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { label: true, validFrom: true, validUntil: true },
  });
  if (overlapping) {
    throw new AdminApiError(409, "SEASON_OVERLAP", `Cette période chevauche la saison « ${overlapping.label} » (nuits du ${dateOnly(overlapping.validFrom)} au ${dateOnly(overlapping.validUntil)}).`);
  }
}

async function assertRoomTypes(transaction: Prisma.TransactionClient, propertyId: string, input: AdminSeasonFields) {
  if (!input.rates.length) return;
  const found = await transaction.roomType.count({
    where: { propertyId, archivedAt: null, id: { in: input.rates.map((rate) => rate.roomTypeId) } },
  });
  if (found !== input.rates.length) {
    throw new AdminApiError(400, "INVALID_SEASON", "Un type de chambre de la grille n'existe pas ou a été archivé.");
  }
}

function rateRows(input: AdminSeasonFields) {
  return input.rates.map((rate) => ({
    roomTypeId: rate.roomTypeId,
    nightlyPrice: rate.nightlyPrice,
    weekendNightlyPrice: rate.weekendNightlyPrice,
  }));
}

async function findSeason(transaction: Prisma.TransactionClient, propertyId: string, seasonId: string, updatedAt: Date) {
  const season = await transaction.season.findFirst({ where: { id: seasonId, propertyId }, include: seasonInclude });
  if (!season) throw new AdminApiError(404, "SEASON_NOT_FOUND", "Saison introuvable.");
  if (season.updatedAt.getTime() !== updatedAt.getTime()) {
    throw new AdminApiError(409, "SEASON_VERSION_CONFLICT", "Cette saison a été modifiée entre-temps. Rechargez-la avant de réessayer.");
  }
  return season;
}

async function withOverlapGuard<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new AdminApiError(409, "SEASON_OVERLAP", "Cette période chevauche une autre saison.");
    }
    throw error;
  }
}

/** Seasons with their price grid, and the room types it covers. */
export async function listAdminSeasons(propertyId: string) {
  const [seasons, roomTypes] = await Promise.all([
    prisma.season.findMany({ where: { propertyId }, orderBy: { validFrom: "asc" }, include: seasonInclude }),
    prisma.roomType.findMany({
      where: { propertyId, archivedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        ratePlans: {
          where: { isActive: true, priceTaxMode: "INCLUSIVE" },
          orderBy: { basePricePerNight: "asc" },
          take: 1,
          select: { basePricePerNight: true, currency: true },
        },
      },
    }),
  ]);
  return {
    roomTypes: roomTypes.map((roomType) => ({
      id: roomType.id,
      name: roomType.name,
      basePrice: roomType.ratePlans[0] ? Number(roomType.ratePlans[0].basePricePerNight) : null,
      currency: roomType.ratePlans[0]?.currency ?? "EUR",
    })),
    seasons: seasons.map(serializeSeason),
  };
}

export async function createAdminSeason(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminSeasonFields,
  ipAddress?: string,
) {
  return withOverlapGuard(() => prisma.$transaction(async (transaction) => {
    await assertNoOverlap(transaction, membership.propertyId, input);
    await assertRoomTypes(transaction, membership.propertyId, input);
    const created = await transaction.season.create({
      data: {
        propertyId: membership.propertyId,
        label: input.label,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        minNights: input.minNights,
        rates: { create: rateRows(input) },
      },
      include: seasonInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "SEASON_CREATED",
        entityType: "Season",
        entityId: created.id,
        before: Prisma.DbNull,
        after: auditSnapshot(created),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeSeason(created);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateAdminSeason(
  membership: AdminMembershipContext,
  adminUserId: string,
  seasonId: string,
  input: AdminSeasonUpdateInput,
  ipAddress?: string,
) {
  return withOverlapGuard(() => prisma.$transaction(async (transaction) => {
    const current = await findSeason(transaction, membership.propertyId, seasonId, input.updatedAt);
    await assertNoOverlap(transaction, membership.propertyId, input, current.id);
    await assertRoomTypes(transaction, membership.propertyId, input);
    // Bookings keep their night-by-night prices: changes only apply to new requests.
    await transaction.seasonRate.deleteMany({ where: { seasonId: current.id } });
    const updated = await transaction.season.update({
      where: { id: current.id },
      data: {
        label: input.label,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        minNights: input.minNights,
        rates: { create: rateRows(input) },
      },
      include: seasonInclude,
    });
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "SEASON_UPDATED",
        entityType: "Season",
        entityId: current.id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    return serializeSeason(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function deleteAdminSeason(
  membership: AdminMembershipContext,
  adminUserId: string,
  seasonId: string,
  input: AdminSeasonDeleteInput,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const season = await findSeason(transaction, membership.propertyId, seasonId, input.updatedAt);
    await transaction.auditLog.create({
      data: {
        propertyId: membership.propertyId,
        adminUserId,
        action: "SEASON_DELETED",
        entityType: "Season",
        entityId: season.id,
        before: auditSnapshot(season),
        after: Prisma.DbNull,
        metadata: { role: membership.role },
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    await transaction.season.delete({ where: { id: season.id } });
    return { id: season.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
