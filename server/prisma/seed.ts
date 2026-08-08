import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, PricingUnit } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const roomTypes = [
  {
    slug: "chambre-classique",
    code: "CLASSIQUE",
    name: "Chambre Classique",
    description: "Elegante et chaleureuse, elle allie confort et sobriete dans une atmosphere baignee de lumiere.",
    surfaceSqm: 18,
    maxAdults: 2,
    maxChildren: 0,
    maxGuests: 2,
    bedLabel: "1 lit double",
    price: 95,
    image: "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85",
    rooms: ["101", "102", "103"],
    amenities: ["vue-jardin", "literie-premium", "produits-bain"],
  },
  {
    slug: "chambre-elegance",
    code: "ELEGANCE",
    name: "Chambre Elegance",
    description: "Des volumes genereux, des textiles delicats et un espace bureau composent une chambre raffinee.",
    surfaceSqm: 24,
    maxAdults: 2,
    maxChildren: 0,
    maxGuests: 2,
    bedLabel: "1 lit queen-size",
    price: 135,
    image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85",
    rooms: ["201", "202", "203"],
    amenities: ["espace-bureau", "douche-italienne", "wifi-fibre"],
  },
  {
    slug: "chambre-deluxe",
    code: "DELUXE",
    name: "Chambre Deluxe",
    description: "Une chambre spacieuse aux prestations haut de gamme, prolongee par un coin salon.",
    surfaceSqm: 30,
    maxAdults: 2,
    maxChildren: 0,
    maxGuests: 2,
    bedLabel: "1 lit king-size",
    price: 185,
    image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85",
    rooms: ["301", "302"],
    amenities: ["coin-salon", "baignoire", "machine-cafe"],
  },
  {
    slug: "suite-rivage",
    code: "SUITE_RIVAGE",
    name: "Suite Rivage",
    description: "Notre suite signature reunit chambre, salon prive et terrasse pour une experience mediterraneenne.",
    surfaceSqm: 52,
    maxAdults: 2,
    maxChildren: 2,
    maxGuests: 4,
    bedLabel: "1 chambre et salon",
    price: 265,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85",
    rooms: ["401"],
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
  ["machine-cafe", "Machine a cafe"],
  ["terrasse-privee", "Terrasse privee"],
  ["salon-independant", "Salon independant"],
  ["vue-panoramique", "Vue panoramique"],
] as const;

async function main() {
  const property = await prisma.property.upsert({
    where: { slug: "hotel-rivage" },
    update: {},
    create: {
      slug: "hotel-rivage",
      name: "Hotel Rivage",
      email: "contact@hotel-rivage.fr",
      phone: "+33 4 93 00 12 34",
      addressLine1: "24 avenue des Pins",
      postalCode: "06400",
      city: "Cannes",
    },
  });

  const amenityBySlug = new Map<string, string>();
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
        displayOrder,
      },
    });

    await prisma.ratePlan.upsert({
      where: { propertyId_code: { propertyId: property.id, code: entry.code } },
      update: { roomTypeId: roomType.id, basePricePerNight: entry.price },
      create: {
        propertyId: property.id,
        roomTypeId: roomType.id,
        code: entry.code,
        name: "Tarif flexible",
        basePricePerNight: entry.price,
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
    ["BREAKFAST", "Petit-dejeuner", "Buffet maison chaque matin", 18, PricingUnit.PER_PERSON_PER_NIGHT],
    ["PARKING", "Parking prive", "Place securisee pour votre vehicule", 15, PricingUnit.PER_NIGHT],
    ["EARLY_CHECKIN", "Arrivee anticipee", "Acces a la chambre des 12h00", 30, PricingUnit.ONE_TIME],
    ["LATE_CHECKOUT", "Depart tardif", "Conservation de la chambre jusqu'a 14h00", 30, PricingUnit.ONE_TIME],
    ["BABY_BED", "Lit bebe", "Lit parapluie avec linge de lit", 10, PricingUnit.PER_NIGHT],
  ] as const;

  for (const [displayOrder, [code, name, description, price, pricingUnit]] of extras.entries()) {
    await prisma.extra.upsert({
      where: { propertyId_code: { propertyId: property.id, code } },
      update: { name, description, price, pricingUnit, displayOrder },
      create: { propertyId: property.id, code, name, description, price, pricingUnit, displayOrder },
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
