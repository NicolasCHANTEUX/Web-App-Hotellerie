-- Follow-up of the contact requests in the administration: when a request
-- was answered and by whom. Requests received before stay open.
ALTER TABLE "contact_requests" ADD COLUMN "handledAt" TIMESTAMPTZ(3),
ADD COLUMN "handledByAdminUserId" UUID;

CREATE INDEX "contact_requests_propertyId_handledAt_createdAt_idx" ON "contact_requests"("propertyId", "handledAt", "createdAt");

ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_handledByAdminUserId_fkey" FOREIGN KEY ("handledByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
