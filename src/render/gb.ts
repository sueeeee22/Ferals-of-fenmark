/**
 * The Game Boy presentation layer.
 *
 * Everything in this file is mechanical: a 4-shade palette, an 8x8 font, a
 * bordered window, a 16x16 tile set, and a couple of tiny procedurally-drawn
 * actors. `draw.ts` composes these into screens; nothing here knows what a
 * battle or a menu is.
 *
 * Performance contract: every pixel pattern in this file (font glyphs, tile
 * art, actor poses) is baked into an offscreen `<canvas>` exactly once, the
 * first time it is needed, and cached. The per-frame path only ever calls
 * `drawImage`/`fillRect` against those caches — no `ImageData` is built and
 * no pixel buffer is allocated after startup.
 */

import { DMG_PALETTE, SPRITE_SIZE, toRgba, type Pixels } from './forge.ts';
import { Tile, type Dir } from '../core/world.ts';

// ---------------------------------------------------------------------------
// Screen geometry
// ---------------------------------------------------------------------------

export const LOGICAL_W = 160;
export const LOGICAL_H = 144;
export const TILE_SIZE = 16;

export type Shade = 0 | 1 | 2 | 3;

export function shadeColor(shade: Shade): string {
  const c = DMG_PALETTE[shade] ?? DMG_PALETTE[0] ?? [0, 0, 0];
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function must2d(canvas: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', opts);
  if (!ctx) throw new Error('gb: 2d context unavailable');
  return ctx;
}

function offscreen(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = must2d(canvas);
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

// ---------------------------------------------------------------------------
// 8x8 font
//
// Glyphs are authored as readable 5-wide/7-tall ASCII-art rows ('#' = ink)
// and packed once, at module load, into 8-byte rows (bit 7 = leftmost pixel
// of the 8px cell). glyph() insets the art by 1px so characters get a little
// breathing room without hand-editing every row.
// ---------------------------------------------------------------------------

function glyph(rows: readonly string[]): Uint8Array {
  const out = new Uint8Array(8);
  for (let r = 0; r < 8; r++) {
    const row = rows[r] ?? '';
    let byte = 0;
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') byte |= 1 << (7 - (c + 1));
    }
    out[r] = byte;
  }
  return out;
}

const FONT_SOURCE: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],

  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['.....', '.....', '.####', '#....', '#....', '#....', '.####'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.####'],
  f: ['..##.', '.#...', '####.', '.#...', '.#...', '.#...', '.#...'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  i: ['..#..', '.....', '..#..', '..#..', '..#..', '..#..', '..#..'],
  j: ['...#.', '.....', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  l: ['.#...', '.#...', '.#...', '.#...', '.#...', '.#...', '.#...'],
  m: ['.....', '.....', '.#.#.', '#.#.#', '#.#.#', '#...#', '#...#'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#...', '.#...', '####.', '.#...', '.#...', '.#...', '..##.'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],

  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '..##.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],

  ' ': [],
  '`': ['.##..', '..##.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '..##.', '..##.'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..##.', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  "'": ['.##..', '.##..'],
  '"': ['.#.#.', '.#.#.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '..##.', '..##.', '.....', '..##.', '..##.', '.....'],
  ';': ['.....', '..##.', '..##.', '.....', '..##.', '.##..', '.....'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '♂': ['...##', '..##.', '.#.#.', '#...#', '#...#', '#...#', '.###.'], // ♂
  '♀': ['.###.', '#...#', '#...#', '#...#', '.###.', '..#..', '.###.'], // ♀
  '×': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'], // ×
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'], // …
  '▶': ['#....', '##...', '###..', '####.', '###..', '##...', '#....'], // ▶
  '▼': ['#####', '.###.', '.###.', '..#..', '.....', '.....', '.....'], // ▼
};

const FONT: Readonly<Record<string, Uint8Array>> = Object.freeze(
  Object.fromEntries(Object.entries(FONT_SOURCE).map(([ch, rows]) => [ch, glyph(rows)])),
);

/** Advance ARROW glyph, exported so draw.ts can use it as a standalone cursor mark. */
export const ADVANCE_PROMPT = '▼';
export const CURSOR_GLYPH = '▶';

const glyphCanvasCache = new Map<string, HTMLCanvasElement>();

function glyphCanvas(ch: string, shade: Shade): HTMLCanvasElement | null {
  const key = `${ch}\u0000${shade}`;
  const cached = glyphCanvasCache.get(key);
  if (cached) return cached;
  const bits = FONT[ch];
  if (!bits) return null;
  const { canvas, ctx } = offscreen(8, 8);
  ctx.fillStyle = shadeColor(shade);
  for (let r = 0; r < 8; r++) {
    const row = bits[r] ?? 0;
    for (let c = 0; c < 8; c++) {
      if (row & (1 << (7 - c))) ctx.fillRect(c, r, 1, 1);
    }
  }
  glyphCanvasCache.set(key, canvas);
  return canvas;
}

/** Pixel width of monospace text at 8px/char — matches the 18-char text box exactly. */
export function measureText(text: string): number {
  return text.length * 8;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  shade: Shade = 3,
): void {
  let cx = x;
  for (const ch of text) {
    const g = glyphCanvas(ch, shade);
    if (g) ctx.drawImage(g, cx, y);
    cx += 8;
  }
}

/** Greedy word wrap at `maxChars` per row. Overlong single words are hard-cut. */
/**
 * Re-exported from core so the renderer and the reducer wrap identically.
 * They MUST agree: the reducer decides which page you are on, the renderer
 * draws it, and a disagreement means text is revealed that nobody can read.
 */
export { wrapText } from '../core/text.ts';

// ---------------------------------------------------------------------------
// Windows (Gen 1's bordered boxes)
// ---------------------------------------------------------------------------

/** 1px dark frame, light fill. `x/y/w/h` should land on 8px tile boundaries. */
export function drawBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = shadeColor(3);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = shadeColor(0);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

// 18 chars * 8px = 144px of actual text, so the box has to be wider than that
// once its own padding is added back — sizing the box to 144 and *then*
// padding inward (the obvious way to write this) quietly clips two characters
// off every row.
export const TEXTBOX_PAD = 4;
export const TEXTBOX_X = 4;
export const TEXTBOX_Y = 96;
export const TEXTBOX_W = 18 * 8 + TEXTBOX_PAD * 2;
export const TEXTBOX_H = 40;
const TEXTBOX_ROW_H = 14;

/**
 * The 2-line, 18-char bottom text box with a typewriter reveal and a blinking
 * ▼ once the visible rows are fully revealed. `lines` is the current
 * dialogue line already word-wrapped to <=18 chars/row (see `wrapText`);
 * `charsShown` counts revealed characters across the wrapped rows, one space
 * assumed consumed between them.
 */
export function drawTextBox(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  charsShown: number,
  showPrompt: boolean,
): void {
  drawBox(ctx, TEXTBOX_X, TEXTBOX_Y, TEXTBOX_W, TEXTBOX_H);
  let remaining = charsShown;
  for (let i = 0; i < 2; i++) {
    const row = lines[i] ?? '';
    const take = Math.max(0, Math.min(row.length, remaining));
    if (take > 0) {
      drawText(ctx, TEXTBOX_X + TEXTBOX_PAD, TEXTBOX_Y + TEXTBOX_PAD + i * TEXTBOX_ROW_H, row.slice(0, take), 3);
    }
    remaining -= row.length + 1;
  }
  if (showPrompt) {
    drawText(ctx, TEXTBOX_X + TEXTBOX_W - 16, TEXTBOX_Y + TEXTBOX_H - 14, ADVANCE_PROMPT, 3);
  }
}

// ---------------------------------------------------------------------------
// HP bars
// ---------------------------------------------------------------------------

/** 48px-wide by default. Fill shade drops at 50% and again at 20% HP. */
export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cur: number,
  max: number,
  width = 48,
): void {
  const h = 4;
  ctx.fillStyle = shadeColor(3);
  ctx.fillRect(x, y, width + 2, h + 2);
  ctx.fillStyle = shadeColor(0);
  ctx.fillRect(x + 1, y + 1, width, h);
  const frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const filled = Math.round(width * frac);
  if (filled <= 0) return;
  const shade: Shade = frac <= 0.2 ? 3 : frac <= 0.5 ? 2 : 1;
  ctx.fillStyle = shadeColor(shade);
  ctx.fillRect(x + 1, y + 1, filled, h);
}

// ---------------------------------------------------------------------------
// Creature sprites (forge.ts Pixels -> cached canvas)
// ---------------------------------------------------------------------------

const spriteCanvasCache = new WeakMap<Pixels, HTMLCanvasElement>();

function spriteCanvas(pixels: Pixels): HTMLCanvasElement {
  const cached = spriteCanvasCache.get(pixels);
  if (cached) return cached;
  const { canvas, ctx } = offscreen(SPRITE_SIZE, SPRITE_SIZE);
  const rgba = new Uint8ClampedArray(toRgba(pixels));
  ctx.putImageData(new ImageData(rgba, SPRITE_SIZE, SPRITE_SIZE), 0, 0);
  spriteCanvasCache.set(pixels, canvas);
  return canvas;
}

/** Blits a forge `Pixels` buffer. Renders and caches its canvas on first use. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  pixels: Pixels,
  x: number,
  y: number,
  scale = 1,
  flipX = false,
): void {
  const canvas = spriteCanvas(pixels);
  const w = SPRITE_SIZE * scale;
  const h = SPRITE_SIZE * scale;
  if (!flipX) {
    ctx.drawImage(canvas, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tile art — a hand-authored 16x16 pattern (or two, for animated tiles) for
// every id in world.ts's Tile table. Patterns are plain index buffers built
// once at module load (DOM-free); the canvases blitted at draw time are baked
// lazily the first time each tile/frame pair is actually drawn.
// ---------------------------------------------------------------------------

const TS = TILE_SIZE;

function blankGrid(fill: Shade | 0): Uint8Array {
  const g = new Uint8Array(TS * TS);
  g.fill(fill);
  return g;
}

function setPx(g: Uint8Array, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= TS || y >= TS) return;
  g[y * TS + x] = v;
}

function getPx(g: Uint8Array, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= TS || y >= TS) return 0;
  return g[y * TS + x] ?? 0;
}

function fillRectG(g: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(TS - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(TS - 1, x1); x++) setPx(g, x, y, v);
  }
}

function circleG(g: Uint8Array, cx: number, cy: number, r: number, v: number): void {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) setPx(g, x, y, v);
    }
  }
}

/** Deterministic hash noise, used for stipple/texture instead of Math.random. */
function noise(x: number, y: number, salt: number): number {
  let n = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n ^ (n >>> 16)) >>> 0;
}

function stipple(g: Uint8Array, v: number, pct: number, salt: number): void {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      if (noise(x, y, salt) % 100 < pct) setPx(g, x, y, v);
    }
  }
}

/** Grass base with a sparse ordered-dither of darker blades. */
function tileGrass(): Uint8Array {
  const g = blankGrid(1);
  stipple(g, 2, 18, 11);
  for (let i = 0; i < 4; i++) {
    const x = (noise(i, 0, 21) % 12) + 2;
    const y = (noise(i, 1, 22) % 10) + 3;
    setPx(g, x, y, 2);
    setPx(g, x, y - 1, 2);
  }
  return g;
}

/** Two frames: taller blades swaying left/right. */
function tileTallGrass(frame: 0 | 1): Uint8Array {
  const g = blankGrid(1);
  stipple(g, 2, 24, 31);
  const lean = frame === 0 ? -1 : 1;
  for (let i = 0; i < 6; i++) {
    const bx = 1 + i * 2 + (i % 2);
    const by = 15;
    for (let s = 0; s < 6; s++) {
      setPx(g, bx + (s > 3 ? lean : 0), by - s, 3);
    }
  }
  return g;
}

function tileWater(frame: 0 | 1): Uint8Array {
  const g = blankGrid(2);
  const shift = frame === 0 ? 0 : 4;
  for (let y = 0; y < TS; y += 4) {
    for (let x = 0; x < TS; x++) {
      if ((x + shift) % 8 < 4) setPx(g, x, y + 1, 1);
    }
  }
  return g;
}

function tilePath(): Uint8Array {
  const g = blankGrid(0);
  stipple(g, 1, 12, 41);
  return g;
}

function tileFloor(): Uint8Array {
  const g = blankGrid(0);
  for (let y = 3; y < TS; y += 5) fillRectG(g, 0, y, TS - 1, y, 1);
  return g;
}

function tileWall(): Uint8Array {
  const g = blankGrid(2);
  for (let y = 0; y < TS; y += 4) fillRectG(g, 0, y, TS - 1, y, 3);
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = offset; x < TS; x += 8) fillRectG(g, x, row * 4, x, row * 4 + 3, 3);
  }
  return g;
}

