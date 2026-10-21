import assert from "node:assert/strict";
import test from "node:test";
import { PostgresRateLimitStore } from "./postgres-rate-limit-store.js";

test("partage les compteurs entre instances et les sépare par route sans conserver les IP", async () => {
  const counts = new Map<string, number>();
  const increment = async (key: string) => {
    assert.match(key, /^[a-f0-9]{64}$/);
    const hits = (counts.get(key) ?? 0) + 1;
    counts.set(key, hits);
    return { hits: BigInt(hits), ttl_ms: 60_000n };
  };
  const first = new PostgresRateLimitStore({}, increment).child({ routeInfo: { method: "POST", url: "/bookings" } });
  const second = new PostgresRateLimitStore({}, increment).child({ routeInfo: { method: "POST", url: "/bookings" } });
  const contact = new PostgresRateLimitStore({}, increment).child({ routeInfo: { method: "POST", url: "/contact-requests" } });
  const hit = (store: PostgresRateLimitStore) => new Promise<{ current: number; ttl: number }>((resolve, reject) => {
    store.incr("203.0.113.10", (error, result) => error ? reject(error) : resolve(result!), 60_000, 2);
  });

  assert.deepEqual(await hit(first), { current: 1, ttl: 60_000 });
  assert.deepEqual(await hit(second), { current: 2, ttl: 60_000 });
  assert.deepEqual(await hit(contact), { current: 1, ttl: 60_000 });
  assert.equal(counts.size, 2);
});

test("échoue fermé si le stockage partagé est indisponible", async () => {
  const store = new PostgresRateLimitStore({}, async () => { throw new Error("database unavailable"); });
  await assert.rejects(
    new Promise((resolve, reject) => store.incr("203.0.113.10", (error, result) => error ? reject(error) : resolve(result))),
    /database unavailable/,
  );
});
