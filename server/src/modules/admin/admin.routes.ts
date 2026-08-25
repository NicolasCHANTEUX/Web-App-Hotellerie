import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BookingStatus, RoomStatus } from "../../generated/prisma/client.js";
import {
  authenticateAdmin,
  loginWithPassword,
  requireAdminContext,
  resolveMembership,
} from "./admin.auth.js";
import { AdminApiError, sendAdminError } from "./admin.errors.js";
import { parseRoomPeriodQuery } from "./admin.room-query.js";
import {
  parseAdminRoomUpdateBody,
  requireRoomManagementPermission,
} from "./admin.room-update.js";
import {
  parseAdminRoomCreateBody,
  parseAdminRoomDeleteBody,
} from "./admin.room-create-delete.js";
import {
  parseAdminRoomTypeCreateBody,
  parseAdminRoomTypeDeleteBody,
  parseAdminRoomTypeUpdateBody,
} from "./admin.room-type.js";
import {
  createAdminRoomType,
  deleteAdminRoomType,
  listAdminRoomTypes,
  updateAdminRoomType,
} from "./admin.room-type.service.js";
import {
  parseAdminBookingRoomAssignmentBody,
  parseAdminBookingStatusBody,
} from "./admin.booking-actions.js";
import { parseAdminAvailabilityBlockBody } from "./admin.availability-block.js";
import { parseIdempotencyKey, parseManualPaymentBody, parseRefundBody } from "../billing/billing.validation.js";
import { recordManualPayment, refundPayment } from "../billing/billing.service.js";
import { getInvoiceForProperty, listBookingInvoices, renderInvoicePdf } from "../billing/invoice.service.js";
import { storeRoomTypeCover } from "../media/media.service.js";
import {
  confirmAdminBooking,
  assignAdminBookingRoom,
  createAdminAvailabilityBlock,
  createAdminRoom,
  deleteAdminRoom,
  getAdminBooking,
  listAdminBookings,
  listAvailableRoomsForBooking,
  listAdminRooms,
  releaseAdminAvailabilityBlock,
  updateAdminBookingStatus,
  updateAdminRoom,
  type BookingListInput,
  type RoomListInput,
} from "./admin.service.js";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

type BookingListQuery = {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  todayOnly?: string;
};

type BookingParams = {
  id: string;
};

type RoomParams = {
  id: string;
};

type RoomTypeParams = {
  id: string;
};

type BlockParams = {
  id: string;
};

type InvoiceParams = {
  id: string;
};

type RoomListQuery = {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  roomTypeId?: string;
  from?: string;
  to?: string;
  sortOrder?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleAdminRoute<T>(reply: FastifyReply, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    return sendAdminError(reply, error);
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number, field: string, max: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new AdminApiError(400, "INVALID_QUERY", `Le paramètre ${field} est invalide.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AdminApiError(400, "INVALID_QUERY", `Le paramètre ${field} est invalide.`);
  }
  return parsed;
}

function parseSearch(value: string | undefined) {
  const search = value?.trim();
  if (!search) return undefined;
  if (search.length > 100) {
    throw new AdminApiError(400, "INVALID_QUERY", "La recherche est limitée à 100 caractères.");
  }
  return search;
}

function parseDate(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  if (!isoDatePattern.test(value)) {
    throw new AdminApiError(400, "INVALID_QUERY", `Le paramètre ${field} doit être une date AAAA-MM-JJ.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) {
    throw new AdminApiError(400, "INVALID_QUERY", `Le paramètre ${field} doit être une date valide.`);
  }
  return date;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseBookingStatus(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!Object.values(BookingStatus).includes(value as BookingStatus)) {
    throw new AdminApiError(400, "INVALID_QUERY", "Le statut de réservation est invalide.");
  }
  return value as BookingStatus;
}

function parseRoomStatus(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!Object.values(RoomStatus).includes(value as RoomStatus)) {
    throw new AdminApiError(400, "INVALID_QUERY", "Le statut de chambre est invalide.");
  }
  return value as RoomStatus;
}

