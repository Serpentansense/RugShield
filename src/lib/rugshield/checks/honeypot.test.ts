import { describe, expect, it } from 'vitest';
import { checkHoneypot } from './honeypot';
import { checkFreezeAuthority, checkMintAuthority } from './authorities';
import { checkTokenInfo } from './token-info';
import {
  SOME_AUTHORITY,
  marketData,
  mint,
  mint2022,
  noRoute,
  roundTrip,
  upstreamError,
} from '../__fixtures__';

const clean = roundTrip({ returnedLamports: 100_000_000 });

function codes(out: ReturnType<typeof checkHoneypot>) {
  return out.reasons.map((r) => r.code);
}

function points(out: ReturnType<typeof checkHoneypot>, code: string) {
  return out.reasons.find((r) => r.code === code)?.points;
}

describe('checkHoneypot', () => {
  it('passes a clean legacy mint with no mechanisms', () => {
    const out = checkHoneypot(mint(), clean);
    expect(out.check.status).toBe('pass');
    expect(out.reasons).toEqual([]);
    expect(out.check.value).toMatchObject({ activeVectorCount: 0 });
  });

  it('explains that legacy mints only have the freeze authority lever', () => {
    const out = checkHoneypot(mint(), clean);
    expect(out.check.explanation).toMatch(/original SPL Token program/i);
  });

  it('lists freeze authority as a vector but leaves its points to its own check', () => {
    // Guards against double counting across checks.
    const snapshot = mint({ freezeAuthority: SOME_AUTHORITY });
    const honeypot = checkHoneypot(snapshot, clean);
    const freeze = checkFreezeAuthority(snapshot);

    expect(codes(honeypot)).not.toContain('FREEZE_AUTHORITY_ACTIVE');
    expect(freeze.reasons.map((r) => r.code)).toEqual(['FREEZE_AUTHORITY_ACTIVE']);

    const vectors = (honeypot.check.value as { vectors: { name: string; active: boolean; scoredBy: string | null }[] }).vectors;
    const entry = vectors.find((v) => v.name === 'Freeze authority');
    expect(entry).toMatchObject({ active: true, scoredBy: 'freeze_authority' });
  });

  it('flags accounts that are created frozen', () => {
    const out = checkHoneypot(mint2022({ defaultAccountState: 'frozen' }), clean);
    expect(codes(out)).toContain('DEFAULT_ACCOUNT_STATE_FROZEN');
    expect(points(out, 'DEFAULT_ACCOUNT_STATE_FROZEN')).toBe(30);
    expect(out.check.status).toBe('fail');
  });

  it('does not flag a normal default account state', () => {
    const out = checkHoneypot(mint2022({ defaultAccountState: 'initialized' }), clean);
    expect(codes(out)).not.toContain('DEFAULT_ACCOUNT_STATE_FROZEN');
  });

  it('flags an attached transfer hook and admits it is not audited', () => {
    const out = checkHoneypot(
      mint2022({ transferHookProgramId: 'HookProgram1111111111111111111111111111111' }),
      clean,
    );
    expect(codes(out)).toContain('TRANSFER_HOOK_ACTIVE');
    expect(points(out, 'TRANSFER_HOOK_ACTIVE')).toBe(25);
    expect(out.reasons.find((r) => r.code === 'TRANSFER_HOOK_ACTIVE')?.message).toMatch(
      /does not audit/i,
    );
  });

  it('flags a permanent delegate', () => {
    const out = checkHoneypot(mint2022({ permanentDelegate: SOME_AUTHORITY }), clean);
    expect(codes(out)).toContain('PERMANENT_DELEGATE_SET');
    expect(points(out, 'PERMANENT_DELEGATE_SET')).toBe(20);
  });

  it('flags a mint that can be paused', () => {
    const out = checkHoneypot(
      mint2022({ pausable: { authority: SOME_AUTHORITY, paused: false } }),
      clean,
    );
    expect(codes(out)).toContain('PAUSABLE_ACTIVE');
    expect(points(out, 'PAUSABLE_ACTIVE')).toBe(20);
  });

  it('flags a mint that is already paused far more heavily', () => {
    const out = checkHoneypot(
      mint2022({ pausable: { authority: SOME_AUTHORITY, paused: true } }),
      clean,
    );
    expect(codes(out)).toContain('TRANSFERS_PAUSED');
    expect(points(out, 'TRANSFERS_PAUSED')).toBe(45);
    expect(codes(out)).not.toContain('PAUSABLE_ACTIVE');
  });

  describe('transfer fee grading', () => {
    function withFee(bps: number, configAuthority: string | null = null) {
      return mint2022({
        transferFee: {
          worstCaseBasisPoints: bps,
          newerBasisPoints: bps,
          newerEpoch: '500',
          olderBasisPoints: bps,
          olderEpoch: '499',
          maximumFee: '0',
          configAuthority,
          withdrawAuthority: null,
        },
      });
    }

    it('grades an extreme fee', () => {
      const out = checkHoneypot(withFee(5_000), clean);
      expect(codes(out)).toContain('TRANSFER_FEE_EXTREME');
      expect(points(out, 'TRANSFER_FEE_EXTREME')).toBe(30);
    });

    it('grades a high fee', () => {
      const out = checkHoneypot(withFee(1_500), clean);
      expect(codes(out)).toContain('TRANSFER_FEE_HIGH');
    });

    it('grades a moderate fee', () => {
      const out = checkHoneypot(withFee(400), clean);
      expect(codes(out)).toContain('TRANSFER_FEE_MODERATE');
    });

    it('grades a small fee', () => {
      const out = checkHoneypot(withFee(50), clean);
      expect(codes(out)).toContain('TRANSFER_FEE_PRESENT');
      expect(points(out, 'TRANSFER_FEE_PRESENT')).toBe(5);
    });

    it('notes when the fee rate is locked', () => {
      const out = checkHoneypot(withFee(100, null), clean);
      expect(out.reasons.find((r) => r.code === 'TRANSFER_FEE_PRESENT')?.message).toMatch(
        /rate is locked/i,
      );
    });

    it('flags a live fee authority even at zero percent today', () => {
      const out = checkHoneypot(withFee(0, SOME_AUTHORITY), clean);
      expect(codes(out)).toContain('TRANSFER_FEE_AUTHORITY_ACTIVE');
      expect(points(out, 'TRANSFER_FEE_AUTHORITY_ACTIVE')).toBe(8);
    });

    it('stays quiet at zero percent with the authority revoked', () => {
      const out = checkHoneypot(withFee(0, null), clean);
      expect(codes(out)).toEqual([]);
    });
  });

  it('flags a mint close authority lightly', () => {
    const out = checkHoneypot(mint2022({ mintCloseAuthority: SOME_AUTHORITY }), clean);
    expect(codes(out)).toContain('MINT_CLOSE_AUTHORITY_SET');
    expect(points(out, 'MINT_CLOSE_AUTHORITY_SET')).toBe(5);
  });

  it('surfaces a one-directional sell route without scoring it twice', () => {
    // The points belong to the sellability check; honeypot only reports it.
    const out = checkHoneypot(mint(), roundTrip({ sell: noRoute }));
    expect(out.check.status).toBe('fail');
    expect(out.check.value).toMatchObject({ sellRouteBlocked: true });
    expect(codes(out)).toEqual([]);
    expect(out.check.explanation).toMatch(/one-directional/i);
  });

  it('does not call routing blocked when the sell quote merely errored', () => {
    const out = checkHoneypot(mint(), roundTrip({ sell: upstreamError }));
    expect(out.check.value).toMatchObject({ sellRouteBlocked: false });
  });

  it('accumulates several mechanisms', () => {
    const out = checkHoneypot(
      mint2022({
        freezeAuthority: SOME_AUTHORITY,
        permanentDelegate: SOME_AUTHORITY,
        mintCloseAuthority: SOME_AUTHORITY,
      }),
      clean,
    );
    expect(out.check.value).toMatchObject({ activeVectorCount: 3 });
    expect(out.check.status).toBe('fail');
  });
});

