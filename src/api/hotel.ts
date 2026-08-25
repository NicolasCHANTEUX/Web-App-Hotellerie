import { apiGet, apiPost } from "./client";
import { Accommodation, AvailabilityResult, BookingConfirmation, BookingOption, BookingQuote, BookingSelectionInput, CreateBookingInput } from "../types/hotel";

export function getRoomTypes(signal?: AbortSignal) {
  return apiGet<Accommodation[]>("/room-types", signal);
}

export function getRoomType(slug: string, signal?: AbortSignal) {
  return apiGet<Accommodation>(`/room-types/${encodeURIComponent(slug)}`, signal);
}

export function getExtras(signal?: AbortSignal) {
  return apiGet<BookingOption[]>("/extras", signal);
}

export function getAvailability(params: { arrival: string; departure: string; adults: number; children: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({
    arrival: params.arrival,
    departure: params.departure,
    adults: String(params.adults),
    children: String(params.children),
  });
  return apiGet<AvailabilityResult>(`/availability?${query}`, signal);
}

export function getBookingQuote(input: BookingSelectionInput, signal?: AbortSignal) {
  return apiPost<BookingQuote>("/quotes", input, signal);
}

export function createBooking(input: CreateBookingInput, idempotencyKey: string, signal?: AbortSignal) {
  return apiPost<BookingConfirmation>("/bookings", input, signal, { "Idempotency-Key": idempotencyKey });
}

export function getPaymentConfig(signal?: AbortSignal) {
  return apiGet<{ stripeEnabled: boolean }>("/payments/config", signal);
}

export function createStripeCheckout(reference: string, email: string, idempotencyKey: string, signal?: AbortSignal) {
  return apiPost<{ checkoutUrl: string; sessionId: string }>(
    "/payments/stripe/checkout",
    { reference, email },
    signal,
    { "Idempotency-Key": idempotencyKey },
  );
}

export type StripeCheckoutStatus = {
  paymentStatus: "REQUIRES_PAYMENT" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  booking: {
    reference: string;
    status: "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "COMPLETED" | "NO_SHOW";
    room: string;
    arrival: string;
    departure: string;
    adults: number;
    children: number;
    options: string[];
    total: number;
    currency: string;
    holdExpiresAt?: string;
  };
};

export function getStripeCheckoutStatus(sessionId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ sessionId });
  return apiGet<StripeCheckoutStatus>(`/payments/stripe/status?${query}`, signal);
}
