/**
 * `npm run gauntlet` — runs all eight gates in dependency order.
 *
 * This command exiting 0 is the only acceptable definition of finished.
 *
 * Order matters: the cheap deterministic gates run first so that a typo never
 * costs a ten-thousand-battle simulation or a browser launch, and nothing that
 * burns a human's or a critic's judgement runs until the scripts have had their
 * say. Failures do NOT stop the run — every gate reports, so one pass gives the
 * full picture rather than only the first thing that broke.
 */
import { spawnSync } from 'node:child_process';

interface Gate {
  readonly n: number;
  readonly name: string;
  readonly script: string;
  /** Roughly how long it takes, so the log sets expectations. */
  readonly cost: string;
}

const GATES: readonly Gate[] = [
  { n: 1, name: 'types', script: 'scripts/gauntlet/types.ts', cost: 'fast' },
  { n: 2, name: 'schema', script: 'scripts/gauntlet/schema.ts', cost: 'fast' },
  { n: 3, name: 'sim', script: 'scripts/gauntlet/sim.ts', cost: '~30s' },
  { n: 4, name: 'curve', script: 'scripts/gauntlet/curve.ts', cost: '~2m' },
  { n: 5, name: 'playthrough', script: 'scripts/gauntlet/playthrough.ts', cost: '~2m' },
  { n: 6, name: 'visual', script: 'scripts/gauntlet/visual.ts', cost: '~2m, browser' },
  { n: 7, name: 'tone', script: 'scripts/gauntlet/tone.ts', cost: 'fast' },
  { n: 8, name: 'ship', script: 'scripts/gauntlet/ship.ts', cost: '~3m, browser' },
  { n: 9, name: 'audio', script: 'scripts/gauntlet/audio.ts', cost: '~2m, browser' },
];

const ROOT = new URL('../..', import.meta.url).pathname;
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

interface Result {
  readonly gate: Gate;
  readonly code: number;
  readonly seconds: number;
  readonly missing: boolean;
}

const results: Result[] = [];

for (const gate of GATES) {
  if (only.length > 0 && !only.includes(gate.name)) continue;

  console.log(`\n${'='.repeat(78)}`);
  console.log(`GAUNTLET ${gate.n}: ${gate.name.toUpperCase()}  (${gate.cost})`);
  console.log('='.repeat(78));

  const t0 = Date.now();
  const run = spawnSync('npx', ['tsx', gate.script], {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  const seconds = (Date.now() - t0) / 1000;

  // A harness that has not been written yet is a distinct outcome from one that
  // ran and failed, and conflating them hides how much work is actually left.
  const missing = run.status === null || run.error !== undefined;
  results.push({ gate, code: run.status ?? 1, seconds, missing });
}

console.log(`\n${'='.repeat(78)}`);
console.log('SUMMARY');
console.log('='.repeat(78));
console.log(`\n  #  GATE            RESULT     TIME`);

let failed = 0;
for (const r of results) {
  const verdict = r.missing ? 'NOT WRITTEN' : r.code === 0 ? 'PASS' : 'FAIL';
  if (r.code !== 0) failed++;
  console.log(
    `  ${String(r.gate.n).padEnd(3)}${r.gate.name.padEnd(16)}${verdict.padEnd(11)}${r.seconds.toFixed(1)}s`,
  );
}

const total = results.length;
console.log(
  failed === 0
    ? `\n  ALL ${total} GATES PASS. This is the definition of finished.\n`
    : `\n  ${failed}/${total} GATES FAILING. Not finished.\n`,
);

process.exit(failed === 0 ? 0 : 1);
