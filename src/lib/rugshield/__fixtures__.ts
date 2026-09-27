/**
 * Builders for test inputs.
 *
 * The checks are pure functions over these snapshots, which is what lets the
 * whole scoring surface be exercised without network access — including the
 * branches that are impractical to hit against live mainnet data, like a
 * paused mint or a one-directional sell route.
 */

import type { MarketData, MarketFetch, Pool } from './sources/dexscreener';
import type { Quote, QuoteResult, RoundTrip } from './sources/jupiter';
import type { MintSnapshot } from './sources/solana';
import type { ChecksMap, CheckResult } from './types';

export const LEGACY_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SOME_AUTHORITY = 'BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG';
export const SOME_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

/** A clean legacy SPL mint: no authorities, no extensions. */
export function mint(overrides: Partial<MintSnapshot> = {}): MintSnapshot {
  return {
    address: SOME_MINT,
    program: 'spl-token',
    programId: LEGACY_PROGRAM_ID,
    decimals: 5,
    supplyRaw: '1000000000',
    supply: 10_000,
    isInitialized: true,
    mintAuthority: null,
    freezeAuthority: null,
    transferFee: null,
    transferHookProgramId: null,
    permanentDelegate: null,
    mintCloseAuthority: null,
    defaultAccountState: null,
    pausable: null,
    extensionBytes: 0,
    lamports: 1_461_600,
    ...overrides,
  };
}

/** A Token-2022 mint, so extension-based branches become reachable. */
export function mint2022(overrides: Partial<MintSnapshot> = {}): MintSnapshot {
  return mint({
    program: 'spl-token-2022',
    programId: TOKEN_2022_PROGRAM_ID,
    extensionBytes: 700,
    ...overrides,
  });
}

export function pool(overrides: Partial<Pool> = {}): Pool {
  return {
    dex: 'raydium',
    pairAddress: 'pair1111111111111111111111111111111111111111',
    labels: [],
    pair: 'TKN/SOL',
    liquidityUsd: 500_000,
    volume24hUsd: 100_000,
    priceUsd: 0.01,
    createdAt: new Date(Date.now() - 90 * 24 * 3_600_000).toISOString(),
    ageHours: 90 * 24,
    url: 'https://dexscreener.com/solana/pair1',
    isBase: true,
    ...overrides,
  };
}

export function marketData(overrides: Partial<MarketData> = {}): MarketData {
  const pools = overrides.pools ?? [pool()];
  const total = pools.reduce((sum, p) => sum + (p.liquidityUsd ?? 0), 0);
  return {
    pools,
    totalLiquidityUsd: total,
    volume24hUsd: pools.reduce((sum, p) => sum + (p.volume24hUsd ?? 0), 0),
    priceUsd: 0.01,
    fdvUsd: 1_000_000,
    marketCapUsd: 1_000_000,
    symbol: 'TKN',
    name: 'Token',
    buys24h: 100,
    sells24h: 80,
    ...overrides,
  };
}

export function market(overrides: Partial<MarketData> = {}): MarketFetch {
  return { ok: true, data: marketData(overrides) };
}

export function marketFailed(error = 'DexScreener: HTTP 503'): MarketFetch {
  return { ok: false, error };
}

export function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    inAmount: '100000000',
    outAmount: '5000000000',
    priceImpactPct: 0.1,
    routeCount: 2,
    dexes: ['Raydium', 'Orca'],
    usdValue: 11.07,
    ...overrides,
  };
}

const PROBE_LAMPORTS = 100_000_000;

/**
 * Builds a round trip from the SOL amount the sell leg would return, which is
 * the number the sellability bands are expressed in.
 */
export function roundTrip(options: {
  buy?: QuoteResult;
  sell?: QuoteResult;
  returnedLamports?: number;
}): RoundTrip {
  const buy = options.buy ?? { ok: true as const, quote: quote() };

  let sell: QuoteResult;
  if (options.sell) {
    sell = options.sell;
  } else if (options.returnedLamports !== undefined) {
    sell = {
      ok: true,
      quote: quote({
        inAmount: '5000000000',
        outAmount: String(options.returnedLamports),
      }),
    };
  } else {
    sell = { ok: true, quote: quote({ outAmount: String(PROBE_LAMPORTS) }) };
  }

  let retainedPct: number | null = null;
  if (sell.ok) retainedPct = (Number(sell.quote.outAmount) / PROBE_LAMPORTS) * 100;

  return { buy, sell, retainedPct, probeLamports: PROBE_LAMPORTS };
}

export const notTradable: QuoteResult = {
  ok: false,
  reason: 'not_tradable',
  error: 'Jupiter reports the token as not tradable',
};

export const noRoute: QuoteResult = {
  ok: false,
  reason: 'no_route',
  error: 'Jupiter could not build a route at this size',
};

export const upstreamError: QuoteResult = {
  ok: false,
  reason: 'upstream_error',
  error: 'Jupiter: HTTP 503',
};

export const notApplicable: QuoteResult = {
  ok: false,
  reason: 'not_applicable',
  error: 'The scanned mint is the probe quote asset (wrapped SOL)',
};

/** Minimal check object, for driving the scorer directly. */
export function check(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    id: 'some_check',
    label: 'Some check',
    status: 'pass',
    scored: true,
    result: 'fine',
    value: null,
    explanation: 'explanation',
    evidence: { sources: [], data: {} },
    ...overrides,
  };
}

/** All-passing checks map, so tests can override just what they care about. */
export function checksMap(overrides: Partial<ChecksMap> = {}): ChecksMap {
  return {
    tokenInfo: check({ id: 'token_info' }),
    mintAuthority: check({ id: 'mint_authority' }),
    freezeAuthority: check({ id: 'freeze_authority' }),
    honeypot: check({ id: 'honeypot' }),
    sellability: check({ id: 'sellability' }),
    liquidity: check({ id: 'liquidity' }),
    holderConcentration: check({ id: 'holder_concentration', scored: false, status: 'info' }),
    ...overrides,
  };
}
