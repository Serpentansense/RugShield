# RugShield

Solana token security checks for AI trading agents.

Send a mint address, get back a risk score, a risk level, and the on-chain
evidence behind every signal. The same risk engine serves the web UI and the
HTTP API.

**RugShield reports observable signals. A low score is not a guarantee that a
token is safe, and a high score is not proof of fraud.** Every check ships the
raw data it used so you can judge it yourself.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # optional, works without it
npm run dev
```

Open http://localhost:3000, paste a mint address, hit **Scan**.

A dedicated `SOLANA_RPC_URL` is recommended but not required. On the public
endpoint everything works except the holder-distribution check, which reports
`unavailable` because that RPC method is rate limited there.

Scan without the browser:

```bash
npm run scan -- DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
npm run scan -- <mint> --json
```

## HTTP API

```bash
curl -s localhost:3000/api/check \
  -H 'content-type: application/json' \
  -d '{"token":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"}'
```

```jsonc
{
  "token": "...",
  "riskScore": 0,          // 0-100, higher = more risk signals
  "riskLevel": "low",      // low | medium | high
  "checks": {
    "honeypot": { "status": "pass", "result": "...", "value": {}, "explanation": "...", "evidence": {} },
    "sellability": {},
    "liquidity": {},
    "tokenInfo": {},
    "mintAuthority": {},
    "freezeAuthority": {},
    "holderConcentration": {}
  },
  "reasons": [             // every signal that added points
    { "code": "FREEZE_AUTHORITY_ACTIVE", "severity": "high", "points": 25, "message": "...", "checkId": "freeze_authority" }
  ],
  "scoring": {},           // full point breakdown, thresholds, coverage
  "dataSources": [],       // which upstreams answered for this scan
  "disclaimer": "...",
  "timestamp": "..."
}
```

`GET /api/check` returns a description of the contract.
`GET /api/track-record?limit=50` returns stored scans.

Error codes: `INVALID_ADDRESS` (400), `MINT_NOT_FOUND` (404),
`NOT_A_TOKEN_MINT` (422), `RPC_UNAVAILABLE` (503).

## What the checks actually do

| Check | Source | What it means |
| --- | --- | --- |
| `tokenInfo` | `getAccountInfo` | Program (SPL Token vs Token-2022), decimals, supply. Informational. |
| `mintAuthority` | `getAccountInfo` | Active authority can mint new supply and dilute holders. |
| `freezeAuthority` | `getAccountInfo` | Active authority can freeze your account, which blocks selling. |
| `honeypot` | `getAccountInfo` | Enumerates every transfer-control mechanism: default-frozen accounts, transfer hook, permanent delegate, pausable, transfer fee, mint close authority. |
| `sellability` | Jupiter quote API | Quotes SOL→token, then quotes selling exactly that amount back. Asymmetry between the legs is the classic honeypot pattern. |
| `liquidity` | DexScreener | Pool detection, USD depth, concentration across pools, pool age, turnover-vs-depth. |
| `holderConcentration` | `getTokenLargestAccounts` | **Reported, never scored.** These are token accounts, so AMM vaults appear next to real wallets and this MVP cannot tell them apart. |

Two rules the engine sticks to:

- A check that could not run returns `status: "unavailable"` and contributes
  zero points. `scoring.confidence` drops to `partial` and the response lists
  which checks were skipped. **An unavailable check is not a pass.**
- The sellability probe uses *quotes*, not executed swaps. It proves an
  aggregator can build a route right now. It does not prove a transaction
  would land, and the check text says so.

## Scoring

Additive risk points, capped at 100. No model, no hidden weights — the
response carries the full breakdown so you can recompute the number.

```
0-29   LOW
30-59  MEDIUM
60-100 HIGH
```

Sample weights: sell route missing while buys route `+55`, transfers paused
`+45`, no route at all `+40`, default account state frozen `+30`, no liquidity
pool `+30`, freeze authority `+25`, transfer hook `+25`, permanent delegate
`+20`, mint authority `+15`. Full table lives in
`src/lib/rugshield/checks/`.

Worth knowing: well-known tokens can score MEDIUM. USDC lands there because it
genuinely has an active mint *and* freeze authority. That is the honest answer
to "what can the issuer do to your position", not a bug.

## x402 pay-per-call

Off by default. When `X402_ENABLED=true`, `POST /api/check` answers HTTP 402
with x402 payment requirements, and serves the scan only after a facilitator
verifies and settles the `X-PAYMENT` header.

```
Agent → POST /api/check
      ← 402 + { x402Version, accepts: [{ scheme, network, asset, amount, payTo }] }
Agent → POST /api/check + X-PAYMENT
      → facilitator /verify → facilitator /settle
      ← 200 + scan result + X-PAYMENT-RESPONSE receipt
```

Isolated in `src/lib/x402/`. Protocol types come from the official
`@x402/core` package. RugShield never holds a private key — settlement is
delegated to the facilitator.

**What is implemented:** the full server side of the protocol — 402 response
with `PaymentRequirements`, `X-PAYMENT` decoding, facilitator `/verify` and
`/settle` calls, `X-PAYMENT-RESPONSE` receipt, and fail-closed behaviour when
enabled but misconfigured.

**What remains for mainnet:** point `X402_FACILITATOR_URL` at a live
Solana facilitator and run a real payment through it. Nothing in this repo has
been exercised against a funded wallet. Swapping in `@x402/next` +
`@x402/svm` is the supported path if you want the official middleware instead
of this thin gate.

## Track record

`/track-record` lists every scan this instance has run, newest first, with the
warnings it reported.

Storage is a JSON file (`data/scans.json`, gitignored), capped at 500 records,
with writes serialised in-process. Writes never block or fail a scan.

Two limits to be aware of: this needs a writable filesystem, so on read-only
serverless hosts the history stays empty; and the `outcome` column is only
populated when a later result is recorded for a token, which nothing does
automatically in this MVP.

## Project layout

```
src/lib/rugshield/   risk engine — no HTTP, no React, no framework
  sources/           solana rpc, dexscreener, jupiter
  checks/            one pure function per check
  scoring.ts         additive points → score → level
  engine.ts          orchestration
src/lib/x402/        payment gate, isolated and framework-agnostic
src/lib/store/       JSON scan history
src/app/api/         HTTP layer, thin
src/components/      UI
scripts/scan.ts      CLI
```

The engine is imported only through `src/lib/rugshield/index.ts`, so the API,
the CLI, and any future MCP server share one implementation.

## Not done yet

Being explicit rather than implying more than exists:

- **MCP server.** Not built. The "Built for AI agents" card marks it as such.
- **Tests.** Vitest is installed and the checks are written as pure functions
  for this purpose, but no tests exist yet.
- **x402 against a live facilitator.** Structure only, see above.
- `npm audit` reports high-severity advisories via `bigint-buffer`, a
  transitive dependency of `@solana/web3.js` v1 with no fix in that line. Not
  reachable in a meaningful way here (fixed 8-byte slices from on-chain data),
  but not silently ignored either.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 ·
`@solana/web3.js` + `@solana/spl-token` · `@x402/core` · Zod
