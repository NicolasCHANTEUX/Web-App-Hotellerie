import { Prisma } from "../../generated/prisma/client.js";
import { BookingError } from "./booking.errors.js";

type FixedTaxCalculationMode =
  | "PER_ADULT_PER_NIGHT"
  | "PER_PERSON_PER_NIGHT"
  | "PER_NIGHT"
  | "PER_STAY";

type TaxCalculationMode = FixedTaxCalculationMode | "PERCENTAGE";
type PricingUnit = "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "ONE_TIME";

export function roundMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function percentageTax(base: Prisma.Decimal, rate: Prisma.Decimal) {
  return roundMoney(base.mul(rate).div(100));
}

export function includedPercentageTax(gross: Prisma.Decimal, rate: Prisma.Decimal) {
  if (rate.isZero()) return new Prisma.Decimal(0);
  return roundMoney(gross.mul(rate).div(new Prisma.Decimal(100).add(rate)));
}

export function netFromGross(gross: Prisma.Decimal, includedTax: Prisma.Decimal) {
  return roundMoney(gross.sub(includedTax));
}

export function discountedPrice(referencePrice: Prisma.Decimal, discountPercent: Prisma.Decimal) {
  return roundMoney(referencePrice.mul(new Prisma.Decimal(100).sub(discountPercent)).div(100));
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

function quantityForPricingUnit(unit: PricingUnit, nights: number, guests: number) {
  if (unit === "PER_PERSON_PER_NIGHT") return nights * guests;
  if (unit === "PER_NIGHT") return nights;
  return 1;
}

export function buildTaxInclusivePrice<TExtra, TTaxRule>(input: {
  nightlyPrice: Prisma.Decimal;
  accommodationTaxRate: Prisma.Decimal;
  nights: number;
  adults: number;
  children: number;
  extras: Array<{
    item: TExtra;
    price: Prisma.Decimal;
    pricingUnit: PricingUnit;
    taxRate: Prisma.Decimal | null;
  }>;
  taxRules: Array<{
    rule: TTaxRule;
    calculationMode: TaxCalculationMode;
    rate: Prisma.Decimal | null;
    amount: Prisma.Decimal | null;
  }>;
}) {
  const guests = input.adults + input.children;
  const accommodationTotal = roundMoney(input.nightlyPrice.mul(input.nights));
  const accommodationTax = includedPercentageTax(accommodationTotal, input.accommodationTaxRate);
  const accommodationSubtotal = netFromGross(accommodationTotal, accommodationTax);

  const extras = input.extras.map(({ item, price, pricingUnit, taxRate: configuredTaxRate }) => {
    const quantity = quantityForPricingUnit(pricingUnit, input.nights, guests);
    const taxRate = configuredTaxRate ?? input.accommodationTaxRate;
    const lineTotal = roundMoney(price.mul(quantity));
    const taxAmount = includedPercentageTax(lineTotal, taxRate);
    return {
      item,
      quantity,
      unitPrice: price,
      pricingUnit,
      taxRate,
      lineSubtotal: netFromGross(lineTotal, taxAmount),
      taxAmount,
      lineTotal,
    };
  });
  const extrasTotal = roundMoney(
    extras.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0)),
  );
  const extrasSubtotal = roundMoney(
    extras.reduce((total, item) => total.add(item.lineSubtotal), new Prisma.Decimal(0)),
  );
  const extrasTax = roundMoney(
    extras.reduce((total, item) => total.add(item.taxAmount), new Prisma.Decimal(0)),
  );

  const touristTaxes = input.taxRules.map(({ rule, ...taxRule }) => ({
    rule,
    ...priceTaxRule(taxRule, accommodationTotal, input.nights, input.adults, input.children),
  }));
  const touristTaxTotal = roundMoney(
    touristTaxes.reduce((total, item) => total.add(item.amount), new Prisma.Decimal(0)),
  );
  const vatTotal = roundMoney(accommodationTax.add(extrasTax));
  const taxTotal = roundMoney(vatTotal.add(touristTaxTotal));
  const subtotal = roundMoney(accommodationSubtotal.add(extrasSubtotal));
  const totalBeforeTouristTax = roundMoney(accommodationTotal.add(extrasTotal));
  const total = roundMoney(totalBeforeTouristTax.add(touristTaxTotal));

  return {
    accommodationSubtotal,
    accommodationTax,
    accommodationTotal,
    extras,
    extrasSubtotal,
    extrasTax,
    extrasTotal,
    touristTaxes,
    touristTaxTotal,
    vatTotal,
    taxTotal,
    subtotal,
    totalBeforeTouristTax,
    total,
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
