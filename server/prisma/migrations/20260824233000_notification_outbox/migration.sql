-- Transactional notification outbox. Delivery is performed asynchronously so
-- booking and payment transactions never depend on an e-mail provider.

CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');
CREATE TYPE "NotificationTemplate" AS ENUM (
  'BOOKING_OPTIONED',
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_REFUNDED'
);
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "bookingId" UUID,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
  "template" "NotificationTemplate" NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerReference" TEXT,
  "lastError" TEXT,
  "sentAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_idempotencyKey_key" ON "notifications"("idempotencyKey");
CREATE INDEX "notifications_status_nextAttemptAt_idx" ON "notifications"("status", "nextAttemptAt");
CREATE INDEX "notifications_propertyId_createdAt_idx" ON "notifications"("propertyId", "createdAt");
CREATE INDEX "notifications_bookingId_createdAt_idx" ON "notifications"("bookingId", "createdAt");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_valid_recipient" CHECK (length(trim("recipient")) BETWEEN 3 AND 320),
  ADD CONSTRAINT "notifications_valid_attempts" CHECK ("attempts" >= 0);

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