function tileTree(): Uint8Array {
  const g = blankGrid(1);
  circleG(g, 8, 7, 7, 2);
  circleG(g, 8, 7, 5, 1);
  stipple(g, 2, 20, 55);
  fillRectG(g, 7, 13, 8, 15, 3);
  return g;
}

function tileRock(): Uint8Array {
  const g = blankGrid(1);
  circleG(g, 8, 10, 6, 2);
  circleG(g, 6, 8, 3, 2);
  circleG(g, 10, 9, 3, 2);
  setPx(g, 8, 8, 3);
  setPx(g, 7, 9, 3);
  setPx(g, 9, 11, 3);
  fillRectG(g, 5, 6, 6, 6, 1);
  return g;
}

function tileHouse(): Uint8Array {
  const g = blankGrid(1);
  fillRectG(g, 0, 8, TS - 1, TS - 1, 1);
  for (let y = 0; y < 8; y++) {
    fillRectG(g, y, y, TS - 1 - y, y, 3);
  }
  fillRectG(g, 3, 9, 6, 12, 2);
  fillRectG(g, 9, 9, 12, 12, 2);
  return g;
}

function tileDoor(): Uint8Array {
  const g = blankGrid(0);
  fillRectG(g, 3, 2, 12, 15, 1);
  fillRectG(g, 3, 2, 12, 2, 3);
  fillRectG(g, 5, 4, 10, 15, 3);
  fillRectG(g, 6, 5, 9, 15, 2);
  setPx(g, 9, 10, 3);
  return g;
}

