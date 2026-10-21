import { createHash } from "node:crypto";
import { prisma } from "./prisma.js";

type Counter = { hits: bigint; ttl_ms: bigint };
type Increment = (key: string, windowMs: number, max: number, continueExceeding: boolean) => Promise<Counter>;
type StoreOptions = {
  continueExceeding?: boolean;
  routeInfo?: { method?: string | string[]; url?: string };
};

async function incrementCounter(key: string, windowMs: number, max: number, continueExceeding: boolean) {
  // The upsert locks one key and increments it atomically across API instances.
  const rows = await prisma.$queryRaw<Counter[]>`
    INSERT INTO "rate_limit_counters" ("key", "hits", "expires_at")
    VALUES (${key}, 1, clock_timestamp() + ${windowMs} * interval '1 millisecond')
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE
        WHEN "rate_limit_counters"."expires_at" <= clock_timestamp() THEN 1
        ELSE "rate_limit_counters"."hits" + 1
      END,
      "expires_at" = CASE
        WHEN "rate_limit_counters"."expires_at" <= clock_timestamp()
          OR (${continueExceeding} AND "rate_limit_counters"."hits" + 1 > ${max})
          THEN clock_timestamp() + ${windowMs} * interval '1 millisecond'
        ELSE "rate_limit_counters"."expires_at"
      END
    RETURNING "hits", GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("expires_at" - clock_timestamp())) * 1000))::bigint AS "ttl_ms"
  `;
  if (!rows[0]) throw new Error("Rate limit counter was not returned.");
  return rows[0];
}

let incrementsSinceCleanup = 0;
function scheduleCleanup() {
  incrementsSinceCleanup += 1;
  if (incrementsSinceCleanup < 1_000) return;
  incrementsSinceCleanup = 0;
  // Expired counters are harmless; cleanup is best effort and never changes a request's result.
  void prisma.$executeRaw`
    DELETE FROM "rate_limit_counters" WHERE "key" IN (
      SELECT "key" FROM "rate_limit_counters"
      WHERE "expires_at" < clock_timestamp() - interval '1 day'
      ORDER BY "expires_at" LIMIT 1_000
    )
  `.catch(() => undefined);
}

export class PostgresRateLimitStore {
  constructor(
    private readonly options: StoreOptions,
    private readonly increment: Increment = incrementCounter,
    private readonly namespace = "global",
  ) {}

  child(routeOptions: unknown) {
    // The plugin types describe Fastify route options, while its runtime passes
    // merged rate-limit options with routeInfo; accept both shapes.
    const options = routeOptions as StoreOptions;
    const method = Array.isArray(options.routeInfo?.method)
      ? options.routeInfo.method.join(",")
      : options.routeInfo?.method ?? "unknown";
    const route = `${method}:${options.routeInfo?.url ?? "unknown"}`;
    return new PostgresRateLimitStore(options, this.increment, `${this.namespace}:${route}`);
  }

  incr(
    clientKey: string,
    callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    windowMs = 60_000,
    max = 1_000,
  ) {
    // Do not keep client IP addresses in the database.
    const key = createHash("sha256").update(`${this.namespace}:${clientKey}`).digest("hex");
    this.increment(key, windowMs, max, this.options.continueExceeding === true)
      .then((counter) => {
        scheduleCleanup();
        callback(null, { current: Number(counter.hits), ttl: Number(counter.ttl_ms) });
      })
      .catch((error: unknown) => callback(error instanceof Error ? error : new Error("Rate limit store unavailable.")));
  }
}
