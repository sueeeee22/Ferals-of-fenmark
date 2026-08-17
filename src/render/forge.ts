/**
 * The procedural sprite forge.
 *
 * Composes a Game Boy-palette pixel sprite from parameterized parts. The single
 * most important thing in this file is that **each animal family has its own
 * drawing routine** — its own body axis, limb attachment, head-to-body ratio and
 * posture. One shared quadruped skeleton with different numbers produces 153
 * variations on one dog, which is exactly the failure BLOCKERS.md item 4
 * describes. A bear is not a heavy dog; it is a different construction.
 *
 * Runs unchanged in Node (for the contact sheet and gauntlet:visual) and in the
 * browser (for the game), because it only ever writes into a Uint8Array.
 *
 * Output is an indexed buffer, one byte per pixel, matching the DMG's four shades:
 *   0 = transparent   1 = light coat   2 = shadow coat   3 = outline / darkest
 *
 * The pipeline, for both views:
 *   layout(params, scale) -> Geom      pure geometry, affine in `scale`
 *   fit(...)                           shrinks `scale` until the pose fits the frame
 *   draw(...)                          fills the silhouette in one flat shade
 *   outline()                          1px border of shade 3
 *   shade()                            coat pattern + ordered-dither underside
 *   detail()                           interior lines (wing edge, far legs, jaw)
 *   drawFace()                         eye with catchlight, nose — front view only
 *
 * The nine starter-line sprites carry hand-tuned overrides in STARTER_TUNING —
 * those are the ones a player stares at for forty hours.
 */

import type { Family } from '../core/creature.ts';

export const SPRITE_SIZE = 56;

export type Pixels = Uint8Array;

/** Gen 1 shows the player's own creature from behind. So do we. */
export type SpriteView = 'front' | 'back';

// ---------------------------------------------------------------------------
// Deterministic per-sprite noise
// ---------------------------------------------------------------------------

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type EarShape = 'prick' | 'drop' | 'round' | 'tuft' | 'none';
export type TailShape = 'curl' | 'plume' | 'brush' | 'stub' | 'whip' | 'fan';
export type CoatPattern =
  | 'solid'
  | 'mask'      // dark cap and back, light face and belly — husky, shepherd
  | 'tabby'     // vertical banding
  | 'spot'      // scattered rosettes
  | 'patch'     // large irregular blocks
  | 'counter'   // dark top, light underside
  | 'saddle';   // dark blanket across the back

export interface ForgeParams {
  readonly family: Family;
  /** 0..1 — overall mass. Drives body depth and leg thickness. */
  readonly bulk: number;
  /** 0..1 — leg length. Low is a corgi, high is a wolfhound. */
  readonly legs: number;
  /** 0..1 — muzzle length. Low is a flat-faced cat, high is a collie. */
  readonly muzzle: number;
  /** 0..1 — head size relative to body. */
  readonly head: number;
  readonly ears: EarShape;
  /** 0..1 — ear size. */
  readonly earSize: number;
  readonly tail: TailShape;
  /** 0..1 — neck ruff / mane. */
  readonly ruff: number;
  readonly pattern: CoatPattern;
  /** Base coat shade: 1 = light animal, 2 = dark animal. */
  readonly coat: 1 | 2;
  /** Extra apex-form flourishes: antlers, crest, longer fur. 0 for pups. */
  readonly majesty: number;
}

/** Family skeletons: the proportions that make a silhouette read as its animal. */
const FAMILY_BASE: Readonly<Record<Family, Omit<ForgeParams, 'family'>>> = {
  canid: { bulk: 0.5, legs: 0.58, muzzle: 0.7, head: 0.5, ears: 'prick', earSize: 0.6, tail: 'plume', ruff: 0.4, pattern: 'mask', coat: 1, majesty: 0 },
  felid: { bulk: 0.42, legs: 0.44, muzzle: 0.25, head: 0.55, ears: 'prick', earSize: 0.55, tail: 'whip', ruff: 0.2, pattern: 'tabby', coat: 1, majesty: 0 },
  ursid: { bulk: 0.9, legs: 0.36, muzzle: 0.5, head: 0.55, ears: 'round', earSize: 0.35, tail: 'stub', ruff: 0.3, pattern: 'solid', coat: 2, majesty: 0 },
  bird: { bulk: 0.5, legs: 0.5, muzzle: 0.5, head: 0.45, ears: 'none', earSize: 0, tail: 'fan', ruff: 0.4, pattern: 'counter', coat: 1, majesty: 0 },
  mustelid: { bulk: 0.4, legs: 0.3, muzzle: 0.45, head: 0.45, ears: 'round', earSize: 0.3, tail: 'brush', ruff: 0.15, pattern: 'counter', coat: 2, majesty: 0 },
  rodent: { bulk: 0.4, legs: 0.4, muzzle: 0.35, head: 0.62, ears: 'round', earSize: 0.7, tail: 'whip', ruff: 0.1, pattern: 'counter', coat: 1, majesty: 0 },
  ungulate: { bulk: 0.6, legs: 0.7, muzzle: 0.7, head: 0.4, ears: 'drop', earSize: 0.5, tail: 'stub', ruff: 0.25, pattern: 'patch', coat: 1, majesty: 0 },
  reptile: { bulk: 0.45, legs: 0.3, muzzle: 0.7, head: 0.4, ears: 'none', earSize: 0, tail: 'whip', ruff: 0, pattern: 'spot', coat: 2, majesty: 0 },
};

/**
 * Ear and tail pools, per family. A bear with prick ears reads as a dog and a
 * badger with a plume reads as a fox, so the randomiser is not allowed to cross
 * those lines — variety inside a family, never across families. Repeated entries
 * are the weighting.
 */
const FAMILY_EARS: Readonly<Record<Family, readonly EarShape[]>> = {
  canid: ['prick', 'prick', 'drop', 'round', 'tuft'],
  felid: ['prick', 'prick', 'tuft', 'round'],
  ursid: ['round'],
  bird: ['none'],
  mustelid: ['round'],
  rodent: ['round', 'round', 'prick'],
  ungulate: ['drop', 'drop', 'prick', 'tuft'],
  reptile: ['none'],
};

const FAMILY_TAILS: Readonly<Record<Family, readonly TailShape[]>> = {
  canid: ['plume', 'curl', 'brush', 'whip', 'stub'],
  felid: ['whip', 'whip', 'plume', 'curl'],
  ursid: ['stub'],
  bird: ['fan'],
  mustelid: ['brush', 'brush', 'whip', 'stub'],
  rodent: ['whip', 'whip', 'brush', 'curl'],
  ungulate: ['stub', 'stub', 'whip'],
  reptile: ['whip'],
};

/**
 * Hand-tuned parameters for the nine starter-line sprites. The generator's
 * defaults are good enough for a route encounter; they are not good enough for
 * the creature a player picks in the first five minutes and keeps for forty hours.
 */
const STARTER_TUNING: Readonly<Record<string, Partial<ForgeParams>>> = {
  // Winter — black-and-white Siberian Husky. Aloof, dramatic, screams.
  winter_pup: { bulk: 0.34, legs: 0.4, muzzle: 0.5, head: 0.66, ears: 'prick', earSize: 0.72, tail: 'curl', ruff: 0.5, pattern: 'mask', coat: 1, majesty: 0 },
  winter_adult: { bulk: 0.54, legs: 0.6, muzzle: 0.72, head: 0.5, ears: 'prick', earSize: 0.66, tail: 'curl', ruff: 0.66, pattern: 'mask', coat: 1, majesty: 0.2 },
  winter_apex: { bulk: 0.74, legs: 0.72, muzzle: 0.78, head: 0.52, ears: 'prick', earSize: 0.8, tail: 'plume', ruff: 1, pattern: 'mask', coat: 1, majesty: 0.95 },

  // Baloo — orange-and-white Siberian Husky. Enthusiastic idiot.
  baloo_pup: { bulk: 0.4, legs: 0.42, muzzle: 0.52, head: 0.64, ears: 'prick', earSize: 0.62, tail: 'curl', ruff: 0.45, pattern: 'mask', coat: 1, majesty: 0 },
  baloo_adult: { bulk: 0.62, legs: 0.58, muzzle: 0.7, head: 0.5, ears: 'prick', earSize: 0.6, tail: 'plume', ruff: 0.7, pattern: 'mask', coat: 1, majesty: 0.25 },
  baloo_apex: { bulk: 0.92, legs: 0.64, muzzle: 0.74, head: 0.56, ears: 'prick', earSize: 0.7, tail: 'plume', ruff: 1, pattern: 'mask', coat: 1, majesty: 1 },

  // Plato — grey-and-white tabby. Contemptuous. Will not fetch.
  plato_pup: { bulk: 0.3, legs: 0.3, muzzle: 0.2, head: 0.7, ears: 'prick', earSize: 0.66, tail: 'whip', ruff: 0.12, pattern: 'tabby', coat: 1, majesty: 0 },
  plato_adult: { bulk: 0.46, legs: 0.46, muzzle: 0.26, head: 0.56, ears: 'prick', earSize: 0.56, tail: 'whip', ruff: 0.3, pattern: 'tabby', coat: 1, majesty: 0.2 },
  plato_apex: { bulk: 0.6, legs: 0.52, muzzle: 0.3, head: 0.6, ears: 'tuft', earSize: 0.74, tail: 'plume', ruff: 0.8, pattern: 'tabby', coat: 1, majesty: 0.9 },
};

/** Derive parameters for a species from its family, stage and seed. */
export function paramsFor(
  id: string,
  family: Family,
  stage: 'pup' | 'adult' | 'apex',
  seed: number,
  legendary = false,
): ForgeParams {
  const rnd = mulberry(seed);
  const base = FAMILY_BASE[family];
  const vary = (v: number, amount: number): number =>
    Math.max(0, Math.min(1, v + (rnd() * 2 - 1) * amount));
  const pick = <T,>(pool: readonly T[], fallback: T): T =>
    pool[Math.floor(rnd() * pool.length)] ?? fallback;

  // Stage drives mass and majesty: a pup is small-bodied and big-headed, an apex
  // is heavy, maned and crested. This is what makes an evolution line read as one.
  const stageBulk = stage === 'pup' ? -0.16 : stage === 'apex' ? 0.18 : 0;
  const stageHead = stage === 'pup' ? 0.14 : stage === 'apex' ? -0.04 : 0;
  const majesty = legendary ? 1 : stage === 'apex' ? 0.72 : stage === 'adult' ? 0.16 : 0;

  const patternPool: readonly CoatPattern[] = ['solid', 'mask', 'tabby', 'spot', 'patch', 'counter', 'saddle'];

  const params: ForgeParams = {
    family,
    bulk: vary(base.bulk + stageBulk, 0.17),
    // Legs get a much wider spread than anything else: at ±0.13 every dog in the
    // roster stood on the same 2px band of leg and you could not tell a corgi
    // from a wolfhound. The draw routines map this across their whole range.
    legs: vary(base.legs, 0.34),
    muzzle: vary(base.muzzle, 0.18),
    head: vary(base.head + stageHead, 0.1),
    ears: rnd() < 0.45 ? base.ears : pick(FAMILY_EARS[family], base.ears),
    earSize: vary(base.earSize, 0.22),
    tail: rnd() < 0.45 ? base.tail : pick(FAMILY_TAILS[family], base.tail),
    ruff: vary(base.ruff + majesty * 0.35, 0.14),
    pattern: rnd() < 0.5 ? base.pattern : pick(patternPool, base.pattern),
    coat: rnd() < 0.5 ? 1 : 2,
    majesty,
  };

  const tuned = STARTER_TUNING[id];
  return tuned ? { ...params, ...tuned, family } : params;
}

