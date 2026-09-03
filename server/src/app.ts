import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { startBackgroundWorker } from "./background-worker.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { adminRoutes } from "./modules/admin/index.js";
import { availabilityRoutes } from "./modules/availability/availability.routes.js";
import { bookingRoutes } from "./modules/booking/booking.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { contactRoutes } from "./modules/contact/contact.routes.js";
import { paymentRoutes, stripeWebhookRoutes } from "./modules/payments/payment.routes.js";

export const API_SERVICE_NAME = "hotel-app-api";

export async function buildApp() {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.x-booking-access-token",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "req.body.password",
          "req.body.accessToken",
          "req.body.refreshToken",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: env.trustProxy,
  });

  await app.register(helmet);

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

  await app.register(multipart, {
    limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 0 },
  });

  app.get("/", async (_request, reply) => reply.redirect(env.frontendUrl));

  app.get("/health/live", async () => ({
    service: API_SERVICE_NAME,
    status: "up",
    pid: process.pid,
  }));

  app.get("/health", async () => {
    await prisma.property.count();
    return { service: API_SERVICE_NAME, status: "ok", database: "connected", pid: process.pid };
  });

  await app.register(catalogRoutes);
  await app.register(contactRoutes);
  await app.register(availabilityRoutes);
  await app.register(bookingRoutes);
  await app.register(paymentRoutes);
  await app.register(stripeWebhookRoutes);
  await app.register(adminRoutes);

  const backgroundWorker = env.backgroundWorkerMode === "embedded"
    ? startBackgroundWorker(app.log)
    : null;

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

  app.addHook("onClose", async () => {
    backgroundWorker?.stop();
    await prisma.$disconnect();
  });
  return app;
}
