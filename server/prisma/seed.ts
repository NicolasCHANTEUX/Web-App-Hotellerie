import { createHash } from "node:crypto";
import { PricingUnit } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

const bookingTermsBody = [
  "La demande est enregistrée sous réserve de confirmation par l'hôtel.",
  "La chambre est optionnée pendant 24 heures.",
  "Les conditions d'annulation applicables sont celles affichées et acceptées au moment de la demande.",
].join("\n");

const roomTypes = [
  {
    slug: "chambre-classique",
    code: "CLASSIQUE",
    name: "Chambre Classique",
    description: "Élégante et chaleureuse, elle allie confort et sobriété dans une atmosphère baignée de lumière.",
    surfaceSqm: 18,
    maxAdults: 2,
    maxChildren: 0,
    maxGuests: 2,
    bedLabel: "1 lit double",
    price: 95,
    image: "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=82",
    ],
    rooms: ["101", "102", "103", "104", "105", "106"],
    amenities: ["vue-jardin", "literie-premium", "produits-bain"],
  },
  {
    slug: "chambre-elegance",
    code: "ELEGANCE",
    name: "Chambre Élégance",
    description: "Des volumes généreux, des textiles délicats et un espace bureau composent une chambre raffinée.",
    surfaceSqm: 24,
    maxAdults: 2,
    maxChildren: 0,
    maxGuests: 2,
    bedLabel: "1 lit queen-size",
    price: 135,
    image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1400&q=82",
    ],
    rooms: ["201", "202", "203", "204", "205", "206"],
    amenities: ["espace-bureau", "douche-italienne", "wifi-fibre"],
  },
  {
    slug: "chambre-deluxe",
    code: "DELUXE",
    name: "Chambre Deluxe",
    description: "Une chambre spacieuse aux prestations haut de gamme, prolongée par un coin salon.",
    surfaceSqm: 30,
    maxAdults: 2,
    maxChildren: 0,
    maxGuests: 2,
    bedLabel: "1 lit king-size",
    price: 185,
    image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1400&q=82",
    ],
    rooms: ["301", "302", "303", "304"],
    amenities: ["coin-salon", "baignoire", "machine-cafe"],
  },
  {
    slug: "suite-rivage",
    code: "SUITE_RIVAGE",
    name: "Suite Rivage",
    description: "Notre suite signature réunit chambre, salon privé et terrasse pour une expérience méditerranéenne.",
    surfaceSqm: 52,
    maxAdults: 2,
    maxChildren: 2,
    maxGuests: 4,
    bedLabel: "1 chambre et salon",
    price: 265,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=82",
    ],
    rooms: ["401", "402"],
    amenities: ["terrasse-privee", "salon-independant", "vue-panoramique"],
  },
] as const;

const amenities = [
  ["vue-jardin", "Vue sur jardin"],
  ["literie-premium", "Literie premium"],
  ["produits-bain", "Produits de bain"],
  ["espace-bureau", "Espace bureau"],
  ["douche-italienne", "Douche italienne"],
  ["wifi-fibre", "Wi-Fi fibre"],
  ["coin-salon", "Coin salon"],
  ["baignoire", "Baignoire"],
  ["machine-cafe", "Machine à café"],
  ["terrasse-privee", "Terrasse privée"],
  ["salon-independant", "Salon indépendant"],
  ["vue-panoramique", "Vue panoramique"],
] as const;