function tileSign(): Uint8Array {
  const g = blankGrid(1);
  fillRectG(g, 7, 8, 8, 15, 2);
  fillRectG(g, 2, 2, 13, 9, 1);
  fillRectG(g, 2, 2, 13, 2, 3);
  fillRectG(g, 2, 9, 13, 9, 3);
  fillRectG(g, 2, 2, 2, 9, 3);
  fillRectG(g, 13, 2, 13, 9, 3);
  fillRectG(g, 4, 5, 11, 5, 2);
  fillRectG(g, 4, 7, 9, 7, 2);
  return g;
}

function tileCounter(): Uint8Array {
  const g = blankGrid(1);
  fillRectG(g, 0, 0, TS - 1, 6, 1);
  fillRectG(g, 0, 6, TS - 1, 8, 3);
  fillRectG(g, 0, 9, TS - 1, TS - 1, 2);
  return g;
}

function tileCarpet(): Uint8Array {
  const g = blankGrid(2);
  fillRectG(g, 1, 1, TS - 2, TS - 2, 2);
  fillRectG(g, 0, 0, TS - 1, 0, 3);
  fillRectG(g, 0, TS - 1, TS - 1, TS - 1, 3);
  fillRectG(g, 0, 0, 0, TS - 1, 3);
  fillRectG(g, TS - 1, 0, TS - 1, TS - 1, 3);
  circleG(g, 8, 8, 3, 1);
  return g;
}

