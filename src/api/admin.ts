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

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string,
) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
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
  nightlyPrice?: number;
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
  specialRequests: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  guests: AdminGuest[];
  extras: Array<{
    id: string;
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

export function createAdminBooking(input: CreateAdminBookingInput, idempotencyKey: string, accessToken: string, signal?: AbortSignal) {
  return adminRequest<AdminBookingDetail>(
    "/admin/bookings",
    { method: "POST", body: JSON.stringify(input), headers: { "Idempotency-Key": idempotencyKey }, signal },
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