function parseBookingQuery(query: BookingListQuery): BookingListInput {
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from && to && from > to) {
    throw new AdminApiError(400, "INVALID_QUERY", "La date de début doit précéder la date de fin.");
  }
  return {
    page: parsePositiveInteger(query.page, 1, "page", 1_000_000),
    pageSize: parsePositiveInteger(query.pageSize, 20, "pageSize", 100),
    search: parseSearch(query.search),
    status: parseBookingStatus(query.status),
    from,
    to,
    todayOnly: query.todayOnly === undefined || query.todayOnly === ""
      ? undefined
      : query.todayOnly === "true"
        ? true
        : query.todayOnly === "false"
          ? false
          : (() => { throw new AdminApiError(400, "INVALID_QUERY", "Le paramètre todayOnly est invalide."); })(),
  };
}

function parseRoomQuery(query: RoomListQuery): RoomListInput {
  const roomTypeId = query.roomTypeId?.trim() || undefined;
  if (roomTypeId && !uuidPattern.test(roomTypeId)) {
    throw new AdminApiError(400, "INVALID_QUERY", "Le type de chambre est invalide.");
  }
  return {
    page: parsePositiveInteger(query.page, 1, "page", 1_000_000),
    pageSize: parsePositiveInteger(query.pageSize, 20, "pageSize", 100),
    search: parseSearch(query.search),
    status: parseRoomStatus(query.status),
    roomTypeId,
    ...parseRoomPeriodQuery(query),
  };
}

function selectedMembership(request: FastifyRequest) {
  const membership = resolveMembership(request);
  return {
    propertyId: membership.propertyId,
    role: membership.role,
    property: membership.property,
  };
}

function bookingOperationsMembership(request: FastifyRequest) {
  const membership = resolveMembership(request);
  if (membership.role !== "ADMIN" && membership.role !== "RECEPTION") {
    throw new AdminApiError(
      403,
      "ROLE_ACCESS_DENIED",
      "Votre rôle ne permet pas de gérer les séjours.",
    );
  }
  return membership;
}

function bookingReadMembership(request: FastifyRequest) {
  const membership = resolveMembership(request);
  if (membership.role !== "ADMIN" && membership.role !== "RECEPTION" && membership.role !== "ACCOUNTING") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de consulter les réservations.");
  }
  return membership;
}

function paymentMembership(request: FastifyRequest) {
  const membership = resolveMembership(request);
  if (!(["ADMIN", "RECEPTION", "ACCOUNTING"] as const).includes(membership.role as "ADMIN" | "RECEPTION" | "ACCOUNTING")) {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de gérer les règlements.");
  }
  return membership;
}

function refundMembership(request: FastifyRequest) {
  const membership = resolveMembership(request);
  if (membership.role !== "ADMIN" && membership.role !== "ACCOUNTING") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas d'effectuer un remboursement.");
  }
  return membership;
}

