/**
 * API-layer configuration (caching and rate limiting).
 *
 * Kept separate from the risk engine config: these are serving concerns, not
 * analysis concerns.
 */

import { TtlCache } from './cache';
import { FixedWindowRateLimiter } from './rate-limit';
import type { RugShieldReport } from '../rugshield';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const API_CONFIG = {
  /** Short on purpose: liquidity and routing move fast. */
  cacheTtlMs: num('RUGSHIELD_CACHE_TTL_MS', 30_000),
  cacheMaxEntries: num('RUGSHIELD_CACHE_MAX_ENTRIES', 500),
  rateLimitEnabled: process.env.RUGSHIELD_RATE_LIMIT_ENABLED !== 'false',
  rateLimit: num('RUGSHIELD_RATE_LIMIT', 30),
  rateWindowMs: num('RUGSHIELD_RATE_WINDOW_MS', 60_000),
} as const;

/**
 * Module-level singletons so state survives between requests within one
 * instance. Next.js may re-evaluate modules on hot reload in development, in
 * which case these reset — acceptable, since both are best-effort.
 */
export const scanCache = new TtlCache<RugShieldReport>(
  API_CONFIG.cacheTtlMs,
  API_CONFIG.cacheMaxEntries,
);

export const scanRateLimiter = new FixedWindowRateLimiter(
  API_CONFIG.rateLimit,
  API_CONFIG.rateWindowMs,
);
