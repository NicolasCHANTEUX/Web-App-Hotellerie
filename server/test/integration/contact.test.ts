import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import {
  countAdminContactRequests,
  getAdminContactRequest,
  listAdminContactRequests,
  setAdminContactRequestHandled,
} from "../../src/modules/admin/admin.contact.service.js";
import { AdminApiError } from "../../src/modules/admin/admin.errors.js";
import { createContactRequest } from "../../src/modules/contact/contact.service.js";
import type { ContactRequestInput } from "../../src/modules/contact/contact.types.js";
import { anonymizeExpiredContactRequests } from "../../src/modules/privacy/retention.service.js";
import { createReceptionist, createTestHotel } from "../support/fixtures.js";

test.after(() => prisma.$disconnect());

function adminError(code: string) {
  return (error: unknown) => error instanceof AdminApiError && error.code === code;
}

function contactRequest(overrides: Partial<ContactRequestInput> = {}): ContactRequestInput {
  return {
    fullName: "Sophie Martin",
    email: "sophie@example.com",
    phone: "+33612345678",
    subject: "ARRIVAL",
    message: "Bonjour, nous arriverons vers 23 heures. Est-ce possible ?",
    privacyAccepted: true,
    ...overrides,
  };
}

const firstPage = { page: 1, pageSize: 20 } as const;

test("suit une demande du site jusqu'à sa réponse, avec un lien direct dans l'e-mail", async () => {
  const hotel = await createTestHotel();
  const reception = await createReceptionist(hotel);
  const received = await createContactRequest(contactRequest(), randomUUID());
  await createContactRequest(contactRequest({ fullName: "Paul Durand", email: "paul@example.com", subject: "OTHER", message: "Avez-vous un parking pour une voiture ?" }), randomUUID());

  const notification = await prisma.notification.findFirstOrThrow({ where: { idempotencyKey: `contact:${received.id}:received` } });
  assert.match(String((notification.payload as { adminUrl?: string }).adminUrl), new RegExp(`/admin/demandes\\?demande=${received.id}$`));

  const open = await listAdminContactRequests(reception.membership, { ...firstPage, status: "OPEN" });
  assert.deepEqual(open.items.map((item) => item.fullName), ["Paul Durand", "Sophie Martin"]);
  assert.deepEqual(open.summary, { open: 2, handled: 0 });
  const searched = await listAdminContactRequests(reception.membership, { ...firstPage, status: "ALL", search: "23 HEURES" });
  assert.deepEqual(searched.items.map((item) => item.id), [received.id]);

  const request = await getAdminContactRequest(reception.membership, received.id);
  assert.equal(request.email, "sophie@example.com");
  assert.equal(request.handledAt, null);
  const handled = await setAdminContactRequestHandled(reception.membership, reception.adminUserId, received.id, { handled: true, updatedAt: new Date(request.updatedAt) });
  assert.ok(handled.handledAt);
  assert.equal(handled.handledBy, "Réception test");
  await assert.rejects(
    () => setAdminContactRequestHandled(reception.membership, reception.adminUserId, received.id, { handled: false, updatedAt: new Date(request.updatedAt) }),
    adminError("CONTACT_REQUEST_VERSION_CONFLICT"),
  );

  const afterHandling = await listAdminContactRequests(reception.membership, { ...firstPage, status: "OPEN" });
  assert.deepEqual(afterHandling.items.map((item) => item.fullName), ["Paul Durand"]);
  assert.deepEqual(afterHandling.summary, { open: 1, handled: 1 });
  assert.deepEqual(await countAdminContactRequests(reception.membership), { open: 1, handled: 1 });
  assert.deepEqual((await listAdminContactRequests(reception.membership, { ...firstPage, status: "HANDLED" })).items.map((item) => item.id), [received.id]);

  const reopened = await setAdminContactRequestHandled(reception.membership, reception.adminUserId, received.id, { handled: false, updatedAt: new Date(handled.updatedAt) });
  assert.equal(reopened.handledAt, null);
  assert.equal(reopened.handledBy, null);
  const audit = await prisma.auditLog.findMany({ where: { entityId: received.id }, orderBy: { createdAt: "asc" }, select: { action: true, adminUserId: true } });
  assert.deepEqual(audit, [
    { action: "CONTACT_REQUEST_HANDLED", adminUserId: reception.adminUserId },
    { action: "CONTACT_REQUEST_REOPENED", adminUserId: reception.adminUserId },
  ]);
});

test("isole les demandes de chaque établissement et masque l'adresse d'une demande anonymisée", async () => {
  const hotel = await createTestHotel();
  const received = await createContactRequest(contactRequest(), randomUUID());
  const other = await createTestHotel({ publicSite: false });
  const otherReception = await createReceptionist(other);

  await assert.rejects(() => getAdminContactRequest(otherReception.membership, received.id), adminError("CONTACT_REQUEST_NOT_FOUND"));
  await assert.rejects(
    () => setAdminContactRequestHandled(otherReception.membership, otherReception.adminUserId, received.id, { handled: true, updatedAt: new Date() }),
    adminError("CONTACT_REQUEST_NOT_FOUND"),
  );
  assert.equal((await listAdminContactRequests(otherReception.membership, { ...firstPage, status: "ALL" })).total, 0);
  assert.deepEqual(await countAdminContactRequests(otherReception.membership), { open: 0, handled: 0 });

  await prisma.contactRequest.update({ where: { id: received.id }, data: { personalDataRetainUntil: new Date(Date.now() - 1_000) } });
  await anonymizeExpiredContactRequests();
  const reception = await createReceptionist(hotel);
  const anonymized = await getAdminContactRequest(reception.membership, received.id);
  assert.equal(anonymized.anonymized, true);
  assert.equal(anonymized.email, null);
  assert.equal(anonymized.fullName, "Contact anonymisé");
});
