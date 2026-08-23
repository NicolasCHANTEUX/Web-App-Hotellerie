BEGIN;

INSERT INTO "properties" (
  "id", "slug", "name", "legalName", "email", "phone", "addressLine1",
  "postalCode", "city", "countryCode", "timezone", "currency", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000001', 'hotel-rivage', 'Hôtel Rivage',
  'Hôtel Rivage', 'contact@hotel-rivage.fr', '+33 4 93 00 12 34',
  '26 avenue des Pins', '06400', 'Cannes', 'FR', 'Europe/Paris', 'EUR', now()
) ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name", "email" = EXCLUDED."email", "phone" = EXCLUDED."phone",
  "addressLine1" = EXCLUDED."addressLine1", "postalCode" = EXCLUDED."postalCode",
  "city" = EXCLUDED."city", "updatedAt" = now();

INSERT INTO "amenities" ("id", "propertyId", "slug", "label", "updatedAt") VALUES
  ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-8000-000000000001', 'vue-jardin', 'Vue sur jardin', now()),
  ('00000000-0000-4000-9000-000000000002', '00000000-0000-4000-8000-000000000001', 'literie-premium', 'Literie premium', now()),
  ('00000000-0000-4000-9000-000000000003', '00000000-0000-4000-8000-000000000001', 'produits-bain', 'Produits de bain', now()),
  ('00000000-0000-4000-9000-000000000004', '00000000-0000-4000-8000-000000000001', 'espace-bureau', 'Espace bureau', now()),
  ('00000000-0000-4000-9000-000000000005', '00000000-0000-4000-8000-000000000001', 'douche-italienne', 'Douche italienne', now()),
  ('00000000-0000-4000-9000-000000000006', '00000000-0000-4000-8000-000000000001', 'wifi-fibre', 'Wi-Fi fibre', now()),
  ('00000000-0000-4000-9000-000000000007', '00000000-0000-4000-8000-000000000001', 'coin-salon', 'Coin salon', now()),
  ('00000000-0000-4000-9000-000000000008', '00000000-0000-4000-8000-000000000001', 'baignoire', 'Baignoire', now()),
  ('00000000-0000-4000-9000-000000000009', '00000000-0000-4000-8000-000000000001', 'machine-cafe', 'Machine à café', now()),
  ('00000000-0000-4000-9000-000000000010', '00000000-0000-4000-8000-000000000001', 'terrasse-privee', 'Terrasse privée', now()),
  ('00000000-0000-4000-9000-000000000011', '00000000-0000-4000-8000-000000000001', 'salon-independant', 'Salon indépendant', now()),
  ('00000000-0000-4000-9000-000000000012', '00000000-0000-4000-8000-000000000001', 'vue-panoramique', 'Vue panoramique', now())
ON CONFLICT ("propertyId", "slug") DO UPDATE SET "label" = EXCLUDED."label", "updatedAt" = now();

INSERT INTO "room_types" (
  "id", "propertyId", "slug", "name", "description", "surfaceSqm", "maxAdults",
  "maxChildren", "maxGuests", "bedLabel", "coverImageUrl", "displayOrder", "updatedAt"
) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'chambre-classique', 'Chambre Classique', 'Élégante et chaleureuse, elle allie confort et sobriété dans une atmosphère baignée de lumière.', 18, 2, 0, 2, '1 lit double', 'https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85', 0, now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'chambre-elegance', 'Chambre Élégance', 'Des volumes généreux, des textiles délicats et un espace bureau composent une chambre raffinée.', 24, 2, 0, 2, '1 lit queen-size', 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85', 1, now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'chambre-deluxe', 'Chambre Deluxe', 'Une chambre spacieuse aux prestations haut de gamme, prolongée par un coin salon.', 30, 2, 0, 2, '1 lit king-size', 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85', 2, now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'suite-rivage', 'Suite Rivage', 'Notre suite signature réunit chambre, salon privé et terrasse pour une expérience méditerranéenne.', 52, 2, 2, 4, '1 chambre et salon', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85', 3, now())
ON CONFLICT ("propertyId", "slug") DO UPDATE SET
  "name" = EXCLUDED."name", "description" = EXCLUDED."description",
  "surfaceSqm" = EXCLUDED."surfaceSqm", "maxAdults" = EXCLUDED."maxAdults",
  "maxChildren" = EXCLUDED."maxChildren", "maxGuests" = EXCLUDED."maxGuests",
  "bedLabel" = EXCLUDED."bedLabel", "coverImageUrl" = EXCLUDED."coverImageUrl",
  "displayOrder" = EXCLUDED."displayOrder", "updatedAt" = now();

