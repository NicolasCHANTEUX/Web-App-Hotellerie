import { createHash, createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { BookingError } from "./booking.errors.js";

const TOKEN_PATTERN = /^rvg_[A-Za-z0-9_-]{43}$/;
const ACCESS_AFTER_DEPARTURE_DAYS = 30;

export function bookingAccessToken(bookingId: string) {
  const digest = createHmac("sha256", env.bookingAccessTokenSecret)
    .update(`booking:${bookingId}`)
    .digest("base64url");
  return `rvg_${digest}`;
}

export function bookingAccessTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function bookingAccessTokenExpiresAt(checkOut: Date) {
  const expiry = new Date(checkOut);
  expiry.setUTCDate(expiry.getUTCDate() + ACCESS_AFTER_DEPARTURE_DAYS);
  return expiry;
}

export function parseBookingAccessToken(value: unknown) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value.trim())) {
    throw new BookingError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
  }
  return value.trim();
}
