import { describe, expect, it } from 'vitest';
import { checkHolderConcentration } from './holders';
import { mint } from '../__fixtures__';

describe('checkHolderConcentration', () => {
  it('reports unavailable when the RPC rejects the call', () => {
    // This is the only path that runs on a public RPC, which rate limits
    // getTokenLargestAccounts, so the success path below is otherwise untested.
    const out = checkHolderConcentration(mint(), {
      ok: false,
      error: '429 Too Many Requests',
    });
    expect(out.check.status).toBe('unavailable');
    expect(out.check.scored).toBe(false);
    expect(out.check.explanation).toMatch(/SOLANA_RPC_URL/);
    expect(out.reasons).toEqual([]);
  });

  it('computes shares against supply on the success path', () => {
    const out = checkHolderConcentration(mint({ supply: 1_000 }), {
      ok: true,
      accounts: [
        { address: 'vault1', amount: '40000000', uiAmount: 400 },
        { address: 'whale1', amount: '25000000', uiAmount: 250 },
        { address: 'holder1', amount: '5000000', uiAmount: 50 },
      ],
    });

    expect(out.check.status).toBe('info');
    expect(out.check.value).toMatchObject({
      scored: false,
      largestSharePct: 40,
      top10SharePct: 70,
      accountsReturned: 3,
    });
  });

  it('never contributes points, however concentrated the holdings are', () => {
    const out = checkHolderConcentration(mint({ supply: 1_000 }), {
      ok: true,
      accounts: [{ address: 'whale', amount: '99000000', uiAmount: 990 }],
    });
    expect(out.reasons).toEqual([]);
    expect(out.check.scored).toBe(false);
  });

  it('states the pool-vault caveat rather than implying a verdict', () => {
    const out = checkHolderConcentration(mint({ supply: 100 }), {
      ok: true,
      accounts: [{ address: 'vault', amount: '9000000', uiAmount: 90 }],
    });
    expect(out.check.result).toMatch(/pool vaults included/i);
    expect(out.check.explanation).toMatch(/cannot separate the two/i);
    expect(out.check.evidence.data).toMatchObject({
      caveat: expect.stringContaining('AMM pool vaults'),
    });
  });

  it('tolerates a zero supply without dividing by zero', () => {
    const out = checkHolderConcentration(mint({ supply: 0 }), {
      ok: true,
      accounts: [{ address: 'a', amount: '0', uiAmount: 0 }],
    });
    expect(out.check.value).toMatchObject({ largestSharePct: null, top10SharePct: null });
  });

  it('caps the reported accounts at ten', () => {
    const accounts = Array.from({ length: 20 }, (_, i) => ({
      address: `acct${i}`,
      amount: '1000000',
      uiAmount: 10,
    }));
    const out = checkHolderConcentration(mint({ supply: 1_000 }), { ok: true, accounts });
    const data = out.check.evidence.data as Record<string, unknown>;
    expect((data.accounts as unknown[]).length).toBe(10);
  });
});
