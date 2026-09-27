/**
 * Honeypot check: enumerate every on-chain mechanism that could stop a holder
 * from selling, or take their tokens.
 *
 * Scoring ownership: this check scores the Token-2022 transfer-control
 * extensions plus the mint close authority. Freeze authority is listed here too
 * because it is a genuine honeypot vector, but its points are owned by the
 * `freeze_authority` check so nothing is counted twice.
 */

import type { MintSnapshot } from '../sources/solana';
import type { RoundTrip } from '../sources/jupiter';
import type { CheckResult, Reason, Severity } from '../types';
import type { CheckOutput } from './authorities';

export interface HoneypotVector {
  /** Mechanism name. */
  name: string;
  active: boolean;
  /** What it lets the holder of the key do. */
  impact: string;
  /** The on-chain value observed. */
  detail: string | null;
  /**
   * Which check owns the score for this vector, so callers can see that
   * nothing is double counted.
   */
  scoredBy: 'honeypot' | 'freeze_authority' | 'sellability' | null;
}

const SOURCE = 'solana-rpc:getAccountInfo';

export function checkHoneypot(mint: MintSnapshot, trip: RoundTrip): CheckOutput {
  const reasons: Reason[] = [];
  const vectors: HoneypotVector[] = [];

  // --- Freeze authority (listed here, scored by its own check) -------------
  vectors.push({
    name: 'Freeze authority',
    active: mint.freezeAuthority !== null,
    impact: 'Can freeze a holder account so it cannot transfer or sell.',
    detail: mint.freezeAuthority,
    scoredBy: mint.freezeAuthority !== null ? 'freeze_authority' : null,
  });

  // --- Token-2022 default account state -----------------------------------
  const defaultFrozen = mint.defaultAccountState === 'frozen';
  vectors.push({
    name: 'Default account state frozen',
    active: defaultFrozen,
    impact:
      'New token accounts are created frozen, so buyers cannot transfer until an authority thaws them individually.',
    detail: mint.defaultAccountState,
    scoredBy: defaultFrozen ? 'honeypot' : null,
  });
  if (defaultFrozen) {
    reasons.push({
      code: 'DEFAULT_ACCOUNT_STATE_FROZEN',
      severity: 'high',
      message:
        'New token accounts for this mint start frozen. Buyers cannot move their tokens unless an authority thaws each account.',
      points: 30,
      checkId: 'honeypot',
    });
  }

  // --- Token-2022 transfer hook -------------------------------------------
  const hook = mint.transferHookProgramId;
  vectors.push({
    name: 'Transfer hook',
    active: hook !== null,
    impact:
      'Runs third-party program code on every transfer and can reject transfers based on arbitrary logic.',
    detail: hook,
    scoredBy: hook !== null ? 'honeypot' : null,
  });
  if (hook) {
    reasons.push({
      code: 'TRANSFER_HOOK_ACTIVE',
      severity: 'high',
      message: `A transfer hook program is attached (${hook}). It executes on every transfer and can reject sells by arbitrary rules. RugShield does not audit the hook program's code.`,
      points: 25,
      checkId: 'honeypot',
    });
  }

  // --- Token-2022 permanent delegate --------------------------------------
  const delegate = mint.permanentDelegate;
  vectors.push({
    name: 'Permanent delegate',
    active: delegate !== null,
    impact: 'Can transfer or burn tokens out of any holder account without consent.',
    detail: delegate,
    scoredBy: delegate !== null ? 'honeypot' : null,
  });
  if (delegate) {
    reasons.push({
      code: 'PERMANENT_DELEGATE_SET',
      severity: 'high',
      message: `A permanent delegate is set (${delegate}). That key can move or burn tokens from any holder account without permission.`,
      points: 20,
      checkId: 'honeypot',
    });
  }

  // --- Token-2022 pausable ------------------------------------------------
  const pausable = mint.pausable;
  vectors.push({
    name: 'Pausable',
    active: pausable !== null,
    impact: 'Can halt all transfers of this mint globally.',
    detail: pausable
      ? `authority=${pausable.authority ?? 'none'}, paused=${pausable.paused}`
      : null,
    scoredBy: pausable !== null ? 'honeypot' : null,
  });
  if (pausable) {
    if (pausable.paused) {
      reasons.push({
        code: 'TRANSFERS_PAUSED',
        severity: 'high',
        message: 'Transfers for this mint are currently paused. Nobody can move or sell this token right now.',
        points: 45,
        checkId: 'honeypot',
      });
    } else if (pausable.authority) {
      reasons.push({
        code: 'PAUSABLE_ACTIVE',
        severity: 'high',
        message: `This mint can be paused by ${pausable.authority}, which would halt all transfers including sells.`,
        points: 20,
        checkId: 'honeypot',
      });
    }
  }

  // --- Token-2022 transfer fee (sell tax) ---------------------------------
  const fee = mint.transferFee;
  const feeBps = fee?.worstCaseBasisPoints ?? 0;
  vectors.push({
    name: 'Transfer fee',
    active: fee !== null && feeBps > 0,
    impact: 'Takes a cut of every transfer, including sells. Acts as a built-in tax.',
    detail: fee ? `${(feeBps / 100).toFixed(2)}% (max ${feeBps} bps of ${10_000})` : null,
    scoredBy: fee !== null && feeBps > 0 ? 'honeypot' : null,
  });
  if (fee && feeBps > 0) {
    const { code, severity, points } = gradeFee(feeBps);
    reasons.push({
      code,
      severity,
      message: `A Token-2022 transfer fee of ${(feeBps / 100).toFixed(2)}% applies to transfers, including sells.${
        fee.configAuthority
          ? ` The fee can be changed by ${fee.configAuthority}.`
          : ' The fee authority is revoked, so the rate is locked.'
      }`,
      points,
      checkId: 'honeypot',
    });
  }
  // A live fee authority can raise the tax later even if it is 0% today.
  if (fee && feeBps === 0 && fee.configAuthority) {
    reasons.push({
      code: 'TRANSFER_FEE_AUTHORITY_ACTIVE',
      severity: 'medium',
      message: `The transfer fee is 0% today, but ${fee.configAuthority} can still raise it, which would tax future sells.`,
      points: 8,
      checkId: 'honeypot',
    });
  }

  // --- Token-2022 mint close authority ------------------------------------
  const close = mint.mintCloseAuthority;
  vectors.push({
    name: 'Mint close authority',
    active: close !== null,
    impact: 'Can close the mint account once supply reaches zero.',
    detail: close,
    scoredBy: close !== null ? 'honeypot' : null,
  });
  if (close) {
    reasons.push({
      code: 'MINT_CLOSE_AUTHORITY_SET',
      severity: 'low',
      message: `A mint close authority is set (${close}). It can close the mint account when supply reaches zero.`,
      points: 5,
      checkId: 'honeypot',
    });
  }

  const activeVectors = vectors.filter((v) => v.active);
  const sellBlocked = trip.buy.ok && !trip.sell.ok && trip.sell.reason !== 'upstream_error';

  const value = {
    activeVectorCount: activeVectors.length,
    activeVectors: activeVectors.map((v) => v.name),
    vectors,
    sellRouteBlocked: sellBlocked,
    tokenProgram: mint.program,
  };

  const evidence = {
    sources: [SOURCE, 'jupiter:/swap/v1/quote'],
    data: {
      tokenProgram: mint.program,
      programId: mint.programId,
      extensionBytes: mint.extensionBytes,
      rawAuthorities: {
        mintAuthority: mint.mintAuthority,
        freezeAuthority: mint.freezeAuthority,
        permanentDelegate: mint.permanentDelegate,
        transferHookProgramId: mint.transferHookProgramId,
        mintCloseAuthority: mint.mintCloseAuthority,
        defaultAccountState: mint.defaultAccountState,
        pausable: mint.pausable,
        transferFee: mint.transferFee,
      },
      sellRouteBlocked: sellBlocked,
      vectors,
    },
  };

  // Status reflects transfer-control mechanisms plus the observed sell route.
  let status: CheckResult['status'];
  let result: string;

  if (sellBlocked) {
    status = 'fail';
    result = 'Sell route unavailable while buys route fine';
  } else if (reasons.some((r) => r.severity === 'high')) {
    status = 'fail';
    result = `${activeVectors.length} transfer-control mechanism(s) could block or tax sells`;
  } else if (reasons.length > 0 || activeVectors.length > 0) {
    status = 'warn';
    result = `${activeVectors.length} transfer-control mechanism(s) present`;
  } else {
    status = 'pass';
    result = 'No transfer-blocking mechanism found on the mint';
  }

  return {
    check: {
      id: 'honeypot',
      label: 'Honeypot mechanisms',
      scored: true,
      status,
      result,
      value,
      explanation: buildExplanation(mint, activeVectors, sellBlocked),
      evidence,
    },
    reasons,
  };
}

