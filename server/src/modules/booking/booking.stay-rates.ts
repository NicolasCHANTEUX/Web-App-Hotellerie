import { Prisma } from "../../generated/prisma/client.js";
import { discountedPrice, roundMoney } from "./booking.pricing.js";

const DAY_MS = 86_400_000;

export type StaySeason = {
  id: string;
  label: string;
  /** First and last nights of the season, both included. */
  validFrom: Date;
  validUntil: Date;
  minNights: number | null;
};

export type StaySeasonRate = {
  seasonId: string;
  nightlyPrice: Prisma.Decimal;
  weekendNightlyPrice: Prisma.Decimal | null;
};

export type StayPromotion = {
  id: string;
  label: string;
  discountPercent: Prisma.Decimal;
  validFrom: Date;
  /** Day after the last promoted night, as stored for promotions. */
  validUntil: Date | null;
};

export type PricedNight = {
  date: Date;
  season: StaySeason | null;
  weekend: boolean;
  regularPrice: Prisma.Decimal;
  promotion: StayPromotion | null;
  price: Prisma.Decimal;
};

function lastNight(departure: Date) {
  return new Date(departure.getTime() - DAY_MS);
}

/** Seasons sharing at least one night with the stay [arrival, departure). */
export function seasonsOverlappingStay(arrival: Date, departure: Date): Prisma.SeasonWhereInput {
  return { validFrom: { lte: lastNight(departure) }, validUntil: { gte: arrival } };
}

/** Active promotions sharing at least one night with the stay [arrival, departure). */
export function promotionsOverlappingStay(arrival: Date, departure: Date): Prisma.RoomTypePromotionWhereInput {
  return {
    isActive: true,
    validFrom: { lte: lastNight(departure) },
    OR: [{ validUntil: null }, { validUntil: { gt: arrival } }],
  };
}

/** Room type relations needed to price a stay night by night. */
export function stayPricingRelations(arrival: Date, departure: Date) {
  return {
    promotions: { where: promotionsOverlappingStay(arrival, departure), orderBy: { validFrom: "asc" as const } },
    seasonRates: { where: { season: seasonsOverlappingStay(arrival, departure) } },
  };
}

/** Property seasons touched by a stay, for its prices and minimum length. */
export function staySeasonsSelection(arrival: Date, departure: Date) {
  return { where: seasonsOverlappingStay(arrival, departure), orderBy: { validFrom: "asc" as const } };
}

/** Friday and Saturday nights. */
export function isWeekendNight(night: Date) {
  const day = night.getUTCDay();
  return day === 5 || day === 6;
}

/**
 * Prices each night of a stay: the room type's price for the season of that
 * night, its weekend price on Friday and Saturday nights when set, otherwise
 * the base price. A promotion takes its percentage off each night it covers.
 */
export function priceStayNights(input: {
  arrival: Date;
  nights: number;
  basePrice: Prisma.Decimal;
  seasons: StaySeason[];
  rates: StaySeasonRate[];
  promotions: StayPromotion[];
}) {
  const ratesBySeason = new Map(input.rates.map((rate) => [rate.seasonId, rate]));
  const nights: PricedNight[] = [];
  for (let index = 0; index < input.nights; index += 1) {
    const date = new Date(input.arrival.getTime() + index * DAY_MS);
    const season = input.seasons.find((item) => item.validFrom <= date && item.validUntil >= date) ?? null;
    const rate = season ? ratesBySeason.get(season.id) : undefined;
    const weekend = isWeekendNight(date);
    const regularPrice = rate
      ? (weekend && rate.weekendNightlyPrice ? rate.weekendNightlyPrice : rate.nightlyPrice)
      : input.basePrice;
    const promotion = input.promotions.find((item) => item.validFrom <= date && (!item.validUntil || item.validUntil > date)) ?? null;
    const price = promotion ? discountedPrice(regularPrice, promotion.discountPercent) : regularPrice;
    nights.push({ date, season, weekend, regularPrice, promotion, price });
  }

  const sum = (values: Prisma.Decimal[]) => roundMoney(values.reduce((total, value) => total.add(value), new Prisma.Decimal(0)));
  const total = sum(nights.map((night) => night.price));
  const regularTotal = sum(nights.map((night) => night.regularPrice));
  // The most demanding minimum stay among the seasons the stay touches.
  const minStay = nights
    .map((night) => night.season)
    .filter((season): season is StaySeason => season?.minNights != null)
    .reduce<StaySeason | null>((strictest, season) => (!strictest || season.minNights! > strictest.minNights! ? season : strictest), null);

  return {
    nights,
    total,
    regularTotal,
    averagePrice: nights.length ? roundMoney(total.div(nights.length)) : new Prisma.Decimal(0),
    minStay: minStay && input.nights < minStay.minNights!
      ? { minNights: minStay.minNights!, seasonLabel: minStay.label }
      : null,
    promotion: nights.find((night) => night.promotion)?.promotion ?? null,
  };
}

/** Night-by-night part of a quote, for the website and the reception. */
export function quotedStay(stayRates: ReturnType<typeof priceStayNights>) {
  const { promotion, nights } = stayRates;
  return {
    // Average over the stay; each night's price is detailed in `nights`.
    unitPrice: Number(stayRates.averagePrice),
    regularTotal: Number(stayRates.regularTotal),
    nights: nights.map((night) => ({
      date: night.date.toISOString().slice(0, 10),
      season: night.season?.label ?? null,
      weekend: night.weekend,
      regularPrice: Number(night.regularPrice),
      price: Number(night.price),
    })),
    promotion: promotion ? {
      id: promotion.id,
      label: promotion.label,
      discountPercent: Number(promotion.discountPercent),
      referenceUnitPrice: Number(roundMoney(stayRates.regularTotal.div(nights.length))),
    } : null,
  };
}

/** Night-by-night detail frozen with a booking. */
export function nightlyRatesSnapshot(nights: PricedNight[]) {
  return nights.map((night) => ({
    date: night.date.toISOString().slice(0, 10),
    season: night.season?.label ?? null,
    weekend: night.weekend,
    regularPrice: night.regularPrice.toFixed(2),
    promotion: night.promotion?.label ?? null,
    price: night.price.toFixed(2),
  }));
}

export function minStayMessage(minStay: { minNights: number; seasonLabel: string }) {
  return `Pendant la période « ${minStay.seasonLabel} », les séjours comptent au moins ${minStay.minNights} nuits.`;
}
