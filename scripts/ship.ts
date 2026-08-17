/**
 * `npm run ship` — build the game and prove the build is publishable.
 *
 * This is what CI runs before it uploads anything to GitHub Pages, and what you
 * should run locally before asking anyone to look at a link. It is a thin
 * wrapper: gauntlet 8 does the work, including the build itself, so there is
 * exactly one definition of "shippable" and no way for the two to drift.
 *
 * It deliberately does NOT deploy. Publishing happens from CI on a push, so the
 * thing that goes live is always a commit somebody can point at, never whatever
 * happened to be in one person's working tree.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const BASE = process.env['BASE_PATH'] ?? '/Ferals-of-fenmark/';

console.log(`\nShipping Ferals of Fenmark  (base path ${BASE})`);

const run = spawnSync('npx', ['tsx', 'scripts/gauntlet/ship.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, BASE_PATH: BASE },
});

if (run.status !== 0) {
  console.log('Not shippable. Fix the failures above; dist/ was not verified.\n');
  process.exit(run.status ?? 1);
}

console.log(
  [
    'Shippable. dist/ is verified against the GitHub Pages subpath.',
    '',
    'To publish: push to the branch the Pages workflow watches. CI rebuilds and',
    'deploys; the link is in DEPLOY.md. Nothing is deployed from here on purpose —',
    'what goes live should always be a commit, not a working tree.',
    '',
  ].join('\n'),
);
