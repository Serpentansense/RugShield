import { describe, expect, it } from 'vitest';
import { MAX_SCORE, RISK_THRESHOLDS, riskLevelForScore, scoreToken } from './scoring';
import { check, checksMap } from './__fixtures__';
import type { Reason } from './types';

function reason(overrides: Partial<Reason> = {}): Reason {
  return {
    code: 'SOME_CODE',
    severity: 'medium',
    message: 'something',
    points: 10,
    checkId: 'liquidity',
    ...overrides,
  };
}

describe('riskLevelForScore', () => {
  it('maps the documented bands', () => {
    expect(riskLevelForScore(0)).toBe('low');
    expect(riskLevelForScore(RISK_THRESHOLDS.medium - 1)).toBe('low');
    expect(riskLevelForScore(RISK_THRESHOLDS.medium)).toBe('medium');
    expect(riskLevelForScore(RISK_THRESHOLDS.high - 1)).toBe('medium');
    expect(riskLevelForScore(RISK_THRESHOLDS.high)).toBe('high');
    expect(riskLevelForScore(MAX_SCORE)).toBe('high');
  });
});

describe('scoreToken', () => {
  it('scores zero with no signals', () => {
    const out = scoreToken({ reasons: [], checks: checksMap() });
    expect(out.riskScore).toBe(0);
    expect(out.riskLevel).toBe('low');
    expect(out.scoring.rawPoints).toBe(0);
    expect(out.scoring.breakdown).toEqual([]);
  });

  it('sums points additively', () => {
    const out = scoreToken({
      reasons: [
        reason({ code: 'A', points: 25 }),
        reason({ code: 'B', points: 15 }),
        reason({ code: 'C', points: 10 }),
      ],
      checks: checksMap(),
    });
    expect(out.riskScore).toBe(50);
    expect(out.scoring.rawPoints).toBe(50);
    expect(out.riskLevel).toBe('medium');
  });

  it('clamps the score at 100 but keeps rawPoints honest', () => {
    const out = scoreToken({
      reasons: [
        reason({ code: 'A', points: 55 }),
        reason({ code: 'B', points: 45 }),
        reason({ code: 'C', points: 30 }),
      ],
      checks: checksMap(),
    });
    expect(out.riskScore).toBe(100);
    expect(out.scoring.rawPoints).toBe(130);
    expect(out.riskLevel).toBe('high');
  });

  it('never returns a negative score', () => {
    const out = scoreToken({
      reasons: [reason({ points: -50 })],
      checks: checksMap(),
    });
    expect(out.riskScore).toBe(0);
  });

  it('sorts reasons by severity, then by points, so reasons[0] is the headline', () => {
    const out = scoreToken({
      reasons: [
        reason({ code: 'LOW_ONE', severity: 'low', points: 8 }),
        reason({ code: 'HIGH_SMALL', severity: 'high', points: 20 }),
        reason({ code: 'MED', severity: 'medium', points: 15 }),
        reason({ code: 'HIGH_BIG', severity: 'high', points: 55 }),
      ],
      checks: checksMap(),
    });
    expect(out.reasons.map((r) => r.code)).toEqual([
      'HIGH_BIG',
      'HIGH_SMALL',
      'MED',
      'LOW_ONE',
    ]);
  });

  it('mirrors the sorted reasons in the breakdown so the score can be recomputed', () => {
    const out = scoreToken({
      reasons: [reason({ code: 'A', points: 25 }), reason({ code: 'B', points: 5 })],
      checks: checksMap(),
    });
    const sum = out.scoring.breakdown.reduce((acc, b) => acc + b.points, 0);
    expect(sum).toBe(out.scoring.rawPoints);
    expect(out.scoring.breakdown).toHaveLength(2);
  });

  describe('coverage reporting', () => {
    it('is complete when every scoring check ran', () => {
      const out = scoreToken({ reasons: [], checks: checksMap() });
      expect(out.scoring.confidence).toBe('complete');
      expect(out.scoring.unavailableChecks).toEqual([]);
      expect(out.scoring.unavailableScoredChecks).toEqual([]);
    });

    it('stays complete when only a non-scoring check is unavailable', () => {
      // Regression guard: holder concentration is permanently unavailable on
      // public RPCs and never scores, so it must not mark every scan partial.
      const out = scoreToken({
        reasons: [],
        checks: checksMap({
          holderConcentration: check({
            id: 'holder_concentration',
            scored: false,
            status: 'unavailable',
          }),
        }),
      });
      expect(out.scoring.confidence).toBe('complete');
      expect(out.scoring.unavailableChecks).toEqual(['holder_concentration']);
      expect(out.scoring.unavailableScoredChecks).toEqual([]);
    });

    it('becomes partial when a scoring check is unavailable', () => {
      const out = scoreToken({
        reasons: [],
        checks: checksMap({
          liquidity: check({ id: 'liquidity', status: 'unavailable' }),
        }),
      });
      expect(out.scoring.confidence).toBe('partial');
      expect(out.scoring.unavailableScoredChecks).toEqual(['liquidity']);
    });

    it('lists every unavailable check, scoring or not', () => {
      const out = scoreToken({
        reasons: [],
        checks: checksMap({
          liquidity: check({ id: 'liquidity', status: 'unavailable' }),
          sellability: check({ id: 'sellability', status: 'unavailable' }),
          holderConcentration: check({
            id: 'holder_concentration',
            scored: false,
            status: 'unavailable',
          }),
        }),
      });
      expect(out.scoring.unavailableChecks).toHaveLength(3);
      expect(out.scoring.unavailableScoredChecks).toEqual(['sellability', 'liquidity']);
      expect(out.scoring.confidence).toBe('partial');
    });
  });

  it('reports the thresholds it used', () => {
    const out = scoreToken({ reasons: [], checks: checksMap() });
    expect(out.scoring.thresholds).toEqual({ medium: 30, high: 60 });
    expect(out.scoring.maxScore).toBe(100);
    expect(out.scoring.model).toBe('additive-risk-points');
  });
});
