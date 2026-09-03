import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const npmCli = process.env.npm_execpath;
const nodeMajor = Number(process.versions.node.split(".")[0]);

if (!npmCli) {
  console.error("Le chemin de npm est introuvable. Lancez ce script avec « npm run dev ».");
  process.exit(1);
}

if (nodeMajor < 24) {
  const vite = spawn(process.execPath, [npmCli, "run", "dev:vite"], {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  vite.once("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
} else {
  console.log(`Node ${process.versions.node} détecté : démarrage du frontend en mode de compatibilité.`);
  const children = new Set();
  let stopping = false;

  function prefix(stream, label, onLine) {
    const lines = createInterface({ input: stream });
    lines.on("line", (line) => {
      process.stdout.write(`[${label}] ${line}\n`);
      onLine?.(line);
    });
  }

  function start(label, args, { onLine } = {}) {
    const child = spawn(process.execPath, [npmCli, ...args], {
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    children.add(child);
    prefix(child.stdout, label, onLine);
    prefix(child.stderr, label, onLine);
    child.once("error", (error) => stop(1, `${label} n'a pas pu démarrer : ${error.message}`));
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (!stopping) stop(code ?? 1, `${label} s'est arrêté (${signal ?? `code ${code ?? 1}`}).`);
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

  function stop(code, message) {
    if (stopping) return;
    stopping = true;
    if (message) console.error(message);
    for (const child of children) terminate(child);
    process.exit(code);
  }

  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));

  let previewStarted = false;
  const startPreviewAfterFirstBuild = (line) => {
    if (previewStarted || !/built in/i.test(line)) return;
    previewStarted = true;
    start("WEB", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  };

  start("BUILD", ["run", "build", "--", "--watch"], { onLine: startPreviewAfterFirstBuild });
}