// ---------------------------------------------------------------------------
// Raster primitives — all write into a SPRITE_SIZE^2 index buffer
// ---------------------------------------------------------------------------

const S = SPRITE_SIZE;
/** Ground line. Everything stands on it; layouts measure upward from here. */
const GROUND = S - 6;
/** Horizontal anchor. Layouts measure outward from here. */
const CXA = S / 2;
const TOP_MARGIN = 3;
const SIDE_MARGIN = 3;

function put(px: Pixels, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  px[y * S + x] = v;
}

function get(px: Pixels, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= S || y >= S) return 0;
  return px[y * S + x] ?? 0;
}

function ellipse(px: Pixels, cx: number, cy: number, rx: number, ry: number, v: number): void {
  const rx2 = Math.max(0.5, rx) ** 2;
  const ry2 = Math.max(0.5, ry) ** 2;
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) put(px, x, y, v);
    }
  }
}

/** Rotated ellipse. The cheapest way to get a body axis that is not vertical. */
function ellipseRot(
  px: Pixels, cx: number, cy: number, rx: number, ry: number, ang: number, v: number,
): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const rx2 = Math.max(0.5, rx) ** 2;
  const ry2 = Math.max(0.5, ry) ** 2;
  const ext = Math.ceil(Math.max(rx, ry)) + 2;
  for (let y = Math.floor(cy) - ext; y <= Math.ceil(cy) + ext; y++) {
    for (let x = Math.floor(cx) - ext; x <= Math.ceil(cx) + ext; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * ca + dy * sa;
      const w = -dx * sa + dy * ca;
      if ((u * u) / rx2 + (w * w) / ry2 <= 1) put(px, x, y, v);
    }
  }
}

/** A limb or tail: a line of shrinking circles. */
function taper(
  px: Pixels,
  x0: number, y0: number, x1: number, y1: number,
  r0: number, r1: number, v: number,
): void {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ellipse(px, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t, v);
  }
}

/** A quadratic curve of shrinking circles — tails and horns. */
function curve(
  px: Pixels,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  r0: number, r1: number, v: number,
): void {
  curveR(px, x0, y0, cx, cy, x1, y1, (t) => r0 + (r1 - r0) * t, v);
}

/** A quadratic curve whose radius is an arbitrary function of t — thick middles. */
function curveR(
  px: Pixels,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  rAt: (t: number) => number, v: number,
): void {
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    const r = rAt(t);
    ellipse(px, x, y, r, r, v);
  }
}

function triangle(
  px: Pixels,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, v: number,
): void {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area;
      const w1 = ((cx - bx) * (y - by) - (x - bx) * (cy - by)) / area;
      const w2 = ((ax - cx) * (y - cy) - (x - cx) * (ay - cy)) / area;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) put(px, x, y, v);
    }
  }
}

/** Ellipse that only paints over existing non-outline pixels. */
function ellipse2(px: Pixels, cx: number, cy: number, rx: number, ry: number, v: number): void {
  const rx2 = Math.max(0.5, rx) ** 2;
  const ry2 = Math.max(0.5, ry) ** 2;
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) / rx2 + (dy * dy) / ry2 > 1) continue;
      const cur = get(px, x, y);
      if (cur === 0 || cur === 3) continue;
      put(px, x, y, v);
    }
  }
}

/** Interior line: a taper that only paints over coat, never over the outline. */
function inkTaper(
  px: Pixels,
  x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, v: number,
): void {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    ellipse2(px, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r, v);
  }
}

/** Interior curve. Same rule: coat only. */
function inkCurve(
  px: Pixels,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  r0: number, r1: number, v: number,
): void {
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    const r = r0 + (r1 - r0) * t;
    ellipse2(px, x, y, r, r, v);
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** One limb bone. Feet are the fat end of the last bone. */
interface Seg {
  readonly x0: number; readonly y0: number;
  readonly x1: number; readonly y1: number;
  readonly r0: number; readonly r1: number;
  /** Half-width of the foot pad at (x1,y1). 0 = no foot. */
  readonly foot: number;
}

function seg(
  x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, foot = 0,
): Seg {
  return { x0, y0, x1, y1, r0, r1, foot };
}

function drawLimbs(px: Pixels, segs: readonly Seg[], v: number): void {
  for (const l of segs) {
    taper(px, l.x0, l.y0, l.x1, l.y1, l.r0, l.r1, v);
    if (l.foot > 0) ellipse(px, l.x1, l.y1, l.foot, Math.max(1, l.r1 * 0.95), v);
  }
}

/** Re-ink the far limbs a shade back, so the near pair reads in front of them. */
function inkLimbs(px: Pixels, segs: readonly Seg[], v: number): void {
  for (const l of segs) {
    inkTaper(px, l.x0, l.y0, l.x1, l.y1, l.r0, l.r1, v);
    if (l.foot > 0) ellipse2(px, l.x1, l.y1, l.foot, Math.max(1, l.r1 * 0.95), v);
  }
}

/**
 * Everything a family's draw, shade and face passes need. Produced by a pure
 * layout function that is affine in `scale`, which is what lets `fit` solve for
 * the largest scale that keeps the pose inside the frame.
 */
interface Geom {
  readonly scale: number;
  /** Barrel ellipse. The coat pattern and the underside dither anchor to this. */
  readonly bodyCx: number; readonly bodyCy: number;
  readonly bodyRx: number; readonly bodyRy: number;
  readonly headCx: number; readonly headCy: number; readonly headR: number;
  readonly eyeX: number; readonly eyeY: number;
  readonly noseX: number; readonly noseY: number;
  readonly hasNose: boolean;
  readonly legLen: number;
  readonly muzLen: number;
  /** Limbs on the far side of the body, drawn first and re-inked after shading. */
  readonly far: readonly Seg[];
  readonly near: readonly Seg[];
  readonly top: number; readonly left: number; readonly right: number;
}

type LayoutFn = (p: ForgeParams, s: number) => Geom;

/**
 * Solve for the biggest scale whose pose still fits. Every layout places points
 * at anchor + k*scale, so violations scale linearly and one correction lands it;
 * the loop is belt and braces for the compound cases (antlers on a tall ungulate).
 */
function fit(layout: LayoutFn, p: ForgeParams, s0: number): Geom {
  let s = s0;
  let g = layout(p, s);
  for (let i = 0; i < 3; i++) {
    let r = 1;
    const topD = GROUND - g.top;
    if (topD > GROUND - TOP_MARGIN) r = Math.min(r, (GROUND - TOP_MARGIN) / topD);
    const leftD = CXA - g.left;
    if (leftD > CXA - SIDE_MARGIN) r = Math.min(r, (CXA - SIDE_MARGIN) / leftD);
    const rightD = g.right - CXA;
    if (rightD > S - SIDE_MARGIN - CXA) r = Math.min(r, (S - SIDE_MARGIN - CXA) / rightD);
    if (r > 0.995) return g;
    s *= r;
    g = layout(p, s);
  }
  return g;
}

/** How far above the skull the ears reach — layouts need it for the top bound. */
function earExtent(p: ForgeParams, s: number): number {
  if (p.ears === 'none') return 0;
  const size = (2.5 + p.earSize * 6.5) * s * (p.majesty > 0.6 ? 1.25 : 1);
  switch (p.ears) {
    case 'prick': return size;
    case 'tuft': return size + 3.6 * s;
    case 'round': return size * 1.1;
    case 'drop': return 2 * s;
  }
}

function tailExtent(p: ForgeParams, s: number): number {
  return p.tail === 'stub' ? 5 * s : (7 + p.bulk * 5) * s;
}

// ---------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------

function drawEars(
  px: Pixels, p: ForgeParams,
  hx: number, hy: number, hr: number, s: number, fill: number,
  spread = 0.62, lift = 0.66,
): void {
  if (p.ears === 'none') return;
  const size = (2.5 + p.earSize * 6.5) * s * (p.majesty > 0.6 ? 1.25 : 1);
  const w = Math.max(1.6, size * 0.45);
  for (const dir of [-1, 1] as const) {
    const ex = hx + dir * hr * spread;
    const ey = hy - hr * lift;
    switch (p.ears) {
      case 'prick':
        triangle(px, ex - w, ey + 1.6 * s, ex + w, ey + 1.6 * s, ex + dir * w * 0.5, ey - size, fill);
        break;
      case 'drop':
        curve(px, ex, ey, ex + dir * size * 0.7, ey + size * 0.3,
          ex + dir * size * 0.45, ey + size * 0.95, 2.6 * s, 1.5 * s, fill);
        break;
      case 'round':
        ellipse(px, ex + dir * 0.6 * s, ey - size * 0.35, size * 0.55, size * 0.55, fill);
        break;
      case 'tuft':
        triangle(px, ex - w, ey + 1.6 * s, ex + w, ey + 1.6 * s, ex + dir * w * 0.4, ey - size, fill);
        // Lynx tips: the single cheapest way to say "this is a wild cat".
        taper(px, ex + dir * w * 0.4, ey - size, ex + dir * (w * 0.4 + 1.1 * s), ey - size - 3.6 * s,
          1.1 * s, 0.4 * s, fill);
        break;
    }
  }
}

/** Tail, for the families whose tail hangs off the back of a horizontal body. */
function drawTail(
  px: Pixels, p: ForgeParams,
  x: number, y: number, len: number, s: number, fill: number,
): void {
  switch (p.tail) {
    case 'curl':
      // Over the back — the husky/spitz signature.
      curve(px, x, y, x + len * 0.95, y - len * 1.05, x - len * 0.15, y - len * 0.95, 3.2 * s, 2.4 * s, fill);
      break;
    case 'plume':
      curve(px, x, y, x + len * 0.85, y - len * 0.55, x + len * 0.75, y - len * 1.15, 3.6 * s, 2.6 * s, fill);
      break;
    case 'brush':
      taper(px, x, y, x + len * 0.95, y + len * 0.3, 3.2 * s, 2.2 * s, fill);
      break;
    case 'stub':
      ellipse(px, x + 2.2 * s, y - 1 * s, 3.1 * s, 2.8 * s, fill);
      break;
    case 'whip':
      curve(px, x, y, x + len * 0.9, y - len * 0.35, x + len * 0.55, y - len * 1.25, 2.1 * s, 1.1 * s, fill);
      break;
    case 'fan':
      for (let i = -2; i <= 2; i++) {
        taper(px, x - 2 * s, y, x + len * 0.75, Math.min(GROUND - 2, y + i * 3.1 * s + 3 * s),
          1.8 * s, 1.1 * s, fill);
      }
      break;
  }
}

/**
 * A mane. It reads as "this one is dangerous" more cheaply than any other
 * feature, but it has to hug the skull — a halo of blobs erases the head shape.
 */
function drawMane(
  px: Pixels, p: ForgeParams, hx: number, hy: number, hr: number, s: number, fill: number,
): void {
  if (p.ruff <= 0.45) return;
  const points = 9;
  for (let i = 0; i < points; i++) {
    const a = Math.PI * 0.25 + (i / (points - 1)) * Math.PI * 1.15;
    const rr = hr * 1.12;
    const r = (1.1 + p.ruff * 1.5) * s;
    ellipse(px, hx + Math.cos(a) * rr + hr * 0.28, hy + Math.sin(a) * rr, r, r, fill);
  }
}

/** Dorsal spines along the back — an apex flourish that does not eat the head. */
function drawSpines(
  px: Pixels, p: ForgeParams, g: Geom, fill: number, count = 5, from = -0.72, to = 0.78,
): void {
  const s = g.scale;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const sx = g.bodyCx + (from + t * (to - from)) * g.bodyRx;
    const backY = g.bodyCy - g.bodyRy * Math.sqrt(Math.max(0, 1 - ((sx - g.bodyCx) / g.bodyRx) ** 2)) * 0.96;
    const h = (4.5 - t * 2.4) * p.majesty * s;
    triangle(px, sx - 1.7 * s, backY + 1, sx + 1.7 * s, backY + 1, sx - 0.6 * s, backY - h, fill);
  }
}

