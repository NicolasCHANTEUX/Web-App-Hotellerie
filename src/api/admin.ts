import type { AvailabilityResult, BookingOption, BookingQuote, BookingSelectionInput, CreateBookingInput } from "../types/hotel";

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

type ApiEnvelope<T> = { data: T };

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

type AdminSessionRenewal = {
  currentAccessToken: () => string | null;
  renew: (expiredAccessToken: string) => Promise<string | null>;
};

let sessionRenewal: AdminSessionRenewal | null = null;

/** Lets the authentication provider supply and renew the current access token. */
export function setAdminSessionRenewal(renewal: AdminSessionRenewal | null) {
  sessionRenewal = renewal;
}

function sendAdminRequest(path: string, options: RequestInit, accessToken?: string) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
}

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
) {
  // Screens keep the token received at sign-in: requests always use the latest
  // renewed one, and renew it once when the API reports it expired. Replaying
  // is safe because a 401 is returned before any change is made.
  const token = accessToken ? sessionRenewal?.currentAccessToken() ?? accessToken : undefined;
  let response = await sendAdminRequest(path, options, token);
  if (response.status === 401 && token && sessionRenewal) {
    const renewedToken = await sessionRenewal.renew(token);
    if (renewedToken) response = await sendAdminRequest(path, options, renewedToken);
  }
  return readAdminResponse<T>(response);
}

async function readAdminResponse<T>(response: Response) {
  if (response.status === 202 || response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | ApiErrorBody | null;

  if (!response.ok) {
    const error = body && "error" in body ? body.error : undefined;
    throw new AdminApiError(
      error?.message ?? "Le service d’administration est momentanément indisponible.",
      response.status,
      error?.code,
    );
  }

  return (body as ApiEnvelope<T>).data;
}

export type AdminRole = "ADMIN" | "RECEPTION" | "ACCOUNTING" | "HOUSEKEEPING";

export type AdminLoginResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type AdminMe = {
  user: {
    id: string;
    displayName: string;
    email: string;
  };
  membership: {
    propertyId: string;
    role: AdminRole;
    property: {
      id: string;
      name: string;
      slug: string;
      timezone: string;
      currency: string;
    };
  };
};

export type BookingStatus =
  | "DRAFT"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "CANCELLED"
  | "EXPIRED"
  | "COMPLETED"
  | "NO_SHOW";

export type PaymentStatus =
  | "REQUIRES_PAYMENT"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type AdminGuest = {
  id?: string;
  isPrimary?: boolean;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  countryCode?: string | null;
};

export type AdminBookingRoom = {
  id: string;
  roomTypeId?: string;
  roomId?: string | null;
  roomTypeName: string;
  roomNumber: string | null;
  /** Average nightly price; nightlyRates details each night when recorded. */
  nightlyPrice?: number;
  nightlyRates?: Array<{ date: string; season: string | null; price: number }> | null;
  taxRate?: number;
  lineTotal?: number;
};

export type AdminBooking = {
  id: string;
  reference: string;
  status: BookingStatus;
  source: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  total: number;
  currency: string;
  createdAt: string;
  guest: AdminGuest | null;
  rooms: AdminBookingRoom[];
  paymentStatus: PaymentStatus | null;
  hold: {
    status: "ACTIVE" | "CONVERTED" | "EXPIRED" | "RELEASED";
    expiresAt: string;
    isActive: boolean;
  } | null;
};

export type AdminBookingDetail = AdminBooking & {
  priceTaxMode: "EXCLUSIVE" | "INCLUSIVE";
  accommodationSubtotal: number;
  extrasSubtotal: number;
  touristTaxTotal: number;
  taxTotal: number;
  rateConditions: {
    name: string;
    refundable: boolean | null;
    termsTitle: string | null;
  };
  specialRequests: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  guests: AdminGuest[];
  extras: Array<{
    id: string;
    extraId: string;
    code: string;
    name: string;
    unitPrice: number;
    pricingUnit: string;
    quantity: number;
    lineTotal: number;
  }>;
  payments: Array<{
    id: string;
    parentPaymentId: string | null;
    provider: "STRIPE" | "MANUAL";
    kind: "CHARGE" | "REFUND";
    status: PaymentStatus;
    amount: number;
    currency: string;
    paymentMethodType: string | null;
    processedAt: string | null;
    createdAt: string;
  }>;
};

export type AdminInvoice = {
  id: string;
  number: string;
  documentType: "INVOICE" | "CREDIT_NOTE";
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID";
  issuedAt: string | null;
  currency: string;
  total: number;
  originalInvoiceId: string | null;
};

export type RoomStatus = "ACTIVE" | "OUT_OF_SERVICE" | "ARCHIVED";

export type AdminRoomOccupancy = {
  kind: "BOOKING" | "HOLD" | "BLOCK";
  blockId?: string | null;
  bookingId?: string | null;
  bookingReference?: string | null;
  status: BookingStatus | null;
  checkIn: string;
  checkOut: string;
  guest?: AdminGuest | null;
  holdExpiresAt: string | null;
  blockReason: string | null;
  note: string | null;
};

export type AdminAvailableBookingRoom = {
  id: string;
  number: string;
  floor: number | null;
  selected: boolean;
};

export type AdminAvailabilityBlockInput = {
  checkIn: string;
  checkOut: string;
  reason: "MAINTENANCE" | "OWNER_USE" | "HOUSEKEEPING" | "OTHER";
  note?: string | null;
};

export type AdminRoom = {
  id: string;
  number: string;
  floor: number | null;
  status: RoomStatus;
  notes: string | null;
  updatedAt: string;
  roomType: {
    id: string;
    name: string;
    slug: string;
  };
  currentOccupancy: AdminRoomOccupancy | null;
  nextOccupancy: AdminRoomOccupancy | null;
  periodAvailability: {
    from: string;
    to: string;
    available: boolean;
    conflicts: AdminRoomOccupancy[];
  } | null;
};

export type AdminRoomType = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  description: string;
  surfaceSqm: number;
  maxAdults: number;
  maxChildren: number;
  maxGuests: number;
  bedLabel: string;
  coverImageUrl: string;
  displayOrder: number;
  isPublished: boolean;
  price: number;
  currency: string;
  taxRate: number;
  refundable: boolean;
  promotion: {
    id: string;
    label: string;
    discountPercent: number;
    referencePrice: number;
    promotionalPrice: number;
    validFrom: string;
    validUntil: string | null;
  } | null;
  amenities: string[];
  roomCount: number;
  canDelete: boolean;
  updatedAt: string;
};

