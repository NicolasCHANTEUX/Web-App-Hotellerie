import { env } from "../../config/env.js";
import { AdminApiError } from "./admin.errors.js";

const AUTH_TIMEOUT_MS = 10_000;
const USERS_PER_PAGE = 1_000;

export type AuthAccount = { id: string; email: string; displayName: string | null };

/** Where the links of invitation and password reset e-mails lead. */
export function accountActivationUrl() {
  return `${env.frontendUrl.replace(/\/+$/, "")}/admin/activation`;
}

function unavailable(): never {
  throw new AdminApiError(503, "AUTH_UNAVAILABLE", "Le service d'authentification est momentanément indisponible.");
}

function secretHeaders() {
  const secretKey = env.supabaseSecretKey;
  if (!secretKey) {
    throw new AdminApiError(503, "TEAM_MANAGEMENT_UNAVAILABLE", "La gestion de l'équipe nécessite la clé secrète Supabase (SUPABASE_SECRET_KEY).");
  }
  // New secret keys go in `apikey` only; legacy service-role JWTs also as a bearer.
  return {
    apikey: secretKey,
    ...(secretKey.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${secretKey}` }),
  };
}

async function authFetch(path: string, init: RequestInit) {
  try {
    return await fetch(`${env.supabaseUrl}/auth/v1${path}`, { ...init, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
  } catch {
    return unavailable();
  }
}

function authAccount(value: unknown): AuthAccount | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.email !== "string") return null;
  const metadata = candidate.user_metadata && typeof candidate.user_metadata === "object"
    ? candidate.user_metadata as Record<string, unknown>
    : {};
  const name = [metadata.full_name, metadata.name].find((item): item is string => typeof item === "string" && item.trim() !== "");
  return { id: candidate.id, email: candidate.email.toLowerCase(), displayName: name?.trim() ?? null };
}

export async function findAuthAccountByEmail(email: string) {
  for (let page = 1; page <= 100; page += 1) {
    const response = await authFetch(`/admin/users?page=${page}&per_page=${USERS_PER_PAGE}`, { headers: secretHeaders() });
    if (!response.ok) unavailable();
    const payload = await response.json().catch(() => null) as { users?: unknown } | null;
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const match = users.map(authAccount).find((account) => account?.email === email);
    if (match) return match;
    if (users.length < USERS_PER_PAGE) return null;
  }
  return unavailable();
}

/** Creates the account and lets Supabase send the e-mail to choose a password. */
export async function inviteAuthAccount(email: string, displayName: string) {
  const response = await authFetch(`/invite?redirect_to=${encodeURIComponent(accountActivationUrl())}`, {
    method: "POST",
    headers: { ...secretHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ email, data: { full_name: displayName } }),
  });
  if (response.status === 429) {
    throw new AdminApiError(429, "INVITATION_RATE_LIMITED", "Trop d'e-mails envoyés pour le moment. Réessayez dans une heure, ou configurez un serveur d'envoi dans Supabase.");
  }
  if (response.status === 422) {
    throw new AdminApiError(409, "INVITATION_REFUSED", "Supabase refuse cette invitation : l'adresse est peut-être déjà utilisée par un autre compte.");
  }
  if (!response.ok) unavailable();
  return authAccount(await response.json().catch(() => null)) ?? unavailable();
}