function tileLedge(): Uint8Array {
  const g = tileGrass();
  fillRectG(g, 0, 0, TS - 1, 3, 1);
  fillRectG(g, 0, 3, TS - 1, 3, 3);
  fillRectG(g, 0, 4, TS - 1, 4, 2);
  for (let x = 3; x < TS; x += 5) setPx(g, x, 5, 3);
  return g;
}

function tileSand(): Uint8Array {
  const g = blankGrid(0);
  stipple(g, 1, 22, 61);
  return g;
}

function tileSnow(): Uint8Array {
  const g = blankGrid(0);
  stipple(g, 1, 10, 71);
  return g;
}

function tileDeepSnow(): Uint8Array {
  const g = blankGrid(1);
  for (let y = 2; y < TS; y += 6) {
    for (let x = 0; x < TS; x++) {
      if ((x + y) % 6 < 3) setPx(g, x, y, 0);
    }
  }
  return g;
}

function tileFlower(): Uint8Array {
  const g = tileGrass();
  const spots: ReadonlyArray<readonly [number, number]> = [[3, 4], [11, 3], [6, 10], [12, 12]];
  for (const [x, y] of spots) {
    circleG(g, x, y, 1, 0);
    setPx(g, x, y, 3);
  }
  return g;
}

function tileFence(): Uint8Array {
  const g = blankGrid(1);
  for (let x = 1; x < TS; x += 5) fillRectG(g, x, 4, x + 1, TS - 1, 2);
  fillRectG(g, 0, 6, TS - 1, 7, 3);
  fillRectG(g, 0, 11, TS - 1, 12, 3);
  return g;
}

