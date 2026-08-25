import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { buildInvoiceLines, invoiceNumber } from "./invoice.service.js";

test("forme un numéro comptable stable et complété", () => {
  assert.equal(invoiceNumber("FAC", 2026, 42), "FAC-2026-000042");
});

test("transforme les montants TTC en lignes HT et TVA", () => {
  const lines = buildInvoiceLines({
    checkIn: new Date("2026-09-01T00:00:00Z"),
    checkOut: new Date("2026-09-03T00:00:00Z"),
    rooms: [{
      roomTypeNameSnapshot: "Chambre Classique",
      roomNumberSnapshot: "101",
      taxRateSnapshot: new Prisma.Decimal(10),
      taxAmountSnapshot: new Prisma.Decimal("20.00"),
      lineTotal: new Prisma.Decimal("220.00"),
    }],
    extras: [],
    taxLines: [{ kind: "TOURIST_TAX", labelSnapshot: "Taxe de séjour", quantitySnapshot: new Prisma.Decimal(2), amount: new Prisma.Decimal("4.00") }],
  });
  assert.equal(lines[0]?.quantity.toString(), "2");
  assert.equal(lines[0]?.subtotal.toFixed(2), "200.00");
  assert.equal(lines[1]?.taxRate.toString(), "0");
  assert.equal(lines[1]?.lineTotal.toFixed(2), "4.00");
});
