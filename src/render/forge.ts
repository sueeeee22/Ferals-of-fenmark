/**
 * The procedural sprite forge.
 *
 * Composes a Game Boy-palette pixel sprite from parameterized parts: a skeleton
 * chosen by animal family, then ears, muzzle, tail, build and coat pattern, all
 * derived deterministically from a per-species seed. 153 creatures therefore cost
 * a data table instead of 153 hand-drawn assets.
 *
 * Runs unchanged in Node (for the contact sheet and gauntlet:visual) and in the
 * browser (for the game), because it only ever writes into a Uint8Array.
 *
 * Output is an indexed buffer, one byte per pixel, matching the DMG's four shades:
 *   0 = transparent   1 = light coat   2 = shadow coat   3 = outline / darkest
 *
 * The nine starter-line sprites carry hand-tuned overrides in STARTER_TUNING —
 * those are the ones a player stares at for forty hours.
 */

import type { Family } from '../core/creature.ts';

export const SPRITE_SIZE = 56;

export type Pixels = Uint8Array;

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
  /** Extra apex-form flourishes: horns, crest, longer fur. 0 for pups. */
  readonly majesty: number;
}

/** Family skeletons: the proportions that make a silhouette read as its animal. */
const FAMILY_BASE: Readonly<Record<Family, Omit<ForgeParams, 'family'>>> = {
  canid: { bulk: 0.5, legs: 0.62, muzzle: 0.7, head: 0.5, ears: 'prick', earSize: 0.6, tail: 'plume', ruff: 0.4, pattern: 'mask', coat: 1, majesty: 0 },
  felid: { bulk: 0.42, legs: 0.5, muzzle: 0.25, head: 0.55, ears: 'prick', earSize: 0.5, tail: 'whip', ruff: 0.2, pattern: 'tabby', coat: 1, majesty: 0 },
  ursid: { bulk: 0.9, legs: 0.34, muzzle: 0.5, head: 0.6, ears: 'round', earSize: 0.35, tail: 'stub', ruff: 0.3, pattern: 'solid', coat: 2, majesty: 0 },
  bird: { bulk: 0.5, legs: 0.55, muzzle: 0.4, head: 0.45, ears: 'none', earSize: 0, tail: 'fan', ruff: 0.5, pattern: 'counter', coat: 1, majesty: 0 },
  mustelid: { bulk: 0.38, legs: 0.28, muzzle: 0.45, head: 0.45, ears: 'round', earSize: 0.3, tail: 'brush', ruff: 0.15, pattern: 'counter', coat: 2, majesty: 0 },
  rodent: { bulk: 0.35, legs: 0.3, muzzle: 0.4, head: 0.6, ears: 'round', earSize: 0.7, tail: 'whip', ruff: 0.1, pattern: 'counter', coat: 1, majesty: 0 },
  ungulate: { bulk: 0.68, legs: 0.85, muzzle: 0.75, head: 0.42, ears: 'drop', earSize: 0.55, tail: 'stub', ruff: 0.25, pattern: 'patch', coat: 1, majesty: 0 },
  reptile: { bulk: 0.45, legs: 0.22, muzzle: 0.85, head: 0.4, ears: 'none', earSize: 0, tail: 'whip', ruff: 0, pattern: 'spot', coat: 2, majesty: 0 },
};

/**
 * Hand-tuned parameters for the nine starter-line sprites. The generator's
 * defaults are good enough for a route encounter; they are not good enough for
 * the creature a player picks in the first five minutes and keeps for forty hours.
 */
