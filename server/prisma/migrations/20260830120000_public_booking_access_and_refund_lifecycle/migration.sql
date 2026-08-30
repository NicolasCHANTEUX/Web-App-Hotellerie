ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "publicAccessTokenHash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "publicAccessTokenExpiresAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_publicAccessTokenHash_key"
  ON "bookings"("publicAccessTokenHash");

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refundReason" TEXT;
