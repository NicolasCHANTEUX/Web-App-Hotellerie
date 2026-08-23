import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { adminRoutes } from "./modules/admin/index.js";
import { availabilityRoutes } from "./modules/availability/availability.routes.js";
import { bookingRoutes } from "./modules/booking/booking.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: env.trustProxy });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed"), false);
    },
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      error: {
        code: "RATE_LIMITED",
        message: "Trop de tentatives. Réessayez dans quelques instants.",
      },
    }),
  });

  app.get("/", async (_request, reply) => reply.redirect(env.frontendUrl));

  app.get("/health", async () => {
    await prisma.property.count();
    return { service: "hotel-rivage-api", status: "ok", database: "connected", pid: process.pid };
  });

  await app.register(catalogRoutes);
  await app.register(availabilityRoutes);
  await app.register(bookingRoutes);
  await app.register(adminRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 429
    ) {
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Trop de tentatives. Réessayez dans quelques instants.",
        },
      });
    }
    app.log.error(error);
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Le service est momentanément indisponible." },
    });
  });

  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}
