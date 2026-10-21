-- Legal notice of the operating company, managed from the administration and
-- shown on the website and on new invoices.
ALTER TABLE "properties"
ADD COLUMN "legalForm" TEXT,
ADD COLUMN "shareCapital" TEXT,
ADD COLUMN "siret" TEXT,
ADD COLUMN "registrationCity" TEXT,
ADD COLUMN "vatNumber" TEXT,
ADD COLUMN "publicationDirector" TEXT,
ADD COLUMN "hostingProvider" TEXT,
ADD COLUMN "mediator" TEXT;
