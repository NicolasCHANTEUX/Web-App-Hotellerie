import assert from "node:assert/strict";
import test from "node:test";
import { ExpiringTokenCache } from "./admin.auth-cache.js";

test("conserve une validation pendant une courte duree", () => {
  const cache = new ExpiringTokenCache<{ id: string }>(1_000, 10);
  cache.set("secret-token", { id: "user-1" }, 5_000);

  assert.deepEqual(cache.get("secret-token", 5_999), { id: "user-1" });
  assert.equal(cache.get("secret-token", 6_000), null);
});

test("ne confond pas deux jetons et borne le nombre d'entrees", () => {
  const cache = new ExpiringTokenCache<string>(10_000, 2);
  cache.set("token-a", "a", 1_000);
  cache.set("token-b", "b", 1_001);
  cache.set("token-c", "c", 1_002);

  assert.equal(cache.get("token-a", 1_003), null);
  assert.equal(cache.get("token-b", 1_003), "b");
  assert.equal(cache.get("token-c", 1_003), "c");
});
