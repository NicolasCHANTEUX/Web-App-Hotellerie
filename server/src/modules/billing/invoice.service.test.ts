import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { buildCreditNoteLines, buildInvoiceLines, invoiceNumber } from "./invoice.service.js";

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

test("ventile un avoir partiel sur chaque taux de TVA sans taux moyen", () => {
  const lines = buildCreditNoteLines([
    {
      id: "room-line",
      description: "Chambre",
      taxRate: new Prisma.Decimal(10),
      subtotal: new Prisma.Decimal("100.00"),
      taxAmount: new Prisma.Decimal("10.00"),
      lineTotal: new Prisma.Decimal("110.00"),
      sortOrder: 0,
      creditLines: [],
    },
    {
      id: "extra-line",
      description: "Champagne",
      taxRate: new Prisma.Decimal(20),
      subtotal: new Prisma.Decimal("50.00"),
      taxAmount: new Prisma.Decimal("10.00"),
      lineTotal: new Prisma.Decimal("60.00"),
      sortOrder: 1,
      creditLines: [],
    },
    {
      id: "tax-line",
      description: "Taxe de séjour",
      taxRate: new Prisma.Decimal(0),
      subtotal: new Prisma.Decimal("4.00"),
      taxAmount: new Prisma.Decimal("0.00"),
      lineTotal: new Prisma.Decimal("4.00"),
      sortOrder: 2,
      creditLines: [],
    },
  ], new Prisma.Decimal("87.00"));

  assert.deepEqual(lines.map((line) => line.taxRate.toString()), ["10", "20", "0"]);
  assert.equal(lines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0)).toFixed(2), "87.00");
  assert.equal(lines.reduce((sum, line) => sum.add(line.subtotal).add(line.taxAmount), new Prisma.Decimal(0)).toFixed(2), "87.00");
  assert.deepEqual(lines.map((line) => line.originalInvoiceLineId), ["room-line", "extra-line", "tax-line"]);
});

test("un dernier avoir reprend exactement les soldes fiscaux après un avoir partiel", () => {
  const lines = buildCreditNoteLines([
    {
      id: "room-line",
      description: "Chambre",
      taxRate: new Prisma.Decimal(10),
      subtotal: new Prisma.Decimal("100.00"),
      taxAmount: new Prisma.Decimal("10.00"),
      lineTotal: new Prisma.Decimal("110.00"),
      sortOrder: 0,
      creditLines: [{ subtotal: new Prisma.Decimal("40.00"), taxAmount: new Prisma.Decimal("4.00"), lineTotal: new Prisma.Decimal("44.00") }],
    },
    {
      id: "extra-line",
      description: "Champagne",
      taxRate: new Prisma.Decimal(20),
      subtotal: new Prisma.Decimal("50.00"),
      taxAmount: new Prisma.Decimal("10.00"),
      lineTotal: new Prisma.Decimal("60.00"),
      sortOrder: 1,
      creditLines: [{ subtotal: new Prisma.Decimal("20.00"), taxAmount: new Prisma.Decimal("4.00"), lineTotal: new Prisma.Decimal("24.00") }],
    },
  ], new Prisma.Decimal("102.00"));

  assert.deepEqual(lines.map((line) => ({ subtotal: line.subtotal.toFixed(2), tax: line.taxAmount.toFixed(2), total: line.lineTotal.toFixed(2) })), [
    { subtotal: "60.00", tax: "6.00", total: "66.00" },
    { subtotal: "30.00", tax: "6.00", total: "36.00" },
  ]);
});

test("détaille l'hébergement par niveau de prix sans écart de TVA", () => {
  const night = (date: string, price: string, season: string | null) => ({ date, season, weekend: false, regularPrice: price, promotion: null, price });
  const room = {
    roomTypeNameSnapshot: "Chambre Deluxe",
    roomNumberSnapshot: "201",
    taxRateSnapshot: new Prisma.Decimal(10),
    // VAT included in 600.00 at 10 %, computed on the whole stay.
    taxAmountSnapshot: new Prisma.Decimal("54.55"),
    lineTotal: new Prisma.Decimal("600.00"),
    nightlyRatesSnapshot: [
      night("2027-06-29", "120.00", null),
      night("2027-06-30", "120.00", null),
      night("2027-07-01", "180.00", "Haute saison"),
      night("2027-07-02", "180.00", "Haute saison"),
    ],
  };
  const stay = { checkIn: new Date("2027-06-29T00:00:00Z"), checkOut: new Date("2027-07-03T00:00:00Z"), extras: [], taxLines: [] };

  const lines = buildInvoiceLines({ ...stay, rooms: [room] });

  assert.deepEqual(
    lines.map((line) => [line.description, line.quantity.toString(), line.lineTotal.toFixed(2), line.taxAmount.toFixed(2), line.sortOrder]),
    [
      ["Chambre Deluxe - chambre 201 (2 nuits)", "2", "240.00", "21.82", 0],
      ["Chambre Deluxe - chambre 201 (2 nuits · Haute saison)", "2", "360.00", "32.73", 1],
    ],
  );
  assert.equal(lines.reduce((sum, line) => sum.add(line.subtotal).add(line.taxAmount), new Prisma.Decimal(0)).toFixed(2), "600.00");

  const uniform = buildInvoiceLines({ ...stay, rooms: [{ ...room, lineTotal: new Prisma.Decimal("480.00"), nightlyRatesSnapshot: room.nightlyRatesSnapshot.map((item) => ({ ...item, price: "120.00", season: null })) }] });
  assert.deepEqual(uniform.map((line) => line.description), ["Chambre Deluxe - chambre 201 (4 nuits)"]);

  const inconsistent = buildInvoiceLines({ ...stay, rooms: [{ ...room, lineTotal: new Prisma.Decimal("610.00") }] });
  assert.equal(inconsistent.length, 1);
  assert.equal(inconsistent[0]?.lineTotal.toFixed(2), "610.00");
});