function tileBridge(): Uint8Array {
  const g = blankGrid(1);
  for (let x = 0; x < TS; x += 3) fillRectG(g, x, 0, x, TS - 1, 2);
  fillRectG(g, 0, 0, TS - 1, 1, 3);
  fillRectG(g, 0, TS - 2, TS - 1, TS - 1, 3);
  return g;
}

function tileCaveFloor(): Uint8Array {
  const g = blankGrid(1);
  stipple(g, 2, 18, 81);
  return g;
}

function tileCaveWall(): Uint8Array {
  const g = blankGrid(2);
  stipple(g, 3, 20, 91);
  stipple(g, 1, 10, 92);
  fillRectG(g, 0, 0, TS - 1, 0, 3);
  return g;
}

function tileStairs(): Uint8Array {
  const g = blankGrid(1);
  for (let i = 0; i < 4; i++) {
    const y = i * 4;
    fillRectG(g, 0, y, TS - 1, y, 3);
    fillRectG(g, 0, y + 1, TS - 1, y + 3, i % 2 === 0 ? 1 : 2);
  }
  return g;
}

function tileBed(): Uint8Array {
  const g = blankGrid(0);
  fillRectG(g, 1, 1, TS - 2, TS - 2, 1);
  fillRectG(g, 1, 1, TS - 2, 1, 3);
  fillRectG(g, 1, TS - 2, TS - 2, TS - 2, 3);
  fillRectG(g, 1, 1, 1, TS - 2, 3);
  fillRectG(g, TS - 2, 1, TS - 2, TS - 2, 3);
  fillRectG(g, 2, 2, TS - 3, 5, 2);
  for (let y = 8; y < TS - 2; y += 3) fillRectG(g, 2, y, TS - 3, y, 2);
  return g;
}

function tileTable(): Uint8Array {
  const g = blankGrid(0);
  fillRectG(g, 0, 3, TS - 1, 10, 2);
  fillRectG(g, 0, 3, TS - 1, 3, 3);
  fillRectG(g, 1, 11, 2, TS - 1, 3);
  fillRectG(g, TS - 3, 11, TS - 2, TS - 1, 3);
  return g;
}

function tileVoid(): Uint8Array {
  return blankGrid(3);
}

const TILE_GENERATORS: Readonly<Record<number, () => readonly Uint8Array[]>> = {
  [Tile.Void]: () => [tileVoid()],
  [Tile.Floor]: () => [tileFloor()],
  [Tile.Grass]: () => [tileGrass()],
  [Tile.TallGrass]: () => [tileTallGrass(0), tileTallGrass(1)],
  [Tile.Path]: () => [tilePath()],
  [Tile.Water]: () => [tileWater(0), tileWater(1)],
  [Tile.Wall]: () => [tileWall()],
  [Tile.Tree]: () => [tileTree()],
  [Tile.Rock]: () => [tileRock()],
  [Tile.House]: () => [tileHouse()],
  [Tile.Door]: () => [tileDoor()],
  [Tile.Sign]: () => [tileSign()],
  [Tile.Counter]: () => [tileCounter()],
  [Tile.Carpet]: () => [tileCarpet()],
  [Tile.LedgeDown]: () => [tileLedge()],
  [Tile.Sand]: () => [tileSand()],
  [Tile.Snow]: () => [tileSnow()],
  [Tile.DeepSnow]: () => [tileDeepSnow()],
  [Tile.Flower]: () => [tileFlower()],
  [Tile.Fence]: () => [tileFence()],
  [Tile.Bridge]: () => [tileBridge()],
  [Tile.CaveFloor]: () => [tileCaveFloor()],
  [Tile.CaveWall]: () => [tileCaveWall()],
  [Tile.Stairs]: () => [tileStairs()],
  [Tile.Bed]: () => [tileBed()],
  [Tile.Table]: () => [tileTable()],
};

