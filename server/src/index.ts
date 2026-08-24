import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const app = await buildApp();
const statePath = process.env.HOTEL_DEV_STATE_PATH || resolve(process.cwd(), ".api-dev-state.json");
const stackPid = Number(process.env.HOTEL_DEV_STACK_PID);
let shuttingDown = false;

function removeOwnedState() {
  if (!existsSync(statePath)) return;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { pid?: unknown };
    if (state.pid === process.pid) unlinkSync(statePath);
  } catch {
    // A future launch will safely discard a stale or unreadable state file.
  }
}

try {
  await app.listen({ host: env.host, port: env.port });
  writeFileSync(statePath, JSON.stringify({
    service: "hotel-rivage-api",
    pid: process.pid,
    parentPid: process.ppid,
    ...(Number.isInteger(stackPid) && stackPid > 0 ? { stackPid } : {}),
    port: env.port,
  }));
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
  } finally {
    removeOwnedState();
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
