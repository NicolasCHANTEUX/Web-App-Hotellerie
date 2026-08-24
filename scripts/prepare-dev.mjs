import { readFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const statePath = resolve("server", ".api-dev-state.json");

async function readHealth() {
  for (const endpoint of ["health/live", "health"]) {
    try {
      const response = await fetch(`http://127.0.0.1:3001/${endpoint}`, {
        signal: AbortSignal.timeout(1_500),
      });
      const body = await response.json().catch(() => null);
      if (body?.service) return body;
    } catch {
      // Try the legacy endpoint before deciding that no API is running.
    }
  }
  return null;
}

const health = await readHealth();
if (!health) {
  await unlink(statePath).catch(() => undefined);
  process.exit(0);
}

if (health.service !== "hotel-rivage-api") {
  console.error("Le port 3001 est occupé par un autre programme. Aucun processus n'a été arrêté.");
  process.exit(1);
}

let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch {
  console.error("Une API Hôtel Rivage existe déjà, mais son fichier d'état est absent. Arrêtez-la avant de relancer.");
  process.exit(1);
}

if (state.service !== health.service || state.pid !== health.pid) {
  console.error("L'ancienne API n'a pas pu être identifiée avec certitude. Aucun processus n'a été arrêté.");
  process.exit(1);
}

const targetPid = Number(state.stackPid || state.parentPid || state.pid);
if (!Number.isInteger(targetPid) || targetPid <= 0) {
  console.error("Le fichier d'état de l'API contient un identifiant de processus invalide. Aucun processus n'a été arrêté.");
  process.exit(1);
}
if (process.platform === "win32") {
  spawnSync("taskkill", ["/PID", String(targetPid), "/T", "/F"], { stdio: "ignore" });
} else {
  try {
    process.kill(targetPid, "SIGTERM");
  } catch {
    // The process may already have stopped between the health check and here.
  }
}

for (let attempt = 0; attempt < 20; attempt += 1) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  if (!await readHealth()) {
    await unlink(statePath).catch(() => undefined);
    console.log("Ancienne instance API arrêtée proprement.");
    process.exit(0);
  }
}

console.error("L'ancienne API utilise encore le port 3001.");
process.exit(1);
