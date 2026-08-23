import type { FastifyReply } from "fastify";

export class AdminApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export function sendAdminError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdminApiError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message },
    });
  }

  throw error;
}