export async function adminRoutes(app: FastifyInstance) {
  app.decorateRequest("adminContext", null);
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post<{ Body: LoginBody }>("/admin/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    return handleAdminRoute(reply, async () => {
      const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      if (!emailPattern.test(email) || email.length > 320 || password.length < 1 || password.length > 1024) {
        throw new AdminApiError(400, "INVALID_CREDENTIALS", "Adresse e-mail ou mot de passe invalide.");
      }
      return { data: await loginWithPassword(email, password) };
    });
  });

  app.get(
    "/admin/me",
    { preHandler: authenticateAdmin },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        const context = requireAdminContext(request);
        return {
          data: {
            user: {
              id: context.user.id,
              displayName: context.user.displayName,
              email: context.user.email,
            },
            membership: selectedMembership(request),
          },
        };
      }),
  );

  app.get<{ Querystring: BookingListQuery }>(
    "/admin/bookings",
    { preHandler: authenticateAdmin },
    async (request, reply) =>
      handleAdminRoute(reply, async () => ({
        data: await listAdminBookings(bookingReadMembership(request), parseBookingQuery(request.query)),
      })),
  );

  app.get<{ Params: BookingParams }>(
    "/admin/bookings/:id",
    { preHandler: authenticateAdmin },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
        }
        const membership = bookingReadMembership(request);
        const booking = await getAdminBooking(membership.propertyId, request.params.id, membership.role !== "ACCOUNTING");
        if (!booking) {
          throw new AdminApiError(404, "BOOKING_NOT_FOUND", "Réservation introuvable.");
        }
        return { data: booking };
      }),
  );

  app.post<{ Params: BookingParams }>(
    "/admin/bookings/:id/confirm",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
        }
        const context = requireAdminContext(request);
        const booking = await confirmAdminBooking(
          bookingOperationsMembership(request),
          context.user.id,
          request.params.id,
          request.ip,
        );
        return { data: booking };
      }),
  );

  app.patch<{ Params: BookingParams; Body: unknown }>(
    "/admin/bookings/:id/status",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 40, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
        }
        const context = requireAdminContext(request);
        return {
          data: await updateAdminBookingStatus(
            bookingOperationsMembership(request),
            context.user.id,
            request.params.id,
            parseAdminBookingStatusBody(request.body),
            request.ip,
          ),
        };
      }),
  );

  app.get<{ Params: BookingParams }>(
    "/admin/bookings/:id/available-rooms",
    { preHandler: authenticateAdmin },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
        }
        return { data: await listAvailableRoomsForBooking(bookingOperationsMembership(request).propertyId, request.params.id) };
      }),
  );

  app.patch<{ Params: BookingParams; Body: unknown }>(
    "/admin/bookings/:id/room",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 40, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
        }
        const context = requireAdminContext(request);
        const input = parseAdminBookingRoomAssignmentBody(request.body);
        return {
          data: await assignAdminBookingRoom(
            bookingOperationsMembership(request),
            context.user.id,
            request.params.id,
            input.roomId,
            request.ip,
          ),
        };
      }),
  );

  app.post<{ Params: BookingParams; Body: unknown }>(
    "/admin/bookings/:id/payments/manual",
    { preHandler: authenticateAdmin, config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => handleAdminRoute(reply, async () => {
      if (!uuidPattern.test(request.params.id)) throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
      const context = requireAdminContext(request);
      const result = await recordManualPayment(
        paymentMembership(request),
        context.user.id,
        request.params.id,
        parseIdempotencyKey(request.headers["idempotency-key"]),
        parseManualPaymentBody(request.body),
        request.ip,
      );
      return reply.code(201).send({ data: result });
    }),
  );

  app.post<{ Params: BookingParams; Body: unknown }>(
    "/admin/bookings/:id/refunds",
    { preHandler: authenticateAdmin, config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => handleAdminRoute(reply, async () => {
      if (!uuidPattern.test(request.params.id)) throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
      const context = requireAdminContext(request);
      const result = await refundPayment(
        refundMembership(request),
        context.user.id,
        request.params.id,
        parseIdempotencyKey(request.headers["idempotency-key"]),
        parseRefundBody(request.body),
        request.ip,
      );
      return reply.code(201).send({ data: result });
    }),
  );

  app.get<{ Params: BookingParams }>(
    "/admin/bookings/:id/invoices",
    { preHandler: authenticateAdmin },
    async (request, reply) => handleAdminRoute(reply, async () => {
      if (!uuidPattern.test(request.params.id)) throw new AdminApiError(400, "INVALID_BOOKING_ID", "L'identifiant de réservation est invalide.");
      const membership = paymentMembership(request);
      return { data: await listBookingInvoices(membership.propertyId, request.params.id) };
    }),
  );

  app.get<{ Params: InvoiceParams }>(
    "/admin/invoices/:id/pdf",
    { preHandler: authenticateAdmin },
    async (request, reply) => handleAdminRoute(reply, async () => {
      if (!uuidPattern.test(request.params.id)) throw new AdminApiError(400, "INVALID_INVOICE_ID", "L'identifiant du document est invalide.");
      const membership = paymentMembership(request);
      const invoice = await getInvoiceForProperty(membership.propertyId, request.params.id);
      if (!invoice) throw new AdminApiError(404, "INVOICE_NOT_FOUND", "Document introuvable.");
      const pdf = await renderInvoicePdf(invoice);
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${invoice.number}.pdf"`)
        .header("content-length", pdf.length)
        .send(pdf);
    }),
  );

  app.get<{ Querystring: RoomListQuery }>(
    "/admin/rooms",
    { preHandler: authenticateAdmin },
    async (request, reply) =>
      handleAdminRoute(reply, async () => ({
        data: await listAdminRooms(resolveMembership(request), parseRoomQuery(request.query)),
      })),
  );

  app.get(
    "/admin/room-types",
    { preHandler: authenticateAdmin },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        const membership = requireRoomManagementPermission(resolveMembership(request));
        return { data: await listAdminRoomTypes(membership.propertyId) };
      }),
  );

  app.post(
    "/admin/media/room-type-cover",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
    },
    async (request, reply) => handleAdminRoute(reply, async () => {
      const membership = requireRoomManagementPermission(resolveMembership(request));
      const part = await request.file({ limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 0 } });
      if (!part) throw new AdminApiError(400, "IMAGE_REQUIRED", "Choisissez une image à téléverser.");
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw new AdminApiError(400, "INVALID_IMAGE_SIZE", "L'image doit peser au maximum 5 Mo.");
      }
      if (part.file.truncated) throw new AdminApiError(400, "INVALID_IMAGE_SIZE", "L'image doit peser au maximum 5 Mo.");
      const result = await storeRoomTypeCover(membership.propertyId, buffer, part.mimetype);
      return reply.code(201).send({ data: result });
    }),
  );

  app.post<{ Body: unknown }>(
    "/admin/room-types",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        const roomType = await createAdminRoomType(
          membership,
          context.user.id,
          parseAdminRoomTypeCreateBody(request.body),
          request.ip,
        );
        return reply.code(201).send({ data: roomType });
      }),
  );

  app.patch<{ Params: RoomTypeParams; Body: unknown }>(
    "/admin/room-types/:id",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 40, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_ROOM_TYPE_ID", "L’identifiant du type de chambre est invalide.");
        }
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        return {
          data: await updateAdminRoomType(
            membership,
            context.user.id,
            request.params.id,
            parseAdminRoomTypeUpdateBody(request.body),
            request.ip,
          ),
        };
      }),
  );

  app.delete<{ Params: RoomTypeParams; Body: unknown }>(
    "/admin/room-types/:id",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 15, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_ROOM_TYPE_ID", "L’identifiant du type de chambre est invalide.");
        }
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        return {
          data: await deleteAdminRoomType(
            membership,
            context.user.id,
            request.params.id,
            parseAdminRoomTypeDeleteBody(request.body),
            request.ip,
          ),
        };
      }),
  );

  app.post<{ Body: unknown }>(
    "/admin/rooms",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        const room = await createAdminRoom(
          membership,
          context.user.id,
          parseAdminRoomCreateBody(request.body),
          request.ip,
        );
        return reply.code(201).send({ data: room });
      }),
  );

  app.patch<{ Params: RoomParams; Body: unknown }>(
    "/admin/rooms/:id",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 60, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_ROOM_ID", "L'identifiant de chambre est invalide.");
        }
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        const room = await updateAdminRoom(
          membership,
          context.user.id,
          request.params.id,
          parseAdminRoomUpdateBody(request.body),
          request.ip,
        );
        return { data: room };
      }),
  );

  app.post<{ Params: RoomParams; Body: unknown }>(
    "/admin/rooms/:id/blocks",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 40, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_ROOM_ID", "L'identifiant de chambre est invalide.");
        }
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        return {
          data: await createAdminAvailabilityBlock(
            membership,
            context.user.id,
            request.params.id,
            parseAdminAvailabilityBlockBody(request.body),
            request.ip,
          ),
        };
      }),
  );

  app.post<{ Params: BlockParams }>(
    "/admin/room-blocks/:id/release",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 40, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_ROOM_BLOCK_ID", "L'identifiant du blocage est invalide.");
        }
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        return {
          data: await releaseAdminAvailabilityBlock(membership, context.user.id, request.params.id, request.ip),
        };
      }),
  );

  app.delete<{ Params: RoomParams; Body: unknown }>(
    "/admin/rooms/:id",
    {
      preHandler: authenticateAdmin,
      config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
    },
    async (request, reply) =>
      handleAdminRoute(reply, async () => {
        if (!uuidPattern.test(request.params.id)) {
          throw new AdminApiError(400, "INVALID_ROOM_ID", "L'identifiant de chambre est invalide.");
        }
        const membership = requireRoomManagementPermission(resolveMembership(request));
        const context = requireAdminContext(request);
        const result = await deleteAdminRoom(
          membership,
          context.user.id,
          request.params.id,
          parseAdminRoomDeleteBody(request.body),
          request.ip,
        );
        return { data: result };
      }),
  );
}