/** Raw index patterns for every tile id — 1 frame normally, 2 for animated tiles. */
export const TILE_ART: Readonly<Record<number, readonly Uint8Array[]>> = Object.freeze(
  Object.fromEntries(Object.entries(TILE_GENERATORS).map(([id, gen]) => [Number(id), gen()])),
);

function tileToCanvas(pattern: Uint8Array): HTMLCanvasElement {
  const { canvas, ctx } = offscreen(TS, TS);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const v = getPx(pattern, x, y) as Shade;
      ctx.fillStyle = shadeColor(v);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

const tileCanvasCache = new Map<string, HTMLCanvasElement>();

/** Draws one 16x16 tile at its animation frame (frame is taken mod the tile's frame count). */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  tileId: number,
  frame: number,
  x: number,
  y: number,
): void {
  const frames = TILE_ART[tileId] ?? TILE_ART[Tile.Void];
  if (!frames || frames.length === 0) return;
  const idx = ((frame % frames.length) + frames.length) % frames.length;
  const key = `${tileId}:${idx}`;
  let canvas = tileCanvasCache.get(key);
  if (!canvas) {
    const pattern = frames[idx];
    if (!pattern) return;
    canvas = tileToCanvas(pattern);
    tileCanvasCache.set(key, canvas);
  }
  ctx.drawImage(canvas, x, y);
}

// ---------------------------------------------------------------------------
// Actors — the player and NPCs. Small procedurally-composed 16x16 humanoids;
// the silhouette (hair/hat/shirt shade) is hashed from the sprite id so every
// NPC reads as a distinct person without hand art for each one.
// ---------------------------------------------------------------------------

interface ActorVariant {
  readonly hair: Shade;
  readonly shirt: Shade;
  readonly hat: boolean;
}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SHADE_CYCLE: readonly Shade[] = [1, 2, 3];

function variantFor(spriteId: string): ActorVariant {
  const h = hashStr(spriteId);
  return {
    hair: SHADE_CYCLE[h % 3] ?? 3,
    shirt: SHADE_CYCLE[Math.floor(h / 3) % 3] ?? 2,
    hat: (h >>> 4) % 2 === 0,
  };
}

/** Player's own look is fixed rather than hashed — it's the sprite a player stares at all game. */
const PLAYER_VARIANT: ActorVariant = { hair: 3, shirt: 2, hat: true };

function outlineActor(g: Uint8Array): void {
  const src = g.slice();
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      if ((src[y * TS + x] ?? 0) !== 0) continue;
      const n =
        (src[y * TS + x - 1] ?? 0) || (src[y * TS + x + 1] ?? 0) ||
        (src[(y - 1) * TS + x] ?? 0) || (src[(y + 1) * TS + x] ?? 0);
      if (n !== 0 && x > 0 && x < TS - 1) setPx(g, x, y, 3);
    }
  }
}

/**
 * frame: 0 = standing, 1/3 = mid-stride (leg forward alternates by `step`).
 * The step direction is derived by the caller from tile-position parity, so
 * consecutive steps alternate feet without needing extra core state.
 */
function humanoidPixels(dir: Dir, frame: number, step: -1 | 0 | 1, v: ActorVariant): Uint8Array {
  const g = new Uint8Array(TS * TS);
  const legLift = frame === 0 ? 0 : 1;
  const leftUp = step <= 0 ? legLift : 0;
  const rightUp = step >= 0 ? legLift : 0;

  if (dir === 'left' || dir === 'right') {
    const mirror = dir === 'right';
    const flip = (x: number): number => (mirror ? TS - 1 - x : x);
    fillRectG(g, flip(5), 1, flip(10), 2, v.hair);
    if (v.hat) fillRectG(g, flip(4), 0, flip(11), 1, v.hair);
    fillRectG(g, flip(6), 3, flip(9), 6, 1);
    setPx(g, flip(7), 4, 3);
    fillRectG(g, flip(5), 7, flip(10), 11, v.shirt);
    fillRectG(g, flip(6), 12 + leftUp, flip(7), 14 + leftUp, 3);
    fillRectG(g, flip(8), 12 + rightUp, flip(9), 14 + rightUp, 3);
    outlineActor(g);
    return g;
  }

  const back = dir === 'up';
  fillRectG(g, 4, 1, 11, back ? 6 : 3, v.hair);
  if (v.hat) fillRectG(g, 3, 0, 12, 1, v.hair);
  if (!back) {
    fillRectG(g, 5, 4, 10, 6, 1);
    setPx(g, 6, 5, 3);
    setPx(g, 9, 5, 3);
  }
  fillRectG(g, 4, 7, 11, 11, v.shirt);
  fillRectG(g, 3, 8, 3, 10, v.shirt);
  fillRectG(g, 12, 8, 12, 10, v.shirt);
  fillRectG(g, 5, 12 + leftUp, 7, 14 + leftUp, 3);
  fillRectG(g, 8, 12 + rightUp, 10, 14 + rightUp, 3);
  outlineActor(g);
  return g;
}

