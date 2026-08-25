ALTER TYPE "NotificationTemplate" ADD VALUE 'CONTACT_REQUEST_RECEIVED';

CREATE TABLE "contact_requests" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "privacyAcceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "personalDataRetainUntil" TIMESTAMPTZ(3) NOT NULL,
  "anonymizedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_requests_idempotencyKey_key" ON "contact_requests"("idempotencyKey");
CREATE INDEX "contact_requests_propertyId_createdAt_idx" ON "contact_requests"("propertyId", "createdAt");
CREATE INDEX "contact_requests_personalDataRetainUntil_anonymizedAt_idx" ON "contact_requests"("personalDataRetainUntil", "anonymizedAt");

ALTER TABLE "contact_requests"
  ADD CONSTRAINT "contact_requests_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contact_requests"
  ADD CONSTRAINT "contact_requests_valid_full_name" CHECK (length(trim("fullName")) BETWEEN 2 AND 120),
  ADD CONSTRAINT "contact_requests_valid_email" CHECK (length(trim("email")) BETWEEN 3 AND 254),
  ADD CONSTRAINT "contact_requests_valid_phone" CHECK ("phone" IS NULL OR length(trim("phone")) BETWEEN 7 AND 30),
  ADD CONSTRAINT "contact_requests_valid_subject" CHECK (length(trim("subject")) BETWEEN 2 AND 80),
  ADD CONSTRAINT "contact_requests_valid_message" CHECK (length(trim("message")) BETWEEN 20 AND 4000),
  ADD CONSTRAINT "contact_requests_valid_hash" CHECK ("requestHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "contact_requests" ENABLE ROW LEVEL SECURITY;