// ---------------------------------------------------------------------------
// canid — the reference build: square dog, level back, head clear of the shoulder
// ---------------------------------------------------------------------------

function layoutCanid(p: ForgeParams, s: number): Geom {
  const legLen = (3 + p.legs * 15) * s;
  const rx = (9.5 + p.bulk * 4.5) * s;
  const ry = (4.6 + p.bulk * 3.4) * s;
  const cx = CXA + 1.5 * s;
  const cy = GROUND - legLen - ry * 0.9;
  const hr = (5.2 + p.head * 3.2) * s;
  const hx = cx - rx - hr * 0.42;
  const hy = cy - ry * 0.7 - hr * 0.55;
  const muz = (2 + p.muzzle * 5) * s;
  const snout = hx - hr * 0.5 - muz;

  const legR = (1.3 + p.bulk * 1.2) * s;
  const frontX = cx - rx * 0.62;
  const backX = cx + rx * 0.6;
  const hipTop = cy + ry * 0.35;
  const far: Seg[] = [
    seg(frontX + 3.0 * s, hipTop, frontX + 4.0 * s, GROUND - 1, legR * 0.8, legR * 0.7, legR * 1.1),
    seg(backX - 3.0 * s, hipTop, backX - 4.0 * s, GROUND - 1, legR * 0.8, legR * 0.7, legR * 1.1),
  ];
  const near: Seg[] = [
    seg(frontX, hipTop, frontX, GROUND - 1, legR, legR * 0.85, legR * 1.35),
    seg(backX, hipTop, backX, GROUND - 1, legR, legR * 0.85, legR * 1.35),
  ];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.16, eyeY: hy - hr * 0.06,
    noseX: snout, noseY: hy + hr * 0.42, hasNose: true,
    legLen, muzLen: muz, far, near,
    top: Math.min(hy - hr - earExtent(p, s), cy - ry - (p.majesty > 0.6 ? 5 * s : 0)),
    left: snout - 2 * s,
    right: cx + rx + tailExtent(p, s),
  };
}

function drawCanid(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  drawTail(px, p, g.bodyCx + g.bodyRx * 0.88, g.bodyCy - g.bodyRy * 0.3, (6.5 + p.bulk * 5) * s, s, fill);
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  ellipse(px, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy, fill);
  // Chest, deeper than the flank — a dog is not a barrel.
  ellipse(px, g.bodyCx - g.bodyRx * 0.45, g.bodyCy + g.bodyRy * 0.18, g.bodyRx * 0.5, g.bodyRy * 0.95, fill);
  const neckR = (2 + p.bulk * 1.8 + p.ruff * 1.2) * s;
  taper(px, g.bodyCx - g.bodyRx * 0.5, g.bodyCy - g.bodyRy * 0.35,
    g.headCx + g.headR * 0.35, g.headCy + g.headR * 0.55, neckR, neckR * 0.85, fill);
  drawMane(px, p, g.headCx, g.headCy, g.headR, s, fill);
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.9, fill);
  // Muzzle: a wedge down and forward off the skull, blunt at the nose.
  taper(px, g.headCx - g.headR * 0.2, g.headCy + g.headR * 0.32, g.noseX, g.noseY,
    g.headR * 0.42, g.headR * 0.26, fill);
  ellipse(px, g.noseX, g.noseY, g.headR * 0.28, g.headR * 0.24, fill);
  drawEars(px, p, g.headCx, g.headCy, g.headR, s, fill);
  if (p.majesty > 0.6) drawSpines(px, p, g, fill);
}

// ---------------------------------------------------------------------------
// felid — lower, longer, crouched. High hips, short muzzle, long expressive tail
// ---------------------------------------------------------------------------

function layoutFelid(p: ForgeParams, s: number): Geom {
  const legLen = (2 + p.legs * 11) * s;
  const rx = (10.5 + p.bulk * 4) * s;
  const ry = (3.8 + p.bulk * 2.6) * s;
  const cx = CXA + 1 * s;
  const cy = GROUND - legLen - ry * 0.95;
  const hr = (4.4 + p.head * 2.8) * s;
  // The head sits low and close: a cat's shoulder is behind its skull, not under it.
  const hx = cx - rx - hr * 0.24;
  const hy = cy - ry * 0.35 - hr * 0.5;
  const muz = (0.8 + p.muzzle * 2.4) * s;
  const snout = hx - hr * 0.62 - muz;
  const tailLen = (9 + p.bulk * 4) * s;

  const legR = (1.1 + p.bulk * 0.9) * s;
  const frontX = cx - rx * 0.6;
  const backX = cx + rx * 0.55;
  const far: Seg[] = [
    seg(frontX + 2.8 * s, cy + ry * 0.3, frontX + 3.6 * s, GROUND - 1, legR * 0.8, legR * 0.7, legR * 1.1),
    seg(backX - 2.8 * s, cy + ry * 0.3, backX - 3.4 * s, GROUND - 1, legR * 0.8, legR * 0.7, legR * 1.1),
  ];
  const near: Seg[] = [
    seg(frontX, cy + ry * 0.3, frontX - 0.6 * s, GROUND - 1, legR, legR * 0.85, legR * 1.4),
    seg(backX, cy + ry * 0.3, backX + 0.4 * s, GROUND - 1, legR * 1.15, legR * 0.85, legR * 1.4),
  ];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.3, eyeY: hy - hr * 0.05,
    noseX: snout + hr * 0.1, noseY: hy + hr * 0.5, hasNose: true,
    legLen, muzLen: muz, far, near,
    top: Math.min(hy - hr - earExtent(p, s), cy - ry * 1.6 - tailLen * 0.1),
    left: snout - 2 * s,
    right: cx + rx * 0.9 + tailLen * 0.9,
  };
}

function drawFelid(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const tailLen = (9 + p.bulk * 4) * s;
  const tx = g.bodyCx + g.bodyRx * 0.85;
  const ty = g.bodyCy - g.bodyRy * 0.1;
  if (p.tail === 'stub') {
    ellipse(px, tx + 2 * s, ty - 1 * s, 2.6 * s, 2.4 * s, fill);
  } else {
    // Long, thin, in two arcs: back and up, then the tip hooks forward. A plume
    // is what a dog has; a cat's tail is a line you can read at thumbnail size.
    const w = p.tail === 'plume' ? 1.5 : 1;
    curve(px, tx, ty, tx + tailLen * 0.6, ty - tailLen * 0.3,
      tx + tailLen * 0.8, ty - tailLen * 0.95, 2.3 * s * w, 1.9 * s * w, fill);
    curve(px, tx + tailLen * 0.8, ty - tailLen * 0.95, tx + tailLen * 0.9, ty - tailLen * 1.45,
      tx + tailLen * 0.35, ty - tailLen * 1.5, 1.9 * s * w, 1.2 * s * w, fill);
  }
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  ellipse(px, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy, fill);
  // High haunch at the rear and a dropped chest at the front: the crouch.
  ellipse(px, g.bodyCx + g.bodyRx * 0.5, g.bodyCy - g.bodyRy * 0.12,
    g.bodyRx * 0.45, g.bodyRy * 1.35, fill);
  ellipse(px, g.bodyCx - g.bodyRx * 0.55, g.bodyCy + g.bodyRy * 0.25,
    g.bodyRx * 0.4, g.bodyRy * 0.95, fill);
  const neckR = (1.9 + p.bulk * 1.4 + p.ruff * 1.1) * s;
  taper(px, g.bodyCx - g.bodyRx * 0.55, g.bodyCy - g.bodyRy * 0.2,
    g.headCx + g.headR * 0.5, g.headCy + g.headR * 0.4, neckR, neckR * 0.9, fill);
  drawMane(px, p, g.headCx, g.headCy, g.headR, s, fill);
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.88, fill);
  // Cheek ruffs. Two bumps at the jawline and the skull reads feline, not canine.
  ellipse(px, g.headCx + g.headR * 0.1, g.headCy + g.headR * 0.55, g.headR * 0.6, g.headR * 0.42, fill);
  // Short blunt muzzle.
  ellipse(px, g.headCx - g.headR * 0.45, g.headCy + g.headR * 0.42,
    g.headR * 0.5 + g.muzLen * 0.5, g.headR * 0.34, fill);
  drawEars(px, p, g.headCx, g.headCy, g.headR, s, fill, 0.6, 0.62);
}

// ---------------------------------------------------------------------------
// ursid — plantigrade, hump-shouldered, head hung low. Never a heavy dog.
// ---------------------------------------------------------------------------

