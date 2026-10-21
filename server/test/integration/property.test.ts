import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import type { AdminPropertySettings } from "../../src/modules/admin/admin.property.js";
import { getAdminPropertySettings, updateAdminPropertySettings } from "../../src/modules/admin/admin.property.service.js";
import { confirmAdminBooking } from "../../src/modules/admin/admin.service.js";
import { recordManualPayment } from "../../src/modules/billing/billing.service.js";
import { createBooking } from "../../src/modules/booking/booking.service.js";
import { bookingRequest, createReceptionist, createTestHotel, type TestHotel } from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

const legalNotice = {
  legalName: "Rivage Hôtellerie",
  legalForm: "SAS",
  shareCapital: "10 000 €",
  siret: "81234567800012",
  registrationCity: "Cannes",
  vatNumber: "FR12812345678",
  publicationDirector: "Claire Martin",
  hostingProvider: "Hébergeur SAS, 1 rue du Serveur, 75000 Paris",
  mediator: "Médiateur du tourisme, BP 80303, 75823 Paris Cedex 17",
};

async function paidInvoiceIssuer(hotel: TestHotel, reception: Awaited<ReturnType<typeof createReceptionist>>, arrivalInDays: number) {
  const booking = await createBooking(await bookingRequest(hotel, { arrivalInDays }), randomUUID());
  await confirmAdminBooking(reception.membership, reception.adminUserId, booking.id);
  await recordManualPayment(reception.membership, reception.adminUserId, booking.id, `manual:${randomUUID()}`, { paymentMethodType: "Carte bancaire" });
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { bookingId: booking.id } });
  return invoice.issuerSnapshot as Record<string, unknown>;
}

test("met à jour l'établissement et n'applique ses mentions légales qu'aux nouvelles factures", async () => {
  const hotel = await createTestHotel({ rooms: 2 });
  const reception = await createReceptionist(hotel);
  const before = await paidInvoiceIssuer(hotel, reception, 30);
  const current = await getAdminPropertySettings(hotel.property.id);
  const { id: _id, slug: _slug, timezone: _timezone, currency: _currency, updatedAt, ...settings } = current;

  const updated = await updateAdminPropertySettings(reception.membership, reception.adminUserId, {
    ...(settings as AdminPropertySettings),
    ...legalNotice,
    checkInTime: "16:00",
    updatedAt: new Date(updatedAt),
  });

  assert.equal(updated.checkInTime, "16:00");
  assert.equal(updated.siret, "81234567800012");
  assert.equal(updated.slug, hotel.property.slug);
  const after = await paidInvoiceIssuer(hotel, reception, 60);
  assert.equal(before.siret, null);
  assert.equal(after.siret, "81234567800012");
  assert.equal(after.legalName, "Rivage Hôtellerie");
  assert.equal(after.vatNumber, "FR12812345678");

  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: hotel.property.id, action: "PROPERTY_UPDATED" } });
  assert.equal((audit.before as Record<string, unknown>).checkInTime, "15:00");
  assert.equal((audit.after as Record<string, unknown>).checkInTime, "16:00");
  await assert.rejects(
    () => updateAdminPropertySettings(reception.membership, reception.adminUserId, { ...(settings as AdminPropertySettings), updatedAt: new Date(updatedAt) }),
    (error: unknown) => error instanceof AdminApiError && error.code === "PROPERTY_VERSION_CONFLICT",
  );
});