describe('checkMintAuthority', () => {
  it('passes a revoked authority', () => {
    const out = checkMintAuthority(mint());
    expect(out.check.status).toBe('pass');
    expect(out.reasons).toEqual([]);
    expect(out.check.value).toMatchObject({ active: false });
  });

  it('warns on an active authority and says legitimate tokens keep it', () => {
    const out = checkMintAuthority(mint({ mintAuthority: SOME_AUTHORITY }));
    expect(out.check.status).toBe('warn');
    expect(out.reasons[0]).toMatchObject({
      code: 'MINT_AUTHORITY_ACTIVE',
      points: 15,
      severity: 'medium',
    });
    expect(out.check.explanation).toMatch(/Many legitimate tokens/i);
  });
});

describe('checkFreezeAuthority', () => {
  it('passes a revoked authority', () => {
    const out = checkFreezeAuthority(mint());
    expect(out.check.status).toBe('pass');
    expect(out.reasons).toEqual([]);
  });

  it('fails an active authority', () => {
    const out = checkFreezeAuthority(mint({ freezeAuthority: SOME_AUTHORITY }));
    expect(out.check.status).toBe('fail');
    expect(out.reasons[0]).toMatchObject({
      code: 'FREEZE_AUTHORITY_ACTIVE',
      points: 25,
      severity: 'high',
    });
  });
});

describe('checkTokenInfo', () => {
  it('is informational for a healthy mint', () => {
    const out = checkTokenInfo(mint(), marketData());
    expect(out.check.status).toBe('info');
    expect(out.reasons).toEqual([]);
  });

  it('fails an uninitialised mint', () => {
    const out = checkTokenInfo(mint({ isInitialized: false }), null);
    expect(out.check.status).toBe('fail');
    expect(out.reasons[0]).toMatchObject({ code: 'MINT_UNINITIALIZED', points: 40 });
  });

  it('carries market metadata through when available', () => {
    const out = checkTokenInfo(mint(), marketData({ symbol: 'TKN', priceUsd: 0.5 }));
    expect(out.check.value).toMatchObject({ symbol: 'TKN', priceUsd: 0.5 });
  });

  it('works without market data', () => {
    const out = checkTokenInfo(mint(), null);
    expect(out.check.value).toMatchObject({ symbol: null });
    expect(out.check.evidence.sources).toEqual(['solana-rpc:getAccountInfo']);
  });

  it('names the token program in the result', () => {
    expect(checkTokenInfo(mint(), null).check.result).toMatch(/SPL Token \(legacy\)/);
    expect(checkTokenInfo(mint2022(), null).check.result).toMatch(/Token-2022/);
  });
});
