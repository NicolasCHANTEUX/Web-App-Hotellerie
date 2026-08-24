import { Prisma } from "../../generated/prisma/client.js";
import { BookingError } from "./booking.errors.js";

type FixedTaxCalculationMode =
  | "PER_ADULT_PER_NIGHT"
  | "PER_PERSON_PER_NIGHT"
  | "PER_NIGHT"
  | "PER_STAY";

type TaxCalculationMode = FixedTaxCalculationMode | "PERCENTAGE";

export function roundMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function percentageTax(base: Prisma.Decimal, rate: Prisma.Decimal) {
  return roundMoney(base.mul(rate).div(100));
}

export function fixedTaxQuantity(
  mode: FixedTaxCalculationMode,
  nights: number,
  adults: number,
  children: number,
) {
  if (mode === "PER_ADULT_PER_NIGHT") return adults * nights;
  if (mode === "PER_PERSON_PER_NIGHT") return (adults + children) * nights;
  if (mode === "PER_NIGHT") return nights;
  return 1;
}

export function priceTaxRule(
  rule: {
    calculationMode: TaxCalculationMode;
    rate: Prisma.Decimal | null;
    amount: Prisma.Decimal | null;
  },
  taxableBase: Prisma.Decimal,
  nights: number,
  adults: number,
  children: number,
) {
  if (rule.calculationMode === "PERCENTAGE") {
    return {
      quantity: new Prisma.Decimal(1),
      taxableBase,
      amount: percentageTax(taxableBase, rule.rate ?? new Prisma.Decimal(0)),
    };
  }

  const quantity = fixedTaxQuantity(rule.calculationMode, nights, adults, children);
  return {
    quantity: new Prisma.Decimal(quantity),
    taxableBase: new Prisma.Decimal(0),
    amount: roundMoney((rule.amount ?? new Prisma.Decimal(0)).mul(quantity)),
  };
}

export function moneyToCents(total: Prisma.Decimal) {
  return Number(total.mul(100).toFixed(0));
}

export function assertExpectedTotal(expectedTotal: number, calculatedTotal: Prisma.Decimal) {
  if (expectedTotal !== moneyToCents(calculatedTotal)) {
    throw new BookingError(
      409,
      "PRICE_CHANGED",
      "Le prix du séjour a changé. Actualisez les disponibilités avant de confirmer.",
    );
  }
}
