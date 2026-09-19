'use client';

/**
 * Results card. Visual priority is deliberate:
 *   1. RISK SCORE
 *   2. RISK LEVEL
 *   3. WHY  (the scored warnings)
 *   4. evidence, below, collapsed per check
 */

import { useState } from 'react';
import type { CheckResult, RugShieldReport } from '@/lib/rugshield';
import {
  CHECK_ORDER,
  CHECK_STATUS_STYLES,
  RISK_LEVEL_STYLES,
  SEVERITY_STYLES,
  formatDateTime,
  shortenAddress,
} from './risk-ui';

export function ResultCard({ report }: { report: RugShieldReport }) {
  const level = RISK_LEVEL_STYLES[report.riskLevel];
  const orderedChecks = CHECK_ORDER.map(
    (key) => [key, report.checks[key]] as const,
  ).filter(([, check]) => Boolean(check));

  return (
    <section aria-label="Scan result" className="space-y-4">
      {/* ---------- SCORE + LEVEL ---------- */}
      <div
        className={`rounded-2xl border border-edge bg-surface p-6 ring-1 ${level.ring} sm:p-8`}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Risk score
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-6xl font-bold tabular-nums ${level.text}`}>
                {report.riskScore}
              </span>
              <span className="text-xl text-muted">/ 100</span>
            </div>
            <div
              className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold tracking-wide ${level.bg} ${level.text}`}
            >
              <span aria-hidden="true">●</span>
              {level.label} RISK
            </div>
          </div>

          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
            <dt className="text-muted">Token</dt>
            <dd className="font-mono text-xs" title={report.token}>
              {shortenAddress(report.token)}
            </dd>
            <dt className="text-muted">Signals</dt>
            <dd className="tabular-nums">{report.reasons.length}</dd>
            <dt className="text-muted">Coverage</dt>
            <dd>
              {report.scoring.confidence === 'complete' ? (
                'all checks ran'
              ) : (
                <span className="text-risk-medium">
                  {report.scoring.unavailableChecks.length} check(s) unavailable
                </span>
              )}
            </dd>
            <dt className="text-muted">Scanned</dt>
            <dd className="text-xs">{formatDateTime(report.timestamp)}</dd>
          </dl>
        </div>

        {/* Score bar */}
        <div className="mt-6">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
            role="img"
            aria-label={`Risk score ${report.riskScore} out of 100, level ${level.label}`}
          >
            <div
              className={`h-full rounded-full ${level.bar}`}
              style={{ width: `${Math.max(report.riskScore, 2)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted">
            <span>0 · low</span>
            <span>{report.scoring.thresholds.medium} · medium</span>
            <span>{report.scoring.thresholds.high} · high</span>
            <span>100</span>
          </div>
        </div>

        {report.scoring.confidence === 'partial' && (
          <p className="mt-4 rounded-lg border border-risk-medium/30 bg-risk-medium/5 p-3 text-xs leading-relaxed text-risk-medium">
            Partial coverage: {report.scoring.unavailableChecks.join(', ')} could not be
            run, so those areas contributed no points. An unavailable check is not a pass.
          </p>
        )}
      </div>

      {/* ---------- WHY ---------- */}
      <div className="rounded-2xl border border-edge bg-surface p-6">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Why
        </h2>
        {report.reasons.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-foreground">
            No risk signals were found by the checks that ran. That is the absence of the
            specific problems RugShield looks for, not a verdict that the token is safe.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {report.reasons.map((reason) => (
              <li
                key={reason.code}
                className="flex gap-3 border-l-2 border-edge pl-3 first:border-l-2"
              >
                <span
                  className={`mt-0.5 shrink-0 font-mono text-xs font-semibold tabular-nums ${SEVERITY_STYLES[reason.severity]}`}
                  title={`${reason.points} risk points`}
                >
                  +{reason.points}
                </span>
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed text-foreground">
                    {reason.message}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {reason.code} · {reason.severity} · from {reason.checkId}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 border-t border-edge pt-3 text-[11px] leading-relaxed text-muted">
          Score = sum of the points above, capped at 100. Raw total{' '}
          {report.scoring.rawPoints}. Model: {report.scoring.model}.
        </p>
      </div>

      {/* ---------- EVIDENCE ---------- */}
      <div className="rounded-2xl border border-edge bg-surface p-6">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Evidence
        </h2>
        <p className="mt-1 text-xs text-muted">
          Every check, what it concluded, and the raw data it used.
        </p>
        <ul className="mt-4 space-y-2">
          {orderedChecks.map(([key, check]) => (
            <CheckRow key={key} check={check} />
          ))}
        </ul>
      </div>

      {/* ---------- SOURCES ---------- */}
      <div className="rounded-2xl border border-edge bg-surface p-6">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Data sources for this scan
        </h2>
        <ul className="mt-3 space-y-1.5 text-xs">
          {report.dataSources.map((source) => (
            <li key={source.name} className="flex items-start gap-2">
              <span
                className={source.ok ? 'text-risk-low' : 'text-risk-high'}
                aria-hidden="true"
              >
                {source.ok ? '✓' : '✕'}
              </span>
              <span className="font-mono text-muted">
                {source.name}
                {source.detail ? ` — ${source.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-edge pt-3 text-[11px] leading-relaxed text-muted">
          {report.disclaimer}
        </p>
      </div>
    </section>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  const [open, setOpen] = useState(false);
  const status = CHECK_STATUS_STYLES[check.status];

  return (
    <li className="overflow-hidden rounded-xl border border-edge bg-surface-raised/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-3.5 text-left transition-colors hover:bg-surface-raised"
      >
        <span
          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ${status.className}`}
        >
          {status.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{check.label}</span>
          <span className="mt-0.5 block text-sm text-muted">{check.result}</span>
        </span>
        <span
          className="mt-1 shrink-0 text-xs text-muted transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-edge px-3.5 py-3">
          <p className="text-sm leading-relaxed text-foreground/90">
            {check.explanation}
          </p>

          <p className="mt-3 font-mono text-[11px] text-muted">
            sources: {check.evidence.sources.join(', ') || 'none'}
          </p>

          <details className="mt-2 group">
            <summary className="cursor-pointer text-xs text-accent hover:underline">
              Raw data used
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(check.evidence.data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </li>
  );
}
