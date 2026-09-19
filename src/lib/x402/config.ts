/**
 * x402 configuration. Entirely environment driven — no addresses, prices or
 * facilitator URLs are hardcoded.
 *
 * Payment is OFF by default so the demo and the MCP server work without any
 * wallet setup. Turn it on with X402_ENABLED=true.
 */

import type { Network } from '@x402/core/types';

export interface X402Config {
  enabled: boolean;
  /** CAIP-style network id, e.g. `solana:mainnet` or `solana:devnet`. */
  network: Network;
  /** Address that receives the USDC. Required when enabled. */
  payTo: string | null;
  /** Token mint used for payment. Defaults to USDC for the chosen network. */
  asset: string;
  assetDecimals: number;
  /** Human price, e.g. `0.01`. */
  priceUsdc: string;
  /** Price in atomic units, which is what the protocol carries. */
  amountAtomic: string;
  /** Facilitator base URL that performs verify + settle. Required when enabled. */
  facilitatorUrl: string | null;
  /** Optional bearer token for facilitators that require auth. */
  facilitatorApiKey: string | null;
  maxTimeoutSeconds: number;
  /** x402 protocol version this server speaks. */
  x402Version: number;
}

/** Circulating USDC mints, so operators do not have to look them up. */
const USDC_BY_NETWORK: Record<string, string> = {
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function getX402Config(): X402Config {
  const network = (env('X402_NETWORK') ?? 'solana:devnet') as Network;
  const decimals = Number(env('X402_ASSET_DECIMALS') ?? 6);
  const priceUsdc = env('X402_PRICE_USDC') ?? '0.01';

  return {
    enabled: env('X402_ENABLED') === 'true',
    network,
    payTo: env('X402_PAY_TO') ?? null,
    asset: env('X402_ASSET') ?? USDC_BY_NETWORK[network] ?? '',
    assetDecimals: decimals,
    priceUsdc,
    amountAtomic: toAtomic(priceUsdc, decimals),
    facilitatorUrl: env('X402_FACILITATOR_URL')?.replace(/\/$/, '') ?? null,
    facilitatorApiKey: env('X402_FACILITATOR_API_KEY') ?? null,
    maxTimeoutSeconds: Number(env('X402_MAX_TIMEOUT_SECONDS') ?? 120),
    x402Version: 2,
  };
}

/** `"0.01"` with 6 decimals -> `"10000"`. String maths, so no float drift. */
export function toAtomic(amount: string, decimals: number): string {
  const [whole = '0', frac = ''] = amount.trim().split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return digits.length > 0 ? digits : '0';
}

/** Config problems that must fail the request rather than silently allow it. */
export function validateX402Config(config: X402Config): string[] {
  if (!config.enabled) return [];
  const problems: string[] = [];
  if (!config.payTo) problems.push('X402_PAY_TO is not set');
  if (!config.facilitatorUrl) problems.push('X402_FACILITATOR_URL is not set');
  if (!config.asset) {
    problems.push(`X402_ASSET is not set and no default USDC mint is known for ${config.network}`);
  }
  if (!/^\d+$/.test(config.amountAtomic) || config.amountAtomic === '0') {
    problems.push(`X402_PRICE_USDC (${config.priceUsdc}) did not resolve to a positive amount`);
  }
  return problems;
}