INSERT INTO "rooms" ("id", "propertyId", "roomTypeId", "number", "floor", "updatedAt") VALUES
  ('11000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '101', 1, now()),
  ('11000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '102', 1, now()),
  ('11000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '103', 1, now()),
  ('11000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '104', 1, now()),
  ('11000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '105', 1, now()),
  ('11000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '106', 1, now()),
  ('11000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '201', 2, now()),
  ('11000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '202', 2, now()),
  ('11000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '203', 2, now()),
  ('11000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '204', 2, now()),
  ('11000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '205', 2, now()),
  ('11000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '206', 2, now()),
  ('11000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '301', 3, now()),
  ('11000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '302', 3, now()),
  ('11000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '303', 3, now()),
  ('11000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '304', 3, now()),
  ('11000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '401', 4, now()),
  ('11000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '402', 4, now())
ON CONFLICT ("propertyId", "number") DO UPDATE SET "roomTypeId" = EXCLUDED."roomTypeId", "floor" = EXCLUDED."floor", "updatedAt" = now();

INSERT INTO "rate_plans" ("id", "propertyId", "roomTypeId", "code", "name", "basePricePerNight", "updatedAt") VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'CLASSIQUE', 'Tarif flexible', 95, now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'ELEGANCE', 'Tarif flexible', 135, now()),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'DELUXE', 'Tarif flexible', 185, now()),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'SUITE_RIVAGE', 'Tarif flexible', 265, now())
ON CONFLICT ("propertyId", "code") DO UPDATE SET "roomTypeId" = EXCLUDED."roomTypeId", "basePricePerNight" = EXCLUDED."basePricePerNight", "updatedAt" = now();

INSERT INTO "extras" ("id", "propertyId", "code", "name", "description", "price", "pricingUnit", "displayOrder", "updatedAt") VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'BREAKFAST', 'Petit-déjeuner', 'Buffet maison chaque matin', 18, 'PER_PERSON_PER_NIGHT', 0, now()),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'PARKING', 'Parking privé', 'Place sécurisée pour votre véhicule', 15, 'PER_NIGHT', 1, now()),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'EARLY_CHECKIN', 'Arrivée anticipée', 'Accès à la chambre dès 12h00', 30, 'ONE_TIME', 2, now()),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'LATE_CHECKOUT', 'Départ tardif', 'Conservation de la chambre jusqu’à 14h00', 30, 'ONE_TIME', 3, now()),
  ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'BABY_BED', 'Lit bébé', 'Lit parapluie avec linge de lit', 10, 'PER_NIGHT', 4, now())
ON CONFLICT ("propertyId", "code") DO UPDATE SET
  "name" = EXCLUDED."name", "description" = EXCLUDED."description", "price" = EXCLUDED."price",
  "pricingUnit" = EXCLUDED."pricingUnit", "displayOrder" = EXCLUDED."displayOrder", "updatedAt" = now();

INSERT INTO "room_type_amenities" ("roomTypeId", "amenityId", "featured", "sortOrder") VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-9000-000000000001', true, 0),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-9000-000000000002', true, 1),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-9000-000000000003', true, 2),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-9000-000000000004', true, 0),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-9000-000000000005', true, 1),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-9000-000000000006', true, 2),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-9000-000000000007', true, 0),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-9000-000000000008', true, 1),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-9000-000000000009', true, 2),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-9000-000000000010', true, 0),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-9000-000000000011', true, 1),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-9000-000000000012', true, 2)
ON CONFLICT ("roomTypeId", "amenityId") DO UPDATE SET "featured" = EXCLUDED."featured", "sortOrder" = EXCLUDED."sortOrder";

UPDATE "room_types" SET "gallery" = CASE "slug"
  WHEN 'chambre-classique' THEN '["https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85","https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1400&q=82","https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=82"]'::jsonb
  WHEN 'chambre-elegance' THEN '["https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85","https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1400&q=82","https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1400&q=82"]'::jsonb
  WHEN 'chambre-deluxe' THEN '["https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85","https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=82","https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1400&q=82"]'::jsonb
  WHEN 'suite-rivage' THEN '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85","https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1400&q=82","https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=82"]'::jsonb
  ELSE "gallery"
END,
"updatedAt" = now()
WHERE "slug" IN ('chambre-classique', 'chambre-elegance', 'chambre-deluxe', 'suite-rivage');

COMMIT;
