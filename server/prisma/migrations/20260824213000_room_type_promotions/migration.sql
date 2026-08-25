-- Auditable public price history and percentage promotions scoped to room types.

CREATE TABLE "rate_plan_price_history" (
  "id" UUID NOT NULL,
  "ratePlanId" UUID NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "priceTaxMode" "PriceTaxMode" NOT NULL DEFAULT 'INCLUSIVE',
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3),
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_plan_price_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_type_promotions" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "roomTypeId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "discountPercent" DECIMAL(5,2) NOT NULL,
  "referencePricePerNight" DECIMAL(12,2) NOT NULL,
  "promotionalPricePerNight" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" DATE NOT NULL,
  "validUntil" DATE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "room_type_promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_type_promotions_discount_check" CHECK ("discountPercent" > 0 AND "discountPercent" <= 90),
  CONSTRAINT "room_type_promotions_prices_check" CHECK ("referencePricePerNight" > 0 AND "promotionalPricePerNight" > 0 AND "promotionalPricePerNight" < "referencePricePerNight"),
  CONSTRAINT "room_type_promotions_dates_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom")
);

CREATE INDEX "rate_plan_price_history_ratePlanId_validFrom_validUntil_idx"
  ON "rate_plan_price_history"("ratePlanId", "validFrom", "validUntil");
CREATE INDEX "room_type_promotions_propertyId_isActive_validFrom_validUntil_idx"
  ON "room_type_promotions"("propertyId", "isActive", "validFrom", "validUntil");
CREATE INDEX "room_type_promotions_roomTypeId_isActive_validFrom_validUntil_idx"
  ON "room_type_promotions"("roomTypeId", "isActive", "validFrom", "validUntil");

ALTER TABLE "rate_plan_price_history"
  ADD CONSTRAINT "rate_plan_price_history_ratePlanId_fkey"
  FOREIGN KEY ("ratePlanId") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_type_promotions"
  ADD CONSTRAINT "room_type_promotions_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_type_promotions"
  ADD CONSTRAINT "room_type_promotions_roomTypeId_fkey"
  FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "room_type_promotions"
  ADD CONSTRAINT "room_type_promotions_no_active_overlap"
  EXCLUDE USING gist (
    "roomTypeId" WITH =,
    daterange("validFrom", COALESCE("validUntil", 'infinity'::date), '[)') WITH &&
  ) WHERE ("isActive");

INSERT INTO "rate_plan_price_history" (
  "id", "ratePlanId", "price", "priceTaxMode", "validFrom", "validUntil", "reason"
)
SELECT
  gen_random_uuid(), "id", "basePricePerNight", "priceTaxMode", "createdAt", NULL, 'BASELINE'
FROM "rate_plans";

ALTER TABLE "rate_plan_price_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_type_promotions" ENABLE ROW LEVEL SECURITY;
