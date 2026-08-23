export type BookingGuestInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  countryCode?: string;
};

export type CreateBookingInput = {
  roomTypeId: string;
  arrival: Date;
  departure: Date;
  adults: number;
  children: number;
  extraIds: string[];
  expectedTotal: number;
  guest: BookingGuestInput;
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
