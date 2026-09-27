/**
 * Sellability: can a route out of this token be built right now, and how much
 * value survives a buy/sell round trip?
 *
 * This is a *quote-based* probe. It proves an aggregator can currently build a
 * route at the probe size. It does not execute a swap, so it cannot prove a
 * transaction would land. The check text says so explicitly.
 */

import type { RoundTrip } from '../sources/jupiter';
import type { CheckResult, Reason } from '../types';
import type { CheckOutput } from './authorities';

export const ROUND_TRIP_BANDS = {
  extreme: 50,
  high: 80,
  moderate: 95,
} as const;

const SOURCE = 'jupiter:/swap/v1/quote';

export function checkSellability(trip: RoundTrip): CheckOutput {
  const probeSol = trip.probeLamports / 1e9;

  if (!trip.buy.ok && trip.buy.reason === 'not_applicable') {
    return {
      check: {
        id: 'sellability',
        scored: true,
        label: 'Sellability',
        status: 'unavailable',
        result: 'Not applicable to wrapped SOL',
        value: null,
        explanation:
          'The round-trip probe quotes against wrapped SOL, so it cannot be run on wrapped SOL itself.',
        evidence: { sources: [SOURCE], data: { reason: trip.buy.error } },
      },
      reasons: [],
    };
  }

  const baseEvidence = {
    probeSizeSol: probeSol,
    probeLamports: trip.probeLamports,
    quoteAsset: 'So11111111111111111111111111111111111111112 (wrapped SOL)',
    method: 'two quote requests: SOL->token, then token->SOL sized from the first result',
    executed: false,
  };

  // --- Buy leg could not even be quoted ------------------------------------
  if (!trip.buy.ok) {
    if (trip.buy.reason === 'upstream_error') {
      return {
        check: {
          id: 'sellability',
          scored: true,
          label: 'Sellability',
          status: 'unavailable',
          result: 'Could not be checked',
          value: null,
          explanation:
            'The routing provider did not respond, so sellability could not be tested. This is not a pass — treat sellability as unknown.',
          evidence: { sources: [SOURCE], data: { ...baseEvidence, error: trip.buy.error } },
        },
        reasons: [],
      };
    }

    return {
      check: {
        id: 'sellability',
        scored: true,
        label: 'Sellability',
        status: 'fail',
        result: 'No tradable route in either direction',
        value: { tradable: false, buyRoute: false, sellRoute: false, retainedPct: null },
        explanation:
          'The aggregator reports no route for this token at all, in either direction. It cannot currently be bought or sold through standard routing.',
        evidence: {
          sources: [SOURCE],
          data: { ...baseEvidence, buyError: trip.buy.error, buyReason: trip.buy.reason },
        },
      },
      reasons: [
        {
          code: 'NOT_TRADABLE',
          severity: 'high',
          message:
            'No aggregator route exists for this token, so it cannot be bought or sold through standard routing.',
          points: 40,
          checkId: 'sellability',
        },
      ],
    };
  }

  // --- Buy works but sell does not: the strongest honeypot signal ----------
  if (!trip.sell.ok) {
    if (trip.sell.reason === 'upstream_error') {
      return {
        check: {
          id: 'sellability',
          scored: true,
          label: 'Sellability',
          status: 'unavailable',
          result: 'Sell leg could not be checked',
          value: { tradable: true, buyRoute: true, sellRoute: null, retainedPct: null },
          explanation:
            'A buy route was found, but the routing provider failed while quoting the sell leg. Sellability is unknown, not confirmed.',
          evidence: {
            sources: [SOURCE],
            data: { ...baseEvidence, buy: trip.buy.quote, sellError: trip.sell.error },
          },
        },
        reasons: [],
      };
    }

    return {
      check: {
        id: 'sellability',
        scored: true,
        label: 'Sellability',
        status: 'fail',
        result: 'Buy route exists, sell route does not',
        value: { tradable: true, buyRoute: true, sellRoute: false, retainedPct: null },
        explanation:
          'A route to buy this token was quoted successfully, but no route to sell the resulting amount back to SOL could be built. One-directional routing is the classic honeypot pattern. It can also occur on brand-new tokens whose sell-side routing has not been indexed yet.',
        evidence: {
          sources: [SOURCE],
          data: {
            ...baseEvidence,
            buy: trip.buy.quote,
            sellError: trip.sell.error,
            sellReason: trip.sell.reason,
          },
        },
      },
      reasons: [
        {
          code: 'SELL_ROUTE_MISSING',
          severity: 'high',
          message:
            'A buy route was quoted but no sell route could be built for the tokens it would produce. This is the classic honeypot pattern.',
          points: 55,
          checkId: 'sellability',
        },
      ],
    };
  }

  // --- Both legs quoted: judge round-trip value retention ------------------
  const retained = trip.retainedPct;
  const reasons: Reason[] = [];

  const value = {
    tradable: true,
    buyRoute: true,
    sellRoute: true,
    retainedPct: retained === null ? null : Math.round(retained * 100) / 100,
    buyPriceImpactPct: trip.buy.quote.priceImpactPct,
    sellPriceImpactPct: trip.sell.quote.priceImpactPct,
    probeSizeSol: probeSol,
  };

  const evidence = {
    sources: [SOURCE],
    data: {
      ...baseEvidence,
      buy: {
        inLamports: trip.buy.quote.inAmount,
        outTokensRaw: trip.buy.quote.outAmount,
        priceImpactPct: trip.buy.quote.priceImpactPct,
        dexes: trip.buy.quote.dexes,
        usdValue: trip.buy.quote.usdValue,
      },
      sell: {
        inTokensRaw: trip.sell.quote.inAmount,
        outLamports: trip.sell.quote.outAmount,
        priceImpactPct: trip.sell.quote.priceImpactPct,
        dexes: trip.sell.quote.dexes,
        usdValue: trip.sell.quote.usdValue,
      },
      retainedPct: value.retainedPct,
    },
  };

  if (retained === null) {
    return {
      check: {
        id: 'sellability',
        scored: true,
        label: 'Sellability',
        status: 'warn',
        result: 'Routes exist, round-trip value could not be computed',
        value,
        explanation:
          'Both legs were quoted but the returned amounts could not be compared, so the cost of a round trip is unknown.',
        evidence,
      },
      reasons: [],
    };
  }

  if (retained < ROUND_TRIP_BANDS.extreme) {
    reasons.push({
      code: 'ROUND_TRIP_LOSS_EXTREME',
      severity: 'high',
      message: `A ${probeSol} SOL buy followed by an immediate sell would return only ${retained.toFixed(1)}% of the SOL spent. Over half the value is lost on the round trip.`,
      points: 30,
      checkId: 'sellability',
    });
  } else if (retained < ROUND_TRIP_BANDS.high) {
    reasons.push({
      code: 'ROUND_TRIP_LOSS_HIGH',
      severity: 'medium',
      message: `A ${probeSol} SOL round trip would return ${retained.toFixed(1)}% of the SOL spent, pointing to a heavy tax or very thin depth.`,
      points: 15,
      checkId: 'sellability',
    });
  } else if (retained < ROUND_TRIP_BANDS.moderate) {
    reasons.push({
      code: 'ROUND_TRIP_LOSS_MODERATE',
      severity: 'low',
      message: `A ${probeSol} SOL round trip would return ${retained.toFixed(1)}% of the SOL spent.`,
      points: 5,
      checkId: 'sellability',
    });
  }

  const status: CheckResult['status'] = reasons.some((r) => r.severity === 'high')
    ? 'fail'
    : reasons.length > 0
      ? 'warn'
      : 'pass';

  return {
    check: {
      id: 'sellability',
      scored: true,
      label: 'Sellability',
      status,
      result: `Sell route found — round trip returns ${retained.toFixed(1)}% of ${probeSol} SOL`,
      value,
      explanation: `Both directions were quoted at a ${probeSol} SOL probe size and a sell route back to SOL exists. Round-trip retention of ${retained.toFixed(1)}% covers swap fees, price impact and any transfer tax. These are quotes, not executed swaps, so they show routing is available right now, not that a transaction is guaranteed to land.`,
      evidence,
    },
    reasons,
  };
}
