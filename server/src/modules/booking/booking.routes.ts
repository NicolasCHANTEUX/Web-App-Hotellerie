import type { FastifyInstance } from "fastify";
import { BookingError } from "./booking.errors.js";
import { createBooking } from "./booking.service.js";
import { getBookingQuote } from "./booking.quote.service.js";
import { parseBookingQuoteBody, parseCreateBookingBody } from "./booking.validation.js";
import { parseIdempotencyKey } from "./booking.idempotency.js";

// Counts every attempt from one address, failed ones included, so it leaves
// room for corrections and for visitors sharing an address. Holding rooms is
// bounded separately by the active requests allowed per guest contact.
export const BOOKING_CREATION_RATE_LIMIT = { max: 10, timeWindow: "1 hour" };

export async function bookingRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/quotes", {
    config: { rateLimit: { max: 60, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    try {
      return { data: await getBookingQuote(parseBookingQuoteBody(request.body)) };
    } catch (error) {
      if (error instanceof BookingError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  });

  app.post<{ Body: unknown }>("/bookings", {
    config: { rateLimit: BOOKING_CREATION_RATE_LIMIT },
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
