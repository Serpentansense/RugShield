/**
 * Mint / token account information. Mostly descriptive, but an uninitialised
 * mint is a hard failure.
 */

import type { MarketData } from '../sources/dexscreener';
import type { MintSnapshot } from '../sources/solana';
import type { CheckResult, Reason } from '../types';
import type { CheckOutput } from './authorities';

export function checkTokenInfo(
  mint: MintSnapshot,
  market: MarketData | null,
): CheckOutput {
  const value = {
    address: mint.address,
    tokenProgram: mint.program,
    programId: mint.programId,
    decimals: mint.decimals,
    supply: mint.supply,
    supplyRaw: mint.supplyRaw,
    isInitialized: mint.isInitialized,
    symbol: market?.symbol ?? null,
    name: market?.name ?? null,
    priceUsd: market?.priceUsd ?? null,
    marketCapUsd: market?.marketCapUsd ?? null,
    fdvUsd: market?.fdvUsd ?? null,
    extensionBytes: mint.extensionBytes,
    rentLamports: mint.lamports,
  };

  const evidence = {
    sources: [
      'solana-rpc:getAccountInfo',
      ...(market ? ['dexscreener:/latest/dex/tokens'] : []),
    ],
    data: value,
  };

  if (!mint.isInitialized) {
    const check: CheckResult = {
      id: 'token_info',
      label: 'Token mint account',
      status: 'fail',
      result: 'Mint account is not initialised',
      value,
      explanation:
        'The account exists but the token program reports it as uninitialised. It cannot be traded in this state.',
      evidence,
    };
    const reasons: Reason[] = [
      {
        code: 'MINT_UNINITIALIZED',
        severity: 'high',
        message: 'The mint account is not initialised and cannot function as a token.',
        points: 40,
        checkId: 'token_info',
      },
    ];
    return { check, reasons };
  }

  const programLabel =
    mint.program === 'spl-token-2022' ? 'Token-2022' : 'SPL Token (legacy)';

  return {
    check: {
      id: 'token_info',
      label: 'Token mint account',
      status: 'info',
      result: `${programLabel}, ${mint.decimals} decimals, supply ${formatCompact(mint.supply)}`,
      value,
      explanation:
        mint.program === 'spl-token-2022'
          ? 'This mint uses Token-2022, which supports extensions such as transfer fees, transfer hooks and permanent delegates. Those extensions are inspected by the honeypot check.'
          : 'This mint uses the original SPL Token program, which has no transfer-fee or transfer-hook extensions. Only the mint and freeze authorities apply.',
      evidence,
    },
    reasons: [],
  };
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const units = [
    { v: 1e12, s: 'T' },
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  for (const u of units) {
    if (Math.abs(n) >= u.v) return `${(n / u.v).toFixed(2)}${u.s}`;
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
