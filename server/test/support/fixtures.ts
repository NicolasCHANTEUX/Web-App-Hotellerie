import { createHash, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { env } from "../../src/config/env.js";
import type { AdminMembershipContext } from "../../src/modules/admin/admin.auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { getBookingQuote } from "../../src/modules/booking/booking.quote.service.js";
import type { CreateBookingInput } from "../../src/modules/booking/booking.types.js";
import { processStripeEvent } from "../../src/modules/payments/payment.service.js";

export const NIGHTLY_PRICE = 120;
export const TOURIST_TAX_PER_ADULT_PER_NIGHT = 1.5;

export function dateFromToday(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export type TestHotel = Awaited<ReturnType<typeof createTestHotel>>;

/**
 * A complete establishment of its own, so that each test owns its rooms and
 * availability whatever else the database contains. It becomes the property
 * of the public site, as PUBLIC_PROPERTY_SLUG makes it in production, unless
 * `publicSite` is false.
 */
export async function createTestHotel({ rooms = 2, touristTax = true, publicSite = true }: { rooms?: number; touristTax?: boolean; publicSite?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const property = await prisma.property.create({
    data: {
      slug: `test-${suffix}`,
      name: `Hôtel test ${suffix}`,
      email: `hotel-${suffix}@example.com`,
      addressLine1: "1 rue des Essais",
      postalCode: "44000",
      city: "Nantes",
    },
  });
  if (publicSite) env.publicPropertySlug = property.slug;
  const termsBody = "Conditions de réservation de test.";
  await prisma.contractTermsVersion.create({
    data: {
      propertyId: property.id,
      code: "BOOKING_TERMS",
      version: 1,
      title: "Conditions de réservation",
      body: termsBody,
      checksumSha256: createHash("sha256").update(termsBody).digest("hex"),
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  if (touristTax) {
    await prisma.taxRule.create({
      data: {
        propertyId: property.id,
        code: "TOURIST_TAX",
        label: "Taxe de séjour",
        kind: "TOURIST_TAX",
        calculationMode: "PER_ADULT_PER_NIGHT",
        amount: TOURIST_TAX_PER_ADULT_PER_NIGHT,
        currency: "EUR",
      },
    });
  }
  const roomType = await prisma.roomType.create({
    data: {
      propertyId: property.id,
      slug: "chambre-test",
      name: "Chambre test",
      description: "Chambre utilisée par les tests d'intégration.",
      surfaceSqm: 20,
      maxAdults: 2,
      maxChildren: 1,
      maxGuests: 3,
      bedLabel: "1 lit double",
      coverImageUrl: "/images/hotel/hero-1280.webp",
    },
  });
  await prisma.ratePlan.create({
    data: {
      propertyId: property.id,
      roomTypeId: roomType.id,
      code: "FLEX",
      name: "Tarif flexible",
      basePricePerNight: NIGHTLY_PRICE,
      priceTaxMode: "INCLUSIVE",
    },
  });
  const createdRooms = [];
  for (let index = 1; index <= rooms; index += 1) {
    createdRooms.push(await prisma.room.create({
      data: { propertyId: property.id, roomTypeId: roomType.id, number: String(100 + index), floor: 1 },
    }));
  }
  return { property, roomType, rooms: createdRooms };
}

/** A hotel season, priced for the test room type unless `nightlyPrice` is null. */
export async function createSeason(
  hotel: TestHotel,
  season: { label?: string; firstNightInDays: number; lastNightInDays: number; minNights?: number; nightlyPrice?: number | null; weekendNightlyPrice?: number },
) {
  return prisma.season.create({
    data: {
      propertyId: hotel.property.id,
      label: season.label ?? "Haute saison",
      validFrom: dateFromToday(season.firstNightInDays),
      validUntil: dateFromToday(season.lastNightInDays),
      minNights: season.minNights ?? null,
      ...(season.nightlyPrice === null ? {} : {
        rates: {
          create: {
            roomTypeId: hotel.roomType.id,
            nightlyPrice: season.nightlyPrice ?? 180,
            weekendNightlyPrice: season.weekendNightlyPrice ?? null,
          },
        },
      }),
    },
  });
}

export async function createReceptionist(hotel: TestHotel) {
  const suffix = randomUUID().slice(0, 8);
  const adminUser = await prisma.adminUser.create({
    data: {
      authSubject: `auth-${suffix}`,
      email: `reception-${suffix}@example.com`,
      displayName: "Réception test",
      memberships: { create: { propertyId: hotel.property.id, role: "ADMIN" } },
    },
  });
  const membership: AdminMembershipContext = {
    propertyId: hotel.property.id,
    role: "ADMIN",
    createdAt: new Date(),
    property: {
      id: hotel.property.id,
      name: hotel.property.name,
      slug: hotel.property.slug,
      timezone: hotel.property.timezone,
      currency: hotel.property.currency,
    },
  };
  return { adminUserId: adminUser.id, membership };
}

let contactSequence = 0;

/** A public request whose expected total comes from the real quote. */
export async function bookingRequest(
  hotel: TestHotel,
  { arrivalInDays = 30, nights = 2, adults = 2 }: { arrivalInDays?: number; nights?: number; adults?: number } = {},
): Promise<CreateBookingInput> {
  contactSequence += 1;
  const selection = {
    roomTypeId: hotel.roomType.id,
    arrival: dateFromToday(arrivalInDays),
    departure: dateFromToday(arrivalInDays + nights),
    adults,
    children: 0,
    extraIds: [],
  };
  const quote = await getBookingQuote(selection);
  return {
    ...selection,
    expectedTotal: Math.round(quote.total * 100),
    termsAccepted: true,
    guest: {
      firstName: "Camille",
      lastName: "Martin",
      email: `guest-${contactSequence}-${randomUUID().slice(0, 8)}@example.com`,
      phone: `+33 6 ${String(contactSequence).padStart(8, "0")}`,
    },
  };
}

export async function expireHold(bookingId: string) {
  await prisma.reservationHold.update({
    where: { bookingId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
}

/** The payment record created when the guest opens Stripe Checkout. */
export async function createStripePayment(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return prisma.payment.create({
    data: {
      propertyId: booking.propertyId,
      bookingId,
      provider: "STRIPE",
      idempotencyKey: `stripe-checkout:${bookingId}:${randomUUID()}`,
      kind: "CHARGE",
      status: "PROCESSING",
      amount: booking.total,
      currency: booking.currency,
      paymentMethodType: "card",
    },
  });
}

/** Delivers a signed-and-verified Stripe event, as the webhook route does. */
export async function deliverStripeEvent(type: string, object: Record<string, unknown>) {
  const event = { id: `evt_${randomUUID()}`, type, livemode: false, data: { object } } as unknown as Stripe.Event;
  const result = await processStripeEvent(event, Buffer.from(JSON.stringify(event)));
  return { event, result };
}

export function checkoutCompleted(paymentId: string) {
  return deliverStripeEvent("checkout.session.completed", {
    metadata: { paymentId },
    payment_status: "paid",
    payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
    payment_method_types: ["card"],
  });
}