export type AdminRoomTypeInput = {
  name: string;
  shortName: string | null;
  description: string;
  surfaceSqm: number;
  maxAdults: number;
  maxChildren: number;
  maxGuests: number;
  bedLabel: string;
  coverImageUrl: string;
  coverImageFileId: string | null;
  displayOrder: number;
  isPublished: boolean;
  price: number;
  taxRate: number;
  promotion: {
    label: string;
    discountPercent: number;
    validFrom: string;
    validUntil: string | null;
  } | null;
  amenities: string[];
};

export type UpdateAdminRoomTypeInput = AdminRoomTypeInput & { updatedAt: string };

export type AdminRoomEditable = Pick<AdminRoom, "id" | "number" | "floor" | "status" | "notes" | "updatedAt" | "roomType">;

export type UpdateAdminRoomInput = {
  updatedAt: string;
  number?: string;
  roomTypeId?: string;
  floor?: number | null;
  status?: RoomStatus;
  notes?: string | null;
};

export type CreateAdminRoomInput = {
  number: string;
  roomTypeId: string;
  floor?: number | null;
  status?: "ACTIVE" | "OUT_OF_SERVICE";
  notes?: string | null;
};

export type DeleteAdminRoomInput = {
  updatedAt: string;
};

export type AdminBookingSummary = {
  total: number;
  byStatus: Partial<Record<BookingStatus, number>>;
  arrivalsToday: number;
  departuresToday: number;
};

export type AdminRoomSummary = {
  total: number;
  byStatus: Partial<Record<RoomStatus, number>>;
  roomTypes: Array<{ id: string; name: string; slug: string }>;
  occupiedNow: number;
  heldNow: number;
  blockedNow: number;
  availableNow: number;
  period: {
    from: string;
    to: string;
    available: number;
    unavailable: number;
  } | null;
};

