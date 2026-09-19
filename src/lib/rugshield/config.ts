/**
 * All tunable inputs come from environment variables. No keys or endpoints are
 * hardcoded beyond public, keyless defaults.
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function num(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface RugShieldConfig {
  /** Solana JSON-RPC endpoint. The public default is heavily rate limited. */
  rpcUrl: string;
  /** True when the operator supplied their own RPC (affects optional checks). */
  usingDefaultRpc: boolean;
  dexscreenerBaseUrl: string;
  jupiterBaseUrl: string;
  /** Per-upstream-request timeout. */
  timeoutMs: number;
  /** Notional size in SOL lamports used for the buy/sell round-trip quote. */
  probeLamports: number;
}

export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

export function getConfig(): RugShieldConfig {
  const rpcUrl = env('SOLANA_RPC_URL') ?? DEFAULT_RPC_URL;
  return {
    rpcUrl,
    usingDefaultRpc: rpcUrl === DEFAULT_RPC_URL,
    dexscreenerBaseUrl:
      env('RUGSHIELD_DEXSCREENER_BASE_URL') ?? 'https://api.dexscreener.com',
    jupiterBaseUrl: env('RUGSHIELD_JUPITER_BASE_URL') ?? 'https://lite-api.jup.ag',
    timeoutMs: num('RUGSHIELD_TIMEOUT_MS', 12_000),
    // 0.1 SOL. Big enough to route, small enough not to distort price impact.
    probeLamports: num('RUGSHIELD_PROBE_LAMPORTS', 100_000_000),
  };
}

/** Wrapped SOL, the quote asset for the sellability round trip. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** The all-zero address, used on-chain to mean "no program / unset". */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
