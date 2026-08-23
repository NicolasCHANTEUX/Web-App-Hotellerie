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
  confirmAdminBooking,
  createAdminRoom,
  deleteAdminRoom,
  getAdminBooking,
  listAdminBookings,
  listAdminRooms,
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

function bookingMembership(request: FastifyRequest) {
  const membership = resolveMembership(request);
  if (membership.role !== "ADMIN" && membership.role !== "RECEPTION") {
    throw new AdminApiError(
      403,
      "ROLE_ACCESS_DENIED",
      "Votre rôle ne permet pas de consulter les réservations.",
    );
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
        data: await listAdminBookings(bookingMembership(request), parseBookingQuery(request.query)),
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
        const booking = await getAdminBooking(bookingMembership(request).propertyId, request.params.id);
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
          bookingMembership(request),
          context.user.id,
          request.params.id,
          request.ip,
        );
        return { data: booking };
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
