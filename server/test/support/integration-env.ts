// Loaded before every integration test file, ahead of the application
// configuration: the tests write to a real PostgreSQL database, which must be
// a disposable one given explicitly.
import { config } from "dotenv";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required: integration tests write to this database, which must be a disposable one with migrations applied.");
}

const fileEnv: Record<string, string> = {};
config({ processEnv: fileEnv, quiet: true });
if (fileEnv.DATABASE_URL?.trim() === testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must not be the application database configured in .env.");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.NOTIFICATION_DELIVERY = "disabled";
process.env.BACKGROUND_WORKER_MODE = "disabled";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ||= "sb_publishable_integration";
