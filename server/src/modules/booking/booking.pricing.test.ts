import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { BookingError } from "./booking.errors.js";
import { assertExpectedTotal, moneyToCents } from "./booking.pricing.js";

test("convertit un montant décimal en centimes sans perte flottante", () => {
  assert.equal(moneyToCents(new Prisma.Decimal("499.50")), 49_950);
  assert.equal(moneyToCents(new Prisma.Decimal("0.01")), 1);
});

test("accepte le prix attendu exact et refuse un prix obsolète", () => {
  assert.doesNotThrow(() => assertExpectedTotal(49_950, new Prisma.Decimal("499.50")));
  assert.throws(
    () => assertExpectedTotal(49_949, new Prisma.Decimal("499.50")),
    (error: unknown) =>
      error instanceof BookingError && error.statusCode === 409 && error.code === "PRICE_CHANGED",
  );
});
