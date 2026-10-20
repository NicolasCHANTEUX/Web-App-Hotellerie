import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import type { AdminExtraFields } from "../../src/modules/admin/admin.extra.js";
import { createAdminExtra, deleteAdminExtra, listAdminExtras, updateAdminExtra } from "../../src/modules/admin/admin.extra.service.js";
import { BookingError } from "../../src/modules/booking/booking.errors.js";
import { getBookingQuote } from "../../src/modules/booking/booking.quote.service.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { listExtras } from "../../src/modules/catalog/catalog.service.js";
import {
  NIGHTLY_PRICE,
  TOURIST_TAX_PER_ADULT_PER_NIGHT,
  bookingRequest,
  createReceptionist,
  createTestHotel,
  type TestHotel,
} from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

const breakfast: AdminExtraFields = {
  name: "Petit-déjeuner",
  description: "Buffet maison chaque matin",
  price: 18,
  pricingUnit: "PER_PERSON_PER_NIGHT",
  taxRate: 10,
  isActive: true,
  displayOrder: 1,
};

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

async function bookWithExtra(hotel: TestHotel, extraId: string) {
  const request = await bookingRequest(hotel, { nights: 2, adults: 2 });
  const withExtra = { ...request, extraIds: [extraId] };
  const quote = await getBookingQuote(withExtra);
  return createBooking({ ...withExtra, expectedTotal: Math.round(quote.total * 100) }, randomUUID());
}

test("rend une nouvelle option réservable et la facture selon son unité", async () => {
  const hotel = await createTestHotel();
  const { membership, adminUserId } = await createReceptionist(hotel);

  const extra = await createAdminExtra(membership, adminUserId, breakfast);

  assert.equal(extra.code, "PETIT_DEJEUNER");
  assert.equal(extra.currency, "EUR");
  assert.deepEqual((await listExtras(hotel.property.id)).map((item) => item.name), ["Petit-déjeuner"]);
  const booking = await bookWithExtra(hotel, extra.id);
  assert.deepEqual(booking.options, ["Petit-déjeuner"]);
  // Room for 2 nights and tourist tax for 2 adults, plus 2 nights x 2 adults x 18 €.
  assert.equal(booking.total, 2 * NIGHTLY_PRICE + 2 * 2 * TOURIST_TAX_PER_ADULT_PER_NIGHT + 2 * 2 * 18);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: extra.id, action: "EXTRA_CREATED" } });
  assert.equal(audit.adminUserId, adminUserId);
});

test("applique un nouveau prix aux seules nouvelles demandes", async () => {
  const hotel = await createTestHotel({ rooms: 2 });
  const { membership, adminUserId } = await createReceptionist(hotel);
  const extra = await createAdminExtra(membership, adminUserId, breakfast);
  const before = await bookWithExtra(hotel, extra.id);

  const updated = await updateAdminExtra(membership, adminUserId, extra.id, { ...breakfast, price: 22, updatedAt: new Date(extra.updatedAt) });
  const after = await bookWithExtra(hotel, extra.id);

  assert.equal(updated.price, 22);
  const snapshots = await prisma.bookingExtra.findMany({ where: { extraId: extra.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(snapshots.map((item) => [item.bookingId, Number(item.unitPriceSnapshot)]), [[before.id, 18], [after.id, 22]]);
  await assert.rejects(
    () => updateAdminExtra(membership, adminUserId, extra.id, { ...breakfast, price: 25, updatedAt: new Date(extra.updatedAt) }),
    adminError("EXTRA_VERSION_CONFLICT"),
  );
});

test("retire une option désactivée des nouvelles demandes sans toucher aux anciennes", async () => {
  const hotel = await createTestHotel({ rooms: 2 });
  const { membership, adminUserId } = await createReceptionist(hotel);
  const extra = await createAdminExtra(membership, adminUserId, breakfast);
  const existing = await bookWithExtra(hotel, extra.id);

  await updateAdminExtra(membership, adminUserId, extra.id, { ...breakfast, isActive: false, updatedAt: new Date(extra.updatedAt) });

  assert.deepEqual(await listExtras(hotel.property.id), []);
  await assert.rejects(
    async () => createBooking({ ...(await bookingRequest(hotel)), extraIds: [extra.id] }, randomUUID()),
    (error: unknown) => error instanceof BookingError && error.code === "EXTRA_NOT_AVAILABLE",
  );
  assert.equal(await prisma.bookingExtra.count({ where: { bookingId: existing.id } }), 1);
});

test("ne supprime qu'une option jamais réservée", async () => {
  const hotel = await createTestHotel();
  const { membership, adminUserId } = await createReceptionist(hotel);
  const booked = await createAdminExtra(membership, adminUserId, breakfast);
  const unused = await createAdminExtra(membership, adminUserId, { ...breakfast, name: "Parking", pricingUnit: "PER_NIGHT", price: 15 });
  await bookWithExtra(hotel, booked.id);

  const listed = await listAdminExtras(hotel.property.id);
  assert.deepEqual(listed.map((item) => [item.name, item.bookingCount, item.canDelete]), [["Parking", 0, true], ["Petit-déjeuner", 1, false]]);
  await assert.rejects(
    () => deleteAdminExtra(membership, adminUserId, booked.id, { updatedAt: new Date(booked.updatedAt) }),
    adminError("EXTRA_IN_USE"),
  );
  await deleteAdminExtra(membership, adminUserId, unused.id, { updatedAt: new Date(unused.updatedAt) });
  assert.deepEqual((await listAdminExtras(hotel.property.id)).map((item) => item.name), ["Petit-déjeuner"]);
});

test("refuse deux options du même nom et garde des codes distincts", async () => {
  const hotel = await createTestHotel();
  const { membership, adminUserId } = await createReceptionist(hotel);
  await createAdminExtra(membership, adminUserId, { ...breakfast, name: "Parking privé" });

  await assert.rejects(
    () => createAdminExtra(membership, adminUserId, { ...breakfast, name: "PARKING privé" }),
    adminError("EXTRA_NAME_CONFLICT"),
  );
  const renamed = await createAdminExtra(membership, adminUserId, { ...breakfast, name: "Parking privé !" });
  assert.equal(renamed.code, "PARKING_PRIVE_2");
});
