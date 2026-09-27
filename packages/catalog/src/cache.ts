export type Ttl<T> = number | ((value: T) => number);

export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  /**
   * Returns the cached value, or runs `loader` once even for concurrent callers.
   * Rejections are not cached. Never cache `undefined`; use `null` for "known missing".
   */
  getOrSet<T>(key: string, ttl: Ttl<T>, loader: () => Promise<T>): Promise<T>;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export function createMemoryCache({
  maxEntries = 1000,
  now = Date.now,
}: MemoryCacheOptions = {}): Cache {
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();

  function get<T>(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    // Re-insert so Map order tracks recency (first key = least recently used).
    entries.delete(key);
    entries.set(key, entry);
    return entry.value as T;
  }

  function set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttlMs });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function getOrSet<T>(key: string, ttl: Ttl<T>, loader: () => Promise<T>): Promise<T> {
    const cached = get<T>(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        set(key, value, typeof ttl === 'function' ? ttl(value) : ttl);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return { get, set, getOrSet };
}
