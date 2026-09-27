import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter, clientKey } from './rate-limit';
import { TtlCache } from './cache';

describe('FixedWindowRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    const verdicts = [1, 2, 3].map(() => limiter.check('ip', 1_000));
    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true]);
    expect(verdicts.map((v) => v.remaining)).toEqual([2, 1, 0]);
  });

  it('blocks past the limit and reports a retry delay', () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);
    limiter.check('ip', 1_000);
    limiter.check('ip', 1_000);
    const blocked = limiter.check('ip', 1_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBe(60);
  });

  it('counts each client separately', () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(false);
  });

  it('opens a fresh window after the old one expires', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);
    expect(limiter.check('ip', 0).allowed).toBe(true);
    expect(limiter.check('ip', 500).allowed).toBe(false);
    expect(limiter.check('ip', 1_001).allowed).toBe(true);
  });

  it('prunes expired windows so the map cannot grow without bound', () => {
    const limiter = new FixedWindowRateLimiter(5, 1_000);
    for (let i = 0; i < 50; i++) limiter.check(`ip-${i}`, 0);
    expect(limiter.size).toBe(50);
    limiter.check('fresh', 2_000);
    expect(limiter.size).toBe(1);
  });
});

describe('clientKey', () => {
  it('takes the first entry of x-forwarded-for', () => {
    const key = clientKey((n) =>
      n === 'x-forwarded-for' ? '203.0.113.7, 70.41.3.18, 150.172.238.178' : null,
    );
    expect(key).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientKey((n) => (n === 'x-real-ip' ? '198.51.100.4' : null))).toBe('198.51.100.4');
  });

  it('shares one bucket when no proxy header is present', () => {
    // Deliberately the safe direction: unknown clients share a limit rather
    // than each getting a fresh allowance.
    expect(clientKey(() => null)).toBe('unknown');
  });
});

describe('TtlCache', () => {
  it('misses on an unknown key', () => {
    const cache = new TtlCache<string>(1_000, 10);
    expect(cache.get('nope')).toEqual({ hit: false });
  });

  it('returns a stored value with its age', () => {
    const cache = new TtlCache<string>(1_000, 10);
    cache.set('k', 'v', 0);
    expect(cache.get('k', 400)).toEqual({ hit: true, value: 'v', ageMs: 400 });
  });

  it('expires entries once the ttl passes', () => {
    const cache = new TtlCache<string>(1_000, 10);
    cache.set('k', 'v', 0);
    expect(cache.get('k', 999).hit).toBe(true);
    expect(cache.get('k', 1_000).hit).toBe(false);
  });

  it('drops the expired entry rather than keeping it around', () => {
    const cache = new TtlCache<string>(1_000, 10);
    cache.set('k', 'v', 0);
    cache.get('k', 2_000);
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entry past the size cap', () => {
    const cache = new TtlCache<number>(10_000, 2);
    cache.set('a', 1, 0);
    cache.set('b', 2, 1);
    cache.set('c', 3, 2);
    expect(cache.size).toBe(2);
    expect(cache.get('a', 3).hit).toBe(false);
    expect(cache.get('b', 3).hit).toBe(true);
    expect(cache.get('c', 3).hit).toBe(true);
  });

  it('refreshes the ttl and the eviction position on overwrite', () => {
    const cache = new TtlCache<number>(1_000, 2);
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    cache.set('a', 9, 500);
    cache.set('c', 3, 600);
    expect(cache.get('b', 700).hit).toBe(false);
    expect(cache.get('a', 700)).toMatchObject({ hit: true, value: 9 });
  });
});
