ALTER TABLE "payments" ADD COLUMN "checkoutSessionId" TEXT;

UPDATE "payments"
SET "checkoutSessionId" = "providerReference"
WHERE "provider" = 'STRIPE'
  AND "providerReference" LIKE 'cs\_%' ESCAPE '\';

CREATE UNIQUE INDEX "payments_checkoutSessionId_key" ON "payments"("checkoutSessionId");
