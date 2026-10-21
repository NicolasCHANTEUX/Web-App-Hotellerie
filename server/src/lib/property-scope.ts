import { env } from "../config/env.js";

/**
 * The property a query may reach: the staff member's own, or, for visitors,
 * the property presented by the public site. Never the whole database.
 */
export function propertyScope(propertyId?: string) {
  return propertyId ? { propertyId } : { property: { slug: env.publicPropertySlug } };
}
