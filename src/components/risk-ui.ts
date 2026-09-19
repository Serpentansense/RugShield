/** Shared presentation helpers for risk levels, check statuses and severities. */

import type { CheckStatus, RiskLevel, Severity } from '@/lib/rugshield';

export const RISK_LEVEL_STYLES: Record<
  RiskLevel,
  { label: string; text: string; ring: string; bg: string; bar: string }
> = {
  low: {
    label: 'LOW',
    text: 'text-risk-low',
    ring: 'ring-risk-low/40',
    bg: 'bg-risk-low/10',
    bar: 'bg-risk-low',
  },
  medium: {
    label: 'MEDIUM',
    text: 'text-risk-medium',
    ring: 'ring-risk-medium/40',
    bg: 'bg-risk-medium/10',
    bar: 'bg-risk-medium',
  },
  high: {
    label: 'HIGH',
    text: 'text-risk-high',
    ring: 'ring-risk-high/40',
    bg: 'bg-risk-high/10',
    bar: 'bg-risk-high',
  },
};

export const CHECK_STATUS_STYLES: Record<
  CheckStatus,
  { label: string; className: string }
> = {
  pass: { label: 'PASS', className: 'bg-risk-low/12 text-risk-low ring-risk-low/30' },
  warn: {
    label: 'WARN',
    className: 'bg-risk-medium/12 text-risk-medium ring-risk-medium/30',
  },
  fail: { label: 'FAIL', className: 'bg-risk-high/12 text-risk-high ring-risk-high/30' },
  info: { label: 'INFO', className: 'bg-accent/12 text-accent ring-accent/30' },
  unavailable: {
    label: 'UNAVAILABLE',
    className: 'bg-muted/10 text-muted ring-muted/30',
  },
};

export const SEVERITY_STYLES: Record<Severity, string> = {
  high: 'text-risk-high',
  medium: 'text-risk-medium',
  low: 'text-muted',
  info: 'text-muted',
};

export const CHECK_ORDER = [
  'honeypot',
  'sellability',
  'liquidity',
  'mintAuthority',
  'freezeAuthority',
  'tokenInfo',
  'holderConcentration',
] as const;

export function shortenAddress(address: string, size = 6): string {
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
