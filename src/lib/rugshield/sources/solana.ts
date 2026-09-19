/**
 * On-chain reads. One `getAccountInfo` call gives us the whole mint account,
 * including Token-2022 extension TLV data, which `@solana/spl-token` then
 * decodes for us.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import {
  AccountState,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getMintCloseAuthority,
  getPausableConfig,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from '@solana/spl-token';
import { RugShieldError } from '../types';
import { SYSTEM_PROGRAM_ID, type RugShieldConfig } from '../config';

export type TokenProgram = 'spl-token' | 'spl-token-2022';

export interface TransferFeeInfo {
  /**
   * The higher of the two scheduled fees, in basis points (100 bps = 1%).
   * Token-2022 stores an older and a newer fee so an authority can schedule a
   * change; we score the worst of the two rather than guess the current epoch.
   */
  worstCaseBasisPoints: number;
  /** Fee that applies from `newerEpoch` onwards. */
  newerBasisPoints: number;
  newerEpoch: string;
  /** Fee that applied before `newerEpoch`. */
  olderBasisPoints: number;
  olderEpoch: string;
  maximumFee: string;
  /** Whoever holds this can change the fee. `null` means the fee is locked. */
  configAuthority: string | null;
  withdrawAuthority: string | null;
}

export interface MintSnapshot {
  address: string;
  program: TokenProgram;
  programId: string;
  decimals: number;
  supplyRaw: string;
  /** Supply scaled by decimals. */
  supply: number;
  isInitialized: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Token-2022 only. `null` when the extension is absent. */
  transferFee: TransferFeeInfo | null;
  transferHookProgramId: string | null;
  permanentDelegate: string | null;
  mintCloseAuthority: string | null;
  /** `frozen` means freshly created token accounts start frozen. */
  defaultAccountState: 'initialized' | 'frozen' | null;
  pausable: { authority: string | null; paused: boolean } | null;
  extensionBytes: number;
  lamports: number;
}

export function isValidMintAddress(value: string): boolean {
  try {
    // PublicKey accepts any 32-byte base58 value; also reject off-curve junk
    // that could never be a real mint account.
    const key = new PublicKey(value);
    return key.toBase58() === value;
  } catch {
    return false;
  }
}

/** Connection for the mandatory mint read. Retries through rate limits. */
export function createConnection(config: RugShieldConfig): Connection {
  return new Connection(config.rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
  });
}

/**
 * Connection for optional reads. Fails fast instead of backing off, because
 * public RPCs reliably rate limit `getTokenLargestAccounts` and the built-in
 * retry ladder would add ~8s to every scan for a check we can live without.
 */
export function createFastFailConnection(config: RugShieldConfig): Connection {
  return new Connection(config.rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });
}

/** Reads and decodes the mint account. Throws `RugShieldError` when unusable. */
export async function fetchMintSnapshot(
  connection: Connection,
  mint: string,
): Promise<MintSnapshot> {
  const pubkey = new PublicKey(mint);

  let account;
  try {
    account = await connection.getAccountInfo(pubkey, 'confirmed');
  } catch (err) {
    throw new RugShieldError(
      'Could not reach the Solana RPC endpoint to read this mint.',
      'RPC_UNAVAILABLE',
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!account) {
    throw new RugShieldError(
      'No account exists at this address on the configured cluster.',
      'MINT_NOT_FOUND',
    );
  }

  const programId = account.owner;
  const isLegacy = programId.equals(TOKEN_PROGRAM_ID);
  const is2022 = programId.equals(TOKEN_2022_PROGRAM_ID);
  if (!isLegacy && !is2022) {
    throw new RugShieldError(
      'This address is not owned by an SPL Token program, so it is not a token mint.',
      'NOT_A_TOKEN_MINT',
      `owner=${programId.toBase58()}`,
    );
  }

  let mintState;
  try {
    mintState = unpackMint(pubkey, account, programId);
  } catch (err) {
    throw new RugShieldError(
      'This account is owned by a token program but does not decode as a mint.',
      'NOT_A_TOKEN_MINT',
      err instanceof Error ? err.message : String(err),
    );
  }

  const snapshot: MintSnapshot = {
    address: mint,
    program: is2022 ? 'spl-token-2022' : 'spl-token',
    programId: programId.toBase58(),
    decimals: mintState.decimals,
    supplyRaw: mintState.supply.toString(),
    supply: rawToUi(mintState.supply, mintState.decimals),
    isInitialized: mintState.isInitialized,
    mintAuthority: mintState.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mintState.freezeAuthority?.toBase58() ?? null,
    transferFee: null,
    transferHookProgramId: null,
    permanentDelegate: null,
    mintCloseAuthority: null,
    defaultAccountState: null,
    pausable: null,
    extensionBytes: mintState.tlvData?.length ?? 0,
    lamports: account.lamports,
  };

  if (!is2022) return snapshot;

  // Token-2022 extensions. Each getter returns null when the extension is not
  // present on this mint.
  const fee = getTransferFeeConfig(mintState);
  if (fee) {
    snapshot.transferFee = {
      worstCaseBasisPoints: Math.max(
        fee.newerTransferFee.transferFeeBasisPoints,
        fee.olderTransferFee.transferFeeBasisPoints,
      ),
      newerBasisPoints: fee.newerTransferFee.transferFeeBasisPoints,
      newerEpoch: fee.newerTransferFee.epoch.toString(),
      olderBasisPoints: fee.olderTransferFee.transferFeeBasisPoints,
      olderEpoch: fee.olderTransferFee.epoch.toString(),
      maximumFee: fee.newerTransferFee.maximumFee.toString(),
      configAuthority: nonZero(fee.transferFeeConfigAuthority?.toBase58()),
      withdrawAuthority: nonZero(fee.withdrawWithheldAuthority?.toBase58()),
    };
  }

  const hook = getTransferHook(mintState);
  snapshot.transferHookProgramId = nonZero(hook?.programId?.toBase58());

  const permanentDelegate = getPermanentDelegate(mintState);
  snapshot.permanentDelegate = nonZero(permanentDelegate?.delegate?.toBase58());

  const closeAuthority = getMintCloseAuthority(mintState);
  snapshot.mintCloseAuthority = nonZero(
    closeAuthority?.closeAuthority?.toBase58(),
  );

  const defaultState = getDefaultAccountState(mintState);
  if (defaultState) {
    snapshot.defaultAccountState =
      defaultState.state === AccountState.Frozen ? 'frozen' : 'initialized';
  }

  const pausable = getPausableConfig(mintState);
  if (pausable) {
    snapshot.pausable = {
      authority: nonZero(pausable.authority?.toBase58()),
      paused: Boolean(pausable.paused),
    };
  }

  return snapshot;
}

/**
 * Largest token accounts. Optional: the public RPC rate limits this method
 * aggressively, so callers must tolerate `null`.
 */
export async function fetchLargestAccounts(
  connection: Connection,
  mint: string,
): Promise<
  | { ok: true; accounts: { address: string; amount: string; uiAmount: number }[] }
  | { ok: false; error: string }
> {
  try {
    const res = await connection.getTokenLargestAccounts(
      new PublicKey(mint),
      'confirmed',
    );
    return {
      ok: true,
      accounts: res.value.map((a) => ({
        address: a.address.toBase58(),
        amount: a.amount,
        uiAmount: a.uiAmount ?? 0,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

function nonZero(address: string | undefined | null): string | null {
  if (!address) return null;
  return address === SYSTEM_PROGRAM_ID ? null : address;
}

function rawToUi(raw: bigint, decimals: number): number {
  if (decimals === 0) return Number(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
}
