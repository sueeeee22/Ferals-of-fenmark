/**
 * gauntlet:types — TypeScript strict, zero errors, zero `any`, lint clean,
 * plus the architectural invariants that a type checker cannot express.
 *
 * Exit 0 or nothing advances.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
let failures = 0;

function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

function run(label: string, cmd: string): boolean {
  process.stdout.write(`  ${label} ... `);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe' });
    console.log('ok');
    return true;
  } catch (err) {
    console.log('FAILED');
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim();
    console.error(out.split('\n').slice(0, 40).map((l) => `        ${l}`).join('\n'));
    failures++;
    return false;
  }
}

/**
 * Strip comments and string/template literals before scanning source for banned
 * constructs. Without this the scanner flags the prose in its own doc comments —
 * "Math.random() is banned" is not a call to Math.random().
 */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

console.log('\n=== GAUNTLET 1: TYPES ===\n');

run('tsc --noEmit (strict)', 'npx tsc --noEmit');
run('eslint', 'npx eslint . --max-warnings 0');

// --- Invariants a type checker cannot express -----------------------------

console.log('\n  architectural invariants:');

const coreFiles = walk(join(ROOT, 'src', 'core'));
if (coreFiles.length === 0) fail('src/core is empty — the game has no logic');

for (const file of coreFiles) {
  const src = stripNonCode(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);

  // The reducer must be deterministic from its seed. Math.random breaks replay,
  // breaks save/load, and makes every gauntlet failure irreproducible.
  if (/Math\s*\.\s*random/.test(src)) {
    fail(`${rel} uses Math.random — src/core must be deterministic (use Rng)`);
  }

  // src/core is pure logic. If it can reach the DOM it will eventually depend on it,
  // and gauntlet:playthrough (which runs in Node) stops working.
  if (/\bfrom\s+['"]\.\.\/(render|ui)\//.test(src)) {
    fail(`${rel} imports from src/render or src/ui — core must stay pure`);
  }
  if (/\b(document|window|localStorage|HTMLElement|CanvasRenderingContext2D)\b/.test(src)) {
    fail(`${rel} references the DOM — core must run headless in Node`);
  }
}

// `any` can sneak past eslint through casts and generics defaults.
// This file is excluded from the textual scan: it *contains* the patterns it
// looks for, so scanning itself is guaranteed to self-report. Its own type
// safety is still enforced by tsc and eslint above.
const SELF = join(ROOT, 'scripts', 'gauntlet', 'types.ts');
const allFiles = [
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'scripts')),
  ...walk(join(ROOT, 'tests')),
].filter((f) => f !== SELF);

for (const file of allFiles) {
  const src = stripNonCode(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);
  for (const [i, line] of src.split('\n').entries()) {
    if (/\/\/\s*eslint-disable/.test(line)) {
      fail(`${rel}:${i + 1} disables eslint — fix the code instead`);
    }
    if (/\bas\s+any\b|:\s*any\b|<any>/.test(line) && !/\bas\s+unknown\b/.test(line)) {
      fail(`${rel}:${i + 1} uses \`any\``);
    }
    if (/@ts-(ignore|expect-error|nocheck)/.test(line)) {
      fail(`${rel}:${i + 1} suppresses the type checker`);
    }
  }
}

if (failures === 0) console.log('  invariants ... ok');

console.log(
  failures === 0 ? '\nGAUNTLET 1 PASS\n' : `\nGAUNTLET 1 FAIL — ${failures} problem(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
