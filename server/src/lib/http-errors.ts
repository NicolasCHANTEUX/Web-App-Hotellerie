type ErrorPayload = {
  code: string;
  message: string;
};

/**
 * Application-level HTTP error whose code and message are written for clients
 * and returned as is.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const INTERNAL_ERROR: ErrorPayload = {
  code: "INTERNAL_ERROR",
  message: "Le service est momentanément indisponible.",
};

export const NOT_FOUND_ERROR: ErrorPayload = {
  code: "NOT_FOUND",
  message: "Ressource introuvable.",
};

// Fastify and its plugins describe client errors in technical English: only
// their status is kept, with a neutral French message.
const FRAMEWORK_CLIENT_ERRORS: Partial<Record<number, ErrorPayload>> = {
  400: { code: "INVALID_REQUEST", message: "La requête est invalide." },
  404: NOT_FOUND_ERROR,
  413: { code: "PAYLOAD_TOO_LARGE", message: "La requête est trop volumineuse." },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Le format de la requête n'est pas pris en charge." },
};

const DEFAULT_CLIENT_ERROR: ErrorPayload = {
  code: "INVALID_REQUEST",
  message: "La requête ne peut pas être traitée.",
};

function frameworkClientStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  if (typeof code !== "string" || !code.startsWith("FST_")) return null;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : null;
}

/**
 * Maps any error reaching the global handler to a client-safe response. Only
 * HttpError and Fastify client errors keep their status: anything else, such as
 * a database or provider failure, becomes a generic 500 so that internal details
 * never leave the server.
 */
export function errorResponse(error: unknown): { statusCode: number; payload: { error: ErrorPayload } } {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, payload: { error: { code: error.code, message: error.message } } };
  }
  const frameworkStatus = frameworkClientStatus(error);
  if (frameworkStatus !== null) {
    return {
      statusCode: frameworkStatus,
      payload: { error: FRAMEWORK_CLIENT_ERRORS[frameworkStatus] ?? DEFAULT_CLIENT_ERROR },
    };
  }
  return { statusCode: 500, payload: { error: INTERNAL_ERROR } };
}