const actorCanvasCache = new Map<string, HTMLCanvasElement>();

/**
 * Draws the player or an NPC. `frame` is 0 (idle) or 1..3 (mid-stride,
 * matching WalkState.progress buckets); `step` biases which leg leads.
 */
export function drawActor(
  ctx: CanvasRenderingContext2D,
  spriteId: string,
  dir: Dir,
  frame: number,
  step: -1 | 0 | 1,
  x: number,
  y: number,
): void {
  const key = `${spriteId}:${dir}:${frame}:${step}`;
  let canvas = actorCanvasCache.get(key);
  if (!canvas) {
    const variant = spriteId === 'player' ? PLAYER_VARIANT : variantFor(spriteId);
    const pixels = humanoidPixels(dir, frame, step, variant);
    const { canvas: c, ctx: actorCtx } = offscreen(TS, TS);
    for (let py = 0; py < TS; py++) {
      for (let px = 0; px < TS; px++) {
        const v = pixels[py * TS + px] ?? 0;
        if (v === 0) continue;
        actorCtx.fillStyle = shadeColor(v as Shade);
        actorCtx.fillRect(px, py, 1, 1);
      }
    }
    canvas = c;
    actorCanvasCache.set(key, canvas);
  }
  ctx.drawImage(canvas, x, y);
}

// ---------------------------------------------------------------------------
// Screen scaling — integer scale, nearest-neighbour, letterboxed.
// ---------------------------------------------------------------------------

export interface Screen {
  /** Draw into this — it is always exactly 160x144. */
  readonly ctx: CanvasRenderingContext2D;
  /** Blit the logical frame to the real canvas at the current integer scale. */
  present(): void;
  /** Recompute the integer scale from the display canvas's CSS box. Call on resize. */
  resize(): void;
}

export function createScreen(displayCanvas: HTMLCanvasElement): Screen {
  const logical = document.createElement('canvas');
  logical.width = LOGICAL_W;
  logical.height = LOGICAL_H;
  const ctx = must2d(logical, { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const displayCtx = must2d(displayCanvas, { alpha: false });
  displayCtx.imageSmoothingEnabled = false;

  let scale = 1;
  let offX = 0;
  let offY = 0;

  function resize(): void {
    // Capped rather than raw devicePixelRatio: beyond 2x the extra backing-store
    // pixels buy no visible crispness for 16px tile art, only GPU/memory cost.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = displayCanvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    scale = Math.max(1, Math.floor(Math.min((cssW * dpr) / LOGICAL_W, (cssH * dpr) / LOGICAL_H)));
    const pixelW = Math.round(cssW * dpr);
    const pixelH = Math.round(cssH * dpr);
    if (displayCanvas.width !== pixelW) displayCanvas.width = pixelW;
    if (displayCanvas.height !== pixelH) displayCanvas.height = pixelH;
    displayCtx.imageSmoothingEnabled = false;
    offX = Math.floor((pixelW - LOGICAL_W * scale) / 2);
    offY = Math.floor((pixelH - LOGICAL_H * scale) / 2);
  }

  function present(): void {
    displayCtx.fillStyle = '#000000';
    displayCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
    displayCtx.drawImage(logical, 0, 0, LOGICAL_W, LOGICAL_H, offX, offY, LOGICAL_W * scale, LOGICAL_H * scale);
  }

  resize();
  return { ctx, present, resize };
}
