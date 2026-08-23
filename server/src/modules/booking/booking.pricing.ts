import { Prisma } from "../../generated/prisma/client.js";
import { BookingError } from "./booking.errors.js";

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
