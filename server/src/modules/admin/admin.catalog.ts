import type { AdminMembershipContext } from "./admin.auth.js";
import { AdminApiError } from "./admin.errors.js";

export function requireCatalogPermission(membership: AdminMembershipContext) {
  if (membership.role !== "ADMIN") {
    throw new AdminApiError(403, "ROLE_ACCESS_DENIED", "Votre rôle ne permet pas de gérer le catalogue.");
  }
  return membership;
}

/**
 * Stable technical code derived from a first name. It never changes
 * afterwards, so that renaming an item keeps its history.
 */
export function catalogCodeFromName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** First free code among `base`, `base_2`, `base_3`… */
export function nextAvailableCode(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
