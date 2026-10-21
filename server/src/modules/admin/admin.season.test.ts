import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin.errors.js";
import { parseAdminSeasonCreateBody, parseAdminSeasonDeleteBody, parseAdminSeasonUpdateBody } from "./admin.season.js";

const ROOM_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM_TYPE_ID = "22222222-2222-4222-8222-222222222222";

const valid = {
  label: "  Haute saison ",
  validFrom: "2027-07-01",
  validUntil: "2027-08-31",
  minNights: 3,
  rates: [
    { roomTypeId: ROOM_TYPE_ID.toUpperCase(), nightlyPrice: 180.005, weekendNightlyPrice: 210 },
    { roomTypeId: OTHER_ROOM_TYPE_ID, nightlyPrice: 250, weekendNightlyPrice: null },
  ],
};

function assertInvalid(body: unknown, pattern: RegExp, parse: (body: unknown) => unknown = parseAdminSeasonCreateBody) {
  assert.throws(() => parse(body), (error) => {
    assert.ok(error instanceof AdminApiError);
    assert.equal(error.code, "INVALID_SEASON");
    assert.match(error.message, pattern);
    return true;
  });
}

test("normalise une saison et sa grille de prix", () => {
  assert.deepEqual(parseAdminSeasonCreateBody(valid), {
    label: "Haute saison",
    validFrom: new Date("2027-07-01T00:00:00.000Z"),
    validUntil: new Date("2027-08-31T00:00:00.000Z"),
    minNights: 3,
    rates: [
      { roomTypeId: ROOM_TYPE_ID, nightlyPrice: 180.01, weekendNightlyPrice: 210 },
      { roomTypeId: OTHER_ROOM_TYPE_ID, nightlyPrice: 250, weekendNightlyPrice: null },
    ],
  });
  const minimal = parseAdminSeasonCreateBody({ ...valid, minNights: null, rates: [] });
  assert.equal(minimal.minNights, null);
  assert.deepEqual(minimal.rates, []);
});

test("refuse une période, une durée ou une grille incohérentes", () => {
  assertInvalid({ ...valid, validUntil: "2027-06-30" }, /dernière nuit/);
  assertInvalid({ ...valid, validFrom: "2027-02-30" }, /première nuit/);
  assertInvalid({ ...valid, label: "H" }, /nom/);
  assertInvalid({ ...valid, minNights: 0 }, /durée minimale/);
  assertInvalid({ ...valid, minNights: 2.5 }, /durée minimale/);
  assertInvalid({ ...valid, rates: [{ roomTypeId: ROOM_TYPE_ID, nightlyPrice: 0 }] }, /prix par nuit/);
  assertInvalid({ ...valid, rates: [{ roomTypeId: ROOM_TYPE_ID, nightlyPrice: 180, weekendNightlyPrice: 20_000 }] }, /week-end/);
  assertInvalid({ ...valid, rates: [{ roomTypeId: "chambre", nightlyPrice: 180 }] }, /type de chambre/);
  assertInvalid({ ...valid, rates: [valid.rates[0], { ...valid.rates[0], roomTypeId: ROOM_TYPE_ID }] }, /deux fois/);
  assertInvalid({ ...valid, rates: [{ roomTypeId: ROOM_TYPE_ID, nightlyPrice: 180, currency: "EUR" }] }, /currency/);
  assertInvalid({ ...valid, propertyId: ROOM_TYPE_ID }, /propertyId/);
});

test("exige une version canonique pour modifier ou supprimer", () => {
  const updatedAt = "2026-10-21T08:00:00.000Z";
  assert.equal(parseAdminSeasonUpdateBody({ ...valid, updatedAt }).updatedAt.toISOString(), updatedAt);
  assert.equal(parseAdminSeasonDeleteBody({ updatedAt }).updatedAt.toISOString(), updatedAt);
  assertInvalid(valid, /version/, parseAdminSeasonUpdateBody);
});
