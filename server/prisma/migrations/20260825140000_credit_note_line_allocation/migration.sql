ALTER TABLE "invoice_lines" ADD COLUMN "originalInvoiceLineId" UUID;

CREATE INDEX "invoice_lines_originalInvoiceLineId_idx" ON "invoice_lines"("originalInvoiceLineId");

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_originalInvoiceLineId_fkey"
  FOREIGN KEY ("originalInvoiceLineId") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