function layoutUrsid(p: ForgeParams, s: number): Geom {
  const legLen = (1 + p.legs * 5) * s;
  const rx = (11.5 + p.bulk * 3.5) * s;
  const ry = (8 + p.bulk * 3.2) * s;
  const cx = CXA + 2 * s;
  const cy = GROUND - legLen - ry * 0.86;
  const humpCy = cy - ry * 0.72;
  const humpRy = ry * 0.62;
  const hr = (4.4 + p.head * 2.4) * s;
  // Low and forward, well under the hump line. This is the whole read.
  const hx = cx - rx * 0.95 - hr * 0.7;
  const hy = cy - ry * 0.2;
  const muz = (2 + p.muzzle * 4) * s;
  const snout = hx - hr * 0.55 - muz;

  const legR = (2.4 + p.bulk * 1.7) * s;
  const frontX = cx - rx * 0.6;
  const backX = cx + rx * 0.55;
  const far: Seg[] = [
    seg(frontX + 3.4 * s, cy + ry * 0.4, frontX + 4.4 * s, GROUND - 1.5 * s, legR * 0.85, legR * 0.85, legR * 1.5),
    seg(backX - 3.4 * s, cy + ry * 0.4, backX - 4.4 * s, GROUND - 1.5 * s, legR * 0.85, legR * 0.85, legR * 1.5),
  ];
  const near: Seg[] = [
    seg(frontX, cy + ry * 0.4, frontX - 0.5 * s, GROUND - 1.5 * s, legR, legR, legR * 1.9),
    seg(backX, cy + ry * 0.4, backX + 0.5 * s, GROUND - 1.5 * s, legR * 1.1, legR, legR * 1.9),
  ];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.2, eyeY: hy - hr * 0.18,
    noseX: snout, noseY: hy + hr * 0.3, hasNose: true,
    legLen, muzLen: muz, far, near,
    top: Math.min(humpCy - humpRy - 1.5 * s, hy - hr - earExtent(p, s) * 0.9),
    left: snout - 2 * s,
    right: cx + rx + 4 * s,
  };
}

function drawUrsid(px: Pixels, p: ForgeParams, g: Geom, fill: number, rnd: () => number): void {
  const s = g.scale;
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  // Barrel.
  ellipse(px, g.bodyCx, g.bodyCy, g.bodyRx, g.bodyRy, fill);
  // Rump, and then the shoulder hump — the highest point on the animal, higher
  // than the skull. Get this wrong and you have drawn a mastiff.
  ellipse(px, g.bodyCx + g.bodyRx * 0.42, g.bodyCy - g.bodyRy * 0.1, g.bodyRx * 0.55, g.bodyRy * 0.95, fill);
  ellipse(px, g.bodyCx - g.bodyRx * 0.42, g.bodyCy - g.bodyRy * 0.72, g.bodyRx * 0.52, g.bodyRy * 0.62, fill);
  // Thick neck dropping forward off the hump to the low skull.
  taper(px, g.bodyCx - g.bodyRx * 0.55, g.bodyCy - g.bodyRy * 0.45,
    g.headCx + g.headR * 0.55, g.headCy - g.headR * 0.1,
    g.headR * 1.05, g.headR * 0.9, fill);
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.92, fill);
  // Broad straight muzzle, blunt at the end.
  taper(px, g.headCx - g.headR * 0.2, g.headCy + g.headR * 0.22, g.noseX, g.noseY,
    g.headR * 0.6, g.headR * 0.42, fill);
  // Small round ears, set wide on the top of the skull.
  const er = (1.3 + p.earSize * 1.8) * s;
  for (const dir of [-1, 1] as const) {
    ellipse(px, g.headCx + dir * g.headR * 0.72, g.headCy - g.headR * 0.82, er, er, fill);
  }
  // Shaggy coat: perturb the belly line. Bears are not smooth.
  const shag = 7;
  for (let i = 0; i < shag; i++) {
    const t = i / (shag - 1);
    const sx = g.bodyCx - g.bodyRx * 0.85 + t * g.bodyRx * 1.7;
    const by = g.bodyCy + g.bodyRy * Math.sqrt(Math.max(0, 1 - ((sx - g.bodyCx) / g.bodyRx) ** 2)) * 0.92;
    const r = (1 + rnd() * 1.6) * s;
    ellipse(px, sx, by, r, r, fill);
  }
}

// ---------------------------------------------------------------------------
// mustelid — one long horizontal tube. Body ~3x its own height, no neck step.
// ---------------------------------------------------------------------------

function layoutMustelid(p: ForgeParams, s: number): Geom {
  const legLen = (0.5 + p.legs * 3.5) * s;
  const half = (13 + p.bulk * 4) * s;
  const ry = (3.1 + p.bulk * 1.8) * s;
  const cx = CXA + 1 * s;
  const cy = GROUND - legLen - ry * 0.95;
  const hr = (3.2 + p.head * 2.1) * s;
  const hx = cx - half - hr * 0.15;
  const hy = cy - ry * 0.5;
  const muz = (0.8 + p.muzzle * 2) * s;
  const snout = hx - hr * 0.75 - muz;
  const tailLen = (7 + p.bulk * 6) * s;

  const legR = (1.1 + p.bulk * 0.9) * s;
  const frontX = cx - half * 0.55;
  const backX = cx + half * 0.6;
  const far: Seg[] = [
    seg(frontX + 2.4 * s, cy + ry * 0.4, frontX + 3.2 * s, GROUND - 1, legR * 0.8, legR * 0.8, legR),
    seg(backX - 2.4 * s, cy + ry * 0.4, backX - 3.2 * s, GROUND - 1, legR * 0.8, legR * 0.8, legR),
  ];
  const near: Seg[] = [
    seg(frontX, cy + ry * 0.4, frontX, GROUND - 1, legR, legR, legR * 1.5),
    seg(backX, cy + ry * 0.4, backX, GROUND - 1, legR, legR, legR * 1.5),
  ];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: half, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.25, eyeY: hy - hr * 0.12,
    noseX: snout, noseY: hy + hr * 0.34, hasNose: true,
    legLen, muzLen: muz, far, near,
    top: Math.min(hy - hr - 2 * s, cy - ry * 2.2, cy - ry - tailLen * 0.55),
    left: snout - 2 * s,
    right: cx + half + tailLen * 0.85,
  };
}

function drawMustelid(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const half = g.bodyRx;
  const ry = g.bodyRy;
  const tailLen = (7 + p.bulk * 6) * s;
  const tx = g.bodyCx + half * 0.92;
  const ty = g.bodyCy - ry * 0.15;
  // Thick-based tapering tail, low, trailing back. Otter, badger, wolverine.
  if (p.tail === 'stub') {
    ellipse(px, tx + 2 * s, ty, 2.6 * s, 2.2 * s, fill);
  } else if (p.tail === 'whip') {
    curve(px, tx, ty, tx + tailLen * 0.7, ty - tailLen * 0.15,
      tx + tailLen, ty - tailLen * 0.55, ry * 0.75, 0.9 * s, fill);
  } else {
    curve(px, tx, ty, tx + tailLen * 0.65, ty - tailLen * 0.25,
      tx + tailLen * 0.95, ty - tailLen * 0.7, ry * 0.95, 1.4 * s, fill);
  }
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  // The spine: one arched tube from rump to skull, thickest over the hips. No
  // shoulder step, no neck step — the head is just the end of the animal.
  curveR(px, g.bodyCx + half, g.bodyCy, g.bodyCx, g.bodyCy - ry * 0.75,
    g.headCx + g.headR * 0.4, g.headCy + g.headR * 0.15,
    (t) => ry * (1.02 - 0.12 * t) * (1 - 0.28 * Math.max(0, t - 0.72) / 0.28), fill);
  ellipse(px, g.bodyCx + half * 0.55, g.bodyCy - ry * 0.1, half * 0.4, ry * 1.05, fill);
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.85, fill);
  // Blunt little muzzle.
  taper(px, g.headCx - g.headR * 0.1, g.headCy + g.headR * 0.2, g.noseX, g.noseY,
    g.headR * 0.55, g.headR * 0.34, fill);
  // Tiny round ears, barely off the skull.
  const er = (0.9 + p.earSize * 1.3) * s;
  for (const dir of [-1, 1] as const) {
    ellipse(px, g.headCx + dir * g.headR * 0.6, g.headCy - g.headR * 0.72, er, er, fill);
  }
}

// ---------------------------------------------------------------------------
// rodent — haunched and sitting up: big head, big ears, small hands, heavy hips
// ---------------------------------------------------------------------------

function layoutRodent(p: ForgeParams, s: number): Geom {
  const rx = (6.2 + p.bulk * 3) * s;
  const ry = (7.5 + p.bulk * 3.2) * s;
  const cx = CXA + 1 * s;
  const sit = (1 + p.legs * 3.5) * s;
  const cy = GROUND - sit - ry * 0.8;
  const hr = (5.2 + p.head * 3.8) * s;
  const hx = cx - rx * 0.62;
  const hy = cy - ry * 0.72 - hr * 0.42;
  const muz = (1.2 + p.muzzle * 2.6) * s;
  const snout = hx - hr * 0.72 - muz;
  const ear = (2.2 + p.earSize * 3.6) * s;

  // A sitting rodent has no standing legs; the "limbs" are the raised hands.
  const near: Seg[] = [
    seg(cx - rx * 0.45, cy - ry * 0.15, cx - rx * 1.0, cy + ry * 0.22, 1.4 * s, 1.0 * s, 1.5 * s),
  ];
  const far: Seg[] = [
    seg(cx - rx * 0.25, cy - ry * 0.1, cx - rx * 0.8, cy + ry * 0.3, 1.2 * s, 0.9 * s, 1.3 * s),
  ];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.28, eyeY: hy - hr * 0.02,
    noseX: snout, noseY: hy + hr * 0.42, hasNose: true,
    legLen: sit, muzLen: muz, far, near,
    top: hy - hr * 0.8 - ear * 1.7,
    left: snout - 2 * s,
    right: cx + rx + (p.tail === 'whip' ? 9 : 5) * s,
  };
}

function drawRodent(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const rx = g.bodyRx;
  const ry = g.bodyRy;
  // Tail: bushy up the back for squirrels, thin and trailing for mice.
  if (p.tail === 'brush' || p.tail === 'curl' || p.tail === 'plume') {
    curveR(px, g.bodyCx + rx * 0.75, GROUND - 3 * s,
      g.bodyCx + rx * 2.1, g.bodyCy - ry * 0.5,
      g.bodyCx + rx * 0.5, g.bodyCy - ry * 1.5,
      (t) => (2 + 2.6 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * s, fill);
  } else {
    curve(px, g.bodyCx + rx * 0.6, GROUND - 2.5 * s,
      g.bodyCx + rx * 1.9, GROUND - 4 * s,
      g.bodyCx + rx * 1.7, g.bodyCy + ry * 0.1, 1.7 * s, 0.9 * s, fill);
  }
  // Hind foot flat on the ground, pointing forward — the sit.
  ellipse(px, g.bodyCx - rx * 0.15, GROUND - 1.6 * s, rx * 0.85, 1.8 * s, fill);
  // Heavy haunch over it.
  ellipse(px, g.bodyCx + rx * 0.28, g.bodyCy + ry * 0.42, rx * 0.78, ry * 0.6, fill);
  // Pear-shaped body, leaning forward.
  ellipse(px, g.bodyCx, g.bodyCy, rx, ry, fill);
  ellipse(px, g.bodyCx - rx * 0.35, g.bodyCy - ry * 0.35, rx * 0.75, ry * 0.6, fill);
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  // Big round head, straight onto the shoulders.
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.95, fill);
  // Short wedge muzzle.
  taper(px, g.headCx - g.headR * 0.15, g.headCy + g.headR * 0.28, g.noseX, g.noseY,
    g.headR * 0.44, g.headR * 0.22, fill);
  // Ears: big and round, high on the skull. On a rodent they are half the read.
  const ear = (2.2 + p.earSize * 3.6) * s;
  if (p.ears === 'prick') {
    for (const dir of [-1, 1] as const) {
      triangle(px,
        g.headCx + dir * g.headR * 0.42 - ear * 0.6, g.headCy - g.headR * 0.62,
        g.headCx + dir * g.headR * 0.42 + ear * 0.6, g.headCy - g.headR * 0.62,
        g.headCx + dir * g.headR * 0.55, g.headCy - g.headR * 0.62 - ear * 1.6, fill);
    }
  } else {
    ellipse(px, g.headCx + g.headR * 0.62, g.headCy - g.headR * 0.62, ear * 0.85, ear, fill);
    ellipse(px, g.headCx - g.headR * 0.28, g.headCy - g.headR * 0.78, ear, ear * 1.05, fill);
  }
}

