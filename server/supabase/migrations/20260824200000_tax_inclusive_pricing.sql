-- Public prices are configured and displayed tax-inclusive from this version.
-- Existing bookings keep their historical tax-exclusive semantics.

CREATE TYPE "PriceTaxMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

ALTER TABLE "rate_plans"
  ADD COLUMN "priceTaxMode" "PriceTaxMode" NOT NULL DEFAULT 'INCLUSIVE';

ALTER TABLE "extras"
  ADD COLUMN "priceTaxMode" "PriceTaxMode" NOT NULL DEFAULT 'INCLUSIVE';

ALTER TABLE "bookings"
  ADD COLUMN "priceTaxMode" "PriceTaxMode" NOT NULL DEFAULT 'EXCLUSIVE';

ALTER TABLE "bookings"
  ALTER COLUMN "priceTaxMode" SET DEFAULT 'INCLUSIVE';

ALTER TABLE "booking_rooms"
  ADD COLUMN "priceTaxModeSnapshot" "PriceTaxMode" NOT NULL DEFAULT 'EXCLUSIVE';

ALTER TABLE "booking_rooms"
  ALTER COLUMN "priceTaxModeSnapshot" SET DEFAULT 'INCLUSIVE';

ALTER TABLE "booking_extras"
  ADD COLUMN "priceTaxModeSnapshot" "PriceTaxMode" NOT NULL DEFAULT 'EXCLUSIVE';

ALTER TABLE "booking_extras"
  ALTER COLUMN "priceTaxModeSnapshot" SET DEFAULT 'INCLUSIVE';