const STARTER_TUNING: Readonly<Record<string, Partial<ForgeParams>>> = {
  // Winter — black-and-white Siberian Husky. Aloof, dramatic, screams.
  winter_pup: { bulk: 0.34, legs: 0.44, muzzle: 0.5, head: 0.66, ears: 'prick', earSize: 0.72, tail: 'curl', ruff: 0.5, pattern: 'mask', coat: 1, majesty: 0 },
  winter_adult: { bulk: 0.54, legs: 0.66, muzzle: 0.72, head: 0.5, ears: 'prick', earSize: 0.66, tail: 'curl', ruff: 0.66, pattern: 'mask', coat: 1, majesty: 0.2 },
  winter_apex: { bulk: 0.74, legs: 0.76, muzzle: 0.78, head: 0.52, ears: 'prick', earSize: 0.8, tail: 'plume', ruff: 1, pattern: 'mask', coat: 1, majesty: 0.95 },

  // Baloo — orange-and-white Siberian Husky. Enthusiastic idiot.
  baloo_pup: { bulk: 0.4, legs: 0.46, muzzle: 0.52, head: 0.64, ears: 'prick', earSize: 0.62, tail: 'curl', ruff: 0.45, pattern: 'mask', coat: 1, majesty: 0 },
  baloo_adult: { bulk: 0.62, legs: 0.64, muzzle: 0.7, head: 0.5, ears: 'prick', earSize: 0.6, tail: 'plume', ruff: 0.7, pattern: 'mask', coat: 1, majesty: 0.25 },
  baloo_apex: { bulk: 0.92, legs: 0.7, muzzle: 0.74, head: 0.56, ears: 'prick', earSize: 0.7, tail: 'plume', ruff: 1, pattern: 'mask', coat: 1, majesty: 1 },

  // Plato — grey-and-white tabby. Contemptuous. Will not fetch.
  plato_pup: { bulk: 0.3, legs: 0.36, muzzle: 0.2, head: 0.7, ears: 'prick', earSize: 0.66, tail: 'whip', ruff: 0.12, pattern: 'tabby', coat: 1, majesty: 0 },
  plato_adult: { bulk: 0.46, legs: 0.52, muzzle: 0.26, head: 0.56, ears: 'prick', earSize: 0.56, tail: 'whip', ruff: 0.3, pattern: 'tabby', coat: 1, majesty: 0.2 },
  plato_apex: { bulk: 0.6, legs: 0.58, muzzle: 0.3, head: 0.6, ears: 'tuft', earSize: 0.74, tail: 'plume', ruff: 0.8, pattern: 'tabby', coat: 1, majesty: 0.9 },
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

  // Stage drives mass and majesty: a pup is small-bodied and big-headed, an apex
  // is heavy, maned and crested. This is what makes an evolution line read as one.
  const stageBulk = stage === 'pup' ? -0.16 : stage === 'apex' ? 0.18 : 0;
  const stageHead = stage === 'pup' ? 0.14 : stage === 'apex' ? -0.04 : 0;
  const majesty = legendary ? 1 : stage === 'apex' ? 0.72 : stage === 'adult' ? 0.16 : 0;

  const earPool: readonly EarShape[] =
    family === 'bird' || family === 'reptile' ? ['none'] : ['prick', 'drop', 'round', 'tuft'];
  const tailPool: readonly TailShape[] =
    family === 'bird' ? ['fan'] : ['curl', 'plume', 'brush', 'stub', 'whip'];
  const patternPool: readonly CoatPattern[] = ['solid', 'mask', 'tabby', 'spot', 'patch', 'counter', 'saddle'];

  const params: ForgeParams = {
    family,
    bulk: vary(base.bulk + stageBulk, 0.13),
    legs: vary(base.legs, 0.13),
    muzzle: vary(base.muzzle, 0.16),
    head: vary(base.head + stageHead, 0.09),
    ears: rnd() < 0.55 ? base.ears : (earPool[Math.floor(rnd() * earPool.length)] ?? base.ears),
    earSize: vary(base.earSize, 0.2),
    tail: rnd() < 0.55 ? base.tail : (tailPool[Math.floor(rnd() * tailPool.length)] ?? base.tail),
    ruff: vary(base.ruff + majesty * 0.35, 0.14),
    pattern:
      rnd() < 0.5 ? base.pattern : (patternPool[Math.floor(rnd() * patternPool.length)] ?? base.pattern),
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
  const steps = 34;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    ellipse(px, x, y, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t, v);
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

// ---------------------------------------------------------------------------
// The forge
// ---------------------------------------------------------------------------

export function forgeSprite(params: ForgeParams, seed: number): Pixels {
  const px = new Uint8Array(S * S);
  const rnd = mulberry(seed ^ 0x5bf03635);
  const fill = params.coat;

  const isBird = params.family === 'bird';
  const isReptile = params.family === 'reptile';
  const isUpright = isBird;

  // --- Layout ------------------------------------------------------------
  // Explicit pixel budget on a 56x56 field: the creature occupies roughly
  // x 6..50, y 12..50, which leaves the margin Gen 1 sprites have. Getting these
  // numbers wrong is the difference between an animal and a blob, so they are
  // absolute rather than proportional to the canvas.
  const groundY = S - 6;
  // Stage scale. Bulk alone does not sell an evolution line; the pup has to be
  // visibly smaller in the frame, the way Charmander is smaller than Charizard.
  const scale = params.majesty >= 0.9 ? 1.14 : params.majesty >= 0.5 ? 1.06 : params.majesty > 0 ? 1 : 0.82;
  const legLen = ((isReptile ? 3 : 6) + params.legs * (isReptile ? 4 : 9)) * scale;
  const bodyRx = ((isUpright ? 8 : 10) + params.bulk * (isUpright ? 3.5 : 5)) * scale;
  const bodyRy = ((isUpright ? 10.5 : 5.5) + params.bulk * 4) * scale;
  const bodyCy = groundY - legLen - bodyRy * 0.85;
  const bodyCx = S / 2 + (isUpright ? 0 : 1.5);

  const headR = (5.5 + params.head * 3.5) * scale;
  // The head must sit clearly forward of the shoulder. Overlap of a few pixels
  // connects them; more than that and the silhouette reads as one lump.
  const headCx = isUpright ? bodyCx : bodyCx - bodyRx - headR * 0.45;
  const headCy = isUpright
    ? bodyCy - bodyRy - headR * 0.75
    : bodyCy - bodyRy * 0.75 - headR * 0.5;

  // --- Tail (drawn first so the body overlaps its root) -------------------
  const tailRootX = bodyCx + bodyRx * 0.9;
  const tailRootY = bodyCy - bodyRy * 0.25;
  drawTail(px, params, tailRootX, tailRootY, fill, groundY);

  // --- Legs ---------------------------------------------------------------
  // Near and far pairs, offset so the gap between them reads as depth. Gen 1
  // sprites do exactly this and it is why they look like they stand in a world.
  if (!isBird) {
    const legR = 1.3 + params.bulk * 1.1;
    const frontX = bodyCx - bodyRx * 0.62;
    const backX = bodyCx + bodyRx * 0.62;
    for (const [lx, dx, far] of [
      [frontX, 0, false], [frontX + 3.2, 1.2, true],
      [backX, 0, false], [backX - 3.2, 1.2, true],
    ] as const) {
      const r = far ? legR * 0.8 : legR;
      taper(px, lx, bodyCy + bodyRy * 0.45, lx + dx, groundY - 1, r, r * 0.85, fill);
      ellipse(px, lx + dx, groundY - 1, r * 1.3, r * 0.85, fill);
    }
  } else {
    const legR = 1.2;
    for (const lx of [bodyCx - 3.5, bodyCx + 3.5]) {
      taper(px, lx, bodyCy + bodyRy * 0.7, lx, groundY - 1, legR, legR, fill);
      ellipse(px, lx, groundY - 1, 2.4, 1.2, fill);
    }
  }

  // --- Body ---------------------------------------------------------------
  ellipse(px, bodyCx, bodyCy, bodyRx, bodyRy, fill);
  if (isReptile) {
    // Reptiles get a long low body that merges into the tail.
    ellipse(px, bodyCx + bodyRx * 0.5, bodyCy + 1, bodyRx * 0.7, bodyRy * 0.8, fill);
  }

  // --- Neck / ruff --------------------------------------------------------
  const neckR = 2 + params.bulk * 1.8 + params.ruff * 1.2;
  taper(px, bodyCx - bodyRx * 0.55, bodyCy - bodyRy * 0.35, headCx + headR * 0.35, headCy + headR * 0.55,
    neckR, neckR * 0.85, fill);
  if (params.ruff > 0.45) {
    // A mane reads as "this one is dangerous" more cheaply than any other feature,
    // but it has to hug the skull — a halo of blobs just erases the head shape.
    const manePoints = 9;
    for (let i = 0; i < manePoints; i++) {
      const a = Math.PI * 0.25 + (i / (manePoints - 1)) * Math.PI * 1.15;
      const rr = headR * 1.12;
      ellipse(
        px,
        headCx + Math.cos(a) * rr + headR * 0.28,
        headCy + Math.sin(a) * rr,
        1.1 + params.ruff * 1.5,
        1.1 + params.ruff * 1.5,
        fill,
      );
    }
  }

  // --- Head ---------------------------------------------------------------
  ellipse(px, headCx, headCy, headR, headR * (isBird ? 0.95 : 0.9), fill);

  // --- Muzzle / beak ------------------------------------------------------
  const muzLen = 2 + params.muzzle * (isReptile ? 8 : 5);
  const muzY = headCy + headR * 0.32;
  const snoutTipX = headCx - headR * 0.5 - muzLen;
  if (isBird) {
    const beakLen = (4 + params.muzzle * 5) * scale;
    const beakBaseX = headCx - headR * 0.55;
    triangle(px, beakBaseX, muzY - 2.6, beakBaseX, muzY + 2.2, beakBaseX - beakLen, muzY - 0.4, fill);
    // The hook. Two pixels of downturn is the whole difference between a raptor
    // and a duck, and this roster has harpy eagles in it.
    taper(px, beakBaseX - beakLen * 0.75, muzY - 0.9, beakBaseX - beakLen * 0.92, muzY + 1.9, 1.3, 0.7, fill);
  } else {
    taper(px, headCx - headR * 0.2, muzY, snoutTipX, muzY + 0.9,
      headR * 0.42, headR * 0.26, fill);
    ellipse(px, snoutTipX, muzY + 0.9, headR * 0.28, headR * 0.24, fill);
  }

  // --- Ears ---------------------------------------------------------------
  drawEars(px, params, headCx, headCy, headR, fill);

  // --- Wings --------------------------------------------------------------
  if (isBird) {
    // One folded wing, tucked along the flank and tapering to primaries that
    // overhang the tail. This is the shape that says "bird" at 56 pixels.
    const span = (6 + params.bulk * 6 + params.majesty * 4) * scale;
    curve(px,
      bodyCx - bodyRx * 0.35, bodyCy - bodyRy * 0.55,
      bodyCx + bodyRx * 0.75, bodyCy - bodyRy * 0.1,
      bodyCx + bodyRx * 0.55 + span * 0.35, bodyCy + bodyRy * 0.75,
      3.4 + params.bulk * 1.8, 1.2, fill);
    // Shoulder coverts, so the wing joins the body instead of being stuck on.
    ellipse(px, bodyCx - bodyRx * 0.1, bodyCy - bodyRy * 0.35, bodyRx * 0.55, bodyRy * 0.4, fill);
  }

  // --- Apex flourishes: horns and crest -----------------------------------
  if (params.majesty > 0.6 && !isBird) {
    // Dorsal spines along the spine, tallest at the shoulder and tapering to the
    // hip. Horns on the skull were tried first and read as rabbit ears — the
    // spine is the one place a silhouette can grow without eating the head.
    const spikes = 5;
    for (let i = 0; i < spikes; i++) {
      const t = i / (spikes - 1);
      const sx = bodyCx - bodyRx * 0.72 + t * bodyRx * 1.5;
      // Follow the curve of the back rather than a flat line.
      const backY = bodyCy - bodyRy * Math.sqrt(Math.max(0, 1 - ((sx - bodyCx) / bodyRx) ** 2)) * 0.96;
      const h = (4.5 - t * 2.4) * params.majesty * scale;
      triangle(px, sx - 1.7, backY + 1, sx + 1.7, backY + 1, sx - 0.6, backY - h, fill);
    }
  }

  // --- Outline, shading, pattern, face ------------------------------------
  outline(px);
  shade(px, params, bodyCx, bodyCy, bodyRx, bodyRy, headCx, headCy, headR, rnd);
  drawFace(px, params, headCx, headCy, headR, isBird);

  return px;
}

function drawEars(
  px: Pixels, params: ForgeParams,
  hx: number, hy: number, hr: number, fill: number,
): void {
  if (params.ears === 'none') return;
  const size = (2.5 + params.earSize * 6.5) * (params.majesty > 0.6 ? 1.25 : 1);
  for (const dir of [-1, 1] as const) {
    const ex = hx + dir * hr * 0.62;
    const ey = hy - hr * 0.66;
    switch (params.ears) {
      case 'prick':
        triangle(px, ex - 2.6, ey + 1.6, ex + 2.6, ey + 1.6, ex + dir * 1.4, ey - size, fill);
        break;
      case 'drop':
        curve(px, ex, ey, ex + dir * size * 0.7, ey + size * 0.3,
          ex + dir * size * 0.45, ey + size * 0.95, 2.6, 1.5, fill);
        break;
      case 'round':
        ellipse(px, ex + dir * 0.6, ey - size * 0.35, size * 0.55, size * 0.55, fill);
        break;
      case 'tuft':
        triangle(px, ex - 2.4, ey + 1.6, ex + 2.4, ey + 1.6, ex + dir * 1.2, ey - size, fill);
        // Lynx tips: the single cheapest way to say "this is a wild cat".
        taper(px, ex + dir * 1.2, ey - size, ex + dir * 2.2, ey - size - 3.4, 1.1, 0.4, fill);
        break;
    }
  }
}

function drawTail(
  px: Pixels, params: ForgeParams,
  x: number, y: number, fill: number, groundY: number,
): void {
  const len = 6 + params.bulk * 4.5;
  switch (params.tail) {
    case 'curl':
      // Over the back — the husky/spitz signature.
      curve(px, x, y, x + len * 0.95, y - len * 1.05, x - len * 0.15, y - len * 0.95, 3.2, 2.4, fill);
      break;
    case 'plume':
      curve(px, x, y, x + len * 0.85, y - len * 0.55, x + len * 0.75, y - len * 1.15, 3.6, 2.6, fill);
      break;
    case 'brush':
      taper(px, x, y, x + len * 0.95, y + len * 0.25, 3.2, 2.2, fill);
      break;
    case 'stub':
      ellipse(px, x + 2.2, y - 1, 3.1, 2.8, fill);
      break;
    case 'whip':
      curve(px, x, y, x + len * 0.9, y - len * 0.35, x + len * 0.55, y - len * 1.25, 2.1, 1.1, fill);
      break;
    case 'fan':
      for (let i = -2; i <= 2; i++) {
        taper(px, x - 2, y, x + len * 0.75, Math.min(groundY - 2, y + i * 3.1 + 3), 1.8, 1.1, fill);
      }
      break;
  }
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
  px: Pixels, params: ForgeParams,
  bx: number, by: number, brx: number, bry: number,
  hx: number, hy: number, hr: number,
  rnd: () => number,
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
  const paint = (x: number, y: number, v: number): void => {
    const cur = get(px, x, y);
    if (cur === 0 || cur === 3) return;
    put(px, x, y, v);
  };

  switch (params.pattern) {
    case 'mask': {
      // Dark cap over the skull and a dark saddle down the back, light muzzle and
      // belly. This is the husky/shepherd read, and it is worth having as a case.
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          const overHead = (x - hx) ** 2 / (hr * 1.02) ** 2 + (y - hy + hr * 0.5) ** 2 / (hr * 0.85) ** 2 <= 1;
          const overBack = y < by - bry * 0.05;
          if (overHead || overBack) paint(x, y, dark);
          else paint(x, y, light);
        }
      }
      // Light brow spots and a light muzzle — the face markings do the work.
      ellipse2(px, hx - hr * 0.5, hy + hr * 0.42, hr * 0.62, hr * 0.42, light);
      break;
    }
    case 'tabby': {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          paint(x, y, light);
        }
      }
      // Vertical bands across the barrel, plus ringed tail.
      for (let i = -4; i <= 5; i++) {
        const sx = bx + i * (brx * 0.29);
        for (let y = Math.floor(by - bry * 1.1); y < by + bry * 1.05; y++) {
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
          const inSaddle = y < by + bry * 0.15 && x > bx - brx * 0.85 && x < bx + brx * 0.95;
          paint(x, y, inSaddle ? dark : light);
        }
      }
      break;
    }
    case 'spot': {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          paint(x, y, light);
        }
      }
      const n = 12 + Math.floor(rnd() * 10);
      for (let i = 0; i < n; i++) {
        const sx = bx + (rnd() * 2 - 1) * brx;
        const sy = by + (rnd() * 2 - 1) * bry;
        ellipse2(px, sx, sy, 1.4 + rnd() * 1.3, 1.2 + rnd(), dark);
      }
      break;
    }
    case 'patch': {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          paint(x, y, light);
        }
      }
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        ellipse2(px, bx + (rnd() * 2 - 1) * brx * 0.85, by + (rnd() * 2 - 1) * bry * 0.85,
          3 + rnd() * 4, 2.6 + rnd() * 3.4, dark);
      }
      break;
    }
    case 'solid': {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (get(px, x, y) === 0) continue;
          paint(x, y, light);
        }
      }
      break;
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
  void rnd;
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

