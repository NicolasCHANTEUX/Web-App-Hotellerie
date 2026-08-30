import { apiGet } from "./client";

const CATALOG_TTL_MS = 60_000;

type CacheEntry<T> = {
  data?: T;
  expiresAt: number;
  promise?: Promise<T>;
};

const catalogCache = new Map<string, CacheEntry<unknown>>();

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function cachedCatalogGet<T>(path: string, signal?: AbortSignal) {
  const current = catalogCache.get(path) as CacheEntry<T> | undefined;
  if (current?.data !== undefined && current.expiresAt > Date.now()) {
    return withAbort(Promise.resolve(current.data), signal);
  }
  if (current?.promise) return withAbort(current.promise, signal);

  const entry: CacheEntry<T> = { expiresAt: 0 };
  entry.promise = apiGet<T>(path)
    .then((data) => {
      entry.data = data;
      entry.expiresAt = Date.now() + CATALOG_TTL_MS;
      entry.promise = undefined;
      return data;
    })
    .catch((error) => {
      catalogCache.delete(path);
      throw error;
    });
  catalogCache.set(path, entry);
  return withAbort(entry.promise, signal);
}
