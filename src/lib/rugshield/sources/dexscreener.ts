/**
 * Liquidity pool discovery via the public DexScreener API (keyless).
 * Returns every Solana pair that quotes the mint, with USD liquidity depth.
 */

import type { RugShieldConfig } from '../config';
import { getJson } from './http';

interface RawPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[];
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

export interface Pool {
  dex: string;
  pairAddress: string;
  labels: string[];
  /** Symbol pair, e.g. `BONK/SOL`. */
  pair: string;
  /** USD depth reported by DexScreener. `null` when not reported. */
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  createdAt: string | null;
  ageHours: number | null;
  url: string | null;
  /** True when the scanned mint is the base side of the pair. */
  isBase: boolean;
}

export interface MarketData {
  pools: Pool[];
  totalLiquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  symbol: string | null;
  name: string | null;
  buys24h: number | null;
  sells24h: number | null;
}

export type MarketFetch =
  | { ok: true; data: MarketData }
  | { ok: false; error: string };

export async function fetchMarketData(
  mint: string,
  config: RugShieldConfig,
): Promise<MarketFetch> {
  const url = `${config.dexscreenerBaseUrl}/latest/dex/tokens/${mint}`;
  const res = await getJson<{ pairs: RawPair[] | null }>(url, config.timeoutMs);
  if (!res.ok) return { ok: false, error: `DexScreener: ${res.error}` };

  const raw = Array.isArray(res.data?.pairs) ? res.data.pairs : [];
  const solanaPairs = raw.filter((p) => p.chainId === 'solana');
  const now = Date.now();

  const pools: Pool[] = solanaPairs.map((p) => {
    const created = typeof p.pairCreatedAt === 'number' ? p.pairCreatedAt : null;
    return {
      dex: p.dexId ?? 'unknown',
      pairAddress: p.pairAddress ?? 'unknown',
      labels: p.labels ?? [],
      pair: `${p.baseToken?.symbol ?? '?'}/${p.quoteToken?.symbol ?? '?'}`,
      liquidityUsd: numOrNull(p.liquidity?.usd),
      volume24hUsd: numOrNull(p.volume?.h24),
      priceUsd: numOrNull(p.priceUsd ? Number(p.priceUsd) : undefined),
      createdAt: created ? new Date(created).toISOString() : null,
      ageHours: created ? (now - created) / 3_600_000 : null,
      url: p.url ?? null,
      isBase: p.baseToken?.address === mint,
    };
  });

  // Deepest pool first: that is the one a trade would actually route through.
  pools.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));

  const withLiquidity = pools.filter((p) => p.liquidityUsd !== null);
  const totalLiquidityUsd = withLiquidity.length
    ? withLiquidity.reduce((sum, p) => sum + (p.liquidityUsd ?? 0), 0)
    : null;

  const volume24hUsd = pools.length
    ? pools.reduce((sum, p) => sum + (p.volume24hUsd ?? 0), 0)
    : null;

  // Prefer the metadata attached to the deepest pair where the mint is base.
  const primary =
    solanaPairs.find((p) => p.baseToken?.address === mint) ?? solanaPairs[0];

  const txnTotals = solanaPairs.reduce(
    (acc, p) => {
      acc.buys += p.txns?.h24?.buys ?? 0;
      acc.sells += p.txns?.h24?.sells ?? 0;
      return acc;
    },
    { buys: 0, sells: 0 },
  );

  return {
    ok: true,
    data: {
      pools,
      totalLiquidityUsd,
      volume24hUsd,
      priceUsd: pools[0]?.priceUsd ?? null,
      fdvUsd: numOrNull(primary?.fdv),
      marketCapUsd: numOrNull(primary?.marketCap),
      symbol: primary?.baseToken?.address === mint ? (primary?.baseToken?.symbol ?? null) : null,
      name: primary?.baseToken?.address === mint ? (primary?.baseToken?.name ?? null) : null,
      buys24h: solanaPairs.length ? txnTotals.buys : null,
      sells24h: solanaPairs.length ? txnTotals.sells : null,
    },
  };
}

function numOrNull(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
