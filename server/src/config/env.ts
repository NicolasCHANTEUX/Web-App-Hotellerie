import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  databaseSslCa: process.env.DATABASE_SSL_CA?.trim() || "certs/prod-ca-2021.crt",
  port,
  host: process.env.HOST?.trim() || "127.0.0.1",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL?.trim() || "http://127.0.0.1:5173",
};
