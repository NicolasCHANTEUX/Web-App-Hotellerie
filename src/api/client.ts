const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

type ApiEnvelope<T> = { data: T };

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  token?: string;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | { error?: { message?: string } } | null;

  if (!response.ok) {
    const message = body && "error" in body ? body.error?.message : undefined;
    throw new ApiError(message ?? "Le service est momentanément indisponible.", response.status);
  }

  return (body as ApiEnvelope<T>).data;
}

export function apiGet<T>(path: string, signal?: AbortSignal) {
  return apiRequest<T>(path, { signal });
}

export function apiPost<T>(path: string, body: unknown, signal?: AbortSignal, headers?: Record<string, string>) {
  return apiRequest<T>(path, { method: "POST", body, signal, headers });
}
