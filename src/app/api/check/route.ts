/**
 * POST /api/check
 *
 * The one public analysis endpoint. Thin by design: validate, run the shared
 * risk engine, persist for the track record, respond.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { RugShieldError, checkToken } from '@/lib/rugshield';
import { API_CONFIG, scanCache, scanRateLimiter } from '@/lib/api/config';
import { clientKey } from '@/lib/api/rate-limit';
import { appendScan, toScanRecord } from '@/lib/store/scans';
import { PAYMENT_RESPONSE_HEADER, runPaymentGate } from '@/lib/x402';

const BodySchema = z.object({
  token: z
    .string()
    .trim()
    .min(32, 'A Solana mint address is at least 32 characters.')
    .max(48, 'That is longer than any Solana mint address.'),
});

/** Maps engine errors onto HTTP status codes. */
const STATUS_BY_CODE: Record<RugShieldError['code'], number> = {
  INVALID_ADDRESS: 400,
  MINT_NOT_FOUND: 404,
  NOT_A_TOKEN_MINT: 422,
  RPC_UNAVAILABLE: 503,
};

export async function POST(request: NextRequest) {
  const getHeader = (name: string) => request.headers.get(name);

  // --- Rate limit ----------------------------------------------------------
  // First, because it is the cheapest check and it protects every stage after
  // it, including the upstream calls a scan would make.
  let rateHeaders: Record<string, string> = {};
  if (API_CONFIG.rateLimitEnabled) {
    const verdict = scanRateLimiter.check(clientKey(getHeader));
    rateHeaders = {
      'x-ratelimit-limit': String(verdict.limit),
      'x-ratelimit-remaining': String(verdict.remaining),
      'x-ratelimit-reset': String(Math.ceil(verdict.resetAt / 1000)),
    };

    if (!verdict.allowed) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: `Too many scans. Try again in ${verdict.retryAfterSec}s.`,
          limit: verdict.limit,
          windowMs: API_CONFIG.rateWindowMs,
        },
        {
          status: 429,
          headers: { ...rateHeaders, 'retry-after': String(verdict.retryAfterSec) },
        },
      );
    }
  }

  // --- x402 pay-per-call gate (no-op unless X402_ENABLED=true) -------------
  const gate = await runPaymentGate(getHeader, {
    url: new URL('/api/check', request.nextUrl.origin).toString(),
    description: 'Solana token security scan: risk score, risk level and evidence.',
    mimeType: 'application/json',
  });

  if (gate.kind === 'misconfigured') {
    return NextResponse.json(
      {
        error: 'PAYMENT_MISCONFIGURED',
        message:
          'This deployment has x402 payments enabled but is not fully configured, so requests cannot be served.',
        problems: gate.problems,
      },
      { status: 500, headers: rateHeaders },
    );
  }

  if (gate.kind === 'payment_required') {
    return NextResponse.json(gate.body, {
      status: 402,
      headers: { ...rateHeaders, 'cache-control': 'no-store' },
    });
  }

  const baseHeaders: Record<string, string> = {
    ...rateHeaders,
    ...(gate.kind === 'paid'
      ? { [PAYMENT_RESPONSE_HEADER]: gate.receiptHeader }
      : {}),
  };

  // --- Parse ---------------------------------------------------------------
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: 'INVALID_JSON',
        message: 'Request body must be JSON shaped like { "token": "<mint address>" }.',
      },
      { status: 400, headers: baseHeaders },
    );
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'INVALID_REQUEST',
        message: 'The "token" field must be a Solana mint address.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400, headers: baseHeaders },
    );
  }

  const token = parsed.data.token;

  // --- Cache ---------------------------------------------------------------
  // A hit is not re-persisted to the track record: the same scan appearing
  // repeatedly would inflate the history without adding information.
  const cached = scanCache.get(token);
  if (cached.hit) {
    return NextResponse.json(cached.value, {
      status: 200,
      headers: {
        ...baseHeaders,
        'x-cache': 'HIT',
        'x-cache-age-ms': String(cached.ageMs),
        'cache-control': 'no-store',
      },
    });
  }

  // --- Analyse -------------------------------------------------------------
  try {
    const report = await checkToken(token);

    scanCache.set(token, report);

    // Track record persistence must never break the response.
    await appendScan(toScanRecord(report, 'api'));

    return NextResponse.json(report, {
      status: 200,
      headers: { ...baseHeaders, 'x-cache': 'MISS', 'cache-control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof RugShieldError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          ...(err.detail ? { detail: err.detail } : {}),
          token,
        },
        { status: STATUS_BY_CODE[err.code], headers: baseHeaders },
      );
    }

    console.error('[rugshield] /api/check failed:', err);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'The scan could not be completed. Please try again.',
      },
      { status: 500, headers: baseHeaders },
    );
  }
}

/** Small self-describing GET so agents can discover the contract. */
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/check',
    request: { token: '<Solana mint address>' },
    response: {
      token: 'string',
      riskScore: '0-100 (higher means more risk signals)',
      riskLevel: 'low | medium | high',
      checks:
        'honeypot, sellability, liquidity, tokenInfo, mintAuthority, freezeAuthority, holderConcentration',
      reasons: '[{ code, severity, message, points, checkId }]',
      scoring: 'the full point breakdown behind riskScore',
      dataSources: 'per-upstream availability for this scan',
      disclaimer: 'string',
      timestamp: 'ISO-8601',
    },
    notes: [
      'A check with status "unavailable" was not run and must not be read as a pass.',
      'Scores are observable signals, not a safety guarantee.',
      `Results are cached for ${Math.round(API_CONFIG.cacheTtlMs / 1000)}s per mint; see the X-Cache header.`,
      API_CONFIG.rateLimitEnabled
        ? `Rate limited to ${API_CONFIG.rateLimit} requests per ${Math.round(API_CONFIG.rateWindowMs / 1000)}s per client.`
        : 'Rate limiting is disabled on this deployment.',
    ],
  });
}
