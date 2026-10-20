import { createHash, createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { BookingError } from "./booking.errors.js";

const TOKEN_PATTERN = /^(?:bkg|rvg)_[A-Za-z0-9_-]{43}$/;
const ACCESS_AFTER_DEPARTURE_DAYS = 30;

export function bookingAccessToken(bookingId: string) {
  const digest = createHmac("sha256", env.bookingAccessTokenSecret)
    .update(`booking:${bookingId}`)
    .digest("base64url");
  return `bkg_${digest}`;
}

export function bookingAccessTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function bookingAccessTokenExpiresAt(checkOut: Date) {
  const expiry = new Date(checkOut);
  expiry.setUTCDate(expiry.getUTCDate() + ACCESS_AFTER_DEPARTURE_DAYS);
  return expiry;
}

type PublicAccess = {
  id: string;
  publicAccessTokenHash: string | null;
  publicAccessTokenExpiresAt: Date | null;
};

/**
 * Personal link to the booking page, while the booking still grants public
 * access. The token sits in the fragment, which browsers never send to servers
 * nor in Referer headers; the page reads it from `#acces=`.
 */
export function publicBookingUrl(booking: PublicAccess, now = new Date()) {
  if (!booking.publicAccessTokenHash || !booking.publicAccessTokenExpiresAt || booking.publicAccessTokenExpiresAt <= now) {
    return undefined;
  }
  const token = bookingAccessToken(booking.id);
  // A rotated secret no longer matches the stored hash: the link would fail.
  if (bookingAccessTokenHash(token) !== booking.publicAccessTokenHash) return undefined;
  return `${env.frontendUrl.replace(/\/+$/, "")}/confirmation#acces=${token}`;
}

export function parseBookingAccessToken(value: unknown) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value.trim())) {
    throw new BookingError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
  }
  return value.trim();
}
