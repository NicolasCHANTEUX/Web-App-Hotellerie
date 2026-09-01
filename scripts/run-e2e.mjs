import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const previewProcess = spawn(process.execPath, [resolve(projectRoot, "scripts", "preview-e2e.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true,
});

function terminatePreview() {
  if (!previewProcess.pid || previewProcess.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(previewProcess.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    previewProcess.kill("SIGTERM");
  }
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (previewProcess.exitCode !== null) {
      throw new Error("Le serveur de previsualisation s'est arrete pendant son demarrage.");
    }
    try {
      const response = await fetch("http://127.0.0.1:4173", {
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Le serveur de previsualisation n'est pas devenu disponible.");
}

function runPlaywright() {
  return new Promise((resolveExit, rejectExit) => {
    const runner = spawn(
      process.execPath,
      [resolve(projectRoot, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)],
      {
        cwd: projectRoot,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    runner.once("error", rejectExit);
    runner.once("exit", (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
}

let exitCode = 1;
try {
  await waitForPreview();
  exitCode = await runPlaywright();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  terminatePreview();
}

process.exit(exitCode);
