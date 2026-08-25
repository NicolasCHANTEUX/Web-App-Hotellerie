import type { BookingSource } from "../../generated/prisma/client.js";
import { searchAvailability } from "../availability/availability.service.js";
import { BookingError } from "../booking/booking.errors.js";
import { parseIdempotencyKey as parseBookingIdempotencyKey } from "../booking/booking.idempotency.js";
import { getBookingQuote } from "../booking/booking.quote.service.js";
import { createBooking } from "../booking/booking.service.js";
import type { BookingSelectionInput, CreateBookingInput } from "../booking/booking.types.js";
import { parseBookingQuoteBody, parseCreateBookingBody } from "../booking/booking.validation.js";
import { listExtras } from "../catalog/catalog.service.js";
import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";
import { confirmAdminBooking } from "./admin.service.js";

const CREATE_FIELDS = new Set([
  "source",
  "roomTypeId",
  "arrival",
  "departure",
  "adults",
  "children",
  "extraIds",
  "expectedTotal",
  "termsAccepted",
  "guest",
  "specialRequests",
]);
const OPTION_FIELDS = new Set(["arrival", "departure", "adults", "children"]);
const ADMIN_SOURCES = new Set<BookingSource>(["PHONE", "EMAIL", "WALK_IN", "ADMIN"]);
const VALIDATION_ROOM_TYPE_ID = "00000000-0000-4000-8000-000000000000";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAdminError(error: unknown): never {
  if (error instanceof BookingError) {
    throw new AdminApiError(error.statusCode, error.code, error.message);
  }
  throw error;
}

export type AdminBookingCreateInput = CreateBookingInput & { source: BookingSource };

export function parseAdminBookingCreateBody(body: unknown): AdminBookingCreateInput {
  if (!isRecord(body) || Object.keys(body).some((field) => !CREATE_FIELDS.has(field))) {
    throw new AdminApiError(400, "INVALID_BOOKING", "La demande de réservation contient un champ non autorisé.");
  }
  if (typeof body.source !== "string" || !ADMIN_SOURCES.has(body.source as BookingSource)) {
    throw new AdminApiError(400, "INVALID_BOOKING_SOURCE", "L'origine de la réservation est invalide.");
  }

  const { source, ...bookingBody } = body;
  try {
    const parsed = parseCreateBookingBody(bookingBody, { contactRequired: false });
    if (source === "PHONE" && !parsed.guest.phone) {
      throw new AdminApiError(400, "BOOKING_PHONE_REQUIRED", "Un numéro de téléphone est requis pour une réservation prise par téléphone.");
    }
    if (source === "EMAIL" && !parsed.guest.email) {
      throw new AdminApiError(400, "BOOKING_EMAIL_REQUIRED", "Une adresse e-mail est requise pour une réservation prise par e-mail.");
    }
    return { ...parsed, source: source as BookingSource };
  } catch (error) {
    return asAdminError(error);
  }
}

export function parseAdminBookingOptionsQuery(query: unknown): Omit<BookingSelectionInput, "roomTypeId" | "extraIds"> {
  if (!isRecord(query) || Object.keys(query).some((field) => !OPTION_FIELDS.has(field))) {
    throw new AdminApiError(400, "INVALID_QUERY", "Les critères de disponibilité sont invalides.");
  }
  try {
    const parsed = parseBookingQuoteBody({
      roomTypeId: VALIDATION_ROOM_TYPE_ID,
      arrival: query.arrival,
      departure: query.departure,
      adults: typeof query.adults === "string" ? Number(query.adults) : query.adults,
      children: typeof query.children === "string" ? Number(query.children) : query.children,
      extraIds: [],
    });
    return {
      arrival: parsed.arrival,
      departure: parsed.departure,
      adults: parsed.adults,
      children: parsed.children,
    };
  } catch (error) {
    return asAdminError(error);
  }
}

export function parseAdminBookingIdempotencyKey(value: unknown) {
  try {
    return parseBookingIdempotencyKey(value);
  } catch (error) {
    return asAdminError(error);
  }
}

export function parseAdminBookingQuoteBody(body: unknown) {
  try {
    return parseBookingQuoteBody(body);
  } catch (error) {
    return asAdminError(error);
  }
}

export async function getAdminBookingOptions(
  membership: AdminMembershipContext,
  input: Omit<BookingSelectionInput, "roomTypeId" | "extraIds">,
) {
  const [availability, extras] = await Promise.all([
    searchAvailability(input, membership.propertyId),
    listExtras(membership.propertyId),
  ]);
  return { ...availability, extras };
}

export async function getAdminBookingQuote(
  membership: AdminMembershipContext,
  input: BookingSelectionInput,
) {
  try {
    return await getBookingQuote(input, membership.propertyId);
  } catch (error) {
    return asAdminError(error);
  }
}

export async function createAdminBooking(
  membership: AdminMembershipContext,
  adminUserId: string,
  input: AdminBookingCreateInput,
  idempotencyKey: string,
  ipAddress?: string,
) {
  try {
    const pendingBooking = await createBooking(input, idempotencyKey, {
      propertyId: membership.propertyId,
      source: input.source,
      acceptanceChannel: "ADMIN",
      recordedByAdminUserId: adminUserId,
      notifyOptioned: false,
    });
    const confirmedBooking = await confirmAdminBooking(
      membership,
      adminUserId,
      pendingBooking.id,
      ipAddress,
      {
        action: "BOOKING_CREATED_BY_ADMIN",
        metadata: { source: input.source, channel: "ADMIN_BOOKING_CREATE" },
      },
    );
    if (!confirmedBooking) {
      throw new AdminApiError(409, "BOOKING_CREATION_CONFLICT", "La réservation a été créée mais ne peut pas être relue.");
    }
    return confirmedBooking;
  } catch (error) {
    return asAdminError(error);
  }
}