/**
 * Eyes and nose, drawn last and never overpainted. A sprite with a clear eye
 * reads as an animal; the same sprite without one reads as a rock.
 */
function drawFace(
  px: Pixels, params: ForgeParams,
  hx: number, hy: number, hr: number, isBird: boolean,
): void {
  const ex = hx - hr * 0.12;
  const ey = hy - hr * 0.08;

  // Light sclera patch so the dark pupil always has contrast to sit on.
  ellipse2(px, ex, ey, 2.5, 2.2, 1);
  ellipse(px, ex, ey, 1.7, 1.9, 3);
  put(px, Math.round(ex - 0.5), Math.round(ey - 0.6), 1); // catchlight

  // Angry brow on apex forms. Two pixels of slope is the whole difference between
  // "friendly" and "about to ruin your day".
  if (params.majesty > 0.5) {
    for (let i = 0; i < 5; i++) {
      put(px, Math.round(ex - 2 + i), Math.round(ey - 3 - i * 0.45), 3);
    }
  }

  if (!isBird) {
    const nx = hx - hr * 0.55 - params.muzzle * 9 * 0.42 - params.muzzle * 4.5;
    ellipse(px, nx, hy + hr * 0.28, 1.7, 1.3, 3);
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

/** Convenience: everything needed to draw one species, from its Species record. */
export function spriteFor(
  id: string,
  family: Family,
  stage: 'pup' | 'adult' | 'apex',
  seed: number,
  legendary = false,
): Pixels {
  return forgeSprite(paramsFor(id, family, stage, seed, legendary), seed);
}
