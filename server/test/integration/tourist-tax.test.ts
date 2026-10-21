import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import type { AdminTouristTaxFields } from "../../src/modules/admin/admin.tourist-tax.js";
import {
  createAdminTouristTax,
  deleteAdminTouristTax,
  listAdminTouristTaxes,
  updateAdminTouristTax,
} from "../../src/modules/admin/admin.tourist-tax.service.js";
import { searchAvailability } from "../../src/modules/availability/availability.service.js";
import { getBookingQuote } from "../../src/modules/booking/booking.quote.service.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { NIGHTLY_PRICE, bookingRequest, createReceptionist, createTestHotel, dateFromToday } from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

const perAdult: AdminTouristTaxFields = {
  label: "Taxe de séjour",
  calculationMode: "PER_ADULT_PER_NIGHT",
  amount: 1.5,
  rate: null,
  validFrom: null,
  validUntil: null,
  isActive: true,
};

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

async function touristTaxLines(bookingId: string) {
  const lines = await prisma.bookingTaxLine.findMany({
    where: { bookingId, kind: "TOURIST_TAX" },
    orderBy: { sortOrder: "asc" },
  });
  return lines.map((line) => [line.labelSnapshot, Number(line.quantitySnapshot), Number(line.amount)]);
}

test("facture chaque nuit au tarif en vigueur quand le séjour chevauche un changement de tarif", async () => {
  const hotel = await createTestHotel({ touristTax: false });
  const { membership, adminUserId } = await createReceptionist(hotel);
  // The rate changes after the night of day 40: nights 39 and 40 at 1.50, night 41 at 2.00.
  await createAdminTouristTax(membership, adminUserId, { ...perAdult, label: "Taxe de séjour actuelle", validUntil: dateFromToday(40) });
  await createAdminTouristTax(membership, adminUserId, { ...perAdult, label: "Taxe de séjour nouvelle", amount: 2, validFrom: dateFromToday(41) });
  const input = await bookingRequest(hotel, { arrivalInDays: 39, nights: 3, adults: 2 });

  const quote = await getBookingQuote(input);
  const availability = await searchAvailability({ arrival: input.arrival, departure: input.departure, adults: 2, children: 0 }, hotel.property.id);
  const booking = await createBooking(input, randomUUID());

  const expectedTax = 2 * 2 * 1.5 + 1 * 2 * 2;
  assert.equal(quote.touristTaxTotal, expectedTax);
  assert.equal(availability.roomTypes.find((roomType) => roomType.slug === hotel.roomType.slug)?.touristTaxTotal, expectedTax);
  assert.equal(booking.total, 3 * NIGHTLY_PRICE + expectedTax);
  assert.deepEqual(await touristTaxLines(booking.id), [
    ["Taxe de séjour actuelle", 4, 6],
    ["Taxe de séjour nouvelle", 2, 4],
  ]);
});

test("n'applique qu'aux nouvelles demandes une taxe modifiée ou désactivée", async () => {
  const hotel = await createTestHotel({ rooms: 3, touristTax: false });
  const { membership, adminUserId } = await createReceptionist(hotel);
  const rule = await createAdminTouristTax(membership, adminUserId, perAdult);
  const before = await createBooking(await bookingRequest(hotel, { nights: 2 }), randomUUID());

  const raised = await updateAdminTouristTax(membership, adminUserId, rule.id, { ...perAdult, amount: 2.5, updatedAt: new Date(rule.updatedAt) });
  const after = await createBooking(await bookingRequest(hotel, { nights: 2 }), randomUUID());
  await updateAdminTouristTax(membership, adminUserId, rule.id, { ...perAdult, amount: 2.5, isActive: false, updatedAt: new Date(raised.updatedAt) });
  const withoutTax = await createBooking(await bookingRequest(hotel, { nights: 2 }), randomUUID());

  assert.deepEqual(await touristTaxLines(before.id), [["Taxe de séjour", 4, 6]]);
  assert.deepEqual(await touristTaxLines(after.id), [["Taxe de séjour", 4, 10]]);
  assert.deepEqual(await touristTaxLines(withoutTax.id), []);
  await assert.rejects(
    () => updateAdminTouristTax(membership, adminUserId, rule.id, { ...perAdult, updatedAt: new Date(rule.updatedAt) }),
    adminError("TOURIST_TAX_VERSION_CONFLICT"),
  );
});

test("ne supprime qu'une taxe jamais facturée", async () => {
  const hotel = await createTestHotel({ touristTax: false });
  const { membership, adminUserId } = await createReceptionist(hotel);
  const used = await createAdminTouristTax(membership, adminUserId, perAdult);
  const future = await createAdminTouristTax(membership, adminUserId, { ...perAdult, amount: 2, validFrom: dateFromToday(400) });
  await createBooking(await bookingRequest(hotel), randomUUID());

  const listed = await listAdminTouristTaxes(hotel.property.id);
  assert.deepEqual(listed.map((rule) => [rule.code, rule.usageCount, rule.canDelete]), [
    ["TAXE_DE_SEJOUR", 1, false],
    ["TAXE_DE_SEJOUR_2", 0, true],
  ]);
  await assert.rejects(
    () => deleteAdminTouristTax(membership, adminUserId, used.id, { updatedAt: new Date(used.updatedAt) }),
    adminError("TOURIST_TAX_IN_USE"),
  );
  await deleteAdminTouristTax(membership, adminUserId, future.id, { updatedAt: new Date(future.updatedAt) });
  assert.deepEqual((await listAdminTouristTaxes(hotel.property.id)).map((rule) => rule.id), [used.id]);
  const audit = await prisma.auditLog.findMany({ where: { entityId: future.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audit.map((item) => item.action), ["TOURIST_TAX_CREATED", "TOURIST_TAX_DELETED"]);
});
