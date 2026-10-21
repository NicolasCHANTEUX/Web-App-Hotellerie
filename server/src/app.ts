import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { startBackgroundWorker } from "./background-worker.js";
import { env } from "./config/env.js";
import { errorResponse, HttpError, NOT_FOUND_ERROR } from "./lib/http-errors.js";
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
    // Vercel Services preserves the public /api prefix when routing to this service.
    // Keep the existing route declarations and local URLs unchanged.
    rewriteUrl: (request) => request.url?.replace(/^\/api(?=\/|\?|$)/, "") || "/",
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

  // Fastify binds the error handler to each route when the route is declared:
  // it must be set before any plugin or route registration.
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, payload } = errorResponse(error);
    if (statusCode >= 500) request.log.error({ err: error }, "Unhandled request error");
    else request.log.info({ err: error }, "Request rejected");
    return reply.code(statusCode).send(payload);
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: NOT_FOUND_ERROR }));

  if (env.trustProxy === false) {
    let proxyWarningLogged = false;
    app.addHook("onRequest", async (request) => {
      if (proxyWarningLogged || request.headers["x-forwarded-for"] === undefined) return;
      proxyWarningLogged = true;
      request.log.warn("X-Forwarded-For received while TRUST_PROXY=false: every client behind this proxy shares its address and rate limits.");
    });
  }

  await app.register(helmet);

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Cette origine n'est pas autorisée."), false);
    },
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => new HttpError(
      context.statusCode,
      "RATE_LIMITED",
      "Trop de tentatives. Réessayez dans quelques instants.",
    ),
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

  app.addHook("onClose", async () => {
    backgroundWorker?.stop();
    await prisma.$disconnect();
  });
  return app;
}