// ---------------------------------------------------------------------------
// ungulate — tall, leggy, deep narrow chest, neck carried UP, small head
// ---------------------------------------------------------------------------

function layoutUngulate(p: ForgeParams, s: number): Geom {
  const legLen = (8 + p.legs * 10) * s;
  const rx = (8.5 + p.bulk * 3) * s;
  const ry = (4.2 + p.bulk * 2.2) * s;
  const cx = CXA + 2 * s;
  const cy = GROUND - legLen - ry * 0.95;
  const neckLen = (7 + p.head * 2 + p.majesty * 2.5) * s;
  const hr = (3.2 + p.head * 2.2) * s;
  const neckX = cx - rx * 0.78;
  const neckY = cy - ry * 0.5;
  const hx = neckX - neckLen * 0.52;
  const hy = neckY - neckLen * 0.95 - hr * 0.4;
  const muz = (2.5 + p.muzzle * 4.5) * s;
  const snout = hx - hr * 0.4 - muz * 0.85;

  const legR = (1.05 + p.bulk * 0.7) * s;
  const kneeY = cy + ry * 0.6 + legLen * 0.5;
  const frontX = cx - rx * 0.55;
  const backX = cx + rx * 0.62;
  const far: Seg[] = [
    seg(frontX + 3 * s, cy + ry * 0.5, frontX + 3.4 * s, kneeY, legR * 0.85, legR * 0.7, 0),
    seg(frontX + 3.4 * s, kneeY, frontX + 3 * s, GROUND - 1, legR * 0.7, legR * 0.6, legR * 1.1),
    seg(backX - 3 * s, cy + ry * 0.4, backX - 2 * s, kneeY, legR * 0.85, legR * 0.7, 0),
    seg(backX - 2 * s, kneeY, backX - 3.4 * s, GROUND - 1, legR * 0.7, legR * 0.6, legR * 1.1),
  ];
  const near: Seg[] = [
    // Foreleg: straight, with a slight knee.
    seg(frontX, cy + ry * 0.5, frontX + 0.4 * s, kneeY, legR, legR * 0.8, 0),
    seg(frontX + 0.4 * s, kneeY, frontX, GROUND - 1, legR * 0.8, legR * 0.65, legR * 1.3),
    // Hind leg: the hock kicks backward, then the cannon drops forward. This
    // zig-zag is what says "deer" rather than "table".
    seg(backX, cy + ry * 0.4, backX + 2.2 * s, kneeY, legR * 1.15, legR * 0.75, 0),
    seg(backX + 2.2 * s, kneeY, backX - 0.6 * s, GROUND - 1, legR * 0.75, legR * 0.65, legR * 1.3),
  ];

  const antler = p.majesty > 0.6 ? (5 + p.majesty * 5) * s : 0;
  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.1, eyeY: hy - hr * 0.15,
    noseX: snout, noseY: hy + hr * 0.85 + muz * 0.35, hasNose: true,
    legLen, muzLen: muz, far, near,
    top: hy - hr - Math.max(earExtent(p, s) * 0.8, antler * 1.5),
    left: Math.min(snout - 2 * s, cx - rx * 1.25),
    right: cx + rx + 5 * s,
  };
}

function drawUngulate(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const rx = g.bodyRx;
  const ry = g.bodyRy;
  // Short tail flat on the rump.
  if (p.tail === 'whip') {
    curve(px, g.bodyCx + rx * 0.92, g.bodyCy - ry * 0.35, g.bodyCx + rx * 1.3, g.bodyCy + ry * 0.4,
      g.bodyCx + rx * 1.1, g.bodyCy + ry * 1.3, 1.5 * s, 0.9 * s, fill);
  } else {
    ellipse(px, g.bodyCx + rx * 0.95, g.bodyCy - ry * 0.35, 2.4 * s, 3 * s, fill);
  }
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  // Barrel plus a deep narrow chest hanging below the shoulder line.
  ellipse(px, g.bodyCx, g.bodyCy, rx, ry, fill);
  ellipse(px, g.bodyCx - rx * 0.45, g.bodyCy + ry * 0.35, rx * 0.45, ry * 1.15, fill);
  ellipse(px, g.bodyCx + rx * 0.55, g.bodyCy + ry * 0.05, rx * 0.45, ry * 1.0, fill);
  // The neck: long, thick at the withers, carried up and forward.
  const neckX = g.bodyCx - rx * 0.78;
  const neckY = g.bodyCy - ry * 0.5;
  curveR(px, neckX, neckY + ry * 0.4, neckX - (neckX - g.headCx) * 0.35, (neckY + g.headCy) * 0.5,
    g.headCx + g.headR * 0.35, g.headCy + g.headR * 0.6,
    (t) => (3.2 + p.bulk * 1.2 + p.ruff * 1.6) * s * (1 - 0.45 * t), fill);
  if (p.ruff > 0.5) {
    // Dewlap / mane down the front of the neck — moose and muskox.
    inkOrFill(px, neckX, neckY, g.headCx, g.headCy, p, s, fill);
  }
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.85, fill);
  // Long face: a wedge angled down and forward off a small skull.
  taper(px, g.headCx, g.headCy + g.headR * 0.15, g.noseX, g.noseY,
    g.headR * 0.62, g.headR * 0.42, fill);
  // Ears out to the sides, leaf-shaped.
  drawEars(px, p, g.headCx, g.headCy, g.headR, s, fill, 0.85, 0.35);
  if (p.majesty > 0.6) {
    // Antlers. Two beams sweeping up and back off the skull, each with two tines.
    const beam = (5 + p.majesty * 5) * s;
    for (const off of [2.4 * s, 0] as const) {
      const ax = g.headCx + off + g.headR * 0.15;
      const ay = g.headCy - g.headR * 0.7;
      curve(px, ax, ay, ax + beam * 0.45, ay - beam * 0.9, ax + beam * 1.0, ay - beam * 1.15,
        1.5 * s, 0.8 * s, fill);
      taper(px, ax + beam * 0.3, ay - beam * 0.62, ax + beam * 0.1, ay - beam * 1.2, 1 * s, 0.5 * s, fill);
      taper(px, ax + beam * 0.72, ay - beam * 0.98, ax + beam * 0.6, ay - beam * 1.45, 0.9 * s, 0.5 * s, fill);
    }
  }
}

/** The neck mane of a moose: a hanging fringe under the throat. */
function inkOrFill(
  px: Pixels, neckX: number, neckY: number, hx: number, hy: number,
  p: ForgeParams, s: number, fill: number,
): void {
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = neckX + (hx - neckX) * t;
    const y = neckY + (hy - neckY) * t;
    const r = (1.2 + p.ruff * 1.8) * s;
    ellipse(px, x - r * 1.1, y + r * 0.4, r, r * 1.4, fill);
  }
}

// ---------------------------------------------------------------------------
// bird — upright, head on shoulders, oversized beak, one folded wing, tail behind
// ---------------------------------------------------------------------------

function layoutBird(p: ForgeParams, s: number): Geom {
  const legLen = (4 + p.legs * 10) * s;
  const rx = (7 + p.bulk * 2.8) * s;
  const ry = (9.5 + p.bulk * 3.2) * s;
  const cx = CXA + 1.5 * s;
  const cy = GROUND - legLen - ry * 0.72;
  const hr = (4 + p.head * 2.6) * s;
  const hx = cx - rx * 0.95;
  const hy = cy - ry * 0.88 - hr * 0.7;
  // The beak has to survive at 56px, so it is deliberately oversized: never less
  // than about five pixels long, and deep at the base.
  const beak = (6 + p.muzzle * 5) * s;
  const tailLen = (9 + p.majesty * 5 + p.bulk * 2) * s;

  const legR = (1.05 + p.bulk * 0.5) * s;
  const footY = GROUND - 1;
  const far: Seg[] = [
    seg(cx + 1.2 * s, cy + ry * 0.62, cx + 2.6 * s, (cy + ry * 0.62 + footY) / 2, legR * 0.85, legR * 0.8, 0),
    seg(cx + 2.6 * s, (cy + ry * 0.62 + footY) / 2, cx + 1.6 * s, footY, legR * 0.8, legR * 0.7, 0),
  ];
  const near: Seg[] = [
    seg(cx - 2.4 * s, cy + ry * 0.62, cx - 1.0 * s, (cy + ry * 0.62 + footY) / 2, legR, legR * 0.85, 0),
    seg(cx - 1.0 * s, (cy + ry * 0.62 + footY) / 2, cx - 2.2 * s, footY, legR * 0.85, legR * 0.75, 0),
  ];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx - hr * 0.2, eyeY: hy - hr * 0.12,
    noseX: hx, noseY: hy, hasNose: false,
    legLen, muzLen: beak, far, near,
    top: hy - hr - (p.majesty > 0.6 ? 5 * s : 1.5 * s),
    left: hx - hr * 0.4 - beak,
    right: cx + rx * 0.6 + tailLen,
  };
}

