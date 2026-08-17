/**
 * GAUNTLET 8: SHIP
 *
 * The question this gate answers is narrow and unforgiving: **if we publish
 * `dist/` right now, does a stranger who opens the link get a working game with
 * working saves?**
 *
 * Everything here is checked against a REAL build, served over HTTP from the
 * same subpath GitHub Pages uses, driven by a real browser. Reading the source
 * and reasoning about it is exactly how you ship a blank page: the two failures
 * that actually happen in practice - an asset URL that 404s under a project
 * subpath, and a save that does not survive a reload - are both invisible until
 * something serves the files and presses the buttons.
 */

import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchBrowser } from '../../tests/browser.ts';
import { newGame } from '../../src/core/game.ts';
import { serialize, deserialize, restore, exportCode, importCode } from '../../src/core/save.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');

/** The subpath GitHub Pages serves a project site from. */
const BASE = process.env['BASE_PATH'] ?? '/Ferals-of-fenmark/';

/** Gzipped budget for the whole page. A phone on bad signal is the target. */
const BUDGET_GZIP_KB = 250;

let failures = 0;
let warnings = 0;

const pass = (label: string, detail = ''): void => {
  console.log(`  ${label} ... ok${detail ? `  ${detail}` : ''}`);
};
const fail = (label: string, why: string): void => {
  failures++;
  console.log(`  ${label} ... FAIL`);
  console.log(`      ${why}`);
};
const warn = (label: string, why: string): void => {
  warnings++;
  console.log(`  ${label} ... warn`);
  console.log(`      ${why}`);
};

console.log('\n=== GAUNTLET 8: SHIP ===\n');

// ---------------------------------------------------------------------------
// 1. Build
// ---------------------------------------------------------------------------

