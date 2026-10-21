import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { lowestNightlyOffer, serializePublicProperty } from "./catalog.service.js";

test("serializes only public property fields and the active room count", () => {
  const property = serializePublicProperty({
    slug: "hotel-rivage",
    name: "Hôtel Rivage",
    email: "contact@hotel-rivage.fr",
    phone: "+33 4 93 00 12 34",
    addressLine1: "26 avenue des Pins",
    addressLine2: null,
    postalCode: "06400",
    city: "Cannes",
    countryCode: "FR",
    timezone: "Europe/Paris",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    legalName: "Rivage Hôtellerie",
    legalForm: "SAS",
    shareCapital: "10 000 €",
    siret: "81234567800012",
    registrationCity: "Cannes",
    vatNumber: "FR12812345678",
    publicationDirector: "Claire Martin",
    hostingProvider: "Hébergeur SAS, 1 rue du Serveur, 75000 Paris",
    mediator: null,
    _count: { rooms: 18 },
  });

  assert.deepEqual(property, {
    slug: "hotel-rivage",
    name: "Hôtel Rivage",
    email: "contact@hotel-rivage.fr",
    phone: "+33 4 93 00 12 34",
    addressLine1: "26 avenue des Pins",
    addressLine2: null,
    postalCode: "06400",
    city: "Cannes",
    countryCode: "FR",
    timezone: "Europe/Paris",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    roomCount: 18,
    legal: {
      legalName: "Rivage Hôtellerie",
      legalForm: "SAS",
      shareCapital: "10 000 €",
      siret: "81234567800012",
      registrationCity: "Cannes",
      vatNumber: "FR12812345678",
      publicationDirector: "Claire Martin",
      hostingProvider: "Hébergeur SAS, 1 rue du Serveur, 75000 Paris",
      mediator: null,
    },
  });
});

test("annonce le prix le plus bas de l'année à venir, saisons et promotions comprises", () => {
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
  const from = day("2027-06-01");
  const base = new Prisma.Decimal("120");
  const november = { id: "low", label: "Basse saison", validFrom: day("2027-11-01"), validUntil: day("2027-11-30"), minNights: null };
  const lowSeason = { seasonId: "low", nightlyPrice: new Prisma.Decimal("90"), weekendNightlyPrice: null, season: november };
  const promotion = (discountPercent: string) => ({
    id: "promo",
    label: "Offre de juin",
    discountPercent: new Prisma.Decimal(discountPercent),
    validFrom: day("2027-06-10"),
    validUntil: day("2027-06-13"),
  });

  assert.equal(lowestNightlyOffer({ promotions: [], seasonRates: [] }, base, from).price.toFixed(2), "120.00");

  const seasonal = lowestNightlyOffer({ promotions: [promotion("10")], seasonRates: [lowSeason] }, base, from);
  assert.equal(seasonal.price.toFixed(2), "90.00");
  assert.equal(seasonal.originalPrice, null);
  assert.equal(seasonal.promotion, null);

  const promoted = lowestNightlyOffer({ promotions: [promotion("30")], seasonRates: [lowSeason] }, base, from);
  assert.equal(promoted.price.toFixed(2), "84.00");
  assert.equal(promoted.originalPrice?.toFixed(2), "120.00");
  assert.equal(promoted.promotion?.label, "Offre de juin");

  // Seasons beyond the coming year do not lower the announced price.
  const nextYear = { ...lowSeason, season: { ...november, validFrom: day("2028-07-01"), validUntil: day("2028-07-31") } };
  assert.equal(lowestNightlyOffer({ promotions: [], seasonRates: [nextYear] }, base, from).price.toFixed(2), "120.00");
});
