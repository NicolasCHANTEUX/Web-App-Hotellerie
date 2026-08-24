export type Accommodation = {
  id: string;
  slug: string;
  name: string;
  category: string;
  shortDescription: string;
  description: string;
  price: number;
  taxRate: number;
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
  touristTaxTotal?: number;
};

export type PricingUnit = "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "ONE_TIME";

export type BookingOption = {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  taxRate: number | null;
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

export type CreateBookingInput = {
  roomTypeId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  extraIds: string[];
  expectedTotal: number;
  guest: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    countryCode?: string;
  };
  specialRequests?: string;
};

export type BookingConfirmation = {
  id: string;
  reference: string;
  status: "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "COMPLETED" | "NO_SHOW";
  room: {
    name: string;
  };
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  options: string[];
  total: number;
  currency: string;
  email: string;
  holdExpiresAt: string;
};
