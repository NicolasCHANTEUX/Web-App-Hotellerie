import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { getAdminBookingUpdateQuote } from "../../src/modules/admin/admin.booking-update.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import { createAdminSeason, deleteAdminSeason, listAdminSeasons, updateAdminSeason } from "../../src/modules/admin/admin.season.service.js";
import { confirmAdminBooking } from "../../src/modules/admin/admin.service.js";
import { recordManualPayment } from "../../src/modules/billing/billing.service.js";
import { searchAvailability } from "../../src/modules/availability/availability.service.js";
import { BookingError } from "../../src/modules/booking/booking.errors.js";
import { getBookingQuote } from "../../src/modules/booking/booking.quote.service.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { isWeekendNight } from "../../src/modules/booking/booking.stay-rates.js";
import {
  NIGHTLY_PRICE,
  TOURIST_TAX_PER_ADULT_PER_NIGHT,
  bookingRequest,
  createReceptionist,
  createSeason,
  createTestHotel,
  dateFromToday,
} from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

function minStayError(error: unknown) {
  return error instanceof BookingError && error.code === "MIN_STAY_NOT_MET" && /au moins 5 nuits/.test(error.message);
}

test("facture un séjour à cheval sur une saison nuit par nuit, partout de la même façon", async () => {
  const hotel = await createTestHotel();
  await createSeason(hotel, { firstNightInDays: 40, lastNightInDays: 60, nightlyPrice: 180 });
  // Nights 38 and 39 at the base price, then 40 and 41 in the season.
  const input = await bookingRequest(hotel, { arrivalInDays: 38, nights: 4, adults: 2 });
  const accommodation = 2 * NIGHTLY_PRICE + 2 * 180;
  const touristTax = 4 * 2 * TOURIST_TAX_PER_ADULT_PER_NIGHT;

  const quote = await getBookingQuote(input);
  const availability = await searchAvailability({ arrival: input.arrival, departure: input.departure, adults: 2, children: 0 }, hotel.property.id);
  const booking = await createBooking(input, randomUUID());

  assert.equal(quote.accommodationTotal, accommodation);
  assert.equal(quote.total, accommodation + touristTax);
  assert.deepEqual(quote.room.nights.map((night) => [night.season, night.price]), [[null, 120], [null, 120], ["Haute saison", 180], ["Haute saison", 180]]);
  const searched = availability.roomTypes.find((roomType) => roomType.id === hotel.roomType.id);
  assert.equal(searched?.totalPrice, accommodation);
  assert.equal(searched?.price, accommodation / 4);
  assert.equal(booking.total, accommodation + touristTax);

  const room = await prisma.bookingRoom.findFirstOrThrow({ where: { bookingId: booking.id } });
  assert.equal(Number(room.lineTotal), accommodation);
  assert.equal(Number(room.nightlyPriceSnapshot), accommodation / 4);
  assert.deepEqual((room.nightlyRatesSnapshot as Array<{ date: string; price: string }>).map((night) => [night.date, night.price]), [
    [dateFromToday(38).toISOString().slice(0, 10), "120.00"],
    [dateFromToday(39).toISOString().slice(0, 10), "120.00"],
    [dateFromToday(40).toISOString().slice(0, 10), "180.00"],
    [dateFromToday(41).toISOString().slice(0, 10), "180.00"],
  ]);
});

test("applique le prix du week-end aux nuits du vendredi et du samedi", async () => {
  const hotel = await createTestHotel();
  await createSeason(hotel, { firstNightInDays: 30, lastNightInDays: 60, nightlyPrice: 180, weekendNightlyPrice: 230 });
  const input = await bookingRequest(hotel, { arrivalInDays: 31, nights: 7 });

  const quote = await getBookingQuote(input);

  const expected = Array.from({ length: 7 }, (_, index) => (isWeekendNight(dateFromToday(31 + index)) ? 230 : 180));
  assert.deepEqual(quote.room.nights.map((night) => night.price), expected);
  assert.equal(quote.accommodationTotal, expected.reduce((total, price) => total + price, 0));
});

test("refuse partout un séjour plus court que la durée minimale de la saison", async () => {
  const hotel = await createTestHotel();
  await createSeason(hotel, { firstNightInDays: 30, lastNightInDays: 60, minNights: 5, nightlyPrice: null });
  const longEnough = await bookingRequest(hotel, { arrivalInDays: 35, nights: 5 });
  const short = { ...longEnough, departure: dateFromToday(38) };

  await assert.rejects(() => getBookingQuote(short), minStayError);
  await assert.rejects(() => createBooking(short, randomUUID()), minStayError);
  const availability = await searchAvailability({ arrival: short.arrival, departure: short.departure, adults: 2, children: 0 }, hotel.property.id);
  assert.deepEqual(availability.roomTypes, []);
  assert.deepEqual(availability.minStay, { minNights: 5, seasonLabel: "Haute saison" });

  // A season without a price for the room type keeps the base price.
  assert.equal((await getBookingQuote(longEnough)).accommodationTotal, 5 * NIGHTLY_PRICE);
});

test("applique une promotion en pourcentage à chaque nuit couverte, saison comprise", async () => {
  const hotel = await createTestHotel();
  await createSeason(hotel, { firstNightInDays: 40, lastNightInDays: 60, nightlyPrice: 200 });
  await prisma.roomTypePromotion.create({
    data: {
      propertyId: hotel.property.id,
      roomTypeId: hotel.roomType.id,
      label: "Offre de printemps",
      discountPercent: 10,
      referencePricePerNight: NIGHTLY_PRICE,
      promotionalPricePerNight: 108,
      // Nights 39 and 40: the stored end date is the day after the last night.
      validFrom: dateFromToday(39),
      validUntil: dateFromToday(41),
    },
  });
  const input = await bookingRequest(hotel, { arrivalInDays: 38, nights: 4 });

  const quote = await getBookingQuote(input);

  assert.deepEqual(quote.room.nights.map((night) => night.price), [120, 108, 180, 200]);
  assert.equal(quote.room.regularTotal, 120 + 120 + 200 + 200);
  assert.equal(quote.room.promotion?.label, "Offre de printemps");
});

