import type { FastifyInstance } from "fastify";
import { BookingError } from "./booking.errors.js";
import { createBooking } from "./booking.service.js";
import { parseCreateBookingBody } from "./booking.validation.js";
import { parseIdempotencyKey } from "./booking.idempotency.js";

export async function bookingRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/bookings", {
    config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    try {
      const input = parseCreateBookingBody(request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      const booking = await createBooking(input, idempotencyKey);
      return reply.code(201).send({ data: booking });
    } catch (error) {
      if (error instanceof BookingError) {
        if (error.statusCode === 429) reply.header("retry-after", "3600");
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  });
}
