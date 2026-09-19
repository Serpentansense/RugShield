/**
 * RugShield core types.
 *
 * This module is intentionally free of Next.js / React / HTTP concerns so the
 * same engine can be consumed by the HTTP API, the MCP server, and scripts.
 */

/**
 * Outcome of a single check.
 *
 * - `pass`        - the check ran and found nothing concerning
 * - `warn`        - the check ran and found something worth flagging
 * - `fail`        - the check ran and found a serious problem
 * - `info`        - data was retrieved but deliberately not scored, because the
 *                   MVP cannot interpret it reliably enough to draw a verdict
 * - `unavailable` - the check could NOT be run (missing data, upstream error,
 *                   rate limit, or not technically feasible yet). Never treat
 *                   `unavailable` as a pass.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'unavailable';

export type RiskLevel = 'low' | 'medium' | 'high';

export type Severity = 'info' | 'low' | 'medium' | 'high';

/** Raw data a check based its conclusion on, so a caller can audit the result. */
export interface CheckEvidence {
  /** Where the data came from, e.g. `solana-rpc:getAccountInfo`. */
  sources: string[];
  /** The actual values used. Kept JSON-serialisable. */
  data: Record<string, unknown>;
}

export interface CheckResult {
  /** Stable machine id, e.g. `freeze_authority`. */
  id: string;
  /** Human label for the UI. */
  label: string;
  status: CheckStatus;
  /** Short, plain-language summary of what was found. */
  result: string;
  /** Structured value behind `result`, shape depends on the check. */
  value: Record<string, unknown> | null;
  /** Why this matters / how to read the result. */
  explanation: string;
  evidence: CheckEvidence;
}

/** A scored risk signal. Every point added to the score has one of these. */
export interface Reason {
  /** Stable machine code, e.g. `FREEZE_AUTHORITY_ACTIVE`. */
  code: string;
  severity: Severity;
  /** Human-readable warning. */
  message: string;
  /** Points this signal contributed to `riskScore`. */
  points: number;
  /** Which check produced it. */
  checkId: string;
}

export type CheckKey =
  | 'honeypot'
  | 'sellability'
  | 'liquidity'
  | 'tokenInfo'
  | 'mintAuthority'
  | 'freezeAuthority'
  | 'holderConcentration';

export type ChecksMap = Record<CheckKey, CheckResult>;

export interface ScoringBreakdownEntry {
  code: string;
  points: number;
  checkId: string;
}

export interface Scoring {
  /** Points are additive; higher means riskier. */
  model: 'additive-risk-points';
  /** Score is clamped to this ceiling. */
  maxScore: 100;
  /** Score thresholds used to derive `riskLevel`. */
  thresholds: { medium: number; high: number };
  /** Every signal that contributed points. */
  breakdown: ScoringBreakdownEntry[];
  /** Sum of points before clamping. */
  rawPoints: number;
  /** Checks that could not be run, so they contributed no points. */
  unavailableChecks: string[];
  /**
   * `complete` when every check ran, `partial` when one or more checks were
   * unavailable and the score therefore covers less ground than usual.
   */
  confidence: 'complete' | 'partial';
}

export interface RugShieldReport {
  /** The mint address that was analysed. */
  token: string;
  /** 0-100. Higher means more risk signals were found. */
  riskScore: number;
  riskLevel: RiskLevel;
  checks: ChecksMap;
  reasons: Reason[];
  scoring: Scoring;
  /** Upstream services that answered for this scan. */
  dataSources: { name: string; ok: boolean; detail?: string }[];
  /** Always returned. RugShield is a signal, not a verdict. */
  disclaimer: string;
  /** ISO-8601 UTC. */
  timestamp: string;
  elapsedMs: number;
}

/** Thrown for problems that should not produce a score at all. */
export class RugShieldError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_ADDRESS'
      | 'MINT_NOT_FOUND'
      | 'NOT_A_TOKEN_MINT'
      | 'RPC_UNAVAILABLE',
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'RugShieldError';
  }
}

export const DISCLAIMER =
  'RugShield reports observable on-chain and market signals only. A low score is not a guarantee that a token is safe, and a high score is not proof of fraud. Conditions can change at any time, including immediately after this scan. Always review the evidence yourself before trading.';
