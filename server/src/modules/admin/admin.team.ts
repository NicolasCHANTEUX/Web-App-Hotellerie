import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";

export const teamRoles = ["ADMIN", "RECEPTION", "ACCOUNTING", "HOUSEKEEPING"] as const;
export type TeamRole = (typeof teamRoles)[number];

export type AdminTeamInvitationInput = { email: string; displayName: string; role: TeamRole };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(message: string): never {
  throw new AdminApiError(400, "INVALID_TEAM_MEMBER", message);
}

function strictObject(value: unknown, allowed: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Les informations du membre sont invalides.");
  const candidate = value as Record<string, unknown>;
  const unexpected = Object.keys(candidate).find((field) => !allowed.has(field));
  if (unexpected) return invalid(`Le champ ${unexpected} n'est pas autorisé.`);
  return candidate;
}

function role(value: unknown): TeamRole {
  if (typeof value === "string" && (teamRoles as readonly string[]).includes(value)) return value as TeamRole;
  return invalid("Le rôle est invalide.");
}

/** Only administrators give or withdraw access to the administration. */
export function requireTeamPermission(membership: AdminMembershipContext) {
  if (membership.role !== "ADMIN") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de gérer l'équipe.");
  }
  return membership;
}

export function parseAdminTeamInvitationBody(body: unknown): AdminTeamInvitationInput {
  const candidate = strictObject(body, new Set(["email", "displayName", "role"]));
  const email = typeof candidate.email === "string" ? candidate.email.trim().toLowerCase() : "";
  if (!emailPattern.test(email) || email.length > 320) invalid("L'adresse e-mail est invalide.");
  const displayName = typeof candidate.displayName === "string" ? candidate.displayName.trim().replace(/\s+/g, " ") : "";
  if (displayName.length < 2 || displayName.length > 80) invalid("Le nom doit contenir entre 2 et 80 caractères.");
  return { email, displayName, role: role(candidate.role) };
}

export function parseAdminTeamRoleBody(body: unknown) {
  return { role: role(strictObject(body, new Set(["role"])).role) };
}
