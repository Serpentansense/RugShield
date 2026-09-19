import type { Metadata } from 'next';
import { listScans, type ScanRecord } from '@/lib/store/scans';
import {
  RISK_LEVEL_STYLES,
  formatDateTime,
  shortenAddress,
} from '@/components/risk-ui';

export const metadata: Metadata = {
  title: 'Track record — RugShield',
  description: 'Every scan RugShield has run, with the score and warnings it reported.',
};

// Reads the scan store on every request, so new scans appear immediately.
export const dynamic = 'force-dynamic';

export default async function TrackRecordPage() {
  let scans: ScanRecord[] = [];
  let storeError: string | null = null;

  try {
    scans = await listScans({ limit: 100 });
  } catch (err) {
    storeError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Public track record</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Every scan this instance has run, newest first. Published so the scores can be
          judged against what actually happened, rather than taken on trust.
        </p>
      </header>

      {storeError && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-risk-high/40 bg-risk-high/5 p-4 text-sm text-risk-high"
        >
          Scan history could not be read: {storeError}
        </div>
      )}

      {!storeError && scans.length === 0 && (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-8 text-center">
          <p className="text-sm font-medium text-foreground">No scans recorded yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Run a scan on the home page and it will appear here.
          </p>
        </div>
      )}

      {scans.length > 0 && (
        <>
          <p className="mt-6 text-xs text-muted">
            Showing {scans.length} scan{scans.length === 1 ? '' : 's'}.
          </p>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-edge bg-surface">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                RugShield scan history: token, date, risk score, warnings and outcome
              </caption>
              <thead>
                <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Token
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Score
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Warnings detected
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <ScanRow key={scan.id} scan={scan} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            The outcome column is only filled in when a later result has been recorded for
            a token. Nothing populates it automatically in this MVP, so it reads
            &ldquo;not recorded&rdquo; for every row.
          </p>
        </>
      )}
    </div>
  );
}

function ScanRow({ scan }: { scan: ScanRecord }) {
  const level = RISK_LEVEL_STYLES[scan.riskLevel];

  return (
    <tr className="border-b border-edge/60 align-top last:border-0">
      <td className="px-4 py-3">
        <a
          href={`https://solscan.io/token/${scan.token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-accent hover:underline"
          title={scan.token}
        >
          {scan.symbol ? `${scan.symbol} · ` : ''}
          {shortenAddress(scan.token, 5)}
        </a>
        <span className="mt-0.5 block font-mono text-[10px] text-muted">
          via {scan.via}
          {scan.confidence === 'partial' ? ' · partial coverage' : ''}
        </span>
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
        {formatDateTime(scan.timestamp)}
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        <span className={`font-semibold tabular-nums ${level.text}`}>
          {scan.riskScore}
        </span>
        <span className="text-xs text-muted">/100</span>
        <span className={`mt-0.5 block text-[10px] font-semibold ${level.text}`}>
          {level.label}
        </span>
      </td>

      <td className="px-4 py-3">
        {scan.warnings.length === 0 ? (
          <span className="text-xs text-muted">none</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {scan.warnings.map((w) => (
              <li
                key={w.code}
                title={w.message}
                className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted"
              >
                {w.code}
              </li>
            ))}
          </ul>
        )}
      </td>

      <td className="px-4 py-3">
        {scan.outcome ? (
          <>
            <span className="text-xs text-foreground">{scan.outcome.label}</span>
            {scan.outcome.note && (
              <span className="mt-0.5 block text-[10px] text-muted">
                {scan.outcome.note}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted">not recorded</span>
        )}
      </td>
    </tr>
  );
}