async function main() {
  const property = await prisma.property.upsert({
    where: { slug: "hotel-rivage" },
    update: {
      name: "Hôtel Rivage",
      email: "contact@hotel-rivage.fr",
      phone: "+33 4 93 00 12 34",
      addressLine1: "26 avenue des Pins",
      postalCode: "06400",
      city: "Cannes",
    },
    create: {
      slug: "hotel-rivage",
      name: "Hôtel Rivage",
      email: "contact@hotel-rivage.fr",
      phone: "+33 4 93 00 12 34",
      addressLine1: "26 avenue des Pins",
      postalCode: "06400",
      city: "Cannes",
    },
  });

  const amenityBySlug = new Map<string, string>();

  await prisma.contractTermsVersion.upsert({
    where: {
      propertyId_code_version: {
        propertyId: property.id,
        code: "BOOKING_TERMS",
        version: 1,
      },
    },
    update: {
      title: "Conditions de réservation",
      body: bookingTermsBody,
      checksumSha256: createHash("sha256").update(bookingTermsBody).digest("hex"),
      cancellationPolicy: { type: "MANUAL_CONFIRMATION", refundable: true },
      isActive: true,
    },
    create: {
      propertyId: property.id,
      code: "BOOKING_TERMS",
      version: 1,
      title: "Conditions de réservation",
      body: bookingTermsBody,
      checksumSha256: createHash("sha256").update(bookingTermsBody).digest("hex"),
      cancellationPolicy: { type: "MANUAL_CONFIRMATION", refundable: true },
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  for (const [slug, label] of amenities) {
    const amenity = await prisma.amenity.upsert({
      where: { propertyId_slug: { propertyId: property.id, slug } },
      update: { label },
      create: { propertyId: property.id, slug, label },
    });
    amenityBySlug.set(slug, amenity.id);
  }

  for (const [displayOrder, entry] of roomTypes.entries()) {
    const roomType = await prisma.roomType.upsert({
      where: { propertyId_slug: { propertyId: property.id, slug: entry.slug } },
      update: {
        name: entry.name,
        description: entry.description,
        surfaceSqm: entry.surfaceSqm,
        maxAdults: entry.maxAdults,
        maxChildren: entry.maxChildren,
        maxGuests: entry.maxGuests,
        bedLabel: entry.bedLabel,
        coverImageUrl: entry.image,
        gallery: [...entry.gallery],
        displayOrder,
      },
      create: {
        propertyId: property.id,
        slug: entry.slug,
        name: entry.name,
        description: entry.description,
        surfaceSqm: entry.surfaceSqm,
        maxAdults: entry.maxAdults,
        maxChildren: entry.maxChildren,
        maxGuests: entry.maxGuests,
        bedLabel: entry.bedLabel,
        coverImageUrl: entry.image,
        gallery: [...entry.gallery],
        displayOrder,
      },
    });

    await prisma.ratePlan.upsert({
      where: { propertyId_code: { propertyId: property.id, code: entry.code } },
      update: { roomTypeId: roomType.id, basePricePerNight: entry.price, priceTaxMode: "INCLUSIVE" },
      create: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        code: entry.code,
        name: "Tarif flexible",
        basePricePerNight: entry.price,
        priceTaxMode: "INCLUSIVE",
      },
    });

    for (const number of entry.rooms) {
      await prisma.room.upsert({
        where: { propertyId_number: { propertyId: property.id, number } },
        update: { roomTypeId: roomType.id },
        create: {
          propertyId: property.id,
          roomTypeId: roomType.id,
          number,
          floor: Number(number[0]),
        },
      });
    }

    for (const [sortOrder, slug] of entry.amenities.entries()) {
      const amenityId = amenityBySlug.get(slug);
      if (!amenityId) throw new Error(`Unknown amenity: ${slug}`);
      await prisma.roomTypeAmenity.upsert({
        where: { roomTypeId_amenityId: { roomTypeId: roomType.id, amenityId } },
        update: { featured: true, sortOrder },
        create: { roomTypeId: roomType.id, amenityId, featured: true, sortOrder },
      });
    }
  }

  const extras = [
    ["BREAKFAST", "Petit-déjeuner", "Buffet maison chaque matin", 18, PricingUnit.PER_PERSON_PER_NIGHT],
    ["PARKING", "Parking privé", "Place sécurisée pour votre véhicule", 15, PricingUnit.PER_NIGHT],
    ["EARLY_CHECKIN", "Arrivée anticipée", "Accès à la chambre dès 12h00", 30, PricingUnit.ONE_TIME],
    ["LATE_CHECKOUT", "Départ tardif", "Conservation de la chambre jusqu'à 14h00", 30, PricingUnit.ONE_TIME],
    ["BABY_BED", "Lit bébé", "Lit parapluie avec linge de lit", 10, PricingUnit.PER_NIGHT],
  ] as const;

  for (const [displayOrder, [code, name, description, price, pricingUnit]] of extras.entries()) {
    await prisma.extra.upsert({
      where: { propertyId_code: { propertyId: property.id, code } },
      update: { name, description, price, pricingUnit, priceTaxMode: "INCLUSIVE", taxRate: 10, displayOrder },
      create: { propertyId: property.id, code, name, description, price, pricingUnit, priceTaxMode: "INCLUSIVE", taxRate: 10, displayOrder },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
