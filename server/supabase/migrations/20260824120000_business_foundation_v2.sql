-- Business foundation v2: immutable pricing/terms snapshots, auditable payments,
-- multi-document invoicing and private/public file metadata.

CREATE TYPE "TaxKind" AS ENUM ('VAT', 'TOURIST_TAX', 'OTHER');
CREATE TYPE "TaxCalculationMode" AS ENUM ('PERCENTAGE', 'PER_ADULT_PER_NIGHT', 'PER_PERSON_PER_NIGHT', 'PER_NIGHT', 'PER_STAY');
CREATE TYPE "InvoiceDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE');
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "StoredFileKind" AS ENUM ('ROOM_TYPE_COVER', 'ROOM_TYPE_GALLERY', 'INVOICE_PDF', 'CREDIT_NOTE_PDF', 'ADMIN_DOCUMENT');
CREATE TYPE "StoredFileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "extras"
  ADD COLUMN "taxRate" DECIMAL(5,2);

CREATE TABLE "tax_rules" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" "TaxKind" NOT NULL,
  "calculationMode" "TaxCalculationMode" NOT NULL,
  "rate" DECIMAL(5,2),
  "amount" DECIMAL(12,2),
  "currency" CHAR(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" DATE,
  "validUntil" DATE,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_terms_versions" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "cancellationPolicy" JSONB,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveUntil" TIMESTAMPTZ(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_terms_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bookings"
  ADD COLUMN "touristTaxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "termsVersionId" UUID,
  ADD COLUMN "termsSnapshot" JSONB,
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
  ADD COLUMN "anonymizedAt" TIMESTAMPTZ(3),
  ADD COLUMN "personalDataRetainUntil" TIMESTAMPTZ(3);

UPDATE "bookings"
SET "termsSnapshot" = jsonb_build_object(
  'source', 'LEGACY_PRICING_SNAPSHOT',
  'capturedAt', "createdAt",
  'pricingSnapshotVersion', COALESCE("pricingSnapshot"->'version', '1'::jsonb)
)
WHERE "termsSnapshot" IS NULL;

ALTER TABLE "booking_rooms"
  ADD COLUMN "taxAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "booking_rooms"
SET "taxAmountSnapshot" = ROUND("lineTotal" * "taxRateSnapshot" / 100, 2);

ALTER TABLE "booking_extras"
  ADD COLUMN "taxRateSnapshot" DECIMAL(5,2),
  ADD COLUMN "taxAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "booking_extras" AS booking_extra
SET "taxRateSnapshot" = COALESCE(
  (SELECT extra."taxRate" FROM "extras" AS extra WHERE extra."id" = booking_extra."extraId"),
  (SELECT room."taxRateSnapshot" FROM "booking_rooms" AS room WHERE room."bookingId" = booking_extra."bookingId" ORDER BY room."createdAt" LIMIT 1)
);

UPDATE "booking_extras"
SET "taxAmountSnapshot" = ROUND("lineTotal" * COALESCE("taxRateSnapshot", 0) / 100, 2);

CREATE TABLE "booking_tax_lines" (
  "id" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "taxRuleId" UUID,
  "kind" "TaxKind" NOT NULL,
  "labelSnapshot" TEXT NOT NULL,
  "calculationModeSnapshot" "TaxCalculationMode" NOT NULL,
  "rateSnapshot" DECIMAL(5,2),
  "unitAmountSnapshot" DECIMAL(12,2),
  "quantitySnapshot" DECIMAL(12,2) NOT NULL DEFAULT 1,
  "taxableBase" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(12,2) NOT NULL,
  "metadataSnapshot" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_tax_lines_pkey" PRIMARY KEY ("id")
);

INSERT INTO "booking_tax_lines" (
  "id", "bookingId", "kind", "labelSnapshot", "calculationModeSnapshot",
  "rateSnapshot", "quantitySnapshot", "taxableBase", "amount", "sortOrder"
)
SELECT
  gen_random_uuid(), room."bookingId", 'VAT'::"TaxKind", 'TVA hébergement',
  'PERCENTAGE'::"TaxCalculationMode", room."taxRateSnapshot", 1,
  room."lineTotal", room."taxAmountSnapshot", 0
FROM "booking_rooms" AS room;

INSERT INTO "booking_tax_lines" (
  "id", "bookingId", "kind", "labelSnapshot", "calculationModeSnapshot",
  "rateSnapshot", "quantitySnapshot", "taxableBase", "amount", "sortOrder"
)
SELECT
  gen_random_uuid(), booking_extra."bookingId", 'VAT'::"TaxKind",
  'TVA ' || booking_extra."nameSnapshot", 'PERCENTAGE'::"TaxCalculationMode",
  booking_extra."taxRateSnapshot", 1, booking_extra."lineTotal",
  booking_extra."taxAmountSnapshot",
  100 + ROW_NUMBER() OVER (PARTITION BY booking_extra."bookingId" ORDER BY booking_extra."createdAt")
FROM "booking_extras" AS booking_extra;

ALTER TABLE "payments"
  ADD COLUMN "propertyId" UUID,
  ADD COLUMN "paymentMethodType" TEXT,
  ADD COLUMN "cardBrand" TEXT,
  ADD COLUMN "cardLast4" CHAR(4);

UPDATE "payments" AS payment
SET "propertyId" = booking."propertyId"
FROM "bookings" AS booking
WHERE booking."id" = payment."bookingId";

ALTER TABLE "payments"
  ALTER COLUMN "propertyId" SET NOT NULL;

CREATE TABLE "payment_provider_events" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "paymentId" UUID,
  "provider" "PaymentProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payloadHash" TEXT NOT NULL,
  "livemode" BOOLEAN,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  "errorMessage" TEXT,
  CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stored_files" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "roomTypeId" UUID,
  "bookingId" UUID,
  "kind" "StoredFileKind" NOT NULL,
  "visibility" "StoredFileVisibility" NOT NULL DEFAULT 'PRIVATE',
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "publicUrl" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "altText" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoices"
  ADD COLUMN "propertyId" UUID,
  ADD COLUMN "originalInvoiceId" UUID,
  ADD COLUMN "storedFileId" UUID,
  ADD COLUMN "documentType" "InvoiceDocumentType" NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN "serviceDate" DATE,
  ADD COLUMN "issuerSnapshot" JSONB,
  ADD COLUMN "creditReason" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

UPDATE "invoices" AS invoice
SET
  "propertyId" = booking."propertyId",
  "issuerSnapshot" = jsonb_build_object(
    'legalName', COALESCE(property."legalName", property."name"),
    'addressLine1', property."addressLine1",
    'addressLine2', property."addressLine2",
    'postalCode', property."postalCode",
    'city', property."city",
    'countryCode', property."countryCode"
  )
FROM "bookings" AS booking
JOIN "properties" AS property ON property."id" = booking."propertyId"
WHERE booking."id" = invoice."bookingId";

ALTER TABLE "invoices"
  ALTER COLUMN "propertyId" SET NOT NULL,
  ALTER COLUMN "issuerSnapshot" SET NOT NULL;

DROP INDEX IF EXISTS "invoices_bookingId_key";
DROP INDEX IF EXISTS "invoices_number_key";

CREATE TABLE "invoice_sequences" (
  "id" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "documentType" "InvoiceDocumentType" NOT NULL,
  "calendarYear" INTEGER NOT NULL,
  "prefix" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_lines"
  ADD COLUMN "subtotal" DECIMAL(12,2),
  ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "invoice_lines"
SET "subtotal" = "lineTotal";

ALTER TABLE "invoice_lines"
  ALTER COLUMN "subtotal" SET NOT NULL;

CREATE UNIQUE INDEX "tax_rules_propertyId_code_key" ON "tax_rules"("propertyId", "code");
CREATE INDEX "tax_rules_propertyId_kind_isActive_validFrom_validUntil_idx" ON "tax_rules"("propertyId", "kind", "isActive", "validFrom", "validUntil");
CREATE UNIQUE INDEX "contract_terms_versions_propertyId_code_version_key" ON "contract_terms_versions"("propertyId", "code", "version");
CREATE INDEX "contract_terms_versions_propertyId_code_isActive_effective_idx" ON "contract_terms_versions"("propertyId", "code", "isActive", "effectiveFrom", "effectiveUntil");
CREATE INDEX "bookings_termsVersionId_idx" ON "bookings"("termsVersionId");
CREATE INDEX "booking_tax_lines_bookingId_sortOrder_idx" ON "booking_tax_lines"("bookingId", "sortOrder");
CREATE INDEX "booking_tax_lines_taxRuleId_idx" ON "booking_tax_lines"("taxRuleId");
CREATE INDEX "payments_propertyId_createdAt_idx" ON "payments"("propertyId", "createdAt");
CREATE UNIQUE INDEX "payment_provider_events_provider_providerEventId_key" ON "payment_provider_events"("provider", "providerEventId");
CREATE INDEX "payment_provider_events_propertyId_receivedAt_idx" ON "payment_provider_events"("propertyId", "receivedAt");
CREATE INDEX "payment_provider_events_paymentId_receivedAt_idx" ON "payment_provider_events"("paymentId", "receivedAt");
CREATE UNIQUE INDEX "stored_files_bucket_objectKey_key" ON "stored_files"("bucket", "objectKey");
CREATE INDEX "stored_files_propertyId_kind_createdAt_idx" ON "stored_files"("propertyId", "kind", "createdAt");
CREATE INDEX "stored_files_roomTypeId_sortOrder_idx" ON "stored_files"("roomTypeId", "sortOrder");
CREATE INDEX "stored_files_bookingId_createdAt_idx" ON "stored_files"("bookingId", "createdAt");
CREATE UNIQUE INDEX "invoices_storedFileId_key" ON "invoices"("storedFileId");
CREATE UNIQUE INDEX "invoices_propertyId_number_key" ON "invoices"("propertyId", "number");
CREATE INDEX "invoices_bookingId_createdAt_idx" ON "invoices"("bookingId", "createdAt");
CREATE INDEX "invoices_originalInvoiceId_idx" ON "invoices"("originalInvoiceId");
CREATE UNIQUE INDEX "invoice_sequences_propertyId_documentType_calendarYear_key" ON "invoice_sequences"("propertyId", "documentType", "calendarYear");

ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_terms_versions" ADD CONSTRAINT "contract_terms_versions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "contract_terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_tax_lines" ADD CONSTRAINT "booking_tax_lines_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_tax_lines" ADD CONSTRAINT "booking_tax_lines_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "tax_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tax_rules"
  ADD CONSTRAINT "tax_rules_valid_configuration" CHECK (
    ("calculationMode" = 'PERCENTAGE' AND "rate" IS NOT NULL AND "amount" IS NULL)
    OR
    ("calculationMode" <> 'PERCENTAGE' AND "rate" IS NULL AND "amount" IS NOT NULL AND "currency" IS NOT NULL)
  ),
  ADD CONSTRAINT "tax_rules_non_negative_values" CHECK (COALESCE("rate", 0) >= 0 AND COALESCE("amount", 0) >= 0),
  ADD CONSTRAINT "tax_rules_valid_period" CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" >= "validFrom");

ALTER TABLE "contract_terms_versions"
  ADD CONSTRAINT "contract_terms_versions_positive_version" CHECK ("version" > 0),
  ADD CONSTRAINT "contract_terms_versions_valid_period" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"),
  ADD CONSTRAINT "contract_terms_versions_valid_checksum" CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_non_negative_tourist_tax" CHECK ("touristTaxTotal" >= 0 AND "touristTaxTotal" <= "taxTotal");

ALTER TABLE "booking_tax_lines"
  ADD CONSTRAINT "booking_tax_lines_non_negative_values" CHECK (
    COALESCE("rateSnapshot", 0) >= 0 AND COALESCE("unitAmountSnapshot", 0) >= 0 AND
    "quantitySnapshot" >= 0 AND "taxableBase" >= 0 AND "amount" >= 0
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_valid_card_last4" CHECK ("cardLast4" IS NULL OR "cardLast4" ~ '^[0-9]{4}$');

ALTER TABLE "payment_provider_events"
  ADD CONSTRAINT "payment_provider_events_valid_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_valid_document_relation" CHECK (
    ("documentType" = 'INVOICE' AND "originalInvoiceId" IS NULL)
    OR
    ("documentType" = 'CREDIT_NOTE' AND "originalInvoiceId" IS NOT NULL)
  ),
  ADD CONSTRAINT "invoices_non_negative_amounts" CHECK ("subtotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0);

ALTER TABLE "invoice_sequences"
  ADD CONSTRAINT "invoice_sequences_valid_values" CHECK ("calendarYear" >= 2000 AND "lastNumber" >= 0);

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_non_negative_amounts" CHECK (
    "quantity" >= 0 AND "unitPrice" >= 0 AND "taxRate" >= 0 AND
    "subtotal" >= 0 AND "taxAmount" >= 0 AND "lineTotal" >= 0
  );

ALTER TABLE "stored_files"
  ADD CONSTRAINT "stored_files_non_negative_size" CHECK ("sizeBytes" >= 0),
  ADD CONSTRAINT "stored_files_valid_checksum" CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "stored_files_visibility_url" CHECK ("visibility" = 'PRIVATE' OR "publicUrl" IS NOT NULL);

ALTER TABLE "tax_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_terms_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_tax_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_provider_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_sequences" ENABLE ROW LEVEL SECURITY;
