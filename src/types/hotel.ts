export type Accommodation = {
  id: string;
  slug: string;
  name: string;
  category: string;
  shortDescription: string;
  description: string;
  price: number;
  currency: string;
  refundable: boolean;
  capacity: number;
  maxAdults: number;
  maxChildren: number;
  surface: string;
  surfaceSqm: number;
  rooms: string;
  hero: string;
  gallery: string[];
  amenities: string[];
  availableUnits?: number;
  totalPrice?: number;
};

export type PricingUnit = "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "ONE_TIME";

export type BookingOption = {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  unit: PricingUnit;
};

export type AvailabilityResult = {
  query: {
    arrival: string;
    departure: string;
    adults: number;
    children: number;
  };
  nights: number;
  roomTypes: Accommodation[];
};
