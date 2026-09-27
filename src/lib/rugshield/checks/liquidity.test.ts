import { describe, expect, it } from 'vitest';
import { LIQUIDITY_BANDS, checkLiquidity } from './liquidity';
import { market, marketFailed, pool } from '../__fixtures__';

function codes(out: ReturnType<typeof checkLiquidity>) {
  return out.reasons.map((r) => r.code);
}

function hoursAgo(hours: number) {
  return {
    createdAt: new Date(Date.now() - hours * 3_600_000).toISOString(),
    ageHours: hours,
  };
}

describe('checkLiquidity', () => {
  it('reports unavailable, not pass, when the provider fails', () => {
    const out = checkLiquidity(marketFailed());
    expect(out.check.status).toBe('unavailable');
    expect(out.reasons).toEqual([]);
    expect(out.check.explanation).toMatch(/not a pass/i);
  });

  it('fails when no pool exists', () => {
    const out = checkLiquidity(market({ pools: [], totalLiquidityUsd: null }));
    expect(out.check.status).toBe('fail');
    expect(codes(out)).toEqual(['NO_LIQUIDITY_POOL']);
    expect(out.reasons[0].points).toBe(30);
  });

  it('passes a deep, multi-pool, mature market with no deductions', () => {
    const out = checkLiquidity(
      market({
        pools: [
          pool({ liquidityUsd: 600_000, volume24hUsd: 200_000 }),
          pool({ liquidityUsd: 400_000, volume24hUsd: 150_000, dex: 'orca' }),
        ],
        marketCapUsd: 5_000_000,
      }),
    );
    expect(out.check.status).toBe('pass');
    expect(out.reasons).toEqual([]);
  });

  describe('depth bands', () => {
    it('flags critically low depth', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: 500, volume24hUsd: 100 })],
          marketCapUsd: 20_000,
        }),
      );
      expect(codes(out)).toContain('LIQUIDITY_CRITICALLY_LOW');
      expect(out.reasons.find((r) => r.code === 'LIQUIDITY_CRITICALLY_LOW')?.points).toBe(25);
      expect(out.check.status).toBe('fail');
    });

    it('flags low depth', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: 5_000, volume24hUsd: 1_000 })],
          marketCapUsd: 200_000,
        }),
      );
      expect(codes(out)).toContain('LIQUIDITY_LOW');
      expect(out.check.status).toBe('warn');
    });

    it('flags modest depth', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: 30_000, volume24hUsd: 5_000 })],
          marketCapUsd: 1_000_000,
        }),
      );
      expect(codes(out)).toContain('LIQUIDITY_MODEST');
      expect(out.reasons.find((r) => r.code === 'LIQUIDITY_MODEST')?.points).toBe(6);
    });

    it('does not flag depth at or above the modest ceiling', () => {
      const out = checkLiquidity(
        market({
          pools: [
            pool({ liquidityUsd: LIQUIDITY_BANDS.modest, volume24hUsd: 1_000 }),
            pool({ liquidityUsd: 40_000, volume24hUsd: 1_000, dex: 'orca' }),
          ],
          marketCapUsd: 2_000_000,
        }),
      );
      expect(codes(out)).not.toContain('LIQUIDITY_MODEST');
    });

    it('flags depth that is not reported at all', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: null }), pool({ liquidityUsd: null, dex: 'orca' })],
          totalLiquidityUsd: null,
        }),
      );
      expect(codes(out)).toContain('LIQUIDITY_DEPTH_UNREPORTED');
      expect(out.check.result).toMatch(/depth not reported/i);
    });
  });

  describe('concentration', () => {
    it('flags a single pool as a single point of failure', () => {
      const out = checkLiquidity(
        market({ pools: [pool({ liquidityUsd: 800_000 })], marketCapUsd: 5_000_000 }),
      );
      expect(codes(out)).toContain('LIQUIDITY_SINGLE_POOL');
      expect(out.reasons.find((r) => r.code === 'LIQUIDITY_SINGLE_POOL')?.points).toBe(8);
    });

    it('flags one pool holding almost all depth across several pools', () => {
      const out = checkLiquidity(
        market({
          pools: [
            pool({ liquidityUsd: 950_000 }),
            pool({ liquidityUsd: 10_000, dex: 'orca' }),
          ],
          marketCapUsd: 5_000_000,
        }),
      );
      expect(codes(out)).toContain('LIQUIDITY_CONCENTRATED');
    });

    it('does not double-flag single pool and concentration', () => {
      const out = checkLiquidity(
        market({ pools: [pool({ liquidityUsd: 800_000 })], marketCapUsd: 5_000_000 }),
      );
      expect(codes(out)).not.toContain('LIQUIDITY_CONCENTRATED');
    });
  });

  describe('liquidity versus market cap', () => {
    it('flags a thin float behind an inflated cap', () => {
      const out = checkLiquidity(
        market({
          pools: [
            pool({ liquidityUsd: 20_000, volume24hUsd: 5_000 }),
            pool({ liquidityUsd: 10_000, volume24hUsd: 2_000, dex: 'orca' }),
          ],
          marketCapUsd: 50_000_000,
        }),
      );
      expect(codes(out)).toContain('LIQUIDITY_THIN_VS_MARKET_CAP');
    });

    it('exempts deep markets, where a low ratio is normal', () => {
      // Regression guard: this fired on BONK and USDC before the ceiling was
      // added, penalising the deepest markets on Solana.
      const out = checkLiquidity(
        market({
          pools: [
            pool({ liquidityUsd: 1_000_000, volume24hUsd: 500_000 }),
            pool({ liquidityUsd: 500_000, volume24hUsd: 200_000, dex: 'orca' }),
          ],
          marketCapUsd: 60_000_000_000,
        }),
      );
      expect(codes(out)).not.toContain('LIQUIDITY_THIN_VS_MARKET_CAP');
      expect(out.check.status).toBe('pass');
    });
  });

  it('flags turnover far above depth', () => {
    const out = checkLiquidity(
      market({
        pools: [
          pool({ liquidityUsd: 300_000, volume24hUsd: 7_000_000 }),
          pool({ liquidityUsd: 200_000, volume24hUsd: 5_000_000, dex: 'orca' }),
        ],
        marketCapUsd: 10_000_000,
      }),
    );
    expect(codes(out)).toContain('LIQUIDITY_TURNOVER_ANOMALY');
  });

  describe('pool age', () => {
    it('flags a pool under a day old', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: 600_000, ...hoursAgo(5) })],
          marketCapUsd: 5_000_000,
        }),
      );
      expect(codes(out)).toContain('POOL_VERY_NEW');
      expect(out.reasons.find((r) => r.code === 'POOL_VERY_NEW')?.points).toBe(10);
    });

    it('flags a pool under a week old', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: 600_000, ...hoursAgo(72) })],
          marketCapUsd: 5_000_000,
        }),
      );
      expect(codes(out)).toContain('POOL_NEW');
    });

    it('does not flag a mature pool', () => {
      const out = checkLiquidity(
        market({
          pools: [pool({ liquidityUsd: 600_000, ...hoursAgo(24 * 200) })],
          marketCapUsd: 5_000_000,
        }),
      );
      expect(codes(out)).not.toContain('POOL_NEW');
      expect(codes(out)).not.toContain('POOL_VERY_NEW');
    });
  });

  it('caps the pool list in evidence and says how many were omitted', () => {
    const pools = Array.from({ length: 12 }, (_, i) =>
      pool({ liquidityUsd: 100_000 - i * 1_000, pairAddress: `pair${i}` }),
    );
    const out = checkLiquidity(market({ pools, marketCapUsd: 20_000_000 }));
    const data = out.check.evidence.data as Record<string, unknown>;
    expect((data.pools as unknown[]).length).toBe(8);
    expect(data.poolsOmitted).toBe(4);
  });

  it('warns that depth is a snapshot that can be withdrawn', () => {
    const out = checkLiquidity(market());
    expect(out.check.explanation).toMatch(/withdraw at any time/i);
  });
});