export type PaginatedAdminResult<T, Summary> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: Summary;
};

export type BookingFilters = {
  page: number;
  pageSize: number;
  search?: string;
  status?: BookingStatus | "";
  from?: string;
  to?: string;
  todayOnly?: boolean;
};

export type AdminBookingOptions = AvailabilityResult & {
  extras: BookingOption[];
};

export type CreateAdminBookingInput = Omit<CreateBookingInput, "guest"> & {
  source: "PHONE" | "EMAIL" | "WALK_IN" | "ADMIN";
  guest: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    countryCode?: string;
  };
};

export type UpdateAdminBookingInput = Omit<CreateAdminBookingInput, "source" | "termsAccepted"> & {
  updatedAt: string;
  reason?: string | null;
};

export type RoomFilters = {
  page: number;
  pageSize: number;
  search?: string;
  status?: RoomStatus | "";
  roomTypeId?: string;
  from?: string;
  to?: string;
  sortOrder?: "asc" | "desc";
};

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function loginAdmin(email: string, password: string, signal?: AbortSignal) {
  return adminRequest<AdminLoginResult>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    signal,
  });
}

export function refreshAdminSession(refreshToken: string) {
  return adminRequest<AdminLoginResult>("/admin/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

/**
 * Revokes the session server side, renewing an expired access token first so
 * that its refresh token is revoked too. Failures are ignored: the browser has
 * already forgotten the session.
 */
export async function revokeAdminSession(accessToken: string, refreshToken: string | null) {
  try {
    const response = await sendAdminRequest("/admin/auth/logout", { method: "POST" }, accessToken);
    if (response.status === 401 && refreshToken) {
      const renewed = await refreshAdminSession(refreshToken);
      await sendAdminRequest("/admin/auth/logout", { method: "POST" }, renewed.accessToken);
    }
  } catch {
    // Best effort only.
  }
}

/** Sends the e-mail to choose a new password; the answer never tells whether the account exists. */
export function requestAdminPasswordReset(email: string, signal?: AbortSignal) {
  return adminRequest<void>("/admin/auth/recover", { method: "POST", body: JSON.stringify({ email }), signal });
}

/**
 * Chooses the password from an invitation or reset link. The link's own token
 * is sent as is, whatever session this tab may already hold.
 */
export async function setAdminPassword(password: string, linkAccessToken: string) {
  return readAdminResponse<void>(await sendAdminRequest("/admin/auth/password", { method: "POST", body: JSON.stringify({ password }) }, linkAccessToken));
}

export type AdminTeamMember = {
  id: string;
  displayName: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  /** Never signed in yet, typically an invitation not yet accepted. */
  pending: boolean;
  lastLoginAt: string | null;
  memberSince: string;
  isCurrentUser: boolean;
};

export function getAdminTeam(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminTeamMember[]>("/admin/team", { signal }, accessToken);
}

export function inviteAdminTeamMember(input: { email: string; displayName: string; role: AdminRole }, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ member: AdminTeamMember; invitationSent: boolean }>("/admin/team", { method: "POST", body: JSON.stringify(input), signal }, accessToken);
}

export function updateAdminTeamMemberRole(id: string, role: AdminRole, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminTeamMember>(`/admin/team/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ role }), signal }, accessToken);
}

export function removeAdminTeamMember(id: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string }>(`/admin/team/${encodeURIComponent(id)}`, { method: "DELETE", signal }, accessToken);
}

export function getAdminMe(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminMe>("/admin/me", { signal }, accessToken);
}

export function getAdminBookings(filters: BookingFilters, accessToken: string, signal?: AbortSignal) {
  return adminRequest<PaginatedAdminResult<AdminBooking, AdminBookingSummary>>(
    `/admin/bookings${queryString(filters)}`,
    { signal },
    accessToken,
  );
}

export function getAdminBooking(id: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    `/admin/bookings/${encodeURIComponent(id)}`,
    { signal },
    accessToken,
  );
}

export function getAdminBookingOptions(
  params: { arrival: string; departure: string; adults: number; children: number },
  accessToken: string,
  signal?: AbortSignal,
) {
  return adminRequest<AdminBookingOptions>(
    `/admin/booking-options${queryString(params)}`,
    { signal },
    accessToken,
  );
}

export function getAdminBookingQuote(input: BookingSelectionInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<BookingQuote>(
    "/admin/booking-quotes",
    { method: "POST", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function getAdminBookingUpdateQuote(id: string, input: BookingSelectionInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<BookingQuote>(
    `/admin/bookings/${encodeURIComponent(id)}/quote`,
    { method: "POST", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function createAdminBooking(input: CreateAdminBookingInput, idempotencyKey: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    "/admin/bookings",
    { method: "POST", body: JSON.stringify(input), headers: { "Idempotency-Key": idempotencyKey }, signal },
    accessToken,
  );
}

export function updateAdminBooking(id: string, input: UpdateAdminBookingInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    `/admin/bookings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function confirmAdminBooking(id: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    `/admin/bookings/${encodeURIComponent(id)}/confirm`,
    { method: "POST", signal },
    accessToken,
  );
}

export function updateAdminBookingStatus(id: string, status: "CHECKED_IN" | "CANCELLED" | "COMPLETED" | "NO_SHOW", reason: string | null, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    `/admin/bookings/${encodeURIComponent(id)}/status`,
    { method: "PATCH", body: JSON.stringify({ status, reason }), signal },
    accessToken,
  );
}

export function getAvailableAdminBookingRooms(id: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminAvailableBookingRoom[]>(
    `/admin/bookings/${encodeURIComponent(id)}/available-rooms`,
    { signal },
    accessToken,
  );
}

export function assignAdminBookingRoom(id: string, roomId: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    `/admin/bookings/${encodeURIComponent(id)}/room`,
    { method: "PATCH", body: JSON.stringify({ roomId }), signal },
    accessToken,
  );
}

