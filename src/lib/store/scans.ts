/**
 * Scan history for the public track record.
 *
 * JSON file storage, which is the right size of solution for an MVP. Swapping
 * in a real database means reimplementing `appendScan` / `listScans` only.
 *
 * Two deliberate properties:
 * - Writes never block or fail a scan. A broken store degrades the track
 *   record, not the security result.
 * - Writes are serialised through an in-process promise chain so two
 *   concurrent requests cannot clobber each other's append.
 *
 * Note: this needs a writable filesystem. On read-only serverless hosts the
 * writes fail softly and the track record stays empty (see README).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RugShieldReport } from '../rugshield';

export interface ScanRecord {
  id: string;
  token: string;
  symbol: string | null;
  /** ISO-8601 UTC. */
  timestamp: string;
  riskScore: number;
  riskLevel: RugShieldReport['riskLevel'];
  /** Warning codes and messages that drove the score. */
  warnings: { code: string; severity: string; points: number; message: string }[];
  /** Per-check status, so the table can show what ran. */
  checkStatuses: Record<string, string>;
  confidence: 'complete' | 'partial';
  liquidityUsd: number | null;
  /** How the scan was requested. */
  via: 'web' | 'api' | 'mcp' | 'cli';
  /**
   * What actually happened to the token afterwards. Nothing populates this in
   * the MVP; it stays `null` until an outcome is recorded.
   */
  outcome: { label: string; note: string | null; recordedAt: string } | null;
}

/** Newest-first cap, keeps the JSON file bounded. */
const MAX_RECORDS = 500;

function storePath(): string {
  return (
    process.env.RUGSHIELD_STORE_PATH ?? path.join(process.cwd(), 'data', 'scans.json')
  );
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<ScanRecord[]> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScanRecord[]) : [];
  } catch {
    // Missing or unreadable file means "no history yet".
    return [];
  }
}

/** Converts a report into the record shape the track record renders. */
export function toScanRecord(
  report: RugShieldReport,
  via: ScanRecord['via'],
): ScanRecord {
  const tokenInfo = report.checks.tokenInfo.value as { symbol?: string | null } | null;
  const liquidity = report.checks.liquidity.value as
    | { totalLiquidityUsd?: number | null }
    | null;

  return {
    id: randomUUID(),
    token: report.token,
    symbol: tokenInfo?.symbol ?? null,
    timestamp: report.timestamp,
    riskScore: report.riskScore,
    riskLevel: report.riskLevel,
    warnings: report.reasons.map((r) => ({
      code: r.code,
      severity: r.severity,
      points: r.points,
      message: r.message,
    })),
    checkStatuses: Object.fromEntries(
      Object.entries(report.checks).map(([key, check]) => [key, check.status]),
    ),
    confidence: report.scoring.confidence,
    liquidityUsd: liquidity?.totalLiquidityUsd ?? null,
    via,
    outcome: null,
  };
}

/**
 * Appends a record. Resolves to `false` if persistence failed, so the caller
 * can carry on regardless.
 */
export async function appendScan(record: ScanRecord): Promise<boolean> {
  const task = writeChain.then(async () => {
    const file = storePath();
    await mkdir(path.dirname(file), { recursive: true });
    const existing = await readAll();
    const next = [record, ...existing].slice(0, MAX_RECORDS);
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  });

  // Keep the chain alive even when this write rejects.
  writeChain = task.catch(() => undefined);

  try {
    await task;
    return true;
  } catch (err) {
    console.error('[rugshield] failed to persist scan record:', err);
    return false;
  }
}

export interface ListOptions {
  limit?: number;
  /** Filter to a single mint. */
  token?: string;
}

export async function listScans(options: ListOptions = {}): Promise<ScanRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_RECORDS);
  let records = await readAll();
  if (options.token) {
    records = records.filter((r) => r.token === options.token);
  }
  return records.slice(0, limit);
}

export async function countScans(): Promise<number> {
  return (await readAll()).length;
}
