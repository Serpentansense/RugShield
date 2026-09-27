/**
 * Small TTL cache for scan results.
 *
 * Why this exists: every scan costs one RPC read plus three upstream API calls.
 * Without a cache, a loop over the public endpoint burns the operator's RPC
 * quota and gets the deployment's IP rate limited by DexScreener and Jupiter,
 * which breaks the service for everyone.
 *
 * Scope limit: in-process only. Multiple instances keep separate caches, so a
 * horizontally scaled deployment should put a shared cache (Redis, KV) in
 * front instead. A short TTL keeps results honest — pool depth and routing can
 * change quickly, so this is measured in seconds, not minutes.
 */

export interface CacheHit<T> {
  hit: true;
  value: T;
  /** How long ago the entry was stored, in ms. */
  ageMs: number;
}

export interface CacheMiss {
  hit: false;
}

interface Entry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string, now = Date.now()): CacheHit<T> | CacheMiss {
    const entry = this.store.get(key);
    if (!entry) return { hit: false };

    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return { hit: false };
    }

    return { hit: true, value: entry.value, ageMs: now - entry.storedAt };
  }

  set(key: string, value: T, now = Date.now()): void {
    // Re-inserting moves the key to the end, which keeps Map iteration order
    // usable as an eviction order.
    this.store.delete(key);
    this.store.set(key, { value, storedAt: now, expiresAt: now + this.ttlMs });

    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
