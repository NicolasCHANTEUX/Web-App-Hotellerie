import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const current = process.env.DATABASE_URL;
if (!current) throw new Error("DATABASE_URL is required.");

const source = new URL(current);
const projectRef = source.hostname.match(/^db\.([a-z]+)\.supabase\.co$/)?.[1]
  ?? decodeURIComponent(source.username).split(".")[1];

if (!projectRef) throw new Error("Unable to determine the Supabase project reference.");

const hosts = [
  "aws-0-eu-north-1.pooler.supabase.com",
  "aws-1-eu-north-1.pooler.supabase.com",
];
const ca = readFileSync(resolve(process.cwd(), process.env.DATABASE_SSL_CA ?? "certs/prod-ca-2021.crt"), "utf8");

for (const host of hosts) {
  const candidate = new URL(current);
  candidate.hostname = host;
  candidate.port = "5432";
  candidate.username = `postgres.${projectRef}`;
  candidate.search = "";

  const client = new Client({
    connectionString: candidate.toString(),
    connectionTimeoutMillis: 7_000,
    ssl: { rejectUnauthorized: true, ca },
  });

  try {
    await client.connect();
    await client.query("select 1");
    console.log(JSON.stringify({ ok: true, host }));
    await client.end();
    process.exit(0);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown connection error";
    console.log(JSON.stringify({ ok: false, host, detail }));
    await client.end().catch(() => undefined);
  }
}

process.exit(1);
