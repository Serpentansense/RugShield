'use client';

/** Token input + scan action, with explicit loading and error states. */

import { useRef, useState } from 'react';
import type { RugShieldReport } from '@/lib/rugshield';
import { ResultCard } from './result-card';

/** BONK — a real, high-liquidity mainnet mint, used for the example button. */
const EXAMPLE_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

interface ApiError {
  error: string;
  message: string;
  detail?: string;
  problems?: string[];
}

type State =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'done'; report: RugShieldReport }
  | { phase: 'error'; error: ApiError };

export function ScanForm() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow earlier request overwriting a newer result.
  const requestId = useRef(0);

  async function scan(mint: string) {
    const trimmed = mint.trim();
    if (!trimmed) {
      setState({
        phase: 'error',
        error: { error: 'EMPTY_INPUT', message: 'Paste a Solana token mint address first.' },
      });
      inputRef.current?.focus();
      return;
    }

    const id = ++requestId.current;
    setState({ phase: 'scanning' });

    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
      });

      const body = await res.json().catch(() => null);
      if (id !== requestId.current) return;

      if (!res.ok) {
        setState({
          phase: 'error',
          error:
            body && typeof body === 'object' && 'message' in body
              ? (body as ApiError)
              : {
                  error: `HTTP_${res.status}`,
                  message: `The scan failed with HTTP ${res.status}.`,
                },
        });
        return;
      }

      setState({ phase: 'done', report: body as RugShieldReport });
    } catch (err) {
      if (id !== requestId.current) return;
      setState({
        phase: 'error',
        error: {
          error: 'NETWORK_ERROR',
          message:
            'Could not reach the RugShield API. Check your connection and try again.',
          detail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  const scanning = state.phase === 'scanning';

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void scan(token);
        }}
        className="rounded-2xl border border-edge bg-surface p-4 sm:p-5"
      >
        <label
          htmlFor="mint"
          className="block text-xs font-medium uppercase tracking-[0.18em] text-muted"
        >
          Solana token mint address
        </label>

        <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
          <input
            id="mint"
            ref={inputRef}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
            spellCheck={false}
            autoComplete="off"
            disabled={scanning}
            aria-describedby="mint-hint"
            aria-invalid={state.phase === 'error'}
            className="min-w-0 flex-1 rounded-xl border border-edge bg-background px-3.5 py-3 font-mono text-sm text-foreground placeholder:text-muted/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={scanning}
            className="shrink-0 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={scanning}
            onClick={() => {
              setToken(EXAMPLE_MINT);
              void scan(EXAMPLE_MINT);
            }}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-60"
          >
            Try an example token
          </button>
          <p id="mint-hint" className="text-xs text-muted">
            Reads live mainnet data. Nothing is signed and no wallet is needed.
          </p>
        </div>
      </form>

      {scanning && <ScanningState />}

      {state.phase === 'error' && (
        <div
          role="alert"
          className="rounded-2xl border border-risk-high/40 bg-risk-high/5 p-5"
        >
          <p className="text-sm font-semibold text-risk-high">Scan failed</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">
            {state.error.message}
          </p>
          {state.error.problems && (
            <ul className="mt-2 list-inside list-disc text-xs text-muted">
              {state.error.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-mono text-[11px] text-muted">
            {state.error.error}
            {state.error.detail ? ` · ${state.error.detail}` : ''}
          </p>
        </div>
      )}

      {state.phase === 'done' && <ResultCard report={state.report} />}
    </div>
  );
}

function ScanningState() {
  const steps = [
    'Reading the mint account',
    'Checking authorities and extensions',
    'Finding liquidity pools',
    'Quoting a buy/sell round trip',
  ];
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-edge bg-surface p-6"
    >
      <p className="text-sm font-medium text-foreground">Scanning on-chain data…</p>
      <ul className="mt-3 space-y-1.5">
        {steps.map((step) => (
          <li key={step} className="flex items-center gap-2 text-xs text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {step}
          </li>
        ))}
      </ul>
      <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
      </div>
    </div>
  );
}
