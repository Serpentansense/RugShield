/** "Built for AI agents" — the three integration surfaces: API, MCP, x402. */

interface Surface {
  tag: string;
  title: string;
  body: string;
  code: string;
  /** `live` ships in this build; `planned` is not implemented yet. */
  state: 'live' | 'planned';
}

const SURFACES: Surface[] = [
  {
    tag: 'HTTP API',
    title: 'POST /api/check',
    body: 'One call returns the score, level, every check and the raw evidence. Same engine the web UI uses.',
    state: 'live',
    code: `curl -s localhost:3000/api/check \\
  -H 'content-type: application/json' \\
  -d '{"token":"<mint>"}'`,
  },
  {
    tag: 'x402',
    title: 'Pay per call in USDC',
    body: 'The API answers 402 with x402 payment requirements, then verifies and settles through a facilitator before serving the scan. Off by default.',
    state: 'live',
    code: `X402_ENABLED=true
X402_NETWORK=solana:devnet
X402_PAY_TO=<your address>
X402_PRICE_USDC=0.01
X402_FACILITATOR_URL=<facilitator>`,
  },
  {
    tag: 'MCP',
    title: 'rugshield_check_token',
    body: 'A stdio MCP server exposing the same analysis as a tool. Not built yet — the risk engine is already decoupled so it can be added without touching the API.',
    state: 'planned',
    code: `// planned surface
server.registerTool('rugshield_check_token', {
  inputSchema: { token: z.string() },
}, ({ token }) => checkToken(token));`,
  },
];

export function BuiltForAgents() {
  return (
    <section aria-labelledby="agents-heading" className="space-y-4">
      <div>
        <h2 id="agents-heading" className="text-lg font-semibold tracking-tight">
          Built for AI agents
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          An agent should be able to check a token before it buys, without a browser.
          Three ways in, one risk engine behind all of them.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {SURFACES.map((s) => (
          <div
            key={s.tag}
            className={`flex flex-col rounded-2xl border border-edge bg-surface p-5 ${
              s.state === 'planned' ? 'opacity-70' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
                {s.tag}
              </span>
              {s.state === 'planned' && (
                <span className="rounded-full bg-muted/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">
                  not built yet
                </span>
              )}
            </div>
            <h3 className="mt-3 font-mono text-sm font-semibold text-foreground">
              {s.title}
            </h3>
            <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted">{s.body}</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-background p-3 font-mono text-[10px] leading-relaxed text-muted">
              {s.code}
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
