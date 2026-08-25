import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const port = Number(process.env.PORT ?? 3001);
const trustProxy = process.env.TRUST_PROXY?.trim().toLowerCase() === "true";
const notificationDelivery = process.env.NOTIFICATION_DELIVERY?.trim().toLowerCase() || "disabled";
const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase() || "development";

if (!["development", "test", "production"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test or production.");
}

if (!["disabled", "log", "resend"].includes(notificationDelivery)) {
  throw new Error("NOTIFICATION_DELIVERY must be disabled, log or resend.");
}

if (notificationDelivery === "resend" && (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_FROM?.trim())) {
  throw new Error("RESEND_API_KEY and EMAIL_FROM are required when NOTIFICATION_DELIVERY=resend.");
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

export const env = {
  nodeEnv: nodeEnv as "development" | "test" | "production",
  databaseUrl: required("DATABASE_URL"),
  databaseSslCa: process.env.DATABASE_SSL_CA?.trim() || "certs/prod-ca-2021.crt",
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
  supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY?.trim() || null,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "hotel-public",
  trustProxy,
  port,
  host: process.env.HOST?.trim() || "127.0.0.1",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL?.trim() || "http://127.0.0.1:5173",
  notificationDelivery: notificationDelivery as "disabled" | "log" | "resend",
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  emailFrom: process.env.EMAIL_FROM?.trim() || null,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || null,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
};
