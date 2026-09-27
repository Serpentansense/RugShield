/**
 * Liquidity pool detection, depth, concentration and suspicious conditions.
 *
 * Depth is what determines whether an exit is actually possible, so this check
 * carries real weight. Pure function over fetched market data.
 */

import type { MarketData, MarketFetch } from '../sources/dexscreener';
import type { CheckResult, Reason } from '../types';
import type { CheckOutput } from './authorities';

/** USD depth bands. Documented here so the scoring stays auditable. */
export const LIQUIDITY_BANDS = {
  critical: 1_000,
  low: 10_000,
  modest: 50_000,
  /**
   * Above this depth the liquidity-to-market-cap ratio stops being a useful
   * signal: established tokens legitimately hold a small fraction of their
   * market cap in on-chain pools.
   */
  ratioCeiling: 250_000,
} as const;

const SOURCE = 'dexscreener:/latest/dex/tokens';

export function checkLiquidity(market: MarketFetch): CheckOutput {
  if (!market.ok) {
    return {
      check: {
        id: 'liquidity',
        scored: true,
        label: 'Liquidity',
        status: 'unavailable',
        result: 'Could not be checked',
        value: null,
        explanation:
          'The liquidity data provider did not respond, so pool depth could not be verified. This is not a pass — treat liquidity as unknown.',
        evidence: { sources: [SOURCE], data: { error: market.error } },
      },
      reasons: [],
    };
  }

  const m = market.data;
  const reasons: Reason[] = [];

  const topPool = m.pools[0] ?? null;
  const total = m.totalLiquidityUsd;
  const topShare =
    topPool?.liquidityUsd != null && total != null && total > 0
      ? (topPool.liquidityUsd / total) * 100
      : null;

  const youngestAgeHours = m.pools
    .map((p) => p.ageHours)
    .filter((h): h is number => h !== null)
    .reduce<number | null>((min, h) => (min === null || h < min ? h : min), null);
  const oldestAgeHours = m.pools
    .map((p) => p.ageHours)
    .filter((h): h is number => h !== null)
    .reduce<number | null>((max, h) => (max === null || h > max ? h : max), null);

  const turnover =
    total != null && total > 0 && m.volume24hUsd != null
      ? m.volume24hUsd / total
      : null;
  const liquidityToMcap =
    total != null && m.marketCapUsd != null && m.marketCapUsd > 0
      ? (total / m.marketCapUsd) * 100
      : null;

  const value = {
    poolCount: m.pools.length,
    totalLiquidityUsd: total,
    volume24hUsd: m.volume24hUsd,
    marketCapUsd: m.marketCapUsd,
    topPool: topPool
      ? {
          dex: topPool.dex,
          pair: topPool.pair,
          pairAddress: topPool.pairAddress,
          liquidityUsd: topPool.liquidityUsd,
          ageHours: topPool.ageHours,
        }
      : null,
    topPoolSharePct: round(topShare),
    oldestPoolAgeHours: round(oldestAgeHours),
    newestPoolAgeHours: round(youngestAgeHours),
    turnoverRatio24h: round(turnover),
    liquidityToMarketCapPct: round(liquidityToMcap),
  };

  const evidence = {
    sources: [SOURCE],
    data: {
      ...value,
      pools: m.pools.slice(0, 8).map((p) => ({
        dex: p.dex,
        pair: p.pair,
        pairAddress: p.pairAddress,
        liquidityUsd: p.liquidityUsd,
        volume24hUsd: p.volume24hUsd,
        createdAt: p.createdAt,
        labels: p.labels,
        url: p.url,
      })),
      poolsOmitted: Math.max(0, m.pools.length - 8),
    },
  };

  // --- No pool at all ------------------------------------------------------
  if (m.pools.length === 0) {
    return {
      check: {
        id: 'liquidity',
        scored: true,
        label: 'Liquidity',
        status: 'fail',
        result: 'No liquidity pool found',
        value,
        explanation:
          'No Solana trading pair for this mint was found on the liquidity data provider. With no pool there is no market to sell into. Very new tokens can also appear this way before they are indexed.',
        evidence,
      },
      reasons: [
        {
          code: 'NO_LIQUIDITY_POOL',
          severity: 'high',
          message:
            'No liquidity pool was found for this token, so there is no market to exit into.',
          points: 30,
          checkId: 'liquidity',
        },
      ],
    };
  }

  // --- Depth ---------------------------------------------------------------
  if (total === null) {
    reasons.push({
      code: 'LIQUIDITY_DEPTH_UNREPORTED',
      severity: 'medium',
      message: `${m.pools.length} pool(s) found but none reported USD depth, so exit size cannot be estimated.`,
      points: 12,
      checkId: 'liquidity',
    });
  } else if (total < LIQUIDITY_BANDS.critical) {
    reasons.push({
      code: 'LIQUIDITY_CRITICALLY_LOW',
      severity: 'high',
      message: `Total liquidity is only ${usd(total)}. Even a small sell would move the price heavily.`,
      points: 25,
      checkId: 'liquidity',
    });
  } else if (total < LIQUIDITY_BANDS.low) {
    reasons.push({
      code: 'LIQUIDITY_LOW',
      severity: 'medium',
      message: `Total liquidity is ${usd(total)}, which is thin enough that exits will suffer significant slippage.`,
      points: 15,
      checkId: 'liquidity',
    });
  } else if (total < LIQUIDITY_BANDS.modest) {
    reasons.push({
      code: 'LIQUIDITY_MODEST',
      severity: 'low',
      message: `Total liquidity is ${usd(total)}. Workable for small size only.`,
      points: 6,
      checkId: 'liquidity',
    });
  }

  // --- Concentration -------------------------------------------------------
  if (m.pools.length === 1) {
    reasons.push({
      code: 'LIQUIDITY_SINGLE_POOL',
      severity: 'low',
      message:
        'All liquidity sits in a single pool. If that one LP position is withdrawn there is no fallback market.',
      points: 8,
      checkId: 'liquidity',
    });
  } else if (topShare !== null && topShare >= 90) {
    reasons.push({
      code: 'LIQUIDITY_CONCENTRATED',
      severity: 'low',
      message: `${topShare.toFixed(1)}% of liquidity is in one pool (${topPool?.dex} ${topPool?.pair}), so the other pools would not absorb an exit.`,
      points: 6,
      checkId: 'liquidity',
    });
  }

  // --- Suspicious conditions ----------------------------------------------
  // Only meaningful while depth is small in absolute terms. Large-cap tokens
  // normally carry a tiny fraction of their cap as on-chain DEX depth, so
  // applying this ratio to them would flag the deepest markets as risky.
  if (
    liquidityToMcap !== null &&
    liquidityToMcap < 1 &&
    total !== null &&
    total < LIQUIDITY_BANDS.ratioCeiling
  ) {
    reasons.push({
      code: 'LIQUIDITY_THIN_VS_MARKET_CAP',
      severity: 'medium',
      message: `Liquidity is only ${liquidityToMcap.toFixed(2)}% of the ${usd(m.marketCapUsd!)} market cap, so the quoted valuation is not backed by tradable depth.`,
      points: 10,
      checkId: 'liquidity',
    });
  }

  if (turnover !== null && turnover > 20) {
    reasons.push({
      code: 'LIQUIDITY_TURNOVER_ANOMALY',
      severity: 'medium',
      message: `24h volume is ${turnover.toFixed(1)}x the pool depth. Turnover that far above depth often accompanies wash trading or a pool being drained.`,
      points: 8,
      checkId: 'liquidity',
    });
  }

  if (youngestAgeHours !== null && oldestAgeHours !== null) {
    if (oldestAgeHours < 24) {
      reasons.push({
        code: 'POOL_VERY_NEW',
        severity: 'medium',
        message: `The oldest pool is only ${oldestAgeHours.toFixed(1)} hours old. There is no trading history to judge behaviour.`,
        points: 10,
        checkId: 'liquidity',
      });
    } else if (oldestAgeHours < 24 * 7) {
      reasons.push({
        code: 'POOL_NEW',
        severity: 'low',
        message: `The oldest pool is ${(oldestAgeHours / 24).toFixed(1)} days old, so history is limited.`,
        points: 5,
        checkId: 'liquidity',
      });
    }
  }

  const status: CheckResult['status'] = reasons.some((r) => r.severity === 'high')
    ? 'fail'
    : reasons.length > 0
      ? 'warn'
      : 'pass';

  return {
    check: {
      id: 'liquidity',
      scored: true,
      label: 'Liquidity',
      status,
      result:
        total !== null
          ? `${usd(total)} across ${m.pools.length} pool${m.pools.length === 1 ? '' : 's'}`
          : `${m.pools.length} pool(s), depth not reported`,
      value,
      explanation: buildLiquidityExplanation(m, total, topShare),
      evidence,
    },
    reasons,
  };
}

function buildLiquidityExplanation(
  m: MarketData,
  total: number | null,
  topShare: number | null,
): string {
  const parts: string[] = [];
  parts.push(
    total !== null
      ? `Pool depth is what limits how much can actually be sold. Total reported depth is ${usd(total)} across ${m.pools.length} indexed Solana pool(s).`
      : `${m.pools.length} Solana pool(s) were found, but the provider did not report USD depth for them.`,
  );
  if (topShare !== null && m.pools.length > 1) {
    parts.push(
      `The deepest pool holds ${topShare.toFixed(1)}% of that depth, so concentration matters more than the pool count.`,
    );
  }
  parts.push(
    'Depth is a snapshot: liquidity providers can withdraw at any time, including right after this scan.',
  );
  return parts.join(' ');
}

function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}
