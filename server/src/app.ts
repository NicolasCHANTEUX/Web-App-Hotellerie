import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { availabilityRoutes } from "./modules/availability/availability.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed"), false);
    },
  });

  app.get("/", async (_request, reply) => reply.redirect(env.frontendUrl));

  app.get("/health", async () => {
    await prisma.property.count();
    return { service: "hotel-rivage-api", status: "ok", database: "connected", pid: process.pid };
  });

  await app.register(catalogRoutes);
  await app.register(availabilityRoutes);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Le service est momentanément indisponible." },
    });
  });

  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}
