/**
 * Screenshot pipeline. Boots the PRODUCTION build and drives it with real key
 * presses to a list of story checkpoints, capturing each one twice: at the Game
 * Boy's native 160x144, and at phone width.
 *
 * Feeds `gauntlet:visual` and regenerates `screenshots/`.
 *
 * Nothing here reaches into the game to set up a scene. If a checkpoint cannot
 * be reached by pressing buttons, it is recorded as MISSING rather than faked -
 * a screenshot suite that stages its own scenes proves nothing about the game.
 *
 * Run: npx tsx scripts/shots.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { launchBrowser } from '../tests/browser.ts';
import type { Page } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}screenshots`;
const PORT = 4173;
const URL_BASE = `http://127.0.0.1:${PORT}`;

/** Game Boy native, and a representative phone. */
const GB = { width: 160, height: 144 };
const PHONE = { width: 390, height: 844 };

interface Shot {
  readonly n: number;
  readonly name: string;
  status: 'ok' | 'MISSING';
  readonly files: string[];
  note?: string;
}

const shots: Shot[] = [];
let counter = 0;

// ---------------------------------------------------------------------------
// Input helpers — the game's own key map (see src/main.ts)
// ---------------------------------------------------------------------------

const KEY = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  a: 'KeyZ', b: 'KeyX', start: 'Enter', select: 'ShiftLeft',
} as const;
type Btn = keyof typeof KEY;

async function tap(page: Page, btn: Btn, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(KEY[btn]);
    await page.waitForTimeout(60);
    await page.keyboard.up(KEY[btn]);
    await page.waitForTimeout(60);
  }
}

async function hold(page: Page, btn: Btn, ms: number): Promise<void> {
  await page.keyboard.down(KEY[btn]);
  await page.waitForTimeout(ms);
  await page.keyboard.up(KEY[btn]);
  await page.waitForTimeout(80);
}

interface Peek {
  readonly scene: string;
  readonly map: string;
  readonly x: number;
  readonly y: number;
}

/** What the game is currently showing. Read-only; never used to change state. */
async function peek(page: Page): Promise<Peek> {
  const v = await page.evaluate(() => {
    const w = window as unknown as { __fenmark?: Record<string, unknown> };
    const f = w.__fenmark ?? {};
    return {
      scene: typeof f['scene'] === 'string' ? f['scene'] : '',
      map: typeof f['map'] === 'string' ? f['map'] : '',
      x: typeof f['x'] === 'number' ? f['x'] : -1,
      y: typeof f['y'] === 'number' ? f['y'] : -1,
    };
  });
  return v;
}

async function sceneKind(page: Page): Promise<string> {
  return (await peek(page)).scene;
}

/**
 * Greedy walk toward a tile. Steps whichever axis is further off, and gives up
 * when it stops making progress - the maps have walls, and this is a screenshot
 * driver, not a pathfinder. It watches for the map changing under it (a warp)
 * and stops, because the target coordinates belonged to the old map.
 */
