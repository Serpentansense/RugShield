/**
 * Top holder distribution.
 *
 * Deliberately NOT scored. `getTokenLargestAccounts` returns token accounts,
 * which include AMM pool vaults, and the MVP has no reliable way to tell a
 * vault apart from a whale wallet. Scoring it would mean inventing a verdict,
 * so the data is reported as evidence with a stated caveat instead.
 */

import type { MintSnapshot } from '../sources/solana';
import type { CheckResult } from '../types';
import type { CheckOutput } from './authorities';

const SOURCE = 'solana-rpc:getTokenLargestAccounts';

export type LargestAccountsResult =
  | { ok: true; accounts: { address: string; amount: string; uiAmount: number }[] }
  | { ok: false; error: string };

export function checkHolderConcentration(
  mint: MintSnapshot,
  largest: LargestAccountsResult,
): CheckOutput {
  if (!largest.ok) {
    const check: CheckResult = {
      id: 'holder_concentration',
      label: 'Top holder distribution',
      scored: false,
      status: 'unavailable',
      result: 'Could not be checked',
      value: null,
      explanation:
        'The RPC endpoint did not return the largest token accounts. Public Solana RPCs rate limit this call heavily — configure a dedicated SOLANA_RPC_URL to enable it.',
      evidence: { sources: [SOURCE], data: { error: largest.error } },
    };
    return { check, reasons: [] };
  }

  const supply = mint.supply;
  const accounts = largest.accounts.map((a) => ({
    address: a.address,
    uiAmount: a.uiAmount,
    sharePct: supply > 0 ? (a.uiAmount / supply) * 100 : null,
  }));

  const topShare = accounts[0]?.sharePct ?? null;
  const top10Share =
    supply > 0
      ? (accounts.slice(0, 10).reduce((s, a) => s + a.uiAmount, 0) / supply) * 100
      : null;

  return {
    check: {
      id: 'holder_concentration',
      label: 'Top holder distribution',
      scored: false,
      status: 'info',
      result:
        topShare !== null
          ? `Largest account holds ${topShare.toFixed(2)}% of supply (pool vaults included)`
          : 'Reported without a supply basis',
      value: {
        scored: false,
        largestSharePct: topShare === null ? null : round(topShare),
        top10SharePct: top10Share === null ? null : round(top10Share),
        accountsReturned: accounts.length,
        supply,
      },
      explanation:
        'Reported as evidence only, not scored. These are token accounts, so AMM pool vaults appear alongside real wallets and this MVP cannot separate the two. A high number here may simply be a liquidity pool rather than a whale.',
      evidence: {
        sources: [SOURCE],
        data: {
          supply,
          decimals: mint.decimals,
          accounts: accounts.slice(0, 10).map((a) => ({
            address: a.address,
            uiAmount: a.uiAmount,
            sharePct: a.sharePct === null ? null : round(a.sharePct),
          })),
          caveat:
            'Includes AMM pool vaults; not usable as a distribution verdict without vault classification.',
        },
      },
    },
    reasons: [],
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
