import { resolve } from "node:path";
import { preview } from "vite";

const server = await preview({
  configFile: resolve(process.cwd(), "vite.config.mjs"),
  configLoader: "native",
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});

let closing = false;

async function closeServer(exitCode = 0) {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(exitCode);
}

process.once("SIGINT", () => void closeServer());
process.once("SIGTERM", () => void closeServer());
process.once("uncaughtException", (error) => {
  console.error(error);
  void closeServer(1);
});
process.once("unhandledRejection", (error) => {
  console.error(error);
  void closeServer(1);
});
