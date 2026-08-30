import { createHash } from "node:crypto";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export class ExpiringTokenCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs = 30_000,
    private readonly maxEntries = 500,
  ) {
    if (ttlMs <= 0 || maxEntries <= 0) {
      throw new Error("Token cache limits must be positive.");
    }
  }

  get(token: string, now = Date.now()) {
    const key = this.key(token);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(token: string, value: T, now = Date.now()) {
    this.prune(now);
    const key = this.key(token);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { expiresAt: now + this.ttlMs, value });
  }

  clear() {
    this.entries.clear();
  }

  private key(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
