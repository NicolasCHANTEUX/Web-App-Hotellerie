import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const app = await buildApp();
const statePath = resolve(process.cwd(), ".api-dev-state.json");

try {
  await app.listen({ host: env.host, port: env.port });
  writeFileSync(statePath, JSON.stringify({
    service: "hotel-rivage-api",
    pid: process.pid,
    parentPid: process.ppid,
    port: env.port,
  }));
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown() {
  await app.close();
  if (existsSync(statePath)) unlinkSync(statePath);
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
