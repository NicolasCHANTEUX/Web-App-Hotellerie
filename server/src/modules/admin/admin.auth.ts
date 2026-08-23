import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getAdminAuthConfig } from "./admin.config.js";
import { AdminApiError, sendAdminError } from "./admin.errors.js";

const AUTH_TIMEOUT_MS = 8_000;

type SupabaseUser = {
  id: string;
  email?: string;
};

export type AdminMembershipContext = {
  propertyId: string;
  role: "ADMIN" | "RECEPTION" | "ACCOUNTING" | "HOUSEKEEPING";
  createdAt: Date;
  property: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
  };
};

export type AdminRequestContext = {
  user: {
    id: string;
    authSubject: string;
    email: string;
    displayName: string;
  };
  memberships: AdminMembershipContext[];
};

declare module "fastify" {
  interface FastifyRequest {
    adminContext: AdminRequestContext | null;
  }
}

function isSupabaseUser(value: unknown): value is SupabaseUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && candidate.id.length > 0;
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    throw new AdminApiError(401, "AUTH_REQUIRED", "Une connexion administrateur est requise.");
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) {
    throw new AdminApiError(401, "INVALID_TOKEN", "La session administrateur est invalide.");
  }
  return match[1];
}

async function fetchSupabaseUser(accessToken: string) {
  const { supabaseUrl, publishableKey } = getAdminAuthConfig();
  let response: Response;

  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    throw new AdminApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Le service d'authentification est momentanément indisponible.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AdminApiError(401, "INVALID_TOKEN", "La session administrateur a expiré ou est invalide.");
  }
  if (!response.ok) {
    throw new AdminApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Le service d'authentification est momentanément indisponible.",
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!isSupabaseUser(payload)) {
    throw new AdminApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Le service d'authentification a retourné une réponse invalide.",
    );
  }
  return payload;
}

async function findAdminContext(authUser: SupabaseUser): Promise<AdminRequestContext> {
  const adminUser = await prisma.adminUser.findUnique({
    where: { authSubject: authUser.id },
    include: {
      memberships: {
        orderBy: { createdAt: "asc" },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              slug: true,
              timezone: true,
              currency: true,
            },
          },
        },
      },
    },
  });

  if (!adminUser?.isActive || adminUser.memberships.length === 0) {
    throw new AdminApiError(403, "ADMIN_ACCESS_DENIED", "Ce compte n'a pas accès à l'administration.");
  }

  return {
    user: {
      id: adminUser.id,
      authSubject: adminUser.authSubject,
      email: adminUser.email,
      displayName: adminUser.displayName,
    },
    memberships: adminUser.memberships,
  };
}

export async function authenticateAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authUser = await fetchSupabaseUser(bearerToken(request));
    request.adminContext = await findAdminContext(authUser);
  } catch (error) {
    return sendAdminError(reply, error);
  }
}

export function requireAdminContext(request: FastifyRequest) {
  if (!request.adminContext) {
    throw new AdminApiError(401, "AUTH_REQUIRED", "Une connexion administrateur est requise.");
  }
  return request.adminContext;
}

const rolePriority: Record<AdminMembershipContext["role"], number> = {
  ADMIN: 0,
  RECEPTION: 1,
  ACCOUNTING: 2,
  HOUSEKEEPING: 3,
};

export function resolveMembership(request: FastifyRequest) {
  const context = requireAdminContext(request);
  const rawHeader = request.headers["x-property-id"];
  const requestedPropertyId = Array.isArray(rawHeader) ? rawHeader[0]?.trim() : rawHeader?.trim();
  const eligible = requestedPropertyId
    ? context.memberships.filter((membership) => membership.propertyId === requestedPropertyId)
    : context.memberships.filter(
        (membership) => membership.propertyId === context.memberships[0]?.propertyId,
      );

  if (eligible.length === 0) {
    throw new AdminApiError(403, "PROPERTY_ACCESS_DENIED", "Vous n'avez pas accès à cet établissement.");
  }

  return [...eligible].sort((left, right) => rolePriority[left.role] - rolePriority[right.role])[0]!;
}

type PasswordLoginPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

export async function loginWithPassword(email: string, password: string) {
  const { supabaseUrl, publishableKey } = getAdminAuthConfig();
  let response: Response;

  try {
    response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    throw new AdminApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Le service d'authentification est momentanément indisponible.",
    );
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new AdminApiError(401, "INVALID_CREDENTIALS", "Adresse e-mail ou mot de passe incorrect.");
  }
  if (response.status === 429) {
    throw new AdminApiError(429, "AUTH_RATE_LIMITED", "Trop de tentatives. Réessayez dans quelques instants.");
  }
  if (!response.ok) {
    throw new AdminApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Le service d'authentification est momentanément indisponible.",
    );
  }

  const payload = (await response.json().catch(() => null)) as PasswordLoginPayload | null;
  if (
    !payload ||
    typeof payload.access_token !== "string" ||
    typeof payload.expires_in !== "number"
  ) {
    throw new AdminApiError(
      503,
      "AUTH_UNAVAILABLE",
      "Le service d'authentification a retourné une réponse invalide.",
    );
  }

  const authUser = await fetchSupabaseUser(payload.access_token);
  const context = await findAdminContext(authUser);
  await prisma.adminUser.update({
    where: { id: context.user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
  };
}