function gradeFee(bps: number): { code: string; severity: Severity; points: number } {
  if (bps >= 5_000) return { code: 'TRANSFER_FEE_EXTREME', severity: 'high', points: 30 };
  if (bps >= 1_000) return { code: 'TRANSFER_FEE_HIGH', severity: 'high', points: 18 };
  if (bps >= 300) return { code: 'TRANSFER_FEE_MODERATE', severity: 'medium', points: 10 };
  return { code: 'TRANSFER_FEE_PRESENT', severity: 'low', points: 5 };
}

function buildExplanation(
  mint: MintSnapshot,
  activeVectors: HoneypotVector[],
  sellBlocked: boolean,
): string {
  const parts: string[] = [];

  parts.push(
    'This check reads the mint account directly and lists every mechanism that could stop you selling or take your tokens.',
  );

  if (mint.program === 'spl-token') {
    parts.push(
      'The mint uses the original SPL Token program, so the only mechanism available to it is the freeze authority — there are no transfer fees, hooks, or permanent delegates.',
    );
  }

  if (activeVectors.length === 0) {
    parts.push('None of these mechanisms are active on this mint.');
  } else {
    parts.push(
      `Active: ${activeVectors.map((v) => v.name.toLowerCase()).join(', ')}.`,
    );
  }

  if (sellBlocked) {
    parts.push(
      'On top of that, routing is currently one-directional: buys quote but sells do not.',
    );
  }

  parts.push(
    'RugShield does not execute a real swap and does not audit any attached program code, so this is a check of on-chain configuration, not a guarantee of behaviour.',
  );

  return parts.join(' ');
}
