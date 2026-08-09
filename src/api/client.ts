const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

type ApiEnvelope<T> = { data: T };

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | { error?: { message?: string } } | null;

  if (!response.ok) {
    const message = body && "error" in body ? body.error?.message : undefined;
    throw new ApiError(message ?? "Le service est momentanément indisponible.", response.status);
  }

  return (body as ApiEnvelope<T>).data;
}
