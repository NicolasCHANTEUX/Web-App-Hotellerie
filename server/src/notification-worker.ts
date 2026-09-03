import type { FastifyBaseLogger } from "fastify";
import { startBackgroundWorker } from "./background-worker.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

if (env.backgroundWorkerMode !== "standalone") {
  throw new Error("Set BACKGROUND_WORKER_MODE=standalone before starting the standalone worker.");
}

const logger = {
  info(details: unknown, message: string) { console.info(message, details); },
  warn(details: unknown, message: string) { console.warn(message, details); },
  error(details: unknown, message: string) { console.error(message, details); },
} as FastifyBaseLogger;

const worker = startBackgroundWorker(logger, false);
console.info("Notification background worker started.");

async function shutdown() {
  worker.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
