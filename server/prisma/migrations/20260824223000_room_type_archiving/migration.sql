-- Retire room types from sale while preserving immutable booking history.

ALTER TABLE "room_types" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

DROP INDEX IF EXISTS "room_types_propertyId_isPublished_displayOrder_idx";
CREATE INDEX "room_types_propertyId_isPublished_archivedAt_displayOrder_idx"
  ON "room_types"("propertyId", "isPublished", "archivedAt", "displayOrder");
