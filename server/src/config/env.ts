import "dotenv/config";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const port = Number(process.env.PORT ?? 3001);
const trustProxy = process.env.TRUST_PROXY?.trim().toLowerCase() === "true";
const notificationDelivery = process.env.NOTIFICATION_DELIVERY?.trim().toLowerCase() || "disabled";
const backgroundWorkerMode = process.env.BACKGROUND_WORKER_MODE?.trim().toLowerCase() || "embedded";
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

if (!["embedded", "standalone", "disabled"].includes(backgroundWorkerMode)) {
  throw new Error("BACKGROUND_WORKER_MODE must be embedded, standalone or disabled.");
}

const bookingAccessTokenSecret = process.env.BOOKING_ACCESS_TOKEN_SECRET?.trim()
  || (nodeEnv === "production" ? required("BOOKING_ACCESS_TOKEN_SECRET") : "hotel-app-local-booking-token-secret-change-me");
const bookingReferencePrefix = process.env.BOOKING_REFERENCE_PREFIX?.trim().toUpperCase()
  || (nodeEnv === "production" ? required("BOOKING_REFERENCE_PREFIX").toUpperCase() : "BKG");

if (!/^[A-Z0-9]{2,8}$/.test(bookingReferencePrefix)) {
  throw new Error("BOOKING_REFERENCE_PREFIX must contain 2 to 8 uppercase letters or digits.");
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
  publicPropertySlug: process.env.PUBLIC_PROPERTY_SLUG?.trim() || "hotel-rivage",
  notificationDelivery: notificationDelivery as "disabled" | "log" | "resend",
  backgroundWorkerMode: backgroundWorkerMode as "embedded" | "standalone" | "disabled",
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  emailFrom: process.env.EMAIL_FROM?.trim() || null,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || null,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
  bookingAccessTokenSecret,
  bookingReferencePrefix,
};
