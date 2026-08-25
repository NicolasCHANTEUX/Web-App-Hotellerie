export type BookingGuestInput = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  countryCode?: string;
};

export type BookingSelectionInput = {
  roomTypeId: string;
  arrival: Date;
  departure: Date;
  adults: number;
  children: number;
  extraIds: string[];
};

export type CreateBookingInput = BookingSelectionInput & {
  expectedTotal: number;
  termsAccepted: true;
  guest: BookingGuestInput;
  specialRequests?: string;
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
    pricingUnit: "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "ONE_TIME";
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
  holdExpiresAt: string;
};
