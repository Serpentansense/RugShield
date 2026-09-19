/**
 * Sellability probing via Jupiter's quote API.
 *
 * Important: these are *quotes*, not executed swaps. A quote proves that an
 * aggregator can currently build a route at the requested size. It does not
 * prove the transaction would land, and RugShield never claims otherwise.
 */

import { WSOL_MINT, type RugShieldConfig } from '../config';
import { getJson } from './http';

interface RawQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: { swapInfo?: { label?: string; ammKey?: string } }[];
  swapUsdValue?: string;
}

export interface Quote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: number | null;
  routeCount: number;
  dexes: string[];
  usdValue: number | null;
}

export type QuoteFailureReason =
  | 'not_tradable'
  | 'no_route'
  | 'upstream_error'
  | 'not_applicable';

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: QuoteFailureReason; error: string };

async function quote(
  config: RugShieldConfig,
  inputMint: string,
  outputMint: string,
  amount: string,
): Promise<QuoteResult> {
  const url =
    `${config.jupiterBaseUrl}/swap/v1/quote` +
    `?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=300&restrictIntermediateTokens=true`;

  const res = await getJson<RawQuote>(url, config.timeoutMs);

  if (!res.ok) {
    const body = res.body ?? '';
    // Jupiter answers 400 with a machine-readable errorCode we can trust.
    if (body.includes('TOKEN_NOT_TRADABLE')) {
      return { ok: false, reason: 'not_tradable', error: 'Jupiter reports the token as not tradable' };
    }
    if (body.includes('NO_ROUTES_FOUND') || body.includes('COULD_NOT_FIND_ANY_ROUTE')) {
      return { ok: false, reason: 'no_route', error: 'Jupiter could not build a route at this size' };
    }
    return { ok: false, reason: 'upstream_error', error: `Jupiter: ${res.error}` };
  }

  const q = res.data;
  if (!q?.outAmount || q.outAmount === '0') {
    return { ok: false, reason: 'no_route', error: 'Jupiter returned an empty route' };
  }

  const impact = q.priceImpactPct !== undefined ? Number(q.priceImpactPct) : NaN;
  return {
    ok: true,
    quote: {
      inAmount: q.inAmount,
      outAmount: q.outAmount,
      priceImpactPct: Number.isFinite(impact) ? impact * 100 : null,
      routeCount: q.routePlan?.length ?? 0,
      dexes: (q.routePlan ?? [])
        .map((r) => r.swapInfo?.label)
        .filter((l): l is string => Boolean(l)),
      usdValue: q.swapUsdValue ? Number(q.swapUsdValue) : null,
    },
  };
}

export interface RoundTrip {
  /** SOL -> token. Establishes how many tokens a given SOL amount buys. */
  buy: QuoteResult;
  /** token -> SOL, sized from the buy leg. The leg that matters for a rug. */
  sell: QuoteResult;
  /** SOL returned divided by SOL spent, as a percentage. */
  retainedPct: number | null;
  probeLamports: number;
}

/**
 * Quotes a buy, then quotes selling exactly what that buy would produce.
 * Asymmetry between the two legs is the strongest honeypot signal available
 * without spending real funds.
 */
export async function probeRoundTrip(
  mint: string,
  config: RugShieldConfig,
): Promise<RoundTrip> {
  // The probe quotes against wrapped SOL, so it cannot be run on wrapped SOL.
  // Skip the request rather than send one we know will 400.
  if (mint === WSOL_MINT) {
    const skipped: QuoteResult = {
      ok: false,
      reason: 'not_applicable',
      error: 'The scanned mint is the probe quote asset (wrapped SOL)',
    };
    return {
      buy: skipped,
      sell: skipped,
      retainedPct: null,
      probeLamports: config.probeLamports,
    };
  }

  const lamports = String(config.probeLamports);
  const buy = await quote(config, WSOL_MINT, mint, lamports);

  if (!buy.ok) {
    return { buy, sell: buy, retainedPct: null, probeLamports: config.probeLamports };
  }

  const sell = await quote(config, mint, WSOL_MINT, buy.quote.outAmount);

  let retainedPct: number | null = null;
  if (sell.ok) {
    const spent = Number(config.probeLamports);
    const returned = Number(sell.quote.outAmount);
    if (spent > 0 && Number.isFinite(returned)) {
      retainedPct = (returned / spent) * 100;
    }
  }

  return { buy, sell, retainedPct, probeLamports: config.probeLamports };
}
