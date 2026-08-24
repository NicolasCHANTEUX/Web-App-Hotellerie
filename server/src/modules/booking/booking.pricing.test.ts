import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { BookingError } from "./booking.errors.js";
import {
  assertExpectedTotal,
  fixedTaxQuantity,
  moneyToCents,
  percentageTax,
  priceTaxRule,
} from "./booking.pricing.js";

test("convertit un montant décimal en centimes sans perte flottante", () => {
  assert.equal(moneyToCents(new Prisma.Decimal("499.50")), 49_950);
  assert.equal(moneyToCents(new Prisma.Decimal("0.01")), 1);
});

test("calcule chaque taxe en centimes avant de composer le total", () => {
  assert.equal(percentageTax(new Prisma.Decimal("199.95"), new Prisma.Decimal("10")).toFixed(2), "20.00");
  assert.equal(percentageTax(new Prisma.Decimal("18"), new Prisma.Decimal("5.5")).toFixed(2), "0.99");
});

test("calcule la quantité d'une taxe fixe selon sa règle", () => {
  assert.equal(fixedTaxQuantity("PER_ADULT_PER_NIGHT", 3, 2, 1), 6);
  assert.equal(fixedTaxQuantity("PER_PERSON_PER_NIGHT", 3, 2, 1), 9);
  assert.equal(fixedTaxQuantity("PER_NIGHT", 3, 2, 1), 3);
  assert.equal(fixedTaxQuantity("PER_STAY", 3, 2, 1), 1);
});

test("valorise une règle de taxe fixe ou proportionnelle avec le même arrondi", () => {
  const fixed = priceTaxRule(
    { calculationMode: "PER_ADULT_PER_NIGHT", rate: null, amount: new Prisma.Decimal("2.15") },
    new Prisma.Decimal("300"),
    2,
    2,
    1,
  );
  assert.equal(fixed.quantity.toFixed(0), "4");
  assert.equal(fixed.amount.toFixed(2), "8.60");

  const percentage = priceTaxRule(
    { calculationMode: "PERCENTAGE", rate: new Prisma.Decimal("3.5"), amount: null },
    new Prisma.Decimal("199.90"),
    2,
    2,
    0,
  );
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
