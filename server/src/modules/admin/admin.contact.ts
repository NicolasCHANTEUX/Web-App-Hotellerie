import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";

export const contactRequestFilters = ["OPEN", "HANDLED", "ALL"] as const;
export type AdminContactRequestFilter = (typeof contactRequestFilters)[number];

export type AdminContactRequestListInput = {
  page: number;
  pageSize: number;
  status: AdminContactRequestFilter;
  search?: string;
};

export type AdminContactRequestHandlingInput = { handled: boolean; updatedAt: Date };

const allowedHandlingFields = new Set(["handled", "updatedAt"]);

/** The front desk answers visitors' messages along with the administrators. */
export function requireContactRequestPermission(membership: AdminMembershipContext) {
  if (membership.role !== "ADMIN" && membership.role !== "RECEPTION") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de consulter les demandes de contact.");
  }
  return membership;
}

/** Requests still to answer unless another filter is asked for. */
export function parseAdminContactRequestFilter(value: string | undefined): AdminContactRequestFilter {
  if (value === undefined || value === "") return "OPEN";
  if ((contactRequestFilters as readonly string[]).includes(value)) return value as AdminContactRequestFilter;
  throw new AdminApiError(400, "INVALID_QUERY", "Le filtre des demandes est invalide.");
}

export function parseAdminContactRequestHandlingBody(body: unknown): AdminContactRequestHandlingInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AdminApiError(400, "INVALID_CONTACT_REQUEST", "La mise à jour de la demande est invalide.");
  }
  const candidate = body as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowedHandlingFields.has(field));
  if (unexpected) throw new AdminApiError(400, "INVALID_CONTACT_REQUEST", `Le champ ${unexpected} n'est pas autorisé.`);
  if (typeof candidate.handled !== "boolean") {
    throw new AdminApiError(400, "INVALID_CONTACT_REQUEST", "Indiquez si la demande est traitée.");
  }
  const updatedAt = typeof candidate.updatedAt === "string" ? new Date(candidate.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== candidate.updatedAt) {
    throw new AdminApiError(400, "INVALID_CONTACT_REQUEST", "La version de la demande est invalide.");
  }
  return { handled: candidate.handled, updatedAt };
}
