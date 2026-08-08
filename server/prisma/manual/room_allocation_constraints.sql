-- Append this SQL to the generated initial migration before applying it.
-- Prisma cannot currently declare PostgreSQL exclusion constraints in schema.prisma.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_valid_stay" CHECK ("checkOut" > "checkIn"),
  ADD CONSTRAINT "bookings_valid_guests" CHECK ("adults" > 0 AND "children" >= 0),
  ADD CONSTRAINT "bookings_non_negative_amounts" CHECK (
    "accommodationSubtotal" >= 0 AND "extrasSubtotal" >= 0 AND
    "taxTotal" >= 0 AND "total" >= 0
  );

ALTER TABLE "reservation_holds"
  ADD CONSTRAINT "reservation_holds_valid_stay" CHECK ("checkOut" > "checkIn"),
  ADD CONSTRAINT "reservation_holds_valid_guests" CHECK ("adults" > 0 AND "children" >= 0);

ALTER TABLE "availability_blocks"
  ADD CONSTRAINT "availability_blocks_valid_stay" CHECK ("checkOut" > "checkIn");

ALTER TABLE "room_allocations"
  ADD CONSTRAINT "room_allocations_valid_stay" CHECK ("checkOut" > "checkIn"),
  ADD CONSTRAINT "room_allocations_exactly_one_source" CHECK (
    ("source" = 'BOOKING' AND "bookingRoomId" IS NOT NULL AND "reservationHoldId" IS NULL AND "availabilityBlockId" IS NULL)
    OR
    ("source" = 'HOLD' AND "bookingRoomId" IS NULL AND "reservationHoldId" IS NOT NULL AND "availabilityBlockId" IS NULL)
    OR
    ("source" = 'BLOCK' AND "bookingRoomId" IS NULL AND "reservationHoldId" IS NULL AND "availabilityBlockId" IS NOT NULL)
  );

ALTER TABLE "room_allocations"
  ADD CONSTRAINT "room_allocations_no_active_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    daterange("checkIn", "checkOut", '[)') WITH &&
  )
  WHERE ("status" = 'ACTIVE');

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_positive_price" CHECK ("basePricePerNight" >= 0),
  ADD CONSTRAINT "rate_plans_valid_period" CHECK (
    "validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" >= "validFrom"
  );

ALTER TABLE "extras"
  ADD CONSTRAINT "extras_non_negative_price" CHECK ("price" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_positive_amount" CHECK ("amount" > 0);
