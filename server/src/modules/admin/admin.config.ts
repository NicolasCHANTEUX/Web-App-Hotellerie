import { AdminApiError } from "./admin.errors.js";

function required(name: "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AdminApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "L'authentification administrateur n'est pas configurée.",
    );
  }
  return value;
}

export function getAdminAuthConfig() {
  return {
    supabaseUrl: required("SUPABASE_URL").replace(/\/+$/, ""),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
  };
}