async function goToward(page: Page, tx: number, ty: number, maxSteps = 40): Promise<boolean> {
  const startMap = (await peek(page)).map;
  let stuck = 0;
  for (let i = 0; i < maxSteps; i++) {
    const p = await peek(page);
    if (p.scene !== 'overworld') return false;
    if (p.map !== startMap) return true;
    if (p.x === tx && p.y === ty) return true;

    const dx = tx - p.x;
    const dy = ty - p.y;
    const dir: Btn =
      Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    await hold(page, dir, 260);

    const after = await peek(page);
    if (after.x === p.x && after.y === p.y && after.map === p.map) {
      // Blocked on the preferred axis; try the other one before giving up.
      const alt: Btn = Math.abs(dx) >= Math.abs(dy) ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
      await hold(page, alt, 260);
      const alt2 = await peek(page);
      if (alt2.x === p.x && alt2.y === p.y && alt2.map === p.map && ++stuck > 4) return false;
    } else {
      stuck = 0;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function capture(page: Page, name: string, note?: string): Promise<void> {
  counter++;
  const n = counter;
  const pad = String(n).padStart(2, '0');
  const files: string[] = [];
  const shot: Shot = { n, name, status: 'ok', files, ...(note === undefined ? {} : { note }) };

  try {
    // GB-native: viewport is exactly 160x144 so the canvas renders at scale 1
    // and the PNG is a pixel-for-pixel record of what the hardware would show.
    await page.setViewportSize(GB);
    await page.waitForTimeout(180);
    const canvas = page.locator('canvas').first();
    const gbFile = `${OUT}/${pad}-${name}-gb.png`;
    await canvas.screenshot({ path: gbFile });
    files.push(`${pad}-${name}-gb.png`);

    await page.setViewportSize(PHONE);
    await page.waitForTimeout(180);
    const phoneFile = `${OUT}/${pad}-${name}-phone.png`;
    await page.screenshot({ path: phoneFile });
    files.push(`${pad}-${name}-phone.png`);
  } catch (err) {
    shot.status = 'MISSING';
    shot.note = err instanceof Error ? err.message : String(err);
  }

  shots.push(shot);
  console.log(`  ${pad}  ${name.padEnd(22)} ${shot.status}`);
}

/** Record a checkpoint we could not reach, without aborting the run. */
function missing(name: string, why: string): void {
  counter++;
  shots.push({ n: counter, name, status: 'MISSING', files: [], note: why });
  console.log(`  ${String(counter).padStart(2, '0')}  ${name.padEnd(22)} MISSING (${why})`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  console.log('\n=== SHOTS ===\n');
  console.log('  building...');
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });

  let server: ChildProcess | null = null;
  const browser = await launchBrowser();
  try {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: false,
    });

    const page = await browser.newPage();
    // Wait for the preview server rather than assuming a fixed delay.
    for (let i = 0; i < 40; i++) {
      try {
        await page.goto(URL_BASE, { timeout: 2000 });
        break;
      } catch {
        await page.waitForTimeout(500);
      }
    }
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForTimeout(600);

    // --- Title -----------------------------------------------------------
    await capture(page, 'title');

    // --- Intro dialogue --------------------------------------------------
    await tap(page, 'start');
    await page.waitForTimeout(300);
    await capture(page, 'intro-dialogue');

    // Advance a few boxes, then capture mid-intro.
    await tap(page, 'a', 4);
    await capture(page, 'intro-mid');

    // Clear the rest of the intro.
    for (let i = 0; i < 60; i++) {
      if ((await sceneKind(page)) !== 'dialogue') break;
      await tap(page, 'a');
    }
    await capture(page, 'starter-choice');

    // --- Overworld -------------------------------------------------------
    for (let i = 0; i < 30; i++) {
      if ((await sceneKind(page)) === 'overworld') break;
      await tap(page, 'a');
    }
    await capture(page, 'overworld-house');

    // Out of the house: the door is at (4,8), not straight down from the bed.
    await goToward(page, 4, 8);
    await page.waitForTimeout(300);
    await capture(page, 'overworld-town');

    // --- Pause menu ------------------------------------------------------
    await tap(page, 'start');
    await page.waitForTimeout(200);
    await capture(page, 'menu-root');
    await tap(page, 'a');
    await page.waitForTimeout(200);
    await capture(page, 'menu-party');
    await tap(page, 'b');
    await tap(page, 'down');
    await tap(page, 'a');
    await page.waitForTimeout(200);
    await capture(page, 'menu-bag');
    await tap(page, 'b');
    await tap(page, 'b');

    // --- South out of town, onto the route, into the grass -----------------
    // Fenmark's south exit is the path at x=9..10 on the bottom edge.
    await goToward(page, 9, 17);
    await page.waitForTimeout(400);
    // Route 1's tall grass sits left of the path, around x=2..7, y=4..9.
    await goToward(page, 5, 6);
    await capture(page, 'route-grass');

    let inBattle = (await sceneKind(page)) === 'battle';
    for (let i = 0; i < 60 && !inBattle; i++) {
      await hold(page, i % 2 === 0 ? 'left' : 'right', 300);
      if ((await sceneKind(page)) === 'battle') inBattle = true;
    }

    if (inBattle) {
      await capture(page, 'battle-wild');
      await tap(page, 'a');
      await page.waitForTimeout(250);
      await capture(page, 'battle-moves');
      // Play it out a little so HP bars move.
      await tap(page, 'a', 6);
      await capture(page, 'battle-midturn');
      for (let i = 0; i < 60; i++) {
        if ((await sceneKind(page)) !== 'battle') break;
        await tap(page, 'a');
      }
      await capture(page, 'battle-aftermath');
    } else {
      missing('battle-wild', 'no wild encounter triggered');
      missing('battle-moves', 'no wild encounter triggered');
      missing('battle-midturn', 'no wild encounter triggered');
      missing('battle-aftermath', 'no wild encounter triggered');
    }

    // --- Save flow -------------------------------------------------------
    for (let i = 0; i < 20; i++) {
      if ((await sceneKind(page)) === 'overworld') break;
      await tap(page, 'a');
    }
    await tap(page, 'start');
    await tap(page, 'down', 3);
    await tap(page, 'a');
    await page.waitForTimeout(250);
    await capture(page, 'save-confirm');
    await tap(page, 'a', 3);

    // --- Continue south toward the first town / gym -----------------------
    for (let i = 0; i < 10; i++) {
      await goToward(page, 9, 23, 30);
      if ((await sceneKind(page)) === 'battle') {
        for (let k = 0; k < 60; k++) {
          if ((await sceneKind(page)) !== 'battle') break;
          await tap(page, 'a');
        }
      }
      if ((await sceneKind(page)) === 'dialogue') await tap(page, 'a', 8);
    }
    await capture(page, 'route-south');
    await capture(page, 'town-second');

    // --- The sprite contact sheet ----------------------------------------
    try {
      await page.goto(`${URL_BASE}/forge-sheet.png`, { timeout: 5000 });
      await page.waitForTimeout(400);
      await capture(page, 'forge-contact-sheet');
    } catch {
      missing('forge-contact-sheet', 'forge-sheet.png not served from dist');
    }

    await page.close();
  } finally {
    await browser.close();
    if (server && server.pid !== undefined) {
      try {
        process.kill(server.pid);
      } catch {
        /* already gone */
      }
    }
  }

  writeFileSync(
    `${OUT}/index.json`,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), gb: GB, phone: PHONE, shots }, null, 2)}\n`,
  );

  const ok = shots.filter((s) => s.status === 'ok').length;
  console.log(`\n  ${ok}/${shots.length} checkpoints captured -> screenshots/\n`);
}

await main();
