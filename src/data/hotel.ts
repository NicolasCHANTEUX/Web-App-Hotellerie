export type Accommodation = {
  id: number;
  slug: string;
  name: string;
  category: string;
  shortDescription: string;
  description: string;
  price: number;
  capacity: number;
  surface: string;
  rooms: string;
  hero: string;
  gallery: string[];
  amenities: string[];
};

export const accommodations: Accommodation[] = [
  {
    id: 1,
    slug: "chambre-classique",
    name: "Chambre Classique",
    category: "Chambre double",
    shortDescription: "Élégante et chaleureuse, la Chambre Classique allie confort et sobriété dans une atmosphère baignée de lumière.",
    description: "Des matières naturelles, une lumière douce et une vue apaisante composent un refuge intime pensé pour deux personnes.",
    price: 95,
    capacity: 2,
    surface: "18 m²",
    rooms: "1 lit double",
    hero: "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=82",
    ],
    amenities: ["Vue sur jardin", "Literie premium", "Produits de bain", "Petit-déjeuner"],
  },
  {
    id: 2,
    slug: "chambre-elegance",
    name: "Chambre Élégance",
    category: "Chambre supérieure",
    shortDescription: "Des volumes généreux, des textiles délicats et un espace bureau composent une chambre aussi raffinée que fonctionnelle.",
    description: "La Chambre Élégance marie le charme d'une maison méditerranéenne au confort contemporain d'un boutique-hôtel.",
    price: 135,
    capacity: 2,
    surface: "24 m²",
    rooms: "1 lit queen-size",
    hero: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1400&q=82",
    ],
    amenities: ["Espace bureau", "Douche italienne", "Wi-Fi fibre", "Accueil personnalisé"],
  },
  {
    id: 3,
    slug: "chambre-deluxe",
    name: "Chambre Deluxe",
    category: "Chambre deluxe",
    shortDescription: "Une chambre spacieuse aux prestations haut de gamme, prolongée par un coin salon propice aux séjours plus longs.",
    description: "La Chambre Deluxe offre davantage d'espace, un lit king-size et une salle de bain généreuse dans une palette douce et solaire.",
    price: 185,
    capacity: 2,
    surface: "30 m²",
    rooms: "1 lit king-size",
    hero: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1400&q=82",
    ],
    amenities: ["Coin salon", "Baignoire", "Machine à café", "Service conciergerie"],
  },
  {
    id: 4,
    slug: "suite-rivage",
    name: "Suite Rivage",
    category: "Suite signature",
    shortDescription: "Notre suite la plus généreuse réunit chambre, salon privé et terrasse pour une expérience pleinement méditerranéenne.",
    description: "Pensée comme un appartement privé, la Suite Rivage offre des volumes ouverts, une terrasse et des attentions sur mesure.",
    price: 265,
    capacity: 4,
    surface: "52 m²",
    rooms: "1 chambre et salon",
    hero: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85",
    gallery: [
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85",
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1400&q=82",
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=82",
    ],
    amenities: ["Terrasse privée", "Salon indépendant", "Vue panoramique", "Petit-déjeuner"],
  },
];

export const experiences = [
  "Petit-déjeuner artisanal servi en chambre",
  "Réservations de restaurants et expériences locales",
  "Arrivée autonome ou accueil personnalisé",
  "Sélection de soins bien-être sur demande",
];
