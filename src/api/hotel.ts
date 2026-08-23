import { apiGet, apiPost } from "./client";
import { Accommodation, AvailabilityResult, BookingConfirmation, BookingOption, CreateBookingInput } from "../types/hotel";

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

export function createBooking(input: CreateBookingInput, idempotencyKey: string, signal?: AbortSignal) {
  return apiPost<BookingConfirmation>("/bookings", input, signal, { "Idempotency-Key": idempotencyKey });
}
