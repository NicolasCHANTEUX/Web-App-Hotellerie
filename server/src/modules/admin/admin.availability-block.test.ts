import assert from "node:assert/strict";
import test from "node:test";
import { BlockReason } from "../../generated/prisma/client.js";
import { parseAdminAvailabilityBlockBody } from "./admin.availability-block.js";

test("availability block parser normalizes a valid operational period", () => {
  assert.deepEqual(parseAdminAvailabilityBlockBody({
    checkIn: "2026-09-10",
    checkOut: "2026-09-12",
    reason: "MAINTENANCE",
    note: "  Climatisation  ",
  }), {
    checkIn: new Date("2026-09-10T00:00:00.000Z"),
    checkOut: new Date("2026-09-12T00:00:00.000Z"),
    reason: BlockReason.MAINTENANCE,
    note: "Climatisation",
  });
});

test("availability block parser rejects invalid ranges and unexpected fields", () => {
  assert.throws(() => parseAdminAvailabilityBlockBody({ checkIn: "2026-09-10", checkOut: "2026-09-10", reason: "OTHER" }));
  assert.throws(() => parseAdminAvailabilityBlockBody({ checkIn: "2026-09-10", checkOut: "2026-09-12", reason: "INVALID" }));
  assert.throws(() => parseAdminAvailabilityBlockBody({ checkIn: "2026-09-10", checkOut: "2026-09-12", reason: "OTHER", force: true }));
});