function drawBird(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const rx = g.bodyRx;
  const ry = g.bodyRy;
  const tailLen = (9 + p.majesty * 5 + p.bulk * 2) * s;
  // Tail: a fan projecting behind and down, clear of the body. Without it the
  // bird is an egg on two sticks.
  const tx = g.bodyCx + rx * 0.45;
  const ty = g.bodyCy + ry * 0.45;
  for (let i = -1; i <= 2; i++) {
    taper(px, tx - 2 * s, ty - 2 * s, tx + tailLen * 0.92, ty + i * 2.6 * s + tailLen * 0.28,
      2.4 * s, 1.1 * s, fill);
  }
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  ellipse(px, g.bodyCx, g.bodyCy, 1.4 * s, 1.4 * s, fill);
  // Body: an egg leaning forward over the feet.
  ellipseRot(px, g.bodyCx, g.bodyCy, rx, ry, -0.26, fill);
  // Neck, deliberately narrower than the skull: the notch between head and
  // shoulders is what stops a bird reading as a blob.
  taper(px, g.bodyCx - rx * 0.45, g.bodyCy - ry * 0.6,
    g.headCx + g.headR * 0.25, g.headCy + g.headR * 0.6,
    g.headR * 0.62, g.headR * 0.55, fill);
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.92, fill);
  // Beak: a long deep wedge with a hooked tip.
  const bx = g.headCx - g.headR * 0.45;
  const by = g.headCy + g.headR * 0.16;
  const beak = g.muzLen;
  triangle(px, bx, by - g.headR * 0.62, bx, by + g.headR * 0.52, bx - beak, by - g.headR * 0.02, fill);
  triangle(px, bx - beak * 0.72, by - g.headR * 0.12, bx - beak, by - g.headR * 0.02,
    bx - beak * 0.82, by + g.headR * 0.5, fill);
  if (p.ruff > 0.55) {
    // Ruffed collar where the neck meets the body — vultures and harpies.
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const a = Math.PI * (0.15 + t * 0.7);
      ellipse(px, g.headCx + Math.cos(a) * g.headR * 1.15 + g.headR * 0.3,
        g.headCy + Math.sin(a) * g.headR * 1.25, (1 + p.ruff * 1.4) * s, (1 + p.ruff * 1.4) * s, fill);
    }
  }
  // Folded wing along the near flank, with primaries overhanging past the flank.
  const wx = g.bodyCx + rx * 0.12;
  const wy = g.bodyCy + ry * 0.05;
  ellipseRot(px, wx, wy, rx * 0.58, ry * 0.6, -0.26, fill);
  for (let i = 0; i < 3; i++) {
    taper(px, wx + rx * 0.1, wy + ry * 0.2,
      wx + rx * 0.75 + i * 1.4 * s, wy + ry * 0.85 + i * 1.6 * s, 2 * s, 1 * s, fill);
  }
  if (p.majesty > 0.6) {
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      triangle(px,
        g.headCx + (t - 0.2) * g.headR * 0.7 - 1.4 * s, g.headCy - g.headR * 0.72,
        g.headCx + (t - 0.2) * g.headR * 0.7 + 1.4 * s, g.headCy - g.headR * 0.72,
        g.headCx + (t - 0.2) * g.headR * 0.7 + 1.6 * s, g.headCy - g.headR * 0.72 - (4 - t * 1.4) * s,
        fill);
    }
  }
  // Toes: three forward, one back. Two pixels each, but they stop the bird
  // floating.
  for (const l of [g.near[1], g.far[1]]) {
    if (!l) continue;
    const r = l.r1;
    taper(px, l.x1, l.y1, l.x1 - 3.2 * s, GROUND - 0.5, r, r * 0.8, fill);
    taper(px, l.x1, l.y1, l.x1 - 1.2 * s, GROUND, r, r * 0.8, fill);
    taper(px, l.x1, l.y1, l.x1 + 2.2 * s, GROUND - 0.5, r, r * 0.8, fill);
  }
}

function detailBird(px: Pixels, p: ForgeParams, g: Geom): void {
  const s = g.scale;
  const dark = p.coat === 1 ? 2 : 1;
  const rx = g.bodyRx;
  const ry = g.bodyRy;
  const wx = g.bodyCx + rx * 0.12;
  const wy = g.bodyCy + ry * 0.05;
  // The wing's leading edge, drawn as an interior line. Inside a silhouette the
  // outline pass cannot help, so the wing has to be inked or it does not exist.
  inkCurve(px,
    wx - rx * 0.55, wy - ry * 0.5,
    wx - rx * 0.2, wy + ry * 0.15,
    wx + rx * 0.5, wy + ry * 0.72,
    1.1 * s, 0.9 * s, dark);
  // Primary separations.
  for (let i = 0; i < 3; i++) {
    inkTaper(px, wx + rx * 0.2 + i * 1.2 * s, wy + ry * 0.42,
      wx + rx * 0.78 + i * 1.4 * s, wy + ry * 0.9 + i * 1.5 * s, 0.7 * s, 0.6 * s, dark);
  }
}

// ---------------------------------------------------------------------------
// reptile — horizontal spine, splayed limbs bowing out, long low head, long tail
// ---------------------------------------------------------------------------

function layoutReptile(p: ForgeParams, s: number): Geom {
  const legLen = (2 + p.legs * 4) * s;
  const rx = (9 + p.bulk * 2.6) * s;
  const ry = (3.2 + p.bulk * 1.8) * s;
  const cx = CXA - 1 * s;
  const cy = GROUND - legLen - ry * 0.95;
  const hl = (5 + p.muzzle * 4.5) * s;
  const hh = (2.2 + p.head * 2) * s;
  const hx = cx - rx - hl * 0.72;
  const hy = cy - ry * 0.15;
  const tailLen = (17 + p.bulk * 7) * s;

  // Splayed: the elbow sits OUTSIDE the body line and the foot lands wide of the
  // shoulder. A lizard's humerus is horizontal; a dog's is vertical.
  const legR = (1.5 + p.bulk * 0.8) * s;
  const mk = (shoulderX: number, dir: number, near: boolean): Seg[] => {
    const sy = cy + ry * 0.35;
    const ex = shoulderX + dir * (3.4 * s);
    const ey = sy + ry * 0.5 + 1.2 * s;
    const fx = ex + dir * 2.8 * s;
    const r = near ? legR : legR * 0.8;
    return [
      seg(shoulderX, sy, ex, ey, r, r * 0.85, 0),
      seg(ex, ey, fx, GROUND - 1, r * 0.85, r * 0.7, r * 1.5),
    ];
  };
  const far: Seg[] = [
    ...mk(cx - rx * 0.5, -1, false).map((l) => seg(l.x0 + 2.4 * s, l.y0 - 0.8 * s, l.x1 + 2.4 * s, l.y1 - 1.2 * s, l.r0, l.r1, l.foot)),
    ...mk(cx + rx * 0.55, 1, false).map((l) => seg(l.x0 - 2.4 * s, l.y0 - 0.8 * s, l.x1 - 2.4 * s, l.y1 - 1.2 * s, l.r0, l.r1, l.foot)),
  ];
  const near: Seg[] = [...mk(cx - rx * 0.55, -1, true), ...mk(cx + rx * 0.6, 1, true)];

  return {
    scale: s, bodyCx: cx, bodyCy: cy, bodyRx: rx, bodyRy: ry,
    headCx: hx, headCy: hy, headR: hh * 1.3,
    eyeX: hx - hl * 0.28, eyeY: hy - hh * 0.42,
    noseX: hx - hl * 0.88, noseY: hy - hh * 0.05, hasNose: true,
    legLen, muzLen: hl, far, near,
    top: Math.min(cy - ry - (p.majesty > 0.4 ? 4.5 * s : 2 * s), cy - ry * 1.2 - tailLen * 0.42),
    left: hx - hl - 2 * s,
    right: cx + rx + tailLen * 0.62,
  };
}

function drawReptile(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const rx = g.bodyRx;
  const ry = g.bodyRy;
  const tailLen = (17 + p.bulk * 7) * s;
  // Tail as long as the body, sweeping back and lifting at the tip so it fits
  // the frame without shrinking the animal.
  const tx = g.bodyCx + rx * 0.8;
  const ty = g.bodyCy - ry * 0.05;
  curveR(px, tx, ty,
    tx + tailLen * 0.55, ty + ry * 0.2,
    tx + tailLen * 0.6, ty - tailLen * 0.5,
    (t) => Math.max(0.7 * s, ry * (1 - t) * 1.05 + 0.6 * s), fill);
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);
  // Low slab of a body, widest at the hips.
  ellipse(px, g.bodyCx, g.bodyCy, rx, ry, fill);
  ellipse(px, g.bodyCx + rx * 0.45, g.bodyCy + ry * 0.1, rx * 0.5, ry * 1.05, fill);
  // Neck continuous with the skull: no step, the way a monitor lizard reads.
  taper(px, g.bodyCx - rx * 0.7, g.bodyCy - ry * 0.15, g.headCx + g.muzLen * 0.5, g.headCy,
    ry * 0.92, g.headR * 0.62, fill);
  // Long low head, snout dipped.
  ellipseRot(px, g.headCx, g.headCy, g.muzLen * 0.95, g.headR * 0.6, -0.1, fill);
  // Sawtooth ridge from the shoulders down the tail — always, subtly; taller on
  // apex forms. It is the cheapest "not a mammal" signal in the kit.
  const crest = p.majesty > 0.4 ? 4.5 * s : 2 * s;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const sx = g.bodyCx - rx * 0.55 + t * rx * 1.75;
    const backY = g.bodyCy - ry * Math.sqrt(Math.max(0, 1 - ((sx - g.bodyCx) / rx) ** 2)) * 0.95;
    const h = crest * (1 - Math.abs(t - 0.45));
    triangle(px, sx - 1.4 * s, backY + 1, sx + 1.4 * s, backY + 1, sx, backY - h, fill);
  }
}

function detailReptile(px: Pixels, p: ForgeParams, g: Geom): void {
  const s = g.scale;
  const dark = p.coat === 1 ? 2 : 1;
  // Jaw line down the length of the head — turns a lump into a mouth.
  inkTaper(px, g.headCx - g.muzLen * 0.9, g.headCy + g.headR * 0.18,
    g.headCx + g.muzLen * 0.5, g.headCy + g.headR * 0.3, 0.7 * s, 0.7 * s, dark);
}

// ---------------------------------------------------------------------------
// Family dispatch
// ---------------------------------------------------------------------------

interface FamilyArt {
  readonly layout: LayoutFn;
  readonly draw: (px: Pixels, p: ForgeParams, g: Geom, fill: number, rnd: () => number) => void;
  /** Interior lines, drawn after shading so they are not painted over. */
  readonly detail?: (px: Pixels, p: ForgeParams, g: Geom) => void;
}

const FAMILY_ART: Readonly<Record<Family, FamilyArt>> = {
  canid: { layout: layoutCanid, draw: drawCanid, detail: detailFarLegs },
  felid: { layout: layoutFelid, draw: drawFelid, detail: detailFarLegs },
  ursid: { layout: layoutUrsid, draw: drawUrsid, detail: detailFarLegs },
  mustelid: { layout: layoutMustelid, draw: drawMustelid, detail: detailFarLegs },
  rodent: { layout: layoutRodent, draw: drawRodent },
  ungulate: { layout: layoutUngulate, draw: drawUngulate, detail: detailFarLegs },
  bird: { layout: layoutBird, draw: drawBird, detail: detailBird },
  reptile: {
    layout: layoutReptile,
    draw: drawReptile,
    detail: (px, p, g) => { detailFarLegs(px, p, g); detailReptile(px, p, g); },
  },
};

/**
 * Push the far limbs one shade back. Inside a silhouette there is no outline to
 * separate them, so without this the four legs are one dark mass.
 */
function detailFarLegs(px: Pixels, p: ForgeParams, g: Geom): void {
  if (p.coat !== 1) return; // On a dark coat the only free shade is lighter, which reads wrong.
  inkLimbs(px, g.far, 2);
}

