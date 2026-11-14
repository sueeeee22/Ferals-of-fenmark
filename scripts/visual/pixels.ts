/**
 * Reading a Game Boy screen back off its pixels.
 *
 * Everything `gauntlet:visual` knows about the picture comes through here, and
 * none of it asks the renderer where it put things. Boxes are found by their
 * borders, health bars by their outline, sprites by being the big dark shapes
 * that are not boxes, and text is READ - matched glyph by glyph against the
 * game's own 8x8 font - so the gate can say "the box reads `Wint`" rather than
 * "the name field has the right length".
 *
 * Pure functions over a 160x144 buffer of shade indices. No browser, no canvas.
 */
import { inflateSync } from 'node:zlib';
import { FONT } from '../../src/render/gb.ts';
import { DMG_PALETTE } from '../../src/render/forge.ts';
import { encodePng } from '../png.ts';

export const SCREEN_W = 160;
export const SCREEN_H = 144;

/** Darkest shade: outlines, borders and every letter the game draws. */
export const INK = 3;
/** A pixel that is not one of the four Game Boy colours at all. */
export const OFF_PALETTE = 4;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: r.w - by * 2, h: r.h - by * 2 };
}

export function rectText(r: Rect): string {
  return `(${r.x},${r.y}) ${r.w}x${r.h}`;
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export function shadeOfRgb(r: number, g: number, b: number): number {
  for (let i = 0; i < DMG_PALETTE.length; i++) {
    const c = DMG_PALETTE[i];
    if (c && c[0] === r && c[1] === g && c[2] === b) return i;
  }
  return OFF_PALETTE;
}

export class Frame {
  readonly px: Uint8Array;
  readonly w: number;
  readonly h: number;

  constructor(px: Uint8Array, w: number = SCREEN_W, h: number = SCREEN_H) {
    this.px = px;
    this.w = w;
    this.h = h;
  }

  /** One character per pixel, '0'-'4' - the form the browser hands frames over in. */
  static fromDigits(digits: string, w: number = SCREEN_W, h: number = SCREEN_H): Frame {
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) px[i] = digits.charCodeAt(i) - 48;
    return new Frame(px, w, h);
  }

  static fromRgba(rgba: Uint8Array, w: number, h: number): Frame {
    const px = new Uint8Array(w * h);
    for (let i = 0; i < px.length; i++) {
      px[i] = shadeOfRgb(rgba[i * 4] ?? 0, rgba[i * 4 + 1] ?? 0, rgba[i * 4 + 2] ?? 0);
    }
    return new Frame(px, w, h);
  }

  get bounds(): Rect {
    return { x: 0, y: 0, w: this.w, h: this.h };
  }

  /** Shade at a pixel, or -1 off the edge of the screen. */
  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.px[y * this.w + x] ?? -1;
  }

  ink(x: number, y: number): boolean {
    return this.at(x, y) === INK;
  }

  /** How many pixels of each shade a region holds: [0, 1, 2, 3, off-palette]. */
  histogram(r: Rect = this.bounds): number[] {
    const out = [0, 0, 0, 0, 0];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const s = this.at(x, y);
        if (s >= 0) out[s] = (out[s] ?? 0) + 1;
      }
    }
    return out;
  }

  /** FNV-1a over a region. Two regions that hash alike look alike. */
  hash(r: Rect = this.bounds): number {
    let h = 0x811c9dc5;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        h ^= this.at(x, y) + 1;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
    return h >>> 0;
  }

  /** Pixels that differ from another frame of the same size, inside a region. */
  diff(other: Frame, r: Rect = this.bounds): number {
    let n = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (this.at(x, y) !== other.at(x, y)) n++;
      }
    }
    return n;
  }

  crop(r: Rect): Frame {
    const px = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) px[y * r.w + x] = Math.max(0, this.at(r.x + x, r.y + y));
    }
    return new Frame(px, r.w, r.h);
  }

  /** For looking at what the gate saw. Off-palette pixels come out magenta. */
  toPng(scale = 1): Buffer {
    const rgba = new Uint8Array(this.w * scale * this.h * scale * 4);
    for (let y = 0; y < this.h * scale; y++) {
      for (let x = 0; x < this.w * scale; x++) {
        const s = this.at(Math.floor(x / scale), Math.floor(y / scale));
        const c = DMG_PALETTE[s] ?? [255, 0, 255];
        const i = (y * this.w * scale + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }
    return encodePng(this.w * scale, this.h * scale, rgba);
  }
}

// ---------------------------------------------------------------------------
// PNG decoding - just enough for a browser screenshot (8-bit RGB or RGBA).
// ---------------------------------------------------------------------------

export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export function decodePng(buf: Uint8Array): Bitmap {
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.readUInt32BE(0) !== 0x89504e47) throw new Error('decodePng: not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < view.length) {
    const len = view.readUInt32BE(pos);
    const type = view.toString('latin1', pos + 4, pos + 8);
    const data = view.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colour = data[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || data[12] !== 0) {
        throw new Error(`decodePng: unsupported format (depth ${depth}, colour ${colour})`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i] ?? 0;
      const a = i >= channels ? (line[i - channels] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= channels ? (prev[i - channels] ?? 0) : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels] ?? 0;
      rgba[o + 1] = line[x * channels + 1] ?? 0;
      rgba[o + 2] = line[x * channels + 2] ?? 0;
      rgba[o + 3] = channels === 4 ? (line[x * channels + 3] ?? 255) : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// Boxes - Gen 1's bordered windows, found by their borders
// ---------------------------------------------------------------------------

const MIN_BOX_W = 16;
const MIN_BOX_H = 12;

/**
 * Every bordered window on screen: a one-pixel ink frame around a light field.
 *
 * Found from the top-left corner outward. The row just inside the top border is
 * always empty in a correct render (every box pads its contents by at least
 * three pixels), which is what tells a window from a tile that merely has a
 * dark line across it.
 */
export function findBoxes(f: Frame): Rect[] {
  const boxes: Rect[] = [];
  for (let y = 0; y < f.h - MIN_BOX_H; y++) {
    for (let x = 0; x < f.w - MIN_BOX_W; x++) {
      // A top-left corner: ink here, ink below, and the field starting diagonally in.
      if (!f.ink(x, y) || !f.ink(x, y + 1) || !f.ink(x + 1, y) || f.at(x + 1, y + 1) !== 0) continue;

      // Run right along the empty row until the far border.
      let x2 = x + 1;
      while (x2 < f.w && f.at(x2, y + 1) === 0 && f.ink(x2, y)) x2++;
      if (x2 >= f.w || !f.ink(x2, y + 1) || !f.ink(x2, y)) continue;
      if (x2 - x + 1 < MIN_BOX_W) continue;

      // Run down both sides until a row that is ink all the way across.
      let y2 = y + 1;
      const rowIsBorder = (yy: number): boolean => {
        for (let xx = x; xx <= x2; xx++) if (!f.ink(xx, yy)) return false;
        return true;
      };
      while (y2 < f.h && f.ink(x, y2) && f.ink(x2, y2) && !rowIsBorder(y2)) y2++;
      if (y2 >= f.h || !rowIsBorder(y2)) continue;
      if (y2 - y + 1 < MIN_BOX_H) continue;

      boxes.push({ x, y, w: x2 - x + 1, h: y2 - y + 1 });
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Health bars
// ---------------------------------------------------------------------------

export interface Bar extends Rect {
  /** Width of the track inside the outline. */
  readonly track: number;
  /** How many pixels of the track are filled. */
  readonly fill: number;
  readonly shade: number;
}

const BAR_H = 6;
const MIN_BAR_W = 20;

/** Health bars: a six-pixel-tall ink outline around a track filled from the left. */
export function findBars(f: Frame, within: Rect = f.bounds): Bar[] {
  const bars: Bar[] = [];
  for (let y = within.y; y <= within.y + within.h - BAR_H; y++) {
    for (let x = within.x; x < within.x + within.w - MIN_BAR_W; x++) {
      if (!f.ink(x, y) || f.ink(x - 1, y)) continue;
      let xe = x;
      while (f.ink(xe + 1, y)) xe++;
      const w = xe - x + 1;
      if (w < MIN_BAR_W) continue;

      let ok = true;
      for (let xx = x; xx <= xe && ok; xx++) if (!f.ink(xx, y + BAR_H - 1)) ok = false;
      for (let r = 1; r < BAR_H - 1 && ok; r++) if (!f.ink(x, y + r) || !f.ink(xe, y + r)) ok = false;
      if (!ok) continue;

      // The track: a run of one fill shade from the left, then empty to the end,
      // and every row of it identical.
      let fill = 0;
      const shade = f.at(x + 1, y + 1);
      if (shade !== 0) while (fill < w - 2 && f.at(x + 1 + fill, y + 1) === shade) fill++;
      for (let r = 1; r < BAR_H - 1 && ok; r++) {
        for (let i = 0; i < w - 2 && ok; i++) {
          const want = i < fill ? shade : 0;
          if (f.at(x + 1 + i, y + r) !== want) ok = false;
        }
      }
      if (!ok) continue;
      bars.push({ x, y, w, h: BAR_H, track: w - 2, fill, shade: fill > 0 ? shade : 0 });
    }
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Blobs - connected shapes that are not background
// ---------------------------------------------------------------------------

export interface Blob extends Rect {
  /** Pixels in the shape. */
  readonly area: number;
  /** How many of them are each shade: [0, 1, 2, 3, off-palette]. */
  readonly shades: readonly number[];
}

/**
 * Connected regions of anything that is not `background`, outside `skip`.
 * Eight-connected, so a sprite and the platform it stands on come out as one.
 */
export function findBlobs(
  f: Frame,
  background: number,
  skip: readonly Rect[] = [],
  within: Rect = f.bounds,
): Blob[] {
  const seen = new Uint8Array(f.w * f.h);
  for (const r of skip) {
    for (let y = Math.max(0, r.y); y < Math.min(f.h, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(f.w, r.x + r.w); x++) seen[y * f.w + x] = 1;
    }
  }
  const inside = (x: number, y: number): boolean =>
    x >= within.x && y >= within.y && x < within.x + within.w && y < within.y + within.h;

  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let sy = within.y; sy < within.y + within.h; sy++) {
    for (let sx = within.x; sx < within.x + within.w; sx++) {
      const start = sy * f.w + sx;
      if (seen[start] === 1 || f.px[start] === background) continue;
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      let area = 0;
      const shades = [0, 0, 0, 0, 0];
      stack.push(start);
      seen[start] = 1;
      while (stack.length > 0) {
        const i = stack.pop() ?? 0;
        const x = i % f.w;
        const y = (i - x) / f.w;
        area++;
        const s = f.px[i] ?? 0;
        shades[s] = (shades[s] ?? 0) + 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inside(nx, ny)) continue;
            const j = ny * f.w + nx;
            if (seen[j] === 1 || f.px[j] === background) continue;
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      blobs.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area, shades });
    }
  }
  return blobs;
}

/** How many of the four shades a shape actually uses. */
export function shadeCount(shades: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < 4; i++) if ((shades[i] ?? 0) > 0) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Reading text
// ---------------------------------------------------------------------------

/** glyph bitmap (8 row bytes joined) -> the character it draws */
const GLYPH_BY_BITS = new Map<string, string>();
/** character -> the character OCR reports for it (two glyphs can share a bitmap) */
const CANONICAL = new Map<string, string>();

for (const [ch, bits] of Object.entries(FONT)) {
  if (bits.every((b) => b === 0)) continue;
  const key = Array.from(bits).join(',');
  const first = GLYPH_BY_BITS.get(key);
  if (first === undefined) {
    GLYPH_BY_BITS.set(key, ch);
    CANONICAL.set(ch, ch);
  } else {
    CANONICAL.set(ch, first);
  }
}

/** Characters the game has no glyph for. `drawText` skips them without a word. */
export function unprintable(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) if (ch !== ' ' && !CANONICAL.has(ch)) out.add(ch);
  return [...out];
}

/**
 * Text as OCR would report it: glyphs that share a bitmap fold together, and a
 * character with no glyph becomes the blank it is drawn as.
 */
export function asDrawn(text: string): string {
  let out = '';
  for (const ch of text) out += CANONICAL.get(ch) ?? ' ';
  return out;
}

export interface TextRun {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface Reading {
  /** Every run of glyphs found, top to bottom then left to right. */
  readonly runs: readonly TextRun[];
  /** Ink that is not part of any readable glyph - garbled or clipped text. */
  readonly stray: number;
  /** Where the first of it is, for the failure message. */
  readonly strayAt: { readonly x: number; readonly y: number } | null;
}

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly ch: string;
  readonly ink: number;
}

/**
 * Read the text in a region.
 *
 * Slides an 8x8 window over every position and keeps the ones that are EXACTLY
 * a glyph - the right pixels dark and every other pixel of the cell not. Text
 * is laid out on an eight-pixel advance, so true glyphs line up into runs;
 * a chance match (the dot of one letter looking like a full stop to a window
 * two pixels off) overlaps a real cell and loses to it.
 *
 * `ignore` rectangles are treated as blank: health bars and nested boxes are
 * ink, but they are not writing.
 */
export function readText(f: Frame, region: Rect = f.bounds, ignore: readonly Rect[] = []): Reading {
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(f.w, region.x + region.w);
  const y1 = Math.min(f.h, region.y + region.h);
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 8 || rh < 8) return { runs: [], stray: 0, strayAt: null };

  // Ink mask for the region, with ignored rectangles blanked.
  const mask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) mask[y * rw + x] = f.ink(x0 + x, y0 + y) ? 1 : 0;
  }
  for (const r of ignore) {
    for (let y = Math.max(y0, r.y); y < Math.min(y1, r.y + r.h); y++) {
      for (let x = Math.max(x0, r.x); x < Math.min(x1, r.x + r.w); x++) mask[(y - y0) * rw + (x - x0)] = 0;
    }
  }

  // rowBits[y][x] = the eight mask bits starting at x, leftmost in bit 7.
  const rowBits = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x + 8 <= rw; x++) {
      let b = 0;
      for (let i = 0; i < 8; i++) b = (b << 1) | (mask[y * rw + x + i] ?? 0);
      rowBits[y * rw + x] = b;
    }
  }

  const matches: Cell[] = [];
  const key: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let y = 0; y + 8 <= rh; y++) {
    for (let x = 0; x + 8 <= rw; x++) {
      let any = 0;
      for (let r = 0; r < 8; r++) {
        const b = rowBits[(y + r) * rw + x] ?? 0;
        key[r] = b;
        any |= b;
      }
      if (any === 0) continue;
      const ch = GLYPH_BY_BITS.get(key.join(','));
      if (ch === undefined) continue;
      let ink = 0;
      for (const b of key) for (let i = 0; i < 8; i++) ink += (b >> i) & 1;
      matches.push({ x, y, ch, ink });
    }
  }

  // Group into candidate lines: same row, same phase of the 8px advance.
  const lines = new Map<string, Cell[]>();
  for (const m of matches) {
    const k = `${m.y}:${m.x & 7}`;
    const line = lines.get(k);
    if (line) line.push(m);
    else lines.set(k, [m]);
  }
  const ordered = [...lines.values()].sort(
    (a, b) => b.reduce((n, c) => n + c.ink, 0) - a.reduce((n, c) => n + c.ink, 0),
  );

  // Most ink first, a line takes its cells unless a better line already has them.
  const taken = new Uint8Array(rw * rh);
  const accepted: Cell[] = [];
  for (const line of ordered) {
    for (const c of line) {
      let free = true;
      for (let r = 0; r < 8 && free; r++) {
        for (let i = 0; i < 8 && free; i++) if (taken[(c.y + r) * rw + c.x + i] === 1) free = false;
      }
      if (!free) continue;
      for (let r = 0; r < 8; r++) for (let i = 0; i < 8; i++) taken[(c.y + r) * rw + c.x + i] = 1;
      accepted.push(c);
    }
  }

  // Whatever ink no glyph accounts for is text nobody can read.
  let stray = 0;
  let strayAt: { x: number; y: number } | null = null;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (mask[y * rw + x] === 1 && taken[y * rw + x] === 0) {
        stray++;
        if (strayAt === null) strayAt = { x: x0 + x, y: y0 + y };
      }
    }
  }

  // Stitch cells into runs. One empty cell is a space; more than two ends the run.
  accepted.sort((a, b) => a.y - b.y || (a.x & 7) - (b.x & 7) || a.x - b.x);
  const runs: TextRun[] = [];
  let cur: { x: number; y: number; phase: number; text: string; end: number } | null = null;
  for (const c of accepted) {
    const phase = c.x & 7;
    if (cur !== null && cur.y === c.y && cur.phase === phase && c.x - cur.end <= 16) {
      cur.text += ' '.repeat((c.x - cur.end) / 8) + c.ch;
      cur.end = c.x + 8;
      continue;
    }
    if (cur !== null) runs.push({ x: x0 + cur.x, y: y0 + cur.y, text: cur.text });
    cur = { x: c.x, y: c.y, phase, text: c.ch, end: c.x + 8 };
  }
  if (cur !== null) runs.push({ x: x0 + cur.x, y: y0 + cur.y, text: cur.text });
  runs.sort((a, b) => a.y - b.y || a.x - b.x);

  return { runs, stray, strayAt };
}

/** All the text in a reading as one string, for "is this word on screen" checks. */
export function allText(r: Reading): string {
  return r.runs.map((t) => t.text).join('\n');
}

/**
 * The same text with every gap closed.
 *
 * Wrapping breaks a sentence wherever it likes, and a word broken across two
 * rows is still all there. Comparing with the spaces taken out asks the only
 * question that matters for truncation: did every letter reach the screen, in
 * order?
 */
export function squash(text: string): string {
  return text.replace(/\s+/g, '');
}