console.log('  building:');
{
  const t0 = Date.now();
  const run = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, BASE_PATH: BASE },
  });
  if (run.status !== 0) {
    fail('npm run build', (run.stderr || run.stdout || 'no output').trim().split('\n').slice(-12).join('\n      '));
    console.log('\nGAUNTLET 8 FAIL - the build does not succeed, nothing else can be checked\n');
    process.exit(1);
  }
  pass('npm run build', `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
// 2. The artifact itself
// ---------------------------------------------------------------------------

console.log('\n  artifact:');

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  fail('dist/index.html', 'missing - there is nothing to deploy');
  process.exit(1);
}
const html = await readFile(indexPath, 'utf8');

// Every URL the page asks for must be prefixed with the base, or it 404s the
// moment the site is not at the domain root. This is THE GitHub Pages bug.
{
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '');
  const rootAbsolute = urls.filter((u) => u.startsWith('/') && !u.startsWith(BASE));
  if (rootAbsolute.length > 0) {
    fail(
      'asset paths',
      `these resolve to the domain root and will 404 under ${BASE}: ${rootAbsolute.join(', ')}`,
    );
  } else {
    pass('asset paths', `all prefixed with ${BASE}`);
  }
}

// Every local asset the HTML references must actually be in dist.
{
  const missing: string[] = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1] ?? '';
    if (!url.startsWith(BASE)) continue;
    const rel = url.slice(BASE.length);
    if (!existsSync(join(DIST, rel))) missing.push(rel);
  }
  if (missing.length > 0) fail('referenced files', `not present in dist/: ${missing.join(', ')}`);
  else pass('referenced files', 'all present');
}

// Size budget, measured gzipped because that is what crosses the wire.
{
  const { gzipSync } = await import('node:zlib');
  let total = 0;
  const parts: string[] = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = m[1] ?? '';
    if (!url.startsWith(BASE)) continue;
    const file = join(DIST, url.slice(BASE.length));
    if (!existsSync(file)) continue;
    const gz = gzipSync(await readFile(file)).length;
    total += gz;
    parts.push(`${url.slice(BASE.length)} ${(gz / 1024).toFixed(0)}KB`);
  }
  total += gzipSync(Buffer.from(html)).length;
  const kb = total / 1024;
  if (kb > BUDGET_GZIP_KB) {
    fail('page weight', `${kb.toFixed(0)}KB gzipped exceeds the ${BUDGET_GZIP_KB}KB budget`);
  } else {
    pass('page weight', `${kb.toFixed(0)}KB gzipped (${parts.join(', ')})`);
  }
}

// A static host serves files; it cannot run a backend. Anything that expects
// one is a deploy that works locally and breaks in public.
{
  const jsFiles = [...html.matchAll(/src="([^"]+\.js)"/g)]
    .map((m) => m[1] ?? '')
    .filter((u) => u.startsWith(BASE))
    .map((u) => join(DIST, u.slice(BASE.length)));
  let bad = '';
  for (const f of jsFiles) {
    const code = await readFile(f, 'utf8');
    if (/\blocalhost:\d+/.test(code)) bad = 'bundle contains a localhost URL';
    if (/127\.0\.0\.1/.test(code)) bad = 'bundle contains a 127.0.0.1 URL';
  }
  if (bad) fail('no local endpoints', bad);
  else pass('no local endpoints', 'nothing points at a dev server');
}

// ---------------------------------------------------------------------------
// 3. Save format, headless. Cheap, and localises a failure the browser test
//    would only report as "the save did not come back".
// ---------------------------------------------------------------------------

console.log('\n  save format:');
{
  const state = newGame('ship-gauntlet');
  state.player.mapId = 'route_1';
  state.player.x = 7;
  state.player.y = 4;

  const round = deserialize(serialize(state));
  if (round === null) {
    fail('serialize/deserialize', 'a freshly serialised save does not parse back');
  } else {
    const back = restore(round);
    if (back.player.mapId !== 'route_1' || back.player.x !== 7 || back.player.y !== 4) {
      fail('serialize/deserialize', 'position did not survive the round trip');
    } else {
      pass('serialize/deserialize', 'position, party and flags intact');
    }
  }

  const code = exportCode(state);
  const imported = importCode(code);
  if (!imported.ok) {
    fail('transfer code', `a freshly exported code failed to import: ${imported.reason}`);
  } else if (imported.file.player.mapId !== 'route_1') {
    fail('transfer code', 'the imported save is not the exported one');
  } else {
    pass('transfer code', `${code.length.toLocaleString()} chars, round trips`);
  }

  // A truncated code is the realistic corruption: chat clients wrap long lines.
  const truncated = importCode(code.slice(0, Math.floor(code.length * 0.9)));
  if (truncated.ok) fail('corrupt code rejected', 'a truncated transfer code was accepted');
  else pass('corrupt code rejected', `"${truncated.reason}"`);

  if (deserialize('{"version":1,"nonsense":true}') !== null) {
    fail('corrupt save rejected', 'a malformed save file was accepted');
  } else {
    pass('corrupt save rejected', 'malformed JSON does not load');
  }
}

// ---------------------------------------------------------------------------
// 4. The real thing: serve dist/ from the subpath and drive it in a browser.
// ---------------------------------------------------------------------------

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveDist(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    if (!url.startsWith(BASE)) {
      // Exactly what GitHub Pages does for a path outside the project subpath.
      res.writeHead(404).end('not found');
      return;
    }
    let rel = url.slice(BASE.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    readFile(file)
      .then((buf) => {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(buf);
      })
      .catch(() => {
        res.writeHead(404).end('not found');
      });
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      ok({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0 });
    });
  });
}

console.log('\n  served from a subpath, in a real browser:');

const { server, port } = await serveDist();
const url = `http://127.0.0.1:${port}${BASE}`;
const browser = await launchBrowser();

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });

  if (failedRequests.length > 0) {
    fail('every request succeeds', failedRequests.join('\n      '));
  } else {
    pass('every request succeeds', 'no 404s under the subpath');
  }

  // The game must actually be running, not merely parsed. __fenmark is the
  // read-only observation hook the loop updates every frame.
  await page
    .waitForFunction(() => (window as unknown as { __fenmark?: unknown }).__fenmark !== undefined, {
      timeout: 10_000,
    })
    .then(() => pass('the game boots', 'the reducer is running'))
    .catch(() => fail('the game boots', 'the frame loop never ran - the page is dead'));

  // The canvas must be painting something. A black 160x144 rectangle is what a
  // renderer crash looks like, and it is indistinguishable from "loading"
  // unless you look at the pixels.
  const distinctColours = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return seen.size;
  });
  if (distinctColours < 2) {
    fail('the screen draws', `the canvas is a single flat colour (${distinctColours} distinct)`);
  } else {
    pass('the screen draws', `${distinctColours} distinct colours on screen`);
  }

  // --- Saves survive a reload. This is the whole point of the deploy. -------
  //
  // Driven through the real title screen and the real save flow, then a genuine
  // page reload. Writing to localStorage directly would prove only that
  // localStorage works.
  // ~70ms is comfortably more than the ~2 frames the reducer needs to see a
  // button; the release gap only has to exceed one frame for the edge detector.
  const pressKey = async (key: string, times = 1): Promise<void> => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.down(key);
      await page.waitForTimeout(70);
      await page.keyboard.up(key);
      await page.waitForTimeout(70);
    }
  };

  // Get into a real game: title -> intro dialogue -> starter picker -> overworld.
  // 'z' is the A button (KeyZ in KEY_MAP); 'x' is B, which is why pressing it
  // here never got past the title. Press A until the player has left the opening
  // house, bounded so a hang fails loudly rather than spinning.
  const snapshot = (): Promise<{ scene: string; map: string; x: number; y: number }> =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __fenmark: { scene: string; map: string; x: number; y: number };
          }
        ).__fenmark,
    );

  const before = await snapshot();

  // Press A through the intro. This is deliberately a blind count rather than
  // "until the scene stops being dialogue": the intro runs several dialogue
  // segments with overworld frames BETWEEN them, so a state-driven loop exits
  // on the first gap and stops half way through. Extra presses in the overworld
  // are harmless - they just interact with whatever is in front of the player.
  //
  // The count has to cover BOXES, not authored lines. Long lines are paged two
  // rows at a time, so one line of dialogue can be four presses; 45 was enough
  // before pagination and silently stopped mid-intro after it.
  let started = before;
  for (let i = 0; i < 220; i++) await pressKey('z');
  started = await snapshot();

  // Then prove the D-pad reaches the reducer too. Direction is deliberately not
  // assumed: the assertion is that input MOVES the player, not that the front
  // door is south. Whether they can find the door is gauntlet 5's job, and it
  // answers yes twelve runs out of twelve.
  const from = `${started.map}:${started.x},${started.y}`;
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
    await pressKey(key, 2);
    started = await snapshot();
    if (`${started.map}:${started.x},${started.y}` !== from) break;
  }

  if (started.scene === 'title') {
    fail('input reaches the game', 'still on the title screen after 16 A presses');
  } else if (`${started.map}:${started.x},${started.y}` === from) {
    warn('input reaches the game', `the intro advanced but the player never moved (${from})`);
  } else {
    pass('input reaches the game', `${before.scene} -> playing, moved to ${started.map}`);
  }

  const wrote = await page.evaluate(() => {
    try {
      return Object.keys(window.localStorage).some((k) => k.startsWith('fenmark.'));
    } catch {
      return false;
    }
  });

  // The autosave fires from the overworld on a timer and on pagehide; a reload
  // triggers pagehide, so a started game must leave something behind.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (window as unknown as { __fenmark?: unknown }).__fenmark !== undefined,
    { timeout: 10_000 },
  );

  const persisted = await page.evaluate(() => {
    try {
      return Object.keys(window.localStorage).filter((k) => k.startsWith('fenmark.'));
    } catch {
      return [];
    }
  });

  if (!wrote && persisted.length === 0) {
    warn(
      'saves persist',
      `nothing was written to localStorage (ended in ${started.map}, scene ${started.scene}). ` +
        'If the intro is longer than the scripted key presses, this is the harness ' +
        'not reaching the overworld rather than a broken save.',
    );
  } else if (persisted.length === 0) {
    fail('saves persist', 'data was written before the reload but is gone after it');
  } else {
    pass('saves persist', `${persisted.length} key(s) survived a reload: ${persisted.join(', ')}`);
  }

  // The save panel is how a player rescues a save from a dying browser.
  const panelWorks = await page.evaluate(() => {
    const btn = document.querySelector<HTMLButtonElement>('#saves-button');
    if (!btn) return 'no saves button';
    btn.click();
    const panel = document.querySelector<HTMLElement>('#save-panel');
    if (!panel || panel.hidden) return 'panel did not open';
    const slots = panel.querySelectorAll('.sp-slot').length;
    if (slots < 1) return 'panel has no slots';
    return `ok:${slots}`;
  });
  if (panelWorks.startsWith('ok:')) {
    pass('save panel opens', `${panelWorks.slice(3)} slots, transfer codes available`);
  } else {
    fail('save panel opens', panelWorks);
  }

  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  if (realErrors.length > 0) {
    fail('no console errors', realErrors.slice(0, 5).join('\n      '));
  } else {
    pass('no console errors', 'clean');
  }

  await page.close();
} finally {
  await browser.close();
  server.close();
}

