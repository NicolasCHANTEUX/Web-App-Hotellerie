import type { FastifyInstance } from "fastify";
import { ContactApiError } from "./contact.errors.js";
import { createContactRequest } from "./contact.service.js";
import { parseContactIdempotencyKey, parseContactRequestBody } from "./contact.validation.js";

export async function contactRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/contact-requests", {
    config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    try {
      const input = parseContactRequestBody(request.body);
      const idempotencyKey = parseContactIdempotencyKey(request.headers["idempotency-key"]);
      const contact = await createContactRequest(input, idempotencyKey);
      return reply.code(201).send({ data: contact });
    } catch (error) {
      if (error instanceof ContactApiError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}
