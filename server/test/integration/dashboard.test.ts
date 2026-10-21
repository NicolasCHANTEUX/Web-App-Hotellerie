import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { getAdminDashboard } from "../../src/modules/admin/admin.dashboard.service.js";
import { confirmAdminBooking } from "../../src/modules/admin/admin.service.js";
import { recordManualPayment } from "../../src/modules/billing/billing.service.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { createContactRequest } from "../../src/modules/contact/contact.service.js";
import { bookingRequest, createReceptionist, createTestHotel, dateFromToday } from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

test("résume les mouvements du jour, les options, la semaine et les encaissements du mois", async () => {
  const hotel = await createTestHotel({ rooms: 3 });
  const reception = await createReceptionist(hotel);
  // Noon UTC is the same calendar day at the property, whatever the hour the test runs.
  const now = new Date(dateFromToday(0).getTime() + 12 * 3_600_000);

  const arriving = await createBooking(await bookingRequest(hotel, { arrivalInDays: 0, nights: 2 }), randomUUID());
  await confirmAdminBooking(reception.membership, reception.adminUserId, arriving.id);
  await recordManualPayment(reception.membership, reception.adminUserId, arriving.id, `manual:${randomUUID()}`, { paymentMethodType: "Carte bancaire" });
  const option = await createBooking(await bookingRequest(hotel, { arrivalInDays: 3, nights: 2 }), randomUUID());
  // A guest leaving today, checked in two days ago.
  const leaving = await createBooking(await bookingRequest(hotel, { arrivalInDays: 10, nights: 2 }), randomUUID());
  await confirmAdminBooking(reception.membership, reception.adminUserId, leaving.id);
  await prisma.booking.update({ where: { id: leaving.id }, data: { checkIn: dateFromToday(-2), checkOut: dateFromToday(0), status: "CHECKED_IN" } });
  await prisma.roomAllocation.updateMany({ where: { bookingRoom: { bookingId: leaving.id } }, data: { checkIn: dateFromToday(-2), checkOut: dateFromToday(0) } });
  await createContactRequest({ fullName: "Sophie Martin", email: "sophie@example.com", subject: "OTHER", message: "Avez-vous un parking pour une voiture ?", privacyAccepted: true }, randomUUID());

  const dashboard = await getAdminDashboard(reception.membership, now);

  assert.equal(dashboard.date, dateFromToday(0).toISOString().slice(0, 10));
  assert.deepEqual(dashboard.arrivals.map((booking) => booking.id), [arriving.id]);
  assert.deepEqual(dashboard.departures.map((booking) => booking.id), [leaving.id]);
  assert.deepEqual(dashboard.pendingOptions.map((booking) => booking.id), [option.id]);
  assert.equal(dashboard.pendingOptionsTotal, 1);
  assert.deepEqual(dashboard.occupancy.map((night) => night.occupied), [1, 1, 0, 1, 1, 0, 0]);
  assert.ok(dashboard.occupancy.every((night) => night.available === 3 && night.blocked === 0));
  assert.equal(dashboard.openContactRequests, 1);
  assert.deepEqual(dashboard.finance && {
    collected: dashboard.finance.collected,
    refunded: dashboard.finance.refunded,
    net: dashboard.finance.net,
    bookingsCount: dashboard.finance.bookingsCount,
    bookingsTotal: dashboard.finance.bookingsTotal,
  }, {
    collected: arriving.total,
    refunded: 0,
    net: arriving.total,
    bookingsCount: 3,
    bookingsTotal: arriving.total + option.total + leaving.total,
  });

  const accounting = await getAdminDashboard({ ...reception.membership, role: "ACCOUNTING" }, now);
  assert.equal(accounting.openContactRequests, null);
  assert.ok(accounting.finance);
  assert.equal(accounting.arrivals[0]?.guest?.email, null);
  const front = await getAdminDashboard({ ...reception.membership, role: "RECEPTION" }, now);
  assert.equal(front.finance, null);
  assert.match(String(front.arrivals[0]?.guest?.email), /@/);
});