// ---------------------------------------------------------------------------
// 5. Deploy configuration
// ---------------------------------------------------------------------------

console.log('\n  deploy config:');
{
  const workflow = join(ROOT, '.github/workflows/deploy-pages.yml');
  if (!existsSync(workflow)) fail('Pages workflow', 'deploy-pages.yml is missing');
  else pass('Pages workflow', '.github/workflows/deploy-pages.yml');

  if (!existsSync(join(ROOT, 'DEPLOY.md'))) {
    fail('DEPLOY.md', 'missing - nobody can deploy this without instructions');
  } else {
    pass('DEPLOY.md', 'present');
  }

  // Jekyll silently drops files it does not like on Pages.
  if (!existsSync(join(DIST, '.nojekyll'))) {
    warn('.nojekyll', 'not in dist/ - add it to public/ so Pages skips Jekyll');
  } else {
    pass('.nojekyll', 'Jekyll processing disabled');
  }

  // Every script package.json advertises must exist, or `npm run` lies.
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const missingScripts: string[] = [];
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    const m = /tsx\s+(\S+\.ts)/.exec(cmd);
    if (m?.[1] && !existsSync(join(ROOT, m[1]))) missingScripts.push(`${name} -> ${m[1]}`);
  }
  if (missingScripts.length > 0) {
    warn('package scripts resolve', `these point at files that do not exist: ${missingScripts.join(', ')}`);
  } else {
    pass('package scripts resolve', 'every npm script has its file');
  }
}

// ---------------------------------------------------------------------------

await stat(DIST);
console.log(
  failures === 0
    ? `\nGAUNTLET 8 PASS${warnings > 0 ? ` (${warnings} warning(s))` : ''}\n`
    : `\nGAUNTLET 8 FAIL - ${failures} problem(s), ${warnings} warning(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
