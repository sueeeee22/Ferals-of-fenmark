/**
 * The stage: the PRODUCTION build, in a real browser, advanced one painted
 * frame at a time.
 *
 * The older screenshot driver pressed keys and then slept, which made every
 * capture a race - the capture labelled "battle-midturn" turned out to be the
 * blackout screen, because the fight had ended while the driver was waiting.
 * Here the page's clock is ours. Nothing moves unless `frames()` is called, so
 * "the frame after the bar changed" is a thing the gate can actually ask for,
 * and two runs see exactly the same pictures.
 *
 * What is NOT faked: the build, the page, the keyboard events, the canvas, the
 * compositor that produces the screenshot. The game runs its own loop off its
 * own `requestAnimationFrame`; all this controls is when the next one fires.
 * And there is still no way to set game state from out here - every scene is
 * reached by pressing buttons.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchBrowser } from '../../tests/browser.ts';
import type { Observation } from '../../src/observe.ts';
import { Frame, SCREEN_H, SCREEN_W, decodePng } from './pixels.ts';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);

/** The subpath GitHub Pages serves from, so asset URLs are exercised for real. */
const BASE = '/Ferals-of-fenmark/';

/** One painted frame of page time. The page's fake clock paints on 16ms boundaries. */
const FRAME_MS = 16;

/**
 * Where the page's clock starts. Fixed, because the game seeds itself from
 * `Date.now()`: a fixed start means the same wild encounters every run, which
 * is what lets a failure be reproduced instead of chased.
 */
const EPOCH = new Date('2026-01-01T12:00:00Z');

const KEY = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  a: 'KeyZ', b: 'KeyX', start: 'Enter', select: 'ShiftLeft',
} as const;
export type Btn = keyof typeof KEY;

/** What the game says it is showing, plus what the renderer says it drew. */
export interface Seen extends Observation {
  /** Where the player sprite was drawn, in screen pixels. */
  readonly px: number;
  readonly py: number;
  /** Where the map's top-left corner was drawn. Tile (tx,ty) is at camX+tx*16, camY+ty*16. */
  readonly camX: number;
  readonly camY: number;
  /** Simulation ticks the last painted frame consumed. */
  readonly ticks: number;
}

export interface Sight {
  readonly seen: Seen;
  readonly frame: Frame;
}

export const GB_VIEW = { width: SCREEN_W, height: SCREEN_H };
export const PHONE_VIEW = { width: 390, height: 844 };

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serve(dist: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (!path.startsWith(BASE)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rel = normalize(path.slice(BASE.length) || 'index.html');
    if (rel.startsWith('..')) {
      res.writeHead(403);
      res.end();
      return;
    }
    readFile(join(dist, rel)).then(
      (body) => {
        res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
        res.end(body);
      },
      () => {
        res.writeHead(404);
        res.end();
      },
    );
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      done({ server, url: `http://127.0.0.1:${port}${BASE}` });
    });
  });
}

/** Build the game exactly as the deploy does. Returns the folder to serve. */
export function build(): { dist: string; seconds: number; error: string | null } {
  const t0 = Date.now();
  const run = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, BASE_PATH: BASE },
  });
  const seconds = (Date.now() - t0) / 1000;
  if (run.status !== 0) {
    const tail = (run.stderr || run.stdout || 'no output').trim().split('\n').slice(-12).join('\n');
    return { dist: join(ROOT, 'dist'), seconds, error: tail };
  }
  return { dist: join(ROOT, 'dist'), seconds, error: null };
}

export class Stage {
  readonly page: Page;
  readonly errors: string[] = [];
  private readonly browser: Browser;
  private readonly context: BrowserContext;
  private readonly server: Server;
  /** Painted frames advanced so far. */
  painted = 0;