// ---------------------------------------------------------------------------
// Back view — Gen 1 shows the player's own creature from behind
// ---------------------------------------------------------------------------

/**
 * Proportions of the rear three-quarter mass, per family. A back view does not
 * need to be a different animal, but a bear's rump is not a deer's: hips, back
 * width, how much of the head clears the shoulders and how the tail sits are
 * what carry the family.
 */
interface BackShape {
  /** Rump half-width and depth, before bulk. */
  readonly hipRx: number; readonly hipRy: number;
  /** Shoulder half-width at the top of the torso. */
  readonly shoulder: number;
  /** Torso height above the hip centre. */
  readonly rise: number;
  readonly headR: number;
  /** How far the skull clears the back line. Low = head turned away / sunk. */
  readonly headClear: number;
  readonly legLen: number;
  readonly legSpread: number;
  readonly legR: number;
}

const BACK_SHAPE: Readonly<Record<Family, BackShape>> = {
  canid: { hipRx: 9, hipRy: 8, shoulder: 7.5, rise: 9, headR: 6, headClear: 0.75, legLen: 11, legSpread: 5.5, legR: 2.1 },
  felid: { hipRx: 8.5, hipRy: 7.5, shoulder: 6.5, rise: 8, headR: 5.4, headClear: 0.6, legLen: 8.5, legSpread: 5, legR: 1.8 },
  ursid: { hipRx: 13, hipRy: 11, shoulder: 12, rise: 12, headR: 5.4, headClear: 0.18, legLen: 4.5, legSpread: 8, legR: 3.4 },
  mustelid: { hipRx: 9.5, hipRy: 6.5, shoulder: 8, rise: 5, headR: 4.4, headClear: 0.3, legLen: 3.5, legSpread: 5.5, legR: 1.6 },
  rodent: { hipRx: 8.5, hipRy: 9, shoulder: 7, rise: 9.5, headR: 6.6, headClear: 0.85, legLen: 3.5, legSpread: 5.5, legR: 2 },
  ungulate: { hipRx: 7.5, hipRy: 8.5, shoulder: 6, rise: 10, headR: 4.4, headClear: 1.05, legLen: 15, legSpread: 4.5, legR: 1.5 },
  bird: { hipRx: 7.5, hipRy: 10.5, shoulder: 6.5, rise: 11, headR: 4.6, headClear: 1.15, legLen: 8, legSpread: 3.5, legR: 1.3 },
  reptile: { hipRx: 11, hipRy: 5.5, shoulder: 9, rise: 4, headR: 4.6, headClear: 0.2, legLen: 3.5, legSpread: 10, legR: 1.7 },
};

function layoutBack(p: ForgeParams, s: number): Geom {
  const b = BACK_SHAPE[p.family];
  const hipRx = (b.hipRx + p.bulk * 3.5) * s;
  const hipRy = (b.hipRy + p.bulk * 2.5) * s;
  const legLen = (b.legLen * (0.55 + p.legs * 0.9)) * s;
  const cx = CXA;
  const cy = GROUND - legLen - hipRy * 0.55;
  const rise = (b.rise + p.bulk * 2) * s;
  const hr = (b.headR + p.head * 2.5) * s;
  const hx = cx;
  const hy = cy - rise - hr * b.headClear;
  const legR = (b.legR + p.bulk * 1.1) * s;
  const spread = (b.legSpread + p.bulk * 1.5) * s;

  const far: Seg[] = [];
  const near: Seg[] = [];
  if (p.family !== 'rodent') {
    for (const dir of [-1, 1] as const) {
      near.push(seg(cx + dir * spread * 0.75, cy + hipRy * 0.2,
        cx + dir * spread, GROUND - 1, legR, legR * 0.85, legR * 1.4));
    }
    if (p.family !== 'bird') {
      // Front feet, visible inside and slightly above the hind pair.
      for (const dir of [-1, 1] as const) {
        far.push(seg(cx + dir * spread * 0.4, cy + hipRy * 0.35,
          cx + dir * spread * 0.45, GROUND - 2 * s, legR * 0.7, legR * 0.7, legR * 1.1));
      }
    }
  }

  const earUp = p.ears === 'none' ? 0 : (2 + p.earSize * 5) * s;
  return {
    scale: s, bodyCx: cx, bodyCy: cy - rise * 0.35, bodyRx: hipRx, bodyRy: (hipRy + rise) * 0.6,
    headCx: hx, headCy: hy, headR: hr,
    eyeX: hx, eyeY: hy, noseX: hx, noseY: hy, hasNose: false,
    legLen, muzLen: 0, far, near,
    top: hy - hr - earUp,
    left: cx - Math.max(hipRx, spread + legR * 1.6) - 2 * s,
    right: cx + Math.max(hipRx, spread + legR * 1.6) + 2 * s,
  };
}

function drawBack(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  const s = g.scale;
  const b = BACK_SHAPE[p.family];
  const hipRx = g.bodyRx;
  const hipRy = (b.hipRy + p.bulk * 2.5) * s;
  const hipCy = GROUND - g.legLen - hipRy * 0.55;
  const rise = (b.rise + p.bulk * 2) * s;
  const shoulder = (b.shoulder + p.bulk * 2.5) * s;

  drawBackTail(px, p, g, hipCy, hipRy, fill);
  drawLimbs(px, g.far, fill);
  drawLimbs(px, g.near, fill);

  // Torso: hips at the bottom, narrowing to the shoulders, seen down the spine.
  ellipse(px, g.bodyCx, hipCy, hipRx, hipRy, fill);
  ellipse(px, g.bodyCx, hipCy - rise * 0.55, shoulder, rise * 0.72, fill);
  // Haunches, left and right, the dominant mass of any rear view.
  for (const dir of [-1, 1] as const) {
    ellipse(px, g.bodyCx + dir * hipRx * 0.55, hipCy + hipRy * 0.18, hipRx * 0.52, hipRy * 0.86, fill);
  }
  if (p.family === 'ursid') {
    // The hump again, from behind: a ridge above the shoulders.
    ellipse(px, g.bodyCx, hipCy - rise * 0.95, shoulder * 0.82, rise * 0.42, fill);
  }
  if (p.family === 'bird') {
    // Folded wings down both flanks, tips meeting over the tail.
    for (const dir of [-1, 1] as const) {
      ellipseRot(px, g.bodyCx + dir * shoulder * 0.72, hipCy - rise * 0.25,
        shoulder * 0.42, rise * 0.85, dir * 0.12, fill);
    }
  }

  // Neck and head. The head is small and sunk between the shoulders — a back
  // view should never show a face, and a foreshortened skull sells the turn.
  taper(px, g.bodyCx, hipCy - rise * 0.7, g.headCx, g.headCy + g.headR * 0.5,
    g.headR * 0.8, g.headR * 0.75, fill);
  ellipse(px, g.headCx, g.headCy, g.headR, g.headR * 0.86, fill);
  drawBackEars(px, p, g, fill);
  if (p.family === 'ungulate' && p.majesty > 0.6) {
    const beam = (4.5 + p.majesty * 4) * s;
    for (const dir of [-1, 1] as const) {
      curve(px, g.headCx + dir * g.headR * 0.5, g.headCy - g.headR * 0.5,
        g.headCx + dir * (g.headR * 0.5 + beam * 0.8), g.headCy - beam * 0.7,
        g.headCx + dir * (g.headR * 0.4 + beam * 0.7), g.headCy - beam * 1.3,
        1.4 * s, 0.7 * s, fill);
    }
  }
  if (p.majesty > 0.6 && (p.family === 'canid' || p.family === 'reptile')) {
    // Dorsal spines run straight up the middle of the back from behind.
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const y = hipCy - rise * 0.2 - t * rise * 0.9;
      const h = (3.6 - t * 1.2) * p.majesty * s;
      triangle(px, g.bodyCx - 1.8 * s, y, g.bodyCx + 1.8 * s, y, g.bodyCx, y - h, fill);
    }
  }
}

function drawBackTail(
  px: Pixels, p: ForgeParams, g: Geom, hipCy: number, hipRy: number, fill: number,
): void {
  const s = g.scale;
  const x = g.bodyCx;
  const rootY = hipCy + hipRy * 0.1;
  const len = (7 + p.bulk * 5) * s;
  if (p.family === 'bird') {
    for (let i = -1; i <= 1; i++) {
      taper(px, x, rootY, x + i * 3.4 * s, Math.min(S - 3, GROUND + 2 * s), 2.6 * s, 1.6 * s, fill);
    }
    return;
  }
  if (p.family === 'reptile') {
    // Straight down the centre and off the bottom of the frame — unmistakable.
    curveR(px, x, rootY, x + 2 * s, GROUND - 2 * s, x + 5 * s, S - 3,
      (t) => Math.max(1 * s, (3.4 - t * 2.2) * s), fill);
    return;
  }
  switch (p.tail) {
    case 'curl':
      // Curled over the rump — from behind, a husky's tail is a ring on its back.
      curve(px, x - len * 0.1, rootY, x + len * 0.85, rootY - len * 0.9,
        x - len * 0.35, rootY - len * 0.75, 3 * s, 2.2 * s, fill);
      break;
    case 'plume':
      curve(px, x, rootY - hipRy * 0.2, x + len * 0.5, rootY + len * 0.5,
        x + len * 0.35, rootY + len * 1.05, 3.4 * s, 2.2 * s, fill);
      break;
    case 'brush':
      taper(px, x, rootY, x + len * 0.35, rootY + len * 1.05, 3 * s, 2 * s, fill);
      break;
    case 'stub':
      ellipse(px, x, rootY + 1 * s, 2.8 * s, 2.6 * s, fill);
      break;
    case 'whip':
      if (p.family === 'felid') {
        // Up: a cat carries its tail vertically, and from behind that is a line
        // straight up the middle of the sprite.
        curve(px, x, rootY - hipRy * 0.3, x + len * 0.15, rootY - len * 1.2,
          x + len * 0.55, rootY - len * 1.7, 2.2 * s, 1.4 * s, fill);
      } else {
        curve(px, x, rootY, x + len * 0.35, rootY + len * 0.7,
          x + len * 0.15, rootY + len * 1.15, 1.9 * s, 1.1 * s, fill);
      }
      break;
    case 'fan':
      taper(px, x, rootY, x, rootY + len, 2.6 * s, 1.6 * s, fill);
      break;
  }
}

function drawBackEars(px: Pixels, p: ForgeParams, g: Geom, fill: number): void {
  if (p.ears === 'none') return;
  const s = g.scale;
  const size = (2 + p.earSize * 5) * s * (p.majesty > 0.6 ? 1.2 : 1);
  for (const dir of [-1, 1] as const) {
    const ex = g.headCx + dir * g.headR * 0.68;
    const ey = g.headCy - g.headR * 0.5;
    switch (p.ears) {
      case 'prick':
      case 'tuft':
        triangle(px, ex - size * 0.5, ey + 1.4 * s, ex + size * 0.5, ey + 1.4 * s,
          ex + dir * size * 0.45, ey - size, fill);
        break;
      case 'drop':
        curve(px, ex, ey, ex + dir * size * 0.8, ey + size * 0.25,
          ex + dir * size * 0.7, ey + size * 0.9, 2.4 * s, 1.4 * s, fill);
        break;
      case 'round':
        ellipse(px, ex + dir * 0.4 * s, ey - size * 0.3, size * 0.6, size * 0.6, fill);
        break;
    }
  }
}

