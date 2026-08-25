UPDATE "bookings"
SET "personalDataRetainUntil" = "checkOut" + INTERVAL '10 years'
WHERE "personalDataRetainUntil" IS NULL;

CREATE INDEX "bookings_personalDataRetainUntil_anonymizedAt_idx"
ON "bookings"("personalDataRetainUntil", "anonymizedAt");