export function recordManualAdminPayment(id: string, paymentMethodType: string, note: string | null, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ paymentId: string; status: PaymentStatus; invoiceId?: string; invoiceNumber?: string }>(
    `/admin/bookings/${encodeURIComponent(id)}/payments/manual`,
    { method: "POST", body: JSON.stringify({ paymentMethodType, note }), headers: { "Idempotency-Key": `manual:${crypto.randomUUID()}` }, signal },
    accessToken,
  );
}

export function refundAdminPayment(id: string, paymentId: string, amount: number | undefined, reason: string, idempotencyKey: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ paymentId: string; status: PaymentStatus; invoiceId?: string; invoiceNumber?: string }>(
    `/admin/bookings/${encodeURIComponent(id)}/refunds`,
    { method: "POST", body: JSON.stringify({ paymentId, ...(amount === undefined ? {} : { amount }), reason }), headers: { "Idempotency-Key": idempotencyKey }, signal },
    accessToken,
  );
}

export function getAdminBookingInvoices(id: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminInvoice[]>(`/admin/bookings/${encodeURIComponent(id)}/invoices`, { signal }, accessToken);
}

export async function downloadAdminInvoice(id: string, accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/admin/invoices/${encodeURIComponent(id)}/pdf`, {
    headers: { Accept: "application/pdf", Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new AdminApiError(body?.error?.message ?? "Le document n'a pas pu être téléchargé.", response.status, body?.error?.code);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "document.pdf";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function getAdminRooms(filters: RoomFilters, accessToken: string, signal?: AbortSignal) {
  return adminRequest<PaginatedAdminResult<AdminRoom, AdminRoomSummary>>(
    `/admin/rooms${queryString(filters)}`,
    { signal },
    accessToken,
  );
}

export function getAdminRoomTypes(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminRoomType[]>("/admin/room-types", { signal }, accessToken);
}

export function uploadAdminRoomTypeCover(file: File, accessToken: string, signal?: AbortSignal) {
  const body = new FormData();
  body.append("file", file);
  return adminRequest<{ storedFileId: string; url: string; mimeType: string; sizeBytes: number }>(
    "/admin/media/room-type-cover",
    { method: "POST", body, signal },
    accessToken,
  );
}

export function createAdminRoomType(input: AdminRoomTypeInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminRoomType>(
    "/admin/room-types",
    { method: "POST", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function updateAdminRoomType(id: string, input: UpdateAdminRoomTypeInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminRoomType>(
    `/admin/room-types/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function deleteAdminRoomType(id: string, updatedAt: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string; archived: boolean }>(
    `/admin/room-types/${encodeURIComponent(id)}`,
    { method: "DELETE", body: JSON.stringify({ updatedAt }), signal },
    accessToken,
  );
}

