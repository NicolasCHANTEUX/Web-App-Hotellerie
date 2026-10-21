-- The promotion indexes were declared with names longer than PostgreSQL's 63
-- characters: the database truncated them differently from Prisma, which
-- then saw a drift. They take the names Prisma expects.
ALTER INDEX "room_type_promotions_propertyId_isActive_validFrom_validUntil_i" RENAME TO "room_type_promotions_propertyId_isActive_validFrom_validUnt_idx";
ALTER INDEX "room_type_promotions_roomTypeId_isActive_validFrom_validUntil_i" RENAME TO "room_type_promotions_roomTypeId_isActive_validFrom_validUnt_idx";