  private constructor(browser: Browser, context: BrowserContext, page: Page, server: Server) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.server = server;
  }

  static async open(dist: string): Promise<Stage> {
    if (!existsSync(join(dist, 'index.html'))) throw new Error(`stage: no build at ${dist}`);
    const { server, url } = await serve(dist);
    const browser = await launchBrowser();
    const context = await browser.newContext({ viewport: GB_VIEW, deviceScaleFactor: 1 });
    // Installed and paused BEFORE the page exists, so the game never gets a
    // frame we did not hand it.
    await context.clock.install({ time: EPOCH });
    await context.clock.pauseAt(EPOCH);
    const page = await context.newPage();
    const stage = new Stage(browser, context, page, server);
    page.on('pageerror', (e) => stage.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') stage.errors.push(m.text());
    });
    await page.goto(url, { waitUntil: 'load' });
    return stage;
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
    await new Promise<void>((done) => this.server.close(() => done()));
  }

  // --- time ------------------------------------------------------------------

  /** Let the page paint `n` frames. */
  async frames(n = 1): Promise<void> {
    if (n <= 0) return;
    await this.context.clock.runFor(n * FRAME_MS);
    this.painted += n;
  }

  /** A stall: the page gets no frames for `ms`, then one long one. */
  async hitch(ms: number): Promise<void> {
    await this.context.clock.fastForward(ms);
    this.painted += 1;
  }

  // --- input -----------------------------------------------------------------

  async down(b: Btn): Promise<void> {
    await this.page.keyboard.down(KEY[b]);
  }

  async up(b: Btn): Promise<void> {
    await this.page.keyboard.up(KEY[b]);
  }

  /**
   * One clean button press. Held for two painted frames because the loop can
   * paint a frame that runs no simulation tick, and a press that lands entirely
   * inside one is never seen; released for two for the same reason, so the next
   * press is a new press rather than the same one continuing.
   */
  async press(b: Btn, times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.down(b);
      await this.frames(2);
      await this.up(b);
      await this.frames(2);
    }
  }

  // --- looking ---------------------------------------------------------------

  /** What the game says it is showing. */
  async peek(): Promise<Seen> {
    const raw = await this.page.evaluate(
      () => (window as unknown as { __fenmark?: unknown }).__fenmark ?? null,
    );
    if (raw === null) throw new Error('stage: the game has not published __fenmark - is it running?');
    return raw as Seen;
  }

  /** What the game says it is showing AND the pixels on its canvas, from the same instant. */
  async see(): Promise<Sight> {
    const raw = await this.page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return null;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // Kept in step with DMG_PALETTE; anything else is reported as '4'.
      const palette = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];
      const codes = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < codes.length; i++) {
        const rgb = ((data[i * 4] ?? 0) << 16) | ((data[i * 4 + 1] ?? 0) << 8) | (data[i * 4 + 2] ?? 0);
        const idx = palette.indexOf(rgb);
        codes[i] = 48 + (idx < 0 ? 4 : idx);
      }
      let digits = '';
      for (let i = 0; i < codes.length; i += 8192) {
        digits += String.fromCharCode(...codes.subarray(i, i + 8192));
      }
      return {
        seen: (window as unknown as { __fenmark?: unknown }).__fenmark ?? null,
        w: canvas.width,
        h: canvas.height,
        digits,
      };
    });
    if (raw === null || raw.seen === null) throw new Error('stage: no canvas, or the game is not running');
    return { seen: raw.seen as Seen, frame: Frame.fromDigits(raw.digits, raw.w, raw.h) };
  }

  /**
   * A real screenshot, through the compositor - what a person would see, as
   * opposed to what the canvas holds. Returns the PNG and the decoded picture.
   */
  async screenshot(): Promise<{ png: Buffer; frame: Frame }> {
    const png = await this.page.screenshot({ animations: 'allow', caret: 'initial' });
    const bmp = decodePng(png);
    return { png, frame: Frame.fromRgba(bmp.rgba, bmp.width, bmp.height) };
  }

  /**
   * Resize the page and wait until the game has noticed. The resize clears the
   * canvas, so one frame is painted before returning - otherwise the next
   * screenshot is of nothing.
   */
  async resize(view: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(view);
    for (let i = 0; i < 100; i++) {
      const ok = await this.page.evaluate(
        (want) => {
          const c = document.querySelector('canvas');
          if (!c) return false;
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          return window.innerWidth === want.width && c.width === Math.round(c.getBoundingClientRect().width * dpr);
        },
        view,
      );
      if (ok) break;
      await this.page.waitForTimeout(10);
    }
    await this.frames(1);
  }
}
