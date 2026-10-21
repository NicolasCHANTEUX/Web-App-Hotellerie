import "dotenv/config";
import { isIP } from "node:net";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const PROXY_ADDRESS_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

function isProxyAddress(value: string) {
  if (PROXY_ADDRESS_KEYWORDS.has(value)) return true;
  const [address, prefix, ...rest] = value.split("/");
  if (!address || rest.length > 0 || !isIP(address)) return false;
  if (prefix === undefined) return true;
  const maxPrefix = isIP(address) === 4 ? 32 : 128;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= maxPrefix;
}

/**
 * Client addresses drive the rate limits: behind a proxy they must be read from
 * X-Forwarded-For, otherwise every visitor shares the proxy address. A hop
 * count or the proxy addresses should be preferred over `true`, which trusts
 * any forwarded address and lets a direct caller choose its own.
 */
export function parseTrustProxy(value: string | undefined, production: boolean): boolean | number | string[] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    if (production) {
      throw new Error("TRUST_PROXY is required in production: false when clients reach the API directly, otherwise the number of proxies in front of it or their addresses.");
    }
    return false;
  }
  if (normalized === "false") return false;
  if (normalized === "true") {
    if (production) throw new Error("TRUST_PROXY=true is unsafe in production; configure the proxy hop count or trusted proxy addresses.");
    return true;
  }
  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    if (hops >= 1 && hops <= 10) return hops;
  } else {
    const addresses = normalized.split(",").map((item) => item.trim()).filter(Boolean);
    if (addresses.length > 0 && addresses.every(isProxyAddress)) return addresses;
  }
  throw new Error("TRUST_PROXY must be true, false, a number of proxies between 1 and 10, or a comma-separated list of proxy addresses.");
}

const port = Number(process.env.PORT ?? 3001);
const notificationDelivery = process.env.NOTIFICATION_DELIVERY?.trim().toLowerCase() || "disabled";
const backgroundWorkerMode = process.env.BACKGROUND_WORKER_MODE?.trim().toLowerCase() || "embedded";
const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase() || "development";

if (!["development", "test", "production"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test or production.");
}

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY, nodeEnv === "production");

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