/** Interior lines for the back view: the spine groove and the haunch split. */
function detailBack(px: Pixels, p: ForgeParams, g: Geom): void {
  const s = g.scale;
  const dark = p.coat === 1 ? 2 : 1;
  const b = BACK_SHAPE[p.family];
  const hipRy = (b.hipRy + p.bulk * 2.5) * s;
  const hipCy = GROUND - g.legLen - hipRy * 0.55;
  const rise = (b.rise + p.bulk * 2) * s;
  inkTaper(px, g.bodyCx, hipCy - rise * 0.85, g.bodyCx, hipCy + hipRy * 0.55, 0.7 * s, 0.7 * s, dark);
  for (const dir of [-1, 1] as const) {
    inkCurve(px,
      g.bodyCx + dir * g.bodyRx * 0.2, hipCy - hipRy * 0.35,
      g.bodyCx + dir * g.bodyRx * 0.95, hipCy - hipRy * 0.1,
      g.bodyCx + dir * g.bodyRx * 0.75, hipCy + hipRy * 0.75,
      0.7 * s, 0.6 * s, dark);
  }
}

// ---------------------------------------------------------------------------
// The forge
// ---------------------------------------------------------------------------

export function forgeSprite(params: ForgeParams, seed: number, view: SpriteView = 'front'): Pixels {
  const px = new Uint8Array(S * S);
  const rnd = mulberry(seed ^ 0x5bf03635);
  const fill = params.coat;

  // Stage scale. Bulk alone does not sell an evolution line; the pup has to be
  // visibly smaller in the frame, the way Charmander is smaller than Charizard.
  const base =
    params.majesty >= 0.9 ? 1.14 : params.majesty >= 0.5 ? 1.06 : params.majesty > 0 ? 1 : 0.82;

  if (view === 'back') {
    const g = fit(layoutBack, params, base);
    drawBack(px, params, g, fill);
    outline(px);
    shade(px, params, g, rnd, 'back');
    detailBack(px, params, g);
    return px;
  }

  const art = FAMILY_ART[params.family];
  const g = fit(art.layout, params, base);
  art.draw(px, params, g, fill, rnd);
  outline(px);
  shade(px, params, g, rnd, 'front');
  art.detail?.(px, params, g);
  drawFace(px, params, g);
  return px;
}

/** Trace a one-pixel dark border around every filled region. */
function outline(px: Pixels): void {
  const src = px.slice();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (src[y * S + x] !== 0) continue;
      const n =
        (src[y * S + x - 1] ?? 0) || (src[y * S + x + 1] ?? 0) ||
        (src[(y - 1) * S + x] ?? 0) || (src[(y + 1) * S + x] ?? 0);
      if (n !== 0 && x > 0 && x < S - 1) put(px, x, y, 3);
    }
  }
}

/**
 * Shading and coat pattern. Both write shade 2 over shade 1 (or vice versa),
 * never over the outline, so the silhouette survives whatever the pattern does.
 */
function shade(
  px: Pixels, params: ForgeParams, g: Geom, rnd: () => number, view: SpriteView,
): void {
  // Shade 3 is reserved for the outline, the eye and the nose. If a coat pattern
  // is allowed to paint 3, a dark animal merges with its own outline and the
  // whole silhouette collapses into a black smear — which is exactly what the
  // first otter did. So the coat only ever uses 1 and 2:
  //   light animal  -> base 1, markings 2
  //   dark animal   -> base 2, markings 1
  // Both stay legible against the DMG's lightest background.
  const light = params.coat === 1 ? 1 : 2;
  const dark = params.coat === 1 ? 2 : 1;
  const bx = g.bodyCx;
  const by = g.bodyCy;
  const brx = g.bodyRx;
  const bry = g.bodyRy;
  const hx = g.headCx;
  const hy = g.headCy;
  const hr = g.headR;
  const paint = (x: number, y: number, v: number): void => {
    const cur = get(px, x, y);
    if (cur === 0 || cur === 3) return;
    put(px, x, y, v);
  };
  const flat = (v: number): void => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (get(px, x, y) === 0) continue;
        paint(x, y, v);
      }
    }
  };
  // Seen from behind, "the back" is the middle of the sprite, not its top half.
  const onBack = (x: number, y: number): boolean =>
    view === 'back'
      ? Math.abs(x - bx) < brx * 0.62 && y > g.headCy - g.headR * 0.2
      : y < by - bry * 0.05;

  switch (params.pattern) {
    case 'mask': {
      // Dark cap over the skull and a dark saddle down the back, light muzzle and
      // belly. This is the husky/shepherd read, and it is worth having as a case.
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          const overHead =
            (x - hx) ** 2 / (hr * 1.02) ** 2 + (y - hy + hr * 0.5) ** 2 / (hr * 0.85) ** 2 <= 1;
          paint(x, y, overHead || onBack(x, y) ? dark : light);
        }
      }
      if (view === 'front') {
        // Light muzzle: the face markings do the work.
        ellipse2(px, hx - hr * 0.5, hy + hr * 0.42, hr * 0.62, hr * 0.42, light);
      }
      break;
    }
    case 'tabby': {
      flat(light);
      // Vertical bands across the barrel, plus a banded tail.
      for (let i = -4; i <= 5; i++) {
        const sx = bx + i * (brx * 0.29);
        for (let y = Math.floor(by - bry * 1.3); y < by + bry * 1.15; y++) {
          const w = 1 + (i % 2 === 0 ? 1 : 0);
          for (let d = 0; d < w; d++) paint(Math.round(sx + d), y, dark);
        }
      }
      ellipse2(px, hx, hy - hr * 0.45, hr * 0.7, hr * 0.3, dark);
      break;
    }
    case 'counter': {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          paint(x, y, y < by ? dark : light);
        }
      }
      break;
    }
    case 'saddle': {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          const inSaddle = view === 'back'
            ? onBack(x, y)
            : y < by + bry * 0.15 && x > bx - brx * 0.85 && x < bx + brx * 0.95;
          paint(x, y, inSaddle ? dark : light);
        }
      }
      break;
    }
    case 'spot': {
      flat(light);
      const n = 12 + Math.floor(rnd() * 10);
      for (let i = 0; i < n; i++) {
        const sx = bx + (rnd() * 2 - 1) * brx;
        const sy = by + (rnd() * 2 - 1) * bry;
        ellipse2(px, sx, sy, 1.4 + rnd() * 1.3, 1.2 + rnd(), dark);
      }
      break;
    }
    case 'patch': {
      flat(light);
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        ellipse2(px, bx + (rnd() * 2 - 1) * brx * 0.85, by + (rnd() * 2 - 1) * bry * 0.85,
          3 + rnd() * 4, 2.6 + rnd() * 3.4, dark);
      }
      break;
    }
    case 'solid': {
      flat(light);
      break;
    }
  }

  if (view === 'back') {
    // From behind, the animal is seen from above: whatever the pattern, the cap
    // and the spine read dark or the sprite is a flat cutout.
    ellipse2(px, hx, hy - hr * 0.25, hr * 0.95, hr * 0.7, dark);
    if (params.pattern !== 'tabby' && params.pattern !== 'spot') {
      ellipse2(px, bx, by, brx * 0.4, bry * 0.85, dark);
    }
  }

  // Universal underside shadow. Ordered 4x4 Bayer dither, not random noise:
  // random speckle reads as dirt, an ordered ramp reads as a light source, and
  // the DMG's own artists used exactly this.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  // Start the ramp below the barrel and finish it fast, so the sprite gets a
  // narrow dithered transition into solid shadow rather than a 50% checkerboard
  // over its whole lower half.
  const shadowTop = by + bry * 0.55;
  const shadowBottom = by + bry * 1.15;
  for (let y = Math.floor(shadowTop); y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cur = get(px, x, y);
      if (cur === 0 || cur === 3) continue;
      const depth = (y - shadowTop) / Math.max(1, shadowBottom - shadowTop);
      const threshold = (BAYER[(y % 4) * 4 + (x % 4)] ?? 0) / 16;
      // Only ever deepens light coat to shadow coat. Never reaches 3.
      if (depth > threshold && cur === 1) paint(x, y, 2);
    }
  }
}

/**
 * Eyes and nose, drawn last and never overpainted. A sprite with a clear eye
 * reads as an animal; the same sprite without one reads as a rock.
 */
function drawFace(px: Pixels, params: ForgeParams, g: Geom): void {
  const ex = g.eyeX;
  const ey = g.eyeY;
  const er = Math.max(1.35, Math.min(2.1, 1.05 + g.headR * 0.16));

  // Light sclera patch so the dark pupil always has contrast to sit on.
  ellipse2(px, ex, ey, er * 1.5, er * 1.35, 1);
  ellipse(px, ex, ey, er, er * 1.1, 3);
  put(px, Math.round(ex - 0.5), Math.round(ey - 0.6), 1); // catchlight

  // Angry brow on apex forms. Two pixels of slope is the whole difference between
  // "friendly" and "about to ruin your day".
  if (params.majesty > 0.5) {
    for (let i = 0; i < 5; i++) {
      put(px, Math.round(ex - 2 + i), Math.round(ey - er - 1 - i * 0.45), 3);
    }
  }

  if (g.hasNose) {
    ellipse(px, g.noseX, g.noseY, 1.7, 1.3, 3);
  }
}

// ---------------------------------------------------------------------------
// Palettes — DMG green, plus a neutral grey for UI contexts
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

export const DMG_PALETTE: readonly Rgb[] = [
  [0xe0, 0xf8, 0xd0],
  [0x88, 0xc0, 0x70],
  [0x34, 0x68, 0x56],
  [0x08, 0x18, 0x20],
];

/** Expand an index buffer to RGBA. `transparent` leaves index 0 fully clear. */
export function toRgba(px: Pixels, palette: readonly Rgb[] = DMG_PALETTE, transparent = true): Uint8ClampedArray {
  const out = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < px.length; i++) {
    const idx = px[i] ?? 0;
    const c = palette[idx] ?? palette[0] ?? [0, 0, 0];
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = transparent && idx === 0 ? 0 : 255;
  }
  return out;
}

/**
 * Convenience: everything needed to draw one species, from its Species record.
 * `view` defaults to 'front', so every existing call site is unchanged.
 */
export function spriteFor(
  id: string,
  family: Family,
  stage: 'pup' | 'adult' | 'apex',
  seed: number,
  legendary = false,
  view: SpriteView = 'front',
): Pixels {
  return forgeSprite(paramsFor(id, family, stage, seed, legendary), seed, view);
}
