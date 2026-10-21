import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import {
  isWeekendNight,
  nightlyRatesSnapshot,
  priceStayNights,
  promotionsOverlappingStay,
  quotedStay,
  seasonsOverlappingStay,
  type StayPromotion,
  type StaySeason,
} from "./booking.stay-rates.js";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const money = (value: string) => new Prisma.Decimal(value);

const highSeason: StaySeason = { id: "high", label: "Haute saison", validFrom: day("2027-07-01"), validUntil: day("2027-08-31"), minNights: 3 };
const highRate = { seasonId: "high", nightlyPrice: money("180"), weekendNightlyPrice: money("210") };

// Tuesday 29 June to Sunday 4 July 2027: two base nights, then Thursday,
// Friday and Saturday nights of the high season.
function summerStay(overrides: Partial<Parameters<typeof priceStayNights>[0]> = {}) {
  return priceStayNights({
    arrival: day("2027-06-29"),
    nights: 5,
    basePrice: money("120"),
    seasons: [highSeason],
    rates: [highRate],
    promotions: [],
    ...overrides,
  });
}

test("facture chaque nuit au prix de sa saison, week-end compris", () => {
  const stay = summerStay();

  assert.deepEqual(
    stay.nights.map((night) => [night.date.toISOString().slice(0, 10), night.season?.label ?? null, night.weekend, night.price.toFixed(2)]),
    [
      ["2027-06-29", null, false, "120.00"],
      ["2027-06-30", null, false, "120.00"],
      ["2027-07-01", "Haute saison", false, "180.00"],
      ["2027-07-02", "Haute saison", true, "210.00"],
      ["2027-07-03", "Haute saison", true, "210.00"],
    ],
  );
  assert.equal(stay.total.toFixed(2), "840.00");
  assert.equal(stay.regularTotal.toFixed(2), "840.00");
  assert.equal(stay.averagePrice.toFixed(2), "168.00");
  assert.equal(stay.minStay, null);
  assert.equal(stay.promotion, null);
});

test("garde le prix de base sans saison, ou pour un type sans prix dans la saison", () => {
  const withoutSeason = summerStay({ seasons: [], rates: [] });
  assert.ok(withoutSeason.nights.every((night) => night.price.equals(120) && night.season === null));
  assert.equal(withoutSeason.total.toFixed(2), "600.00");

  const withoutRate = summerStay({ rates: [] });
  assert.equal(withoutRate.nights[2]?.season?.label, "Haute saison");
  assert.ok(withoutRate.nights.every((night) => night.price.equals(120)));

  const noWeekendPrice = summerStay({ rates: [{ ...highRate, weekendNightlyPrice: null }] });
  assert.equal(noWeekendPrice.nights[3]?.price.toFixed(2), "180.00");
});

test("applique une promotion aux seules nuits qu'elle couvre", () => {
  // Promotions keep their stored end date: the day after the last night.
  const promotion: StayPromotion = { id: "promo", label: "Offre d'été", discountPercent: money("10"), validFrom: day("2027-07-02"), validUntil: day("2027-07-04") };
  const stay = summerStay({ promotions: [promotion] });

  assert.deepEqual(stay.nights.map((night) => night.price.toFixed(2)), ["120.00", "120.00", "180.00", "189.00", "189.00"]);
  assert.equal(stay.total.toFixed(2), "798.00");
  assert.equal(stay.regularTotal.toFixed(2), "840.00");
  assert.equal(stay.promotion?.id, "promo");
  assert.equal(quotedStay(stay).promotion?.referenceUnitPrice, 168);
});

test("exige la durée minimale la plus stricte des saisons touchées", () => {
  const august: StaySeason = { id: "august", label: "Août", validFrom: day("2027-08-01"), validUntil: day("2027-08-31"), minNights: 7 };
  const short = priceStayNights({
    arrival: day("2027-07-01"),
    nights: 2,
    basePrice: money("120"),
    seasons: [highSeason],
    rates: [highRate],
    promotions: [],
  });
  assert.deepEqual(short.minStay, { minNights: 3, seasonLabel: "Haute saison" });

  const crossing = priceStayNights({
    arrival: day("2027-07-28"),
    nights: 6,
    basePrice: money("120"),
    seasons: [{ ...highSeason, validUntil: day("2027-07-31") }, august],
    rates: [],
    promotions: [],
  });
  assert.deepEqual(crossing.minStay, { minNights: 7, seasonLabel: "Août" });
  assert.equal(summerStay().minStay, null);
});

test("sélectionne en base les saisons et promotions qui partagent une nuit avec le séjour", () => {
  assert.deepEqual(seasonsOverlappingStay(day("2027-06-29"), day("2027-07-04")), {
    validFrom: { lte: day("2027-07-03") },
    validUntil: { gte: day("2027-06-29") },
  });
  assert.deepEqual(promotionsOverlappingStay(day("2027-06-29"), day("2027-07-04")), {
    isActive: true,
    validFrom: { lte: day("2027-07-03") },
    OR: [{ validUntil: null }, { validUntil: { gt: day("2027-06-29") } }],
  });
  assert.equal(isWeekendNight(day("2027-07-02")), true);
  assert.equal(isWeekendNight(day("2027-07-04")), false);
});

test("fige le détail de chaque nuit avec la réservation", () => {
  assert.deepEqual(nightlyRatesSnapshot(summerStay().nights.slice(2, 4)), [
    { date: "2027-07-01", season: "Haute saison", weekend: false, regularPrice: "180.00", promotion: null, price: "180.00" },
    { date: "2027-07-02", season: "Haute saison", weekend: true, regularPrice: "210.00", promotion: null, price: "210.00" },
  ]);
});
