/**
 * Fixed-window rate limiter.
 *
 * `/api/check` is public and unauthenticated, and each call fans out to four
 * upstream services. Without a limit, one client can exhaust the operator's
 * RPC quota and trip the shared IP rate limits at DexScreener and Jupiter.
 *
 * Two honest limitations:
 *
 * 1. In-process only. Each instance counts separately, so N instances allow
 *    N times the configured limit. A shared store is needed to enforce a real
 *    global limit.
 * 2. The client key comes from `x-forwarded-for`, which a client can forge
 *    unless the app sits behind a proxy that overwrites it. Treat this as
 *    protection against accidental hammering, not a determined attacker.
 */

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
  /** Seconds to wait, for the `Retry-After` header. Only set when blocked. */
  retryAfterSec: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitVerdict {
    this.prune(now);

    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }

    window.count += 1;
    const allowed = window.count <= this.limit;

    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - window.count),
      resetAt: window.resetAt,
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  /** Drops expired windows so the map cannot grow without bound. */
  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }

  clear(): void {
    this.windows.clear();
  }
}

/**
 * Best-effort client identity. Falls back to a shared bucket when no proxy
 * header is present, which is the safe direction: unknown clients share a
 * limit rather than each getting a fresh one.
 */
export function clientKey(getHeader: (name: string) => string | null): string {
  const forwarded = getHeader('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return getHeader('x-real-ip')?.trim() || 'unknown';
}
