import { FastifyInstance } from "fastify";
import { searchAvailability } from "./availability.service.js";

type AvailabilityQuery = {
  arrival?: string;
  departure?: string;
  adults?: string;
  children?: string;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | undefined) {
  if (!value || !isoDate.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export async function availabilityRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AvailabilityQuery }>("/availability", async (request, reply) => {
    const arrival = parseDate(request.query.arrival);
    const departure = parseDate(request.query.departure);
    const adults = Number(request.query.adults ?? 2);
    const children = Number(request.query.children ?? 0);

    if (!arrival || !departure || departure <= arrival) {
      return reply.code(400).send({ error: { code: "INVALID_DATES", message: "Les dates du séjour sont invalides." } });
    }
    if (!Number.isInteger(adults) || adults < 1 || adults > 10 || !Number.isInteger(children) || children < 0 || children > 10) {
      return reply.code(400).send({ error: { code: "INVALID_GUESTS", message: "Le nombre de voyageurs est invalide." } });
    }

    return { data: await searchAvailability({ arrival, departure, adults, children }) };
  });
}
