export type Accommodation = {
  id: string;
  slug: string;
  name: string;
  category: string;
  shortDescription: string;
  description: string;
  price: number;
  originalPrice?: number;
  promotion?: {
    label: string;
    discountPercent: number;
    validUntil: string | null;
  };
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

export type BookingSelectionInput = {
  roomTypeId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  extraIds: string[];
};

export type BookingQuote = {
  priceTaxMode: "INCLUSIVE";
  currency: string;
  nights: number;
  room: {
    id: string;
    slug: string;
    name: string;
    unitPrice: number;
    subtotal: number;
    taxAmount: number;
    total: number;
    promotion: {
      id: string;
      label: string;
      discountPercent: number;
      referenceUnitPrice: number;
    } | null;
  };
  extras: Array<{
    id: string;
    code: string;
    name: string;
    unitPrice: number;
    pricingUnit: PricingUnit;
    quantity: number;
    subtotal: number;
    taxAmount: number;
    total: number;
  }>;
  accommodationTotal: number;
  extrasTotal: number;
  vatTotalIncluded: number;
  touristTaxTotal: number;
  total: number;
};

export type CreateBookingInput = BookingSelectionInput & {
  expectedTotal: number;
  termsAccepted: true;
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
  status: "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "EXPIRED" | "COMPLETED" | "NO_SHOW";
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
  accessToken?: string;
  holdExpiresAt: string;
};

export type PublicProperty = {
  slug: string;
  name: string;
  email: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
  roomCount: number;
};
