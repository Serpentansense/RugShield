/**
 * CLI scan, useful for verifying the engine without the web layer.
 *
 *   npm run scan -- <mint> [<mint> ...]
 *   npm run scan -- <mint> --json
 */

import { RugShieldError, checkToken } from '../src/lib/rugshield';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const mints = args.filter((a) => !a.startsWith('--'));

  if (mints.length === 0) {
    console.error('usage: npm run scan -- <mint address> [--json]');
    process.exit(1);
  }

  for (const mint of mints) {
    try {
      const report = await checkToken(mint);

      if (jsonOnly) {
        console.log(JSON.stringify(report, null, 2));
        continue;
      }

      console.log(`\n${'='.repeat(72)}`);
      console.log(`${mint}`);
      console.log(
        `RISK ${report.riskScore}/100  ${report.riskLevel.toUpperCase()}  ` +
          `(raw ${report.scoring.rawPoints}, confidence ${report.scoring.confidence}, ${report.elapsedMs}ms)`,
      );
      console.log('-'.repeat(72));
      for (const [key, check] of Object.entries(report.checks)) {
        console.log(`  [${check.status.toUpperCase().padEnd(11)}] ${key}: ${check.result}`);
      }
      if (report.reasons.length) {
        console.log('  WHY:');
        for (const r of report.reasons) {
          console.log(`    +${String(r.points).padStart(2)} ${r.code} (${r.severity})`);
          console.log(`        ${r.message}`);
        }
      } else {
        console.log('  WHY: no risk signals found');
      }
      console.log('  SOURCES:');
      for (const s of report.dataSources) {
        console.log(`    ${s.ok ? 'ok  ' : 'FAIL'} ${s.name} - ${s.detail ?? ''}`);
      }
    } catch (err) {
      if (err instanceof RugShieldError) {
        console.log(
          `\n${mint}\n  ERROR ${err.code}: ${err.message}${err.detail ? ` (${err.detail})` : ''}`,
        );
      } else {
        console.log(
          `\n${mint}\n  UNEXPECTED: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

void main();
