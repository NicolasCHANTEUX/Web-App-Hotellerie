import { getAdminAuthConfig } from "./admin.config.js";
import { AdminApiError } from "./admin.errors.js";
import { accountActivationUrl } from "./admin.supabase-admin.js";

const AUTH_TIMEOUT_MS = 8_000;
export const MIN_PASSWORD_LENGTH = 10;
// Supabase hashes passwords with bcrypt, which ignores what follows 72 bytes.
export const MAX_PASSWORD_BYTES = 72;

function unavailable(): never {
  throw new AdminApiError(503, "AUTH_UNAVAILABLE", "Le service d'authentification est momentanément indisponible.");
}

export function parseNewPassword(value: unknown) {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(value) > MAX_PASSWORD_BYTES) {
    throw new AdminApiError(400, "INVALID_PASSWORD", `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères et rester sous 72 octets.`);
  }
  if (value.trim() !== value) {
    throw new AdminApiError(400, "INVALID_PASSWORD", "Le mot de passe ne doit pas commencer ni finir par une espace.");
  }
  return value;
}

/**
 * Asks Supabase to e-mail a link to choose a new password. The answer is the
 * same whether the address is known or not, so that it reveals no account.
 */
export async function requestPasswordReset(email: string) {
  const { supabaseUrl, publishableKey } = getAdminAuthConfig();
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(accountActivationUrl())}`, {
      method: "POST",
      headers: { apikey: publishableKey, "content-type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return unavailable();
  }
  if (response.status === 429) {
    throw new AdminApiError(429, "AUTH_RATE_LIMITED", "Trop de demandes. Réessayez dans quelques minutes.");
  }
  if (!response.ok && response.status !== 400 && response.status !== 404 && response.status !== 422) unavailable();
}

/** Sets the password of the signed-in account, opened from an invitation or reset link. */
export async function updateOwnPassword(accessToken: string, password: string) {
  const { supabaseUrl, publishableKey } = getAdminAuthConfig();
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return unavailable();
  }
  if (response.status === 401 || response.status === 403) {
    throw new AdminApiError(401, "INVALID_TOKEN", "Ce lien a expiré. Demandez-en un nouveau depuis la page de connexion.");
  }
  if (response.status === 422) {
    const payload = await response.json().catch(() => null) as { error_code?: unknown; msg?: unknown } | null;
    throw new AdminApiError(400, "INVALID_PASSWORD", payload?.error_code === "same_password"
      ? "Choisissez un mot de passe différent de l'actuel."
      : "Ce mot de passe est refusé : choisissez-en un plus long ou moins courant.");
  }
  if (response.status === 429) {
    throw new AdminApiError(429, "AUTH_RATE_LIMITED", "Trop de tentatives. Réessayez dans quelques instants.");
  }
  if (!response.ok) unavailable();
}
