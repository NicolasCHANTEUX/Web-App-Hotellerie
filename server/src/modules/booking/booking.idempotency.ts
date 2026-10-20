import { createHash, randomInt } from "node:crypto";
import { BookingError } from "./booking.errors.js";
import type { CreateBookingInput } from "./booking.types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new BookingError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "L'en-tête Idempotency-Key doit contenir un UUID valide.",
    );
  }
  return value.trim().toLowerCase();
}

// Without 0/O, 1/I/L or U/V, so that a reference can be read over the phone.
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTWXYZ";
const REFERENCE_LENGTH = 6;

/**
 * Short code given to the guest, such as "BKG-7K3F9Q". It is not a secret:
 * access to a booking always requires its access token.
 */
export function generateBookingReference(prefix: string) {
  let code = "";
  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `${prefix}-${code}`;
}

export function bookingRequestHash(
  input: CreateBookingInput,
  context?: {
    propertyId: string;
    source: string;
    acceptanceChannel: string;
  },
) {
  const canonicalPayload = {
    roomTypeId: input.roomTypeId.toLowerCase(),
    arrival: input.arrival.toISOString().slice(0, 10),
    departure: input.departure.toISOString().slice(0, 10),
    adults: input.adults,
    children: input.children,
    extraIds: input.extraIds.map((id) => id.toLowerCase()).sort(),
    expectedTotal: input.expectedTotal,
    termsAccepted: input.termsAccepted,
    guest: {
      firstName: input.guest.firstName,
      lastName: input.guest.lastName,
      email: input.guest.email ?? null,
      phone: input.guest.phone ?? null,
      countryCode: input.guest.countryCode ?? null,
    },
    specialRequests: input.specialRequests ?? null,
    ...(context ? { context } : {}),
  };

  return createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

export function assertIdempotencyRequestMatches(storedRequestHash: string | undefined, requestHash: string) {
  if (storedRequestHash !== requestHash) {
    throw new BookingError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "Cette clé d'idempotence a déjà été utilisée avec une autre demande.",
    );
  }
}
