-- Hotel-wide seasons and their nightly price per room type. Nights outside
-- any season, or of a room type without a price for it, keep the base price.
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "minNights" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "seasons_valid_period" CHECK ("validUntil" >= "validFrom"),
    CONSTRAINT "seasons_valid_min_nights" CHECK ("minNights" IS NULL OR "minNights" BETWEEN 1 AND 30)
);

CREATE TABLE "season_rates" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "roomTypeId" UUID NOT NULL,
    "nightlyPrice" DECIMAL(12,2) NOT NULL,
    "weekendNightlyPrice" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "season_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "season_rates_positive_prices" CHECK ("nightlyPrice" > 0 AND ("weekendNightlyPrice" IS NULL OR "weekendNightlyPrice" > 0))
);

CREATE INDEX "seasons_propertyId_validFrom_validUntil_idx" ON "seasons"("propertyId", "validFrom", "validUntil");
CREATE UNIQUE INDEX "season_rates_seasonId_roomTypeId_key" ON "season_rates"("seasonId", "roomTypeId");
CREATE INDEX "season_rates_roomTypeId_idx" ON "season_rates"("roomTypeId");

ALTER TABLE "seasons" ADD CONSTRAINT "seasons_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "season_rates" ADD CONSTRAINT "season_rates_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "season_rates" ADD CONSTRAINT "season_rates_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A night belongs to at most one season of a property.
ALTER TABLE "seasons"
  ADD CONSTRAINT "seasons_no_overlap"
  EXCLUDE USING gist (
    "propertyId" WITH =,
    daterange("validFrom", "validUntil", '[]') WITH &&
  );

ALTER TABLE "seasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "season_rates" ENABLE ROW LEVEL SECURITY;

-- Night-by-night detail of the accepted price, frozen with each booking.
ALTER TABLE "booking_rooms" ADD COLUMN "nightlyRatesSnapshot" JSONB;
