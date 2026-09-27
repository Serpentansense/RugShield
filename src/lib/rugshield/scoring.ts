/**
 * Scoring.
 *
 * Deliberately boring and auditable: every risk signal carries a fixed point
 * value, points are summed, and the total is clamped to 100. There is no
 * hidden weighting and no model. `scoring.breakdown` in the response lists the
 * exact contribution of every signal so a caller can recompute the number.
 *
 * Higher score = more risk signals found. The score is NOT a probability and
 * NOT a safety guarantee.
 */

import type {
  CheckResult,
  ChecksMap,
  Reason,
  RiskLevel,
  Scoring,
} from './types';

/** Score at or above `medium` is MEDIUM; at or above `high` is HIGH. */
export const RISK_THRESHOLDS = { medium: 30, high: 60 } as const;

export const MAX_SCORE = 100;

export function riskLevelForScore(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export interface ScoreInput {
  reasons: Reason[];
  checks: ChecksMap;
}

export interface ScoreOutput {
  riskScore: number;
  riskLevel: RiskLevel;
  /** Sorted most severe first, so `reasons[0]` is the headline warning. */
  reasons: Reason[];
  scoring: Scoring;
}

const SEVERITY_RANK: Record<Reason['severity'], number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export function scoreToken({ reasons, checks }: ScoreInput): ScoreOutput {
  const rawPoints = reasons.reduce((sum, r) => sum + r.points, 0);
  const riskScore = Math.min(MAX_SCORE, Math.max(0, rawPoints));

  const sorted = [...reasons].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return bySeverity !== 0 ? bySeverity : b.points - a.points;
  });

  const unavailable = (Object.values(checks) as CheckResult[]).filter(
    (c) => c.status === 'unavailable',
  );
  const unavailableChecks = unavailable.map((c) => c.id);
  // Only checks that can add points affect how much ground the score covers.
  // `holder_concentration`, for example, is reported but never scored, and it
  // is permanently unavailable on public RPCs — counting it would mark every
  // single scan as `partial` and drain the signal of meaning.
  const unavailableScoredChecks = unavailable.filter((c) => c.scored).map((c) => c.id);

  return {
    riskScore,
    riskLevel: riskLevelForScore(riskScore),
    reasons: sorted,
    scoring: {
      model: 'additive-risk-points',
      maxScore: MAX_SCORE,
      thresholds: { ...RISK_THRESHOLDS },
      breakdown: sorted.map((r) => ({
        code: r.code,
        points: r.points,
        checkId: r.checkId,
      })),
      rawPoints,
      unavailableChecks,
      unavailableScoredChecks,
      confidence: unavailableScoredChecks.length === 0 ? 'complete' : 'partial',
    },
  };
}
