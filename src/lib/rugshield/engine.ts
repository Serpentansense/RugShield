/**
 * The RugShield risk engine.
 *
 * Single entry point shared by the HTTP API, the MCP server and the CLI script.
 * It knows nothing about HTTP, React or MCP.
 */

import { getConfig, type RugShieldConfig } from './config';
import { scoreToken } from './scoring';
import {
  checkFreezeAuthority,
  checkMintAuthority,
  type CheckOutput,
} from './checks/authorities';
import { checkHolderConcentration } from './checks/holders';
import { checkHoneypot } from './checks/honeypot';
import { checkLiquidity } from './checks/liquidity';
import { checkSellability } from './checks/sellability';
import { checkTokenInfo } from './checks/token-info';
import { fetchMarketData, type MarketFetch } from './sources/dexscreener';
import { probeRoundTrip } from './sources/jupiter';
import {
  createConnection,
  createFastFailConnection,
  fetchLargestAccounts,
  fetchMintSnapshot,
  isValidMintAddress,
} from './sources/solana';
import {
  DISCLAIMER,
  RugShieldError,
  type ChecksMap,
  type Reason,
  type RugShieldReport,
} from './types';

export interface CheckTokenOptions {
  config?: RugShieldConfig;
}

/**
 * Runs every check against a mint and returns a scored report.
 *
 * Throws `RugShieldError` only for inputs that cannot produce a meaningful
 * score at all (bad address, no such account, not a mint, RPC unreachable).
 * Individual upstream failures degrade the relevant check to `unavailable`
 * instead of failing the scan.
 */
export async function checkToken(
  token: string,
  options: CheckTokenOptions = {},
): Promise<RugShieldReport> {
  const startedAt = Date.now();
  const config = options.config ?? getConfig();
  const mintAddress = token.trim();

  if (!isValidMintAddress(mintAddress)) {
    throw new RugShieldError(
      'That is not a valid Solana address. A mint address is 32 bytes encoded as base58, usually 43 or 44 characters.',
      'INVALID_ADDRESS',
    );
  }

  const connection = createConnection(config);

  // The mint read is mandatory: without it there is nothing to score.
  const mint = await fetchMintSnapshot(connection, mintAddress);

  // Everything else runs in parallel and is allowed to fail independently.
  const [market, roundTrip, largest] = await Promise.all([
    fetchMarketData(mintAddress, config),
    probeRoundTrip(mintAddress, config),
    fetchLargestAccounts(createFastFailConnection(config), mintAddress),
  ]);

  const outputs: Record<keyof ChecksMap, CheckOutput> = {
    tokenInfo: checkTokenInfo(mint, market.ok ? market.data : null),
    mintAuthority: checkMintAuthority(mint),
    freezeAuthority: checkFreezeAuthority(mint),
    honeypot: checkHoneypot(mint, roundTrip),
    sellability: checkSellability(roundTrip),
    liquidity: checkLiquidity(market),
    holderConcentration: checkHolderConcentration(mint, largest),
  };

  const checks = Object.fromEntries(
    Object.entries(outputs).map(([key, out]) => [key, out.check]),
  ) as ChecksMap;

  const reasons: Reason[] = Object.values(outputs).flatMap((out) => out.reasons);

  const { riskScore, riskLevel, reasons: sortedReasons, scoring } = scoreToken({
    reasons,
    checks,
  });

  return {
    token: mintAddress,
    riskScore,
    riskLevel,
    checks,
    reasons: sortedReasons,
    scoring,
    dataSources: buildDataSources(config, market, roundTrip, largest),
    disclaimer: DISCLAIMER,
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}

function buildDataSources(
  config: RugShieldConfig,
  market: MarketFetch,
  roundTrip: Awaited<ReturnType<typeof probeRoundTrip>>,
  largest: Awaited<ReturnType<typeof fetchLargestAccounts>>,
): RugShieldReport['dataSources'] {
  // `not_tradable` / `no_route` are valid answers from a healthy Jupiter, so
  // only a genuine transport failure counts as the source being down.
  const jupiterSkipped = !roundTrip.buy.ok && roundTrip.buy.reason === 'not_applicable';
  const jupiterOk = roundTrip.buy.ok || (!roundTrip.buy.ok && roundTrip.buy.reason !== 'upstream_error');

  return [
    {
      name: 'solana-rpc',
      ok: true,
      detail: config.usingDefaultRpc
        ? 'public mainnet-beta endpoint (rate limited)'
        : 'custom endpoint',
    },
    {
      name: 'dexscreener',
      ok: market.ok,
      detail: market.ok ? `${market.data.pools.length} Solana pool(s)` : market.error,
    },
    {
      name: 'jupiter',
      ok: jupiterOk,
      detail: jupiterSkipped
        ? 'not queried (scanned mint is the probe quote asset)'
        : jupiterOk
          ? 'quote API reachable'
          : !roundTrip.buy.ok
            ? roundTrip.buy.error
            : 'unknown',
    },
    {
      name: 'solana-rpc:getTokenLargestAccounts',
      ok: largest.ok,
      detail: largest.ok ? `${largest.accounts.length} account(s)` : largest.error,
    },
  ];
}
