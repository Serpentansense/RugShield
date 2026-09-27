import { describe, expect, it } from 'vitest';
import { checkSellability } from './sellability';
import {
  notApplicable,
  notTradable,
  noRoute,
  quote,
  roundTrip,
  upstreamError,
} from '../__fixtures__';

const PROBE = 100_000_000;

function codes(out: ReturnType<typeof checkSellability>) {
  return out.reasons.map((r) => r.code);
}

describe('checkSellability', () => {
  it('reports unavailable, not pass, when the routing provider fails', () => {
    const out = checkSellability(roundTrip({ buy: upstreamError }));
    expect(out.check.status).toBe('unavailable');
    expect(out.reasons).toEqual([]);
    expect(out.check.scored).toBe(true);
  });

  it('reports unavailable for wrapped SOL, which cannot be probed against itself', () => {
    const out = checkSellability(roundTrip({ buy: notApplicable }));
    expect(out.check.status).toBe('unavailable');
    expect(out.check.result).toMatch(/wrapped SOL/i);
    expect(out.reasons).toEqual([]);
  });

  it('fails with NOT_TRADABLE when no route exists in either direction', () => {
    const out = checkSellability(roundTrip({ buy: notTradable }));
    expect(out.check.status).toBe('fail');
    expect(codes(out)).toEqual(['NOT_TRADABLE']);
    expect(out.reasons[0].points).toBe(40);
    expect(out.reasons[0].severity).toBe('high');
  });

  it('fails with SELL_ROUTE_MISSING when buys route but sells do not', () => {
    // The honeypot pattern, and the heaviest single signal in the engine.
    const out = checkSellability(roundTrip({ sell: noRoute }));
    expect(out.check.status).toBe('fail');
    expect(codes(out)).toEqual(['SELL_ROUTE_MISSING']);
    expect(out.reasons[0].points).toBe(55);
    expect(out.check.value).toMatchObject({ buyRoute: true, sellRoute: false });
  });

  it('does not claim a honeypot when only the sell quote request failed', () => {
    const out = checkSellability(roundTrip({ sell: upstreamError }));
    expect(out.check.status).toBe('unavailable');
    expect(out.reasons).toEqual([]);
    expect(out.check.value).toMatchObject({ sellRoute: null });
  });

  it('passes a healthy round trip with no deductions', () => {
    const out = checkSellability(roundTrip({ returnedLamports: PROBE * 0.99 }));
    expect(out.check.status).toBe('pass');
    expect(out.reasons).toEqual([]);
  });

  describe('round-trip retention bands', () => {
    it('flags a moderate loss below 95%', () => {
      const out = checkSellability(roundTrip({ returnedLamports: PROBE * 0.9 }));
      expect(codes(out)).toEqual(['ROUND_TRIP_LOSS_MODERATE']);
      expect(out.reasons[0].points).toBe(5);
      expect(out.check.status).toBe('warn');
    });

    it('flags a high loss below 80%', () => {
      const out = checkSellability(roundTrip({ returnedLamports: PROBE * 0.7 }));
      expect(codes(out)).toEqual(['ROUND_TRIP_LOSS_HIGH']);
      expect(out.reasons[0].points).toBe(15);
      expect(out.check.status).toBe('warn');
    });

    it('fails on an extreme loss below 50%', () => {
      const out = checkSellability(roundTrip({ returnedLamports: PROBE * 0.3 }));
      expect(codes(out)).toEqual(['ROUND_TRIP_LOSS_EXTREME']);
      expect(out.reasons[0].points).toBe(30);
      expect(out.check.status).toBe('fail');
    });

    it('treats the band edges as inclusive upper bounds', () => {
      expect(codes(checkSellability(roundTrip({ returnedLamports: PROBE * 0.95 })))).toEqual(
        [],
      );
      expect(codes(checkSellability(roundTrip({ returnedLamports: PROBE * 0.8 })))).toEqual([
        'ROUND_TRIP_LOSS_MODERATE',
      ]);
      expect(codes(checkSellability(roundTrip({ returnedLamports: PROBE * 0.5 })))).toEqual([
        'ROUND_TRIP_LOSS_HIGH',
      ]);
    });
  });

  it('states in evidence that no swap was executed', () => {
    const out = checkSellability(roundTrip({ returnedLamports: PROBE }));
    expect(out.check.evidence.data).toMatchObject({ executed: false });
    expect(out.check.explanation).toMatch(/quotes, not executed swaps/i);
  });

  it('keeps both legs in evidence so the number can be audited', () => {
    const out = checkSellability(
      roundTrip({
        buy: { ok: true, quote: quote({ outAmount: '5000000000' }) },
        returnedLamports: 98_000_000,
      }),
    );
    const data = out.check.evidence.data as Record<string, unknown>;
    expect(data.buy).toMatchObject({ outTokensRaw: '5000000000' });
    expect(data.sell).toMatchObject({ outLamports: '98000000' });
    expect(data.retainedPct).toBe(98);
  });
});
