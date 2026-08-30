ALTER TABLE "stored_files"
ADD COLUMN "purgedAt" TIMESTAMPTZ(3);

CREATE INDEX "stored_files_kind_deletedAt_purgedAt_idx"
ON "stored_files"("kind", "deletedAt", "purgedAt");
