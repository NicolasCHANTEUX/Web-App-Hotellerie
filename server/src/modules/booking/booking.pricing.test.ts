import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { BookingError } from "./booking.errors.js";
import {
  discountedPrice,
  assertExpectedTotal,
  buildTaxInclusivePrice,
  fixedTaxQuantity,
  includedPercentageTax,
  moneyToCents,
  nightsCoveredByTaxRule,
  percentageTax,
  priceTaxRule,
  touristTaxPeriodFilter,
} from "./booking.pricing.js";

test("convertit un montant décimal en centimes sans perte flottante", () => {
  assert.equal(moneyToCents(new Prisma.Decimal("499.50")), 49_950);
  assert.equal(moneyToCents(new Prisma.Decimal("0.01")), 1);
});

test("calcule chaque taxe en centimes avant de composer le total", () => {
  assert.equal(percentageTax(new Prisma.Decimal("199.95"), new Prisma.Decimal("10")).toFixed(2), "20.00");
  assert.equal(percentageTax(new Prisma.Decimal("18"), new Prisma.Decimal("5.5")).toFixed(2), "0.99");
});

test("extrait la TVA d'un prix TTC sans augmenter le prix public", () => {
  const gross = new Prisma.Decimal("95.00");
  const tax = includedPercentageTax(gross, new Prisma.Decimal("10"));
  assert.equal(tax.toFixed(2), "8.64");
  assert.equal(gross.sub(tax).toFixed(2), "86.36");
});

test("calcule une réduction en pourcentage depuis le prix de référence", () => {
  assert.equal(discountedPrice(new Prisma.Decimal("135"), new Prisma.Decimal("15")).toFixed(2), "114.75");
  assert.equal(discountedPrice(new Prisma.Decimal("99.99"), new Prisma.Decimal("12.5")).toFixed(2), "87.49");
});

test("compose un devis TTC et ajoute uniquement la taxe de séjour", () => {
  const quote = buildTaxInclusivePrice({
    nightlyPrice: new Prisma.Decimal("95"),
    accommodationTaxRate: new Prisma.Decimal("10"),
    arrival: new Date("2027-03-10T00:00:00.000Z"),
    nights: 2,
    adults: 2,
    children: 0,
    extras: [{
      item: { code: "BREAKFAST" },
      price: new Prisma.Decimal("18"),
      pricingUnit: "PER_PERSON_PER_NIGHT",
      taxRate: new Prisma.Decimal("10"),
    }],
    taxRules: [{
      rule: { code: "TOURIST" },
      calculationMode: "PER_ADULT_PER_NIGHT",
      rate: null,
      amount: new Prisma.Decimal("2.15"),
    }],
  });

  assert.equal(quote.accommodationTotal.toFixed(2), "190.00");
  assert.equal(quote.extrasTotal.toFixed(2), "72.00");
  assert.equal(quote.vatTotal.toFixed(2), "23.82");
  assert.equal(quote.touristTaxTotal.toFixed(2), "8.60");
  assert.equal(quote.total.toFixed(2), "270.60");
});

test("calcule la quantité d'une taxe fixe selon sa règle", () => {
  assert.equal(fixedTaxQuantity("PER_ADULT_PER_NIGHT", 3, 2, 1), 6);
  assert.equal(fixedTaxQuantity("PER_PERSON_PER_NIGHT", 3, 2, 1), 9);
  assert.equal(fixedTaxQuantity("PER_NIGHT", 3, 2, 1), 3);
  assert.equal(fixedTaxQuantity("PER_STAY", 3, 2, 1), 1);
});

test("valorise une règle de taxe fixe ou proportionnelle avec le même arrondi", () => {
  const stay = { arrival: new Date("2027-03-10T00:00:00.000Z"), nights: 2, nightlyPrice: new Prisma.Decimal("99.95"), adults: 2, children: 1 };
  const fixed = priceTaxRule({ calculationMode: "PER_ADULT_PER_NIGHT", rate: null, amount: new Prisma.Decimal("2.15") }, stay);
  assert.equal(fixed.quantity.toFixed(0), "4");
  assert.equal(fixed.amount.toFixed(2), "8.60");

  const percentage = priceTaxRule({ calculationMode: "PERCENTAGE", rate: new Prisma.Decimal("3.5"), amount: null }, stay);
  assert.equal(percentage.taxableBase.toFixed(2), "199.90");
  assert.equal(percentage.amount.toFixed(2), "7.00");
});