export type AdminPricingUnit = "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "ONE_TIME";

export type AdminExtra = {
  id: string;
  code: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  pricingUnit: AdminPricingUnit;
  taxRate: number | null;
  isActive: boolean;
  displayOrder: number;
  bookingCount: number;
  canDelete: boolean;
  updatedAt: string;
};

export type AdminExtraInput = {
  name: string;
  description: string;
  price: number;
  pricingUnit: AdminPricingUnit;
  taxRate: number;
  isActive: boolean;
  displayOrder: number;
};

export function getAdminExtras(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminExtra[]>("/admin/extras", { signal }, accessToken);
}

export function createAdminExtra(input: AdminExtraInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminExtra>("/admin/extras", { method: "POST", body: JSON.stringify(input), signal }, accessToken);
}

export function updateAdminExtra(id: string, input: AdminExtraInput & { updatedAt: string }, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminExtra>(
    `/admin/extras/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function deleteAdminExtra(id: string, updatedAt: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string }>(
    `/admin/extras/${encodeURIComponent(id)}`,
    { method: "DELETE", body: JSON.stringify({ updatedAt }), signal },
    accessToken,
  );
}

export type AdminPropertyEditableSettings = {
  name: string;
  legalName: string | null;
  email: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  checkInTime: string;
  checkOutTime: string;
  legalForm: string | null;
  shareCapital: string | null;
  siret: string | null;
  registrationCity: string | null;
  vatNumber: string | null;
  publicationDirector: string | null;
  hostingProvider: string | null;
  mediator: string | null;
};

export type AdminPropertySettings = AdminPropertyEditableSettings & {
  id: string;
  slug: string;
  timezone: string;
  currency: string;
  updatedAt: string;
};

export function getAdminPropertySettings(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminPropertySettings>("/admin/property", { signal }, accessToken);
}

export function updateAdminPropertySettings(input: AdminPropertyEditableSettings & { updatedAt: string }, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminPropertySettings>("/admin/property", { method: "PATCH", body: JSON.stringify(input), signal }, accessToken);
}

export type AdminTaxCalculationMode = "PER_ADULT_PER_NIGHT" | "PER_PERSON_PER_NIGHT" | "PER_NIGHT" | "PER_STAY" | "PERCENTAGE";

export type AdminTouristTax = {
  id: string;
  code: string;
  label: string;
  calculationMode: AdminTaxCalculationMode;
  amount: number | null;
  rate: number | null;
  currency: string | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  usageCount: number;
  canDelete: boolean;
  updatedAt: string;
};

export type AdminTouristTaxInput = {
  label: string;
  calculationMode: AdminTaxCalculationMode;
  amount: number | null;
  rate: number | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
};

export function getAdminTouristTaxes(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminTouristTax[]>("/admin/tourist-taxes", { signal }, accessToken);
}

export function createAdminTouristTax(input: AdminTouristTaxInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminTouristTax>("/admin/tourist-taxes", { method: "POST", body: JSON.stringify(input), signal }, accessToken);
}

export function updateAdminTouristTax(id: string, input: AdminTouristTaxInput & { updatedAt: string }, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminTouristTax>(
    `/admin/tourist-taxes/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function deleteAdminTouristTax(id: string, updatedAt: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string }>(
    `/admin/tourist-taxes/${encodeURIComponent(id)}`,
    { method: "DELETE", body: JSON.stringify({ updatedAt }), signal },
    accessToken,
  );
}

export type AdminDashboard = {
  /** Today at the property, as YYYY-MM-DD. */
  date: string;
  arrivals: AdminBooking[];
  departures: AdminBooking[];
  pendingOptions: AdminBooking[];
  pendingOptionsTotal: number;
  occupancy: Array<{ date: string; occupied: number; blocked: number; available: number }>;
  /** Null for the roles that do not answer contact requests. */
  openContactRequests: number | null;
  /** Null for the roles that do not handle money. */
  finance: {
    currency: string;
    monthStart: string;
    collected: number;
    refunded: number;
    net: number;
    bookingsCount: number;
    bookingsTotal: number;
  } | null;
};

export function getAdminDashboard(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminDashboard>("/admin/dashboard", { signal }, accessToken);
}

export type AdminContactRequestFilter = "OPEN" | "HANDLED" | "ALL";

export type AdminContactRequest = {
  id: string;
  fullName: string;
  /** Null once the request has been anonymized. */
  email: string | null;
  phone: string | null;
  subject: string;
  message: string;
  anonymized: boolean;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
  updatedAt: string;
};

export type AdminContactRequestSummary = { open: number; handled: number };

export function getAdminContactRequests(
  filters: { page: number; pageSize: number; status: AdminContactRequestFilter; search?: string },
  accessToken: string,
  signal?: AbortSignal,
) {
  return adminRequest<PaginatedAdminResult<AdminContactRequest, AdminContactRequestSummary>>(
    `/admin/contact-requests${queryString(filters)}`,
    { signal },
    accessToken,
  );
}

export function getAdminContactRequest(id: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminContactRequest>(`/admin/contact-requests/${encodeURIComponent(id)}`, { signal }, accessToken);
}

export function setAdminContactRequestHandled(id: string, handled: boolean, updatedAt: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminContactRequest>(
    `/admin/contact-requests/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ handled, updatedAt }), signal },
    accessToken,
  );
}

export type AdminSeasonRate = {
  roomTypeId: string;
  nightlyPrice: number;
  weekendNightlyPrice: number | null;
};

/** validFrom and validUntil are the first and last nights of the season, both included. */
export type AdminSeason = {
  id: string;
  label: string;
  validFrom: string;
  validUntil: string;
  minNights: number | null;
  rates: AdminSeasonRate[];
  updatedAt: string;
};

export type AdminSeasonGrid = {
  roomTypes: Array<{ id: string; name: string; basePrice: number | null; currency: string }>;
  seasons: AdminSeason[];
};

export type AdminSeasonInput = Omit<AdminSeason, "id" | "updatedAt">;

export function getAdminSeasons(accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminSeasonGrid>("/admin/seasons", { signal }, accessToken);
}

export function createAdminSeason(input: AdminSeasonInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminSeason>("/admin/seasons", { method: "POST", body: JSON.stringify(input), signal }, accessToken);
}

export function updateAdminSeason(id: string, input: AdminSeasonInput & { updatedAt: string }, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminSeason>(
    `/admin/seasons/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function deleteAdminSeason(id: string, updatedAt: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string }>(
    `/admin/seasons/${encodeURIComponent(id)}`,
    { method: "DELETE", body: JSON.stringify({ updatedAt }), signal },
    accessToken,
  );
}

export function updateAdminRoom(id: string, input: UpdateAdminRoomInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminRoomEditable>(
    `/admin/rooms/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function createAdminAvailabilityBlock(roomId: string, input: AdminAvailabilityBlockInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string }>(
    `/admin/rooms/${encodeURIComponent(roomId)}/blocks`,
    { method: "POST", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function releaseAdminAvailabilityBlock(blockId: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string; released: boolean }>(
    `/admin/room-blocks/${encodeURIComponent(blockId)}/release`,
    { method: "POST", signal },
    accessToken,
  );
}

export function createAdminRoom(input: CreateAdminRoomInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminRoomEditable>(
    "/admin/rooms",
    { method: "POST", body: JSON.stringify(input), signal },
    accessToken,
  );
}

export function deleteAdminRoom(id: string, input: DeleteAdminRoomInput, accessToken: string, signal?: AbortSignal) {
  return adminRequest<{ id: string }>(
    `/admin/rooms/${encodeURIComponent(id)}`,
    { method: "DELETE", body: JSON.stringify(input), signal },
    accessToken,
  );
}
