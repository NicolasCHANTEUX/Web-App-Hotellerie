import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = await buildApp();
const idempotencyKey = randomUUID();
let contactId: string | null = null;

try {
  const payload = {
    fullName: "Test automatique Hôtel Rivage",
    email: "contact-smoke@invalid.example",
    phone: "+33 6 00 00 00 00",
    subject: "OTHER",
    message: "Message temporaire créé par le test de bon fonctionnement.",
    privacyAccepted: true,
  };
  const request = () => app.inject({
    method: "POST",
    url: "/contact-requests",
    headers: { "idempotency-key": idempotencyKey },
    payload,
  });

  const first = await request();
  assert.equal(first.statusCode, 201, first.body);
  const firstBody = first.json() as { data?: { id?: string; status?: string } };
  assert.equal(firstBody.data?.status, "RECEIVED");
  assert.equal(typeof firstBody.data?.id, "string");
  contactId = firstBody.data?.id ?? null;

  const retry = await request();
  assert.equal(retry.statusCode, 201, retry.body);
  assert.equal((retry.json() as { data?: { id?: string } }).data?.id, contactId);

  const stored = await prisma.contactRequest.count({ where: { idempotencyKey } });
  assert.equal(stored, 1);
  console.log("Contact smoke test passed: persisted, queued and idempotent.");
} finally {
  if (contactId) {
    await prisma.notification.deleteMany({ where: { idempotencyKey: { startsWith: `contact:${contactId}:` } } });
    await prisma.contactRequest.deleteMany({ where: { id: contactId } });
  }
  await app.close();
}
