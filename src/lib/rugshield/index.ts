/**
 * Public surface of the RugShield risk engine.
 *
 * The HTTP API, the MCP server and the CLI script all import from here and
 * nowhere deeper, so the engine stays swappable.
 */

export { checkToken, type CheckTokenOptions } from './engine';
export { getConfig, DEFAULT_RPC_URL, WSOL_MINT, type RugShieldConfig } from './config';
export {
  MAX_SCORE,
  RISK_THRESHOLDS,
  riskLevelForScore,
  scoreToken,
  type ScoreInput,
  type ScoreOutput,
} from './scoring';
export { isValidMintAddress } from './sources/solana';
export {
  DISCLAIMER,
  RugShieldError,
  type CheckEvidence,
  type CheckKey,
  type CheckResult,
  type CheckStatus,
  type ChecksMap,
  type Reason,
  type RiskLevel,
  type RugShieldReport,
  type Scoring,
  type Severity,
} from './types';