test("accepte le prix attendu exact et refuse un prix obsolète", () => {
  assert.doesNotThrow(() => assertExpectedTotal(49_950, new Prisma.Decimal("499.50")));
  assert.throws(
    () => assertExpectedTotal(49_949, new Prisma.Decimal("499.50")),
    (error: unknown) =>
      error instanceof BookingError && error.statusCode === 409 && error.code === "PRICE_CHANGED",
  );
});

const night = (value: string) => new Date(`${value}T00:00:00.000Z`);

function newYearQuote(taxRules: Parameters<typeof buildTaxInclusivePrice<null, { code: string }>>[0]["taxRules"]) {
  // Nights of 30 and 31 December, then 1 January.
  return buildTaxInclusivePrice({
    nightlyPrice: new Prisma.Decimal("100"),
    accommodationTaxRate: new Prisma.Decimal("10"),
    arrival: night("2026-12-30"),
    nights: 3,
    adults: 2,
    children: 1,
    extras: [],
    taxRules,
  });
}

test("facture chaque nuit d'un séjour au tarif de taxe en vigueur cette nuit-là", () => {
  const quote = newYearQuote([
    { rule: { code: "TS_2026" }, calculationMode: "PER_ADULT_PER_NIGHT", rate: null, amount: new Prisma.Decimal("1.50"), validFrom: night("2026-01-01"), validUntil: night("2026-12-31") },
    { rule: { code: "TS_2027" }, calculationMode: "PER_ADULT_PER_NIGHT", rate: null, amount: new Prisma.Decimal("2.00"), validFrom: night("2027-01-01"), validUntil: null },
  ]);

  assert.deepEqual(
    quote.touristTaxes.map((tax) => [tax.rule.code, tax.quantity.toFixed(0), tax.amount.toFixed(2)]),
    [["TS_2026", "4", "6.00"], ["TS_2027", "2", "4.00"]],
  );
  assert.equal(quote.touristTaxTotal.toFixed(2), "10.00");
});

test("ignore une règle hors du séjour et rattache un forfait à la nuit d'arrivée", () => {
  const quote = newYearQuote([
    { rule: { code: "FUTURE" }, calculationMode: "PER_ADULT_PER_NIGHT", rate: null, amount: new Prisma.Decimal("9"), validFrom: night("2027-01-02"), validUntil: null },
    { rule: { code: "STAY_2026" }, calculationMode: "PER_STAY", rate: null, amount: new Prisma.Decimal("5"), validFrom: null, validUntil: night("2026-12-31") },
    { rule: { code: "STAY_2027" }, calculationMode: "PER_STAY", rate: null, amount: new Prisma.Decimal("7"), validFrom: night("2027-01-01"), validUntil: null },
    { rule: { code: "PERCENT" }, calculationMode: "PERCENTAGE", rate: new Prisma.Decimal("5"), amount: null, validFrom: night("2027-01-01"), validUntil: null },
  ]);

  assert.deepEqual(
    quote.touristTaxes.map((tax) => [tax.rule.code, tax.taxableBase.toFixed(2), tax.amount.toFixed(2)]),
    [["STAY_2026", "0.00", "5.00"], ["PERCENT", "100.00", "5.00"]],
  );
});

test("compte la dernière nuit d'une règle mais jamais le jour du départ", () => {
  const until = { validFrom: null, validUntil: night("2026-12-31") };
  assert.deepEqual(nightsCoveredByTaxRule(until, night("2026-12-30"), 2), { covered: 2, coversArrival: true });
  assert.deepEqual(nightsCoveredByTaxRule({ validFrom: night("2027-01-01") }, night("2026-12-30"), 2), { covered: 0, coversArrival: false });
  assert.deepEqual(nightsCoveredByTaxRule({}, night("2026-12-30"), 3), { covered: 3, coversArrival: true });

  assert.deepEqual(touristTaxPeriodFilter(night("2026-12-30"), night("2027-01-01")), {
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: night("2026-12-31") } }] },
      { OR: [{ validUntil: null }, { validUntil: { gte: night("2026-12-30") } }] },
    ],
  });
});