test("recalcule les nuits quand la réception déplace un séjour dans la saison", async () => {
  const hotel = await createTestHotel();
  await createSeason(hotel, { firstNightInDays: 40, lastNightInDays: 60, nightlyPrice: 180 });
  const booking = await createBooking(await bookingRequest(hotel, { arrivalInDays: 20, nights: 2 }), randomUUID());

  const moved = await getAdminBookingUpdateQuote(hotel.property.id, booking.id, {
    roomTypeId: hotel.roomType.id,
    arrival: dateFromToday(45),
    departure: dateFromToday(47),
    adults: 2,
    children: 0,
    extraIds: [],
  });

  assert.equal(moved.accommodationTotal, 2 * 180);
  assert.deepEqual(moved.room.nights.map((night) => night.season), ["Haute saison", "Haute saison"]);
});

test("interdit en base deux saisons qui se chevauchent", async () => {
  const hotel = await createTestHotel();
  await createSeason(hotel, { firstNightInDays: 40, lastNightInDays: 60 });

  await assert.rejects(() => createSeason(hotel, { label: "Fin d'été", firstNightInDays: 60, lastNightInDays: 70 }));
  await createSeason(hotel, { label: "Automne", firstNightInDays: 61, lastNightInDays: 90 });
  assert.equal(await prisma.season.count({ where: { propertyId: hotel.property.id } }), 2);
});

test("gère les saisons depuis l'administration et les applique aux nouveaux devis", async () => {
  const hotel = await createTestHotel();
  const { membership, adminUserId } = await createReceptionist(hotel);
  const summer = {
    label: "Été",
    validFrom: dateFromToday(40),
    validUntil: dateFromToday(60),
    minNights: null,
    rates: [{ roomTypeId: hotel.roomType.id, nightlyPrice: 190, weekendNightlyPrice: null }],
  };
  const input = await bookingRequest(hotel, { arrivalInDays: 45, nights: 2 });

  const created = await createAdminSeason(membership, adminUserId, summer);
  assert.equal((await getBookingQuote(input)).accommodationTotal, 2 * 190);
  const listed = await listAdminSeasons(hotel.property.id);
  assert.deepEqual(listed.roomTypes.map((roomType) => [roomType.name, roomType.basePrice]), [["Chambre test", NIGHTLY_PRICE]]);
  assert.deepEqual(listed.seasons.map((season) => [season.label, season.rates[0]?.nightlyPrice]), [["Été", 190]]);

  await assert.rejects(
    () => createAdminSeason(membership, adminUserId, { ...summer, label: "Août", validFrom: dateFromToday(55), validUntil: dateFromToday(70) }),
    (error: unknown) => error instanceof AdminApiError && error.code === "SEASON_OVERLAP" && error.message.includes("« Été »"),
  );

  const updated = await updateAdminSeason(membership, adminUserId, created.id, { ...summer, rates: [{ ...summer.rates[0]!, nightlyPrice: 210 }], updatedAt: new Date(created.updatedAt) });
  assert.equal((await getBookingQuote(input)).accommodationTotal, 2 * 210);
  await assert.rejects(
    () => updateAdminSeason(membership, adminUserId, created.id, { ...summer, updatedAt: new Date(created.updatedAt) }),
    (error: unknown) => error instanceof AdminApiError && error.code === "SEASON_VERSION_CONFLICT",
  );

  await deleteAdminSeason(membership, adminUserId, created.id, { updatedAt: new Date(updated.updatedAt) });
  assert.equal((await getBookingQuote(input)).accommodationTotal, 2 * NIGHTLY_PRICE);
  const audit = await prisma.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audit.map((item) => item.action), ["SEASON_CREATED", "SEASON_UPDATED", "SEASON_DELETED"]);
});

test("détaille la facture d'un séjour à cheval sur une saison sans écart de centime", async () => {
  const hotel = await createTestHotel();
  const reception = await createReceptionist(hotel);
  await createSeason(hotel, { firstNightInDays: 40, lastNightInDays: 60, nightlyPrice: 185 });
  const booking = await createBooking(await bookingRequest(hotel, { arrivalInDays: 38, nights: 4 }), randomUUID());
  await confirmAdminBooking(reception.membership, reception.adminUserId, booking.id);

  await recordManualPayment(reception.membership, reception.adminUserId, booking.id, `manual:${randomUUID()}`, { paymentMethodType: "Carte bancaire" });

  const invoice = await prisma.invoice.findFirstOrThrow({ where: { bookingId: booking.id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  assert.deepEqual(invoice.lines.map((line) => [line.description.replace(/ - chambre \d+/, ""), Number(line.quantity), Number(line.lineTotal)]), [
    ["Chambre test (2 nuits)", 2, 2 * NIGHTLY_PRICE],
    ["Chambre test (2 nuits · Haute saison)", 2, 2 * 185],
    ["Taxe de séjour", 8, 8 * TOURIST_TAX_PER_ADULT_PER_NIGHT],
  ]);
  const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
  assert.equal(sum(invoice.lines.map((line) => Number(line.lineTotal))), Number(invoice.total));
  assert.equal(sum(invoice.lines.map((line) => Number(line.taxAmount))), Number(invoice.taxTotal));
});
