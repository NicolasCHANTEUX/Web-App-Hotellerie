import { spawn, spawnSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const statePath = resolve(projectRoot, "server", ".api-dev-state.json");
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  console.error("Le chemin de npm est introuvable. Lancez ce script avec « npm run dev:full ».");
  process.exit(1);
}

const colors = {
  API: "\u001b[33m",
  WEB: "\u001b[36m",
};
const reset = "\u001b[0m";
const children = new Set();
let stopping = false;

function prefixOutput(stream, name) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    process.stdout.write(`${colors[name]}[${name}]${reset} ${line}\n`);
  });
}

function start(name, args) {
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOTEL_DEV_STACK_PID: String(process.pid),
      HOTEL_DEV_STATE_PATH: statePath,
    },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });

  children.add(child);
  prefixOutput(child.stdout, name);
  prefixOutput(child.stderr, name);

  child.once("error", (error) => {
    if (!stopping) void stop(1, `${name} n'a pas pu démarrer : ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      void stop(code ?? 1, `${name} s'est arrêté (${reason}).`);
    }
  });
  return child;
}

function terminate(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function removeOwnedState() {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.stackPid === process.pid) await unlink(statePath);
  } catch {
    // The API normally removes the file during its own graceful shutdown.
  }
}

async function stop(code, message) {
  if (stopping) return;
  stopping = true;
  if (message) console.error(message);
  for (const child of children) terminate(child);
  await removeOwnedState();
  process.exit(code);
}

async function waitForApi(apiProcess) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (apiProcess.exitCode !== null) throw new Error("L'API s'est arrêtée pendant son démarrage.");
    try {
      const response = await fetch("http://127.0.0.1:3001/health/live", {
        signal: AbortSignal.timeout(700),
      });
      const health = await response.json();
      if (response.ok && health.service === "hotel-rivage-api") return;
    } catch {
      // The API is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("L'API n'est pas devenue disponible dans le délai prévu.");
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

const api = start("API", ["--prefix", "server", "run", "dev"]);
try {
  await waitForApi(api);
  process.stdout.write(`${colors.API}[API]${reset} API prête sur http://127.0.0.1:3001\n`);
  start("WEB", ["run", "dev"]);
} catch (error) {
  await stop(1, error instanceof Error ? error.message : "Le démarrage de l'API a échoué.");
}
