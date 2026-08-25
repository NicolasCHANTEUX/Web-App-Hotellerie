import assert from "node:assert/strict";
import test from "node:test";
import { bookingWhere } from "./admin.service.js";

test("today-only selects stays touching the property date", () => {
  const today = new Date("2026-08-24T00:00:00.000Z");
  assert.deepEqual(bookingWhere("property-id", { todayOnly: true }, today), {
    propertyId: "property-id",
    AND: [
      { checkIn: { lte: today } },
      { checkOut: { gte: today } },
    ],
  });
});

test("ordinary booking filters remain composable without today-only", () => {
  const today = new Date("2026-08-24T00:00:00.000Z");
  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-09-30T00:00:00.000Z");
  assert.deepEqual(bookingWhere("property-id", { status: "CONFIRMED", from, to }, today), {
    propertyId: "property-id",
    status: "CONFIRMED",
    checkOut: { gt: from },
    checkIn: { lte: to },
  });
});

test("accounting search never queries guest contact details", () => {
  const where = bookingWhere(
    "property-id",
    { search: "Martin" },
    new Date("2026-08-24T00:00:00.000Z"),
    true,
    false,
  );
  const serialized = JSON.stringify(where);

  assert.match(serialized, /firstName/);
  assert.match(serialized, /lastName/);
  assert.doesNotMatch(serialized, /email/);
  assert.doesNotMatch(serialized, /phone/);
});
