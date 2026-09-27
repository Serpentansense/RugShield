/**
 * Mint authority and freeze authority checks.
 *
 * These are the two classic Solana control switches:
 * - mint authority  -> can create new supply out of thin air
 * - freeze authority -> can freeze a holder's token account, blocking sells
 *
 * Pure functions over an already-fetched snapshot, so they are unit-testable.
 */

import type { MintSnapshot } from '../sources/solana';
import type { CheckResult, Reason } from '../types';

export interface CheckOutput {
  check: CheckResult;
  reasons: Reason[];
}

const RPC_SOURCE = 'solana-rpc:getAccountInfo';

export function checkMintAuthority(mint: MintSnapshot): CheckOutput {
  const active = mint.mintAuthority !== null;
  const evidence = {
    sources: [RPC_SOURCE],
    data: {
      mint: mint.address,
      mintAuthority: mint.mintAuthority,
      tokenProgram: mint.program,
      currentSupply: mint.supply,
      currentSupplyRaw: mint.supplyRaw,
    },
  };

  if (!active) {
    return {
      check: {
        id: 'mint_authority',
        label: 'Mint authority',
        status: 'pass',
        scored: true,
        result: 'Revoked — supply is fixed',
        value: { active: false, authority: null },
        explanation:
          'No mint authority is set, so no further tokens of this mint can be created. Total supply cannot be inflated.',
        evidence,
      },
      reasons: [],
    };
  }

  return {
    check: {
      id: 'mint_authority',
      label: 'Mint authority',
      status: 'warn',
      scored: true,
      result: 'Active — supply can be increased',
      value: { active: true, authority: mint.mintAuthority },
      explanation:
        'A mint authority is still set. Whoever controls that key can mint additional tokens at any time, diluting existing holders. Many legitimate tokens keep this key, so treat it as a control risk rather than proof of intent.',
      evidence,
    },
    reasons: [
      {
        code: 'MINT_AUTHORITY_ACTIVE',
        severity: 'medium',
        message: `Mint authority is still active (${mint.mintAuthority}). New supply can be minted at any time.`,
        points: 15,
        checkId: 'mint_authority',
      },
    ],
  };
}

export function checkFreezeAuthority(mint: MintSnapshot): CheckOutput {
  const active = mint.freezeAuthority !== null;
  const evidence = {
    sources: [RPC_SOURCE],
    data: {
      mint: mint.address,
      freezeAuthority: mint.freezeAuthority,
      tokenProgram: mint.program,
      defaultAccountState: mint.defaultAccountState,
    },
  };

  if (!active) {
    return {
      check: {
        id: 'freeze_authority',
        label: 'Freeze authority',
        status: 'pass',
        scored: true,
        result: 'Revoked — accounts cannot be frozen',
        value: { active: false, authority: null },
        explanation:
          'No freeze authority is set, so no key can freeze your token account and block you from transferring or selling.',
        evidence,
      },
      reasons: [],
    };
  }

  return {
    check: {
      id: 'freeze_authority',
      label: 'Freeze authority',
      status: 'fail',
      scored: true,
      result: 'Active — your account can be frozen',
      value: { active: true, authority: mint.freezeAuthority },
      explanation:
        'A freeze authority is set. That key can freeze any holder account for this mint, which stops that holder from transferring or selling. This is the most direct on-chain route to an unsellable position. Regulated stablecoins legitimately use this.',
      evidence,
    },
    reasons: [
      {
        code: 'FREEZE_AUTHORITY_ACTIVE',
        severity: 'high',
        message: `Freeze authority is active (${mint.freezeAuthority}). Holder accounts can be frozen, which would block selling.`,
        points: 25,
        checkId: 'freeze_authority',
      },
    ],
  };
}
