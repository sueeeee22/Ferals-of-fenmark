/**
 * What counts as a broken screen.
 *
 * Each rule here exists because the bug it describes shipped at least once
 * while every data-level test was green: sprites that were not drawn, names cut
 * to four letters, health bars emptying before the game had said who hit whom,
 * a walk that snapped a whole tile backwards once per step.
 *
 * Every check takes the PIXELS (`Sight.frame`) and holds them against what the
 * game says it is showing (`Sight.seen`). Neither half is enough alone: pixels
 * cannot know the creature is called Winter, and the game's own state cannot
 * know the box drew "Wint".
 */
import { paginate, pageLength, wrapText } from '../../src/core/text.ts';
import { Tile, tileAt, visibleNpcs, type GameMap } from '../../src/core/world.ts';
import type { Species } from '../../src/core/creature.ts';
import type { SeenFeral } from '../../src/observe.ts';
import type { Seen, Sight } from './stage.ts';
import {
  Frame, INK, allText, asDrawn, contains, findBars, findBlobs, findBoxes, overlaps, readText,
  rectText, shadeCount, squash, unprintable,
  type Bar, type Blob, type Reading, type Rect,
} from './pixels.ts';

// ---------------------------------------------------------------------------
// Rules and the tally
// ---------------------------------------------------------------------------

export const RULES = {
  label: 'each shot is the scene its label claims',
  distinct: 'no two checkpoints are the same picture',
  palette: 'only the four Game Boy colours reach the screen',
  colours: 'no blank or flat screens',
  page: 'the page shows the game whole: square pixels, nothing on top of it',
  readable: 'every mark inside a box is a letter you can read',
  edges: 'no text runs into the edge of its box',
  clean: 'no box cuts through an animal, and nothing pokes out from behind one',
  words: 'the words on screen are the words the game means, all of them',
  sprites: 'creatures are drawn, and are more than a shadow',
  starters: 'the three starters look different from each other',
  actors: 'the player and the townsfolk are visible',
  bars: 'health bars show the health they claim to',
  sync: 'bars, names and levels never change ahead of the text',
  flinch: 'the animal that was hit is the one that blinks',
  snare: 'a thrown snare is seen to fly',
  smooth: 'walking never jumps, stalls or slides backwards',
  taps: 'a tap walks exactly one tile',
  forge: 'every one of the 153 creatures has its own, non-blank sprite',
  fits: 'every name in the game fits its box and can be spelled in the font',
} as const;

export type Rule = keyof typeof RULES;

export class Tally {
  private readonly rows = new Map<Rule, { ok: number; bad: string[] }>();

  private row(rule: Rule): { ok: number; bad: string[] } {
    let r = this.rows.get(rule);
    if (!r) {
      r = { ok: 0, bad: [] };
      this.rows.set(rule, r);
    }
    return r;
  }

  /** Records one examination of a rule. `detail` is only built on failure. */
  check(rule: Rule, ok: boolean, detail: () => string): boolean {
    const r = this.row(rule);
    if (ok) r.ok++;
    else r.bad.push(detail());
    return ok;
  }

  bad(rule: Rule, detail: string): void {
    this.row(rule).bad.push(detail);
  }

  failed(rule: Rule): number {
    return this.rows.get(rule)?.bad.length ?? 0;
  }

  /** Prints every rule, examined or not, and returns how many rules failed. */
  report(): number {
    let failing = 0;
    for (const rule of Object.keys(RULES) as Rule[]) {
      const r = this.rows.get(rule);
      const label = RULES[rule];
      if (!r || (r.ok === 0 && r.bad.length === 0)) {
        // A rule nothing examined is not a pass. It means the tour never got
        // far enough to test it, which is its own failure.
        failing++;
        console.log(`  ${label} ... NOT CHECKED`);
        continue;
      }
      if (r.bad.length === 0) {
        console.log(`  ${label} ... ok  (${r.ok} checks)`);
        continue;
      }
      failing++;
      console.log(`  ${label} ... FAIL  (${r.bad.length} of ${r.ok + r.bad.length})`);
      // The same fault usually shows on dozens of frames in a row. Say it once,
      // with where it was first seen and how many times.
      const groups = new Map<string, { where: string; n: number }>();
      for (const d of r.bad) {
        const cut = d.indexOf(': ');
        const where = cut < 0 ? '' : d.slice(0, cut);
        const what = cut < 0 ? d : d.slice(cut + 2);
        const g = groups.get(what);
        if (g) g.n++;
        else groups.set(what, { where, n: 1 });
      }
      const limit = process.env['VISUAL_VERBOSE'] === '1' ? Infinity : 6;
      let shown = 0;
      for (const [what, g] of groups) {
        if (shown++ >= limit) break;
        console.log(`      ${g.where === '' ? '' : `${g.where}: `}${what}${g.n > 1 ? `  (x${g.n})` : ''}`);
      }
      if (groups.size > limit) console.log(`      ... and ${groups.size - limit} more kinds (VISUAL_VERBOSE=1 lists them all)`);
    }
    return failing;
  }
}

// ---------------------------------------------------------------------------
// Layout: the boxes and bars on a screen, and what each box says
// ---------------------------------------------------------------------------

export interface Layout {
  readonly boxes: readonly Rect[];
  readonly bars: readonly Bar[];
  /** The text inside a box, not counting boxes and bars nested in it. */
  read(box: Rect): Reading;
}

const LAYOUTS = new WeakMap<Frame, Layout>();

export function layoutOf(f: Frame): Layout {
  const known = LAYOUTS.get(f);
  if (known) return known;
  const made = buildLayout(f);
  LAYOUTS.set(f, made);
  return made;
}

function buildLayout(f: Frame): Layout {
  const boxes = findBoxes(f);
  const bars = findBars(f);
  const cache = new Map<Rect, Reading>();
  return {
    boxes,
    bars,
    read(box: Rect): Reading {
      let r = cache.get(box);
      if (!r) {
        r = readText(f, { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 }, nestedIn(box, boxes, bars));
        cache.set(box, r);
      }
      return r;
    },
  };
}

function nestedIn(box: Rect, boxes: readonly Rect[], bars: readonly Bar[]): Rect[] {
  return [
    ...boxes.filter((o) => o !== box && contains(box, o)),
    ...bars.filter((b) => contains(box, b)),
  ];
}

interface Row {
  readonly y: number;
  readonly text: string;
}

/** A box's text as screen rows: everything on one line, left to right. */
function rowsOf(r: Reading): Row[] {
  const byY = new Map<number, string[]>();
  for (const run of r.runs) {
    const list = byY.get(run.y);
    if (list) list.push(run.text);
    else byY.set(run.y, [run.text]);
  }
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([y, parts]) => ({ y, text: parts.join(' ') }));
}

function hasRun(r: Reading, text: string): boolean {
  const want = asDrawn(text);
  return r.runs.some((run) => run.text === want);
}

const quote = (s: string): string => JSON.stringify(s);

/** Which side of a box has ink in the one-pixel ring just inside its border. */
function inkAtEdge(f: Frame, box: Rect, lay: Layout): string | null {
  const skip = nestedIn(box, lay.boxes, lay.bars);
  const skipped = (x: number, y: number): boolean =>
    skip.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const x0 = box.x + 1;
  const x1 = box.x + box.w - 2;
  const y0 = box.y + 1;
  const y1 = box.y + box.h - 2;
  for (let y = y0; y <= y1; y++) {
    if (f.ink(x1, y) && !skipped(x1, y)) return 'right';
    if (f.ink(x0, y) && !skipped(x0, y)) return 'left';
  }
  for (let x = x0; x <= x1; x++) {
    if (f.ink(x, y0) && !skipped(x, y0)) return 'top';
    if (f.ink(x, y1) && !skipped(x, y1)) return 'bottom';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The checks every screen gets
// ---------------------------------------------------------------------------

export function inspectFrame(t: Tally, where: string, s: Sight): Layout {
  const f = s.frame;
  const hist = f.histogram();
  t.check('palette', hist[4] === 0, () =>
    `${where}: ${hist[4]} pixels are not one of the four Game Boy colours (blurred or anti-aliased drawing)`);

  const lay = layoutOf(f);
  for (const box of lay.boxes) {
    const rd = lay.read(box);
    t.check('readable', rd.stray === 0, () =>
      `${where}: ${rd.stray}px of marks that are not letters in the box at ${rectText(box)}, ` +
      `first at (${rd.strayAt?.x},${rd.strayAt?.y}); what can be read is ${quote(allText(rd).replace(/\n/g, ' / '))}`);
    const side = inkAtEdge(f, box, lay);
    t.check('edges', side === null, () =>
      `${where}: text runs into the ${side} edge of the box at ${rectText(box)}; it reads ${quote(allText(rd).replace(/\n/g, ' / '))}`);
  }
  return lay;
}

/** A checkpoint must be a picture, not a flat field. */
export function inspectNotBlank(t: Tally, where: string, f: Frame): void {
  const hist = f.histogram();
  const total = f.w * f.h;
  const used = hist.slice(0, 4).filter((n) => n >= total * 0.002).length;
  t.check('colours', used >= 3, () =>
    `${where}: only ${used} shade(s) on screen (pixels per shade: ${hist.slice(0, 4).join(', ')})`);
}

// ---------------------------------------------------------------------------
// Scene checks
// ---------------------------------------------------------------------------

export interface World {
  map(id: string): GameMap;
  species(id: string): Species;
  readonly starters: readonly string[];
}

/** The game's bottom text box: full width, low on the screen. */
function textBox(lay: Layout): Rect | null {
  return lay.boxes.find((b) => b.y >= 90 && b.w >= 140) ?? null;
}

function isPrompt(text: string): boolean {
  return text === '▼';
}

/** Rows of a message box, minus the "press to continue" arrow. */
function messageRows(lay: Layout, box: Rect): string[] {
  const rd = lay.read(box);
  const kept: Reading = { ...rd, runs: rd.runs.filter((r) => !isPrompt(r.text)) };
  return rowsOf(kept).map((r) => r.text);
}

function inspectDialogue(t: Tally, where: string, s: Sight, lay: Layout): void {
  const seen = s.seen;
  const box = textBox(lay);
  if (!t.check('words', box !== null, () => `${where}: a line is being spoken but there is no text box on screen`)) return;
  if (box === null) return;

  const missing = unprintable(seen.text);
  t.check('words', missing.length === 0, () =>
    `${where}: the font has no glyph for ${missing.map(quote).join(' ')}, so ${quote(seen.text)} is drawn with holes in it`);

  const pages = paginate(seen.text);
  const rows = pages[seen.page] ?? [];
  // What the typewriter has revealed so far, row by row.
  const want: string[] = [];
  let left = seen.chars;
  for (const row of rows) {
    const take = Math.max(0, Math.min(row.length, left));
    if (take > 0) want.push(asDrawn(row.slice(0, take)).trimEnd());
    left -= row.length + 1;
  }
  const got = messageRows(lay, box);
  t.check('words', got.join('\n') === want.filter((r) => r.length > 0).join('\n'), () =>
    `${where}: the box should read ${quote(want.join(' / '))} but the screen reads ${quote(got.join(' / '))}`);
}

/** The rows of the text box as they can be read off the screen right now. */
export function shownMessage(s: Sight): string[] {
  const lay = layoutOf(s.frame);
  const box = textBox(lay);
  return box === null ? [] : messageRows(lay, box);
}

/** True once the current dialogue box has finished typing. */
export function dialogueTyped(seen: Seen): boolean {
  const rows = paginate(seen.text)[seen.page] ?? [];
  return seen.chars >= pageLength(rows);
}

function inspectTitle(t: Tally, where: string, s: Sight): void {
  const text = allText(readText(s.frame));
  for (const want of ['FERALS OF', 'FENMARK']) {
    t.check('words', text.includes(want), () => `${where}: the title should read ${quote(want)}; it is not on screen`);
  }
  const blobs = findBlobs(s.frame, 1, [], { x: 0, y: 0, w: s.frame.w, h: 80 }).filter((b) => b.area >= 150);
  const best = blobs.sort((a, b) => b.area - a.area)[0];
  t.check('sprites', best !== undefined && (best.shades[2] ?? 0) > 20 && (best.shades[INK] ?? 0) > 20, () =>
    `${where}: the title creature is missing or blank (${best ? `${best.area}px, shades ${best.shades.slice(0, 4).join('/')}` : 'nothing drawn'})`);
}

/** The big shapes that are not background and not boxes: creatures on their platforms. */
function creatureBlobs(f: Frame, lay: Layout, within: Rect = f.bounds): Blob[] {
  return findBlobs(f, 0, lay.boxes, within).filter((b) => b.area >= 80);
}

function spriteVerdict(b: Blob | undefined): string | null {
  if (b === undefined) return 'nothing is drawn there';
  if (shadeCount(b.shades) < 3 || (b.shades[INK] ?? 0) < 25) {
    return `only a shadow is there (${b.area}px, pixels per shade ${b.shades.slice(0, 4).join('/')})`;
  }
  if (b.h < 14 || b.w < 14) return `it is ${b.w}x${b.h}px, too small to be a creature`;
  return null;
}

function inspectStarterPick(t: Tally, where: string, s: Sight, lay: Layout, world: World): void {
  const f = s.frame;
  const heading = allText(readText(f, { x: 0, y: 0, w: f.w, h: 20 }));
  t.check('words', heading.includes('PICK ONE.'), () => `${where}: the heading should read "PICK ONE."; the screen reads ${quote(heading)}`);

  const blobs = creatureBlobs(f, lay, { x: 0, y: 14, w: f.w, h: 66 }).sort((a, b) => a.x - b.x);
  t.check('sprites', blobs.length === 3, () => `${where}: three starters should be on show, ${blobs.length} shape(s) found`);
  for (const [i, b] of blobs.entries()) {
    const verdict = spriteVerdict(b);
    t.check('sprites', verdict === null, () => `${where}: starter ${i + 1}: ${verdict}`);
  }

  const id = world.starters[s.seen.cursor];
  const box = lay.boxes[0];
  if (id === undefined || box === undefined) {
    t.bad('words', `${where}: no description box for the selected starter`);
    return;
  }
  const sp = world.species(id);
  const rd = lay.read(box);
  const rows = rowsOf(rd).map((r) => r.text);
  const head = (rows[0] ?? '').split(/\s+/);
  const types = sp.types.join('/');
  t.check('words', head.includes(asDrawn(sp.name)), () => `${where}: the box should name ${quote(sp.name)}; its top row reads ${quote(rows[0] ?? '')}`);
  t.check('words', head.includes(asDrawn(types)), () => `${where}: the box should say ${quote(types)}; its top row reads ${quote(rows[0] ?? '')}`);
  // Everything under the top row is the description, and all of it has to be
  // there: a description that stops mid-sentence is a cut-off, however neat.
  const told = squash(rows.slice(1).join(' '));
  t.check('words', told === squash(asDrawn(sp.dexEntry)), () =>
    `${where}: ${sp.name}'s description is ${quote(sp.dexEntry)} but the screen stops at ${quote(rows.slice(1).join(' '))}`);
}

/** The starter under the cursor, cut out of the screen, for comparing the three. */
export function selectedStarter(s: Sight): Frame | null {
  const lay = layoutOf(s.frame);
  const blobs = creatureBlobs(s.frame, lay, { x: 0, y: 14, w: s.frame.w, h: 66 }).sort((a, b) => a.x - b.x);
  const b = blobs[s.seen.cursor];
  if (b === undefined) return null;
  // Stop above the plinth and the cursor mark under it: those are the same for
  // all three and would make different animals look alike.
  return s.frame.crop({ x: b.x, y: b.y, w: b.w, h: Math.max(1, b.h - 12) });
}

/**
 * How different two cut-out sprites are: the share of pixels, over the area
 * either one covers, where they disagree. Aligned bottom-centre, the way they
 * stand on screen.
 */
export function spriteDifference(a: Frame, b: Frame): number {
  const w = Math.max(a.w, b.w);
  const h = Math.max(a.h, b.h);
  const pick = (f: Frame, x: number, y: number): number => {
    const fx = x - Math.floor((w - f.w) / 2);
    const fy = y - (h - f.h);
    return Math.max(0, f.at(fx, fy));
  };
  let covered = 0;
  let differ = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = pick(a, x, y);
      const pb = pick(b, x, y);
      if (pa === 0 && pb === 0) continue;
      covered++;
      if (pa !== pb) differ++;
    }
  }
  return covered === 0 ? 0 : differ / covered;
}

/**
 * A drawn person changes at least this many of their square's 256 pixels.
 *
 * Measured on the real screen: a properly filled figure changes 81 at the very
 * least (side-on, standing in long grass, which hides the most of anyone) and
 * usually 100-160. The hollow ones - hair and clothes the colour of the grass,
 * so only the outline showed - changed 60 and 65.
 */
const HOLLOW_BELOW = 73;

const TILE_NAME: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(Tile).map(([name, id]) => [id, name]),
);

/**
 * Is everyone who should be standing in the world actually drawn?
 *
 * The test needs no idea of what a person looks like. The tile under an actor
 * is known, and the same tile is nearly always on screen somewhere else with
 * nobody on it; if the two squares are pixel-identical, nobody was drawn. That
 * is exactly how the player vanished whenever she faced right.
 */
function inspectActors(t: Tally, where: string, s: Sight, lay: Layout, world: World): void {
  const seen = s.seen;
  if (seen.walking || seen.starter === '') return;
  const map = world.map(seen.map);
  const f = s.frame;
  const cell = (tx: number, ty: number): Rect => ({ x: seen.camX + tx * 16, y: seen.camY + ty * 16, w: 16, h: 16 });
  const clear = (r: Rect): boolean =>
    r.x >= 0 && r.y >= 0 && r.x + 16 <= f.w && r.y + 16 <= f.h && !lay.boxes.some((b) => overlaps(b, r));

  const actors = [
    { who: 'the player', x: seen.x, y: seen.y },
    ...visibleNpcs(map, new Set(seen.flags)).map((n) => ({ who: n.name === '' ? n.id : n.name, x: n.x, y: n.y })),
  ];
  const taken = new Set(actors.map((a) => `${a.x},${a.y}`));

  // In the open world nothing may sit on top of the player. The place-name
  // banner used to: walk into a town from the north and it covered her whole.
  if (seen.scene === 'overworld') {
    const me = cell(seen.x, seen.y);
    const over = lay.boxes.find((b) => overlaps(b, me));
    t.check('actors', over === undefined, () =>
      `${where}: the player is hidden behind the box at ${over === undefined ? '' : rectText(over)}`);
  }

  for (const a of actors) {
    const here = cell(a.x, a.y);
    if (!clear(here)) continue;
    const id = tileAt(map, a.x, a.y);
    let bare: Rect | null = null;
    for (let ty = 0; ty < map.height && bare === null; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (tileAt(map, tx, ty) !== id || taken.has(`${tx},${ty}`)) continue;
        const r = cell(tx, ty);
        if (clear(r)) {
          bare = r;
          break;
        }
      }
    }
    if (bare === null) continue;
    let differ = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) if (f.at(here.x + x, here.y + y) !== f.at(bare.x + x, bare.y + y)) differ++;
    }
    const ground = TILE_NAME[id] ?? 'ground';
    if (!t.check('actors', differ > 0, () =>
      `${where}: ${a.who} is not drawn - the square at tile (${a.x},${a.y}) is bare ${ground}` +
      (a.who === 'the player' ? ` (facing ${seen.facing})` : ''))) continue;
    // Drawn, but is there a body? A person whose hair and clothes are the
    // colour of the ground is an outline with nothing in it.
    t.check('actors', differ >= HOLLOW_BELOW, () =>
      `${where}: ${a.who} is only an outline - ${differ} of 256 pixels differ from the ${ground} they stand on`);
  }
}

function inspectBanner(t: Tally, where: string, s: Sight, lay: Layout, world: World): void {
  const map = world.map(s.seen.map);
  const banner = lay.boxes.find((b) => b.h <= 24);
  if (map.indoor) {
    t.check('words', banner === undefined, () => `${where}: a place-name banner is up indoors, where there should be none`);
    return;
  }
  if (banner === undefined) return;
  const want = map.name.toUpperCase();
  const got = allText(lay.read(banner));
  t.check('words', got === asDrawn(want), () => `${where}: this place is called ${quote(map.name)} but the banner reads ${quote(got)}`);
}

const MENU_ROOT = ['PARTY', 'BAG', 'DEX', 'SAVE', 'BACK'] as const;

function barFor(lay: Layout, box: Rect, y: number): Bar | null {
  return lay.bars.find((b) => contains(box, b) && Math.abs(b.y - y) <= 4) ?? null;
}

function barVerdict(bar: Bar | null, hp: number, max: number): string | null {
  if (bar === null) return 'there is no health bar';
  const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const want = Math.round(bar.track * frac);
  if (Math.abs(bar.fill - want) > 1) {
    return `the bar is ${bar.fill}px of ${bar.track} full, but ${hp}/${max} health is ${want}px`;
  }
  return null;
}

function inspectMenu(t: Tally, where: string, s: Sight, lay: Layout): void {
  const seen = s.seen;
  const box = [...lay.boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!t.check('words', box !== undefined, () => `${where}: the menu is open but no menu box is on screen`) || box === undefined) return;
  const rd = lay.read(box);
  const cursorRun = rd.runs.find((r) => r.text === '▶');

  if (seen.sub === 'root') {
    for (const label of MENU_ROOT) {
      t.check('words', hasRun(rd, label), () => `${where}: the menu should offer ${label}; it reads ${quote(allText(rd))}`);
    }
    const chosen = rd.runs.find((r) => r.text === MENU_ROOT[seen.cursor]);
    t.check('words', cursorRun !== undefined && chosen !== undefined && cursorRun.y === chosen.y, () =>
      `${where}: the cursor should be on ${MENU_ROOT[seen.cursor]}`);
    return;
  }

  if (seen.sub === 'party') {
    t.check('words', hasRun(rd, 'PARTY'), () => `${where}: the party list has no PARTY heading`);
    for (const m of seen.party) {
      const run = rd.runs.find((r) => r.text === asDrawn(m.name));
      if (!t.check('words', run !== undefined, () => `${where}: ${quote(m.name)} is in the party but the list reads ${quote(allText(rd))}`)) continue;
      if (run === undefined) continue;
      const verdict = barVerdict(barFor(lay, box, run.y), m.hp, m.maxHp);
      t.check('bars', verdict === null, () => `${where}: ${m.name}: ${verdict}`);
    }
    return;
  }

  if (seen.sub === 'bag') {
    t.check('words', hasRun(rd, 'BAG'), () => `${where}: the bag has no BAG heading`);
    for (const stack of seen.bag) {
      const name = stack.item.replace(/_/g, ' ');
      const run = rd.runs.find((r) => r.text === asDrawn(name));
      if (!t.check('words', run !== undefined, () => `${where}: the bag holds ${quote(name)} but the list reads ${quote(allText(rd))}`)) continue;
      if (run === undefined) continue;
      const count = `x${stack.count}`;
      t.check('words', rd.runs.some((r) => r.y === run.y && r.text === count), () =>
        `${where}: ${name} should show ${count}; that row reads ${quote(rd.runs.filter((r) => r.y === run.y).map((r) => r.text).join(' '))}`);
    }
  }
}

// --- Battle ------------------------------------------------------------------

export interface BattleParts {
  /** The party / bag list, when it covers the field. */
  readonly overlay: Rect | null;
  readonly enemyBox: Rect | null;
  readonly playerBox: Rect | null;
  /** Boxes along the bottom: message, command menu, move list. */
  readonly bottom: readonly Rect[];
}

export function battleParts(lay: Layout): BattleParts {
  const overlay = lay.boxes.find((b) => b.w >= 140 && b.h >= 100) ?? null;
  const info = lay.boxes
    .filter((b) => b.h < 60 && b.y < 80 && lay.bars.some((bar) => contains(b, bar)))
    .sort((a, b) => a.y - b.y);
  const bottom = lay.boxes.filter((b) => b.y >= 80).sort((a, b) => a.x - b.x);
  return { overlay, enemyBox: info[0] ?? null, playerBox: info[1] ?? null, bottom };
}

/** True while the battle is showing a message rather than a menu. */
export function battleNarrating(seen: Seen): boolean {
  const b = seen.battle;
  return b !== null && (b.queued > 0 || b.awaiting || b.snare || b.outcome !== 'ongoing');
}

function inspectSide(
  t: Tally, where: string, lay: Layout, box: Rect | null,
  who: string, f: SeenFeral, shownHp: number, numbers: boolean,
): void {
  if (!t.check('words', box !== null, () => `${where}: ${who} has no status box on screen`) || box === null) return;
  const rd = lay.read(box);
  const said = quote(allText(rd).replace(/\n/g, ' / '));
  t.check('words', hasRun(rd, f.name), () => `${where}: ${who} is called ${quote(f.name)} but its box reads ${said}`);
  t.check('words', hasRun(rd, `Lv${f.level}`), () => `${where}: ${who} is level ${f.level} but its box reads ${said}`);
  if (numbers) {
    const want = `${shownHp}/${f.maxHp}`;
    t.check('words', hasRun(rd, want), () => `${where}: ${who} should show ${want} but its box reads ${said}`);
  }
  const verdict = barVerdict(lay.bars.find((b) => contains(box, b)) ?? null, shownHp, f.maxHp);
  t.check('bars', verdict === null, () => `${where}: ${who}: ${verdict}`);
}

const COMMANDS = ['FIGHT', 'BAG', 'PARTY', 'RUN'] as const;

/** Where each side's creature stands, found from the picture. */
export function battleSprites(f: Frame, lay: Layout): { enemy: Blob | undefined; player: Blob | undefined } {
  const blobs = creatureBlobs(f, lay);
  const mid = (b: Blob): number => b.x + b.w / 2;
  return {
    enemy: blobs.filter((b) => mid(b) >= 80 && b.y < 60).sort((a, b) => b.area - a.area)[0],
    player: blobs.filter((b) => mid(b) < 80).sort((a, b) => b.area - a.area)[0],
  };
}

function inspectBattle(t: Tally, where: string, s: Sight, lay: Layout): void {
  const b = s.seen.battle;
  if (b === null || b.intro > 0) return;
  const parts = battleParts(lay);
  const narrating = battleNarrating(s.seen);
  const listUp = !narrating && (b.sub === 'party' || b.sub === 'bag' || b.sub === 'forceSwitch');

  // The field holds two animals and nothing else. Anything more is debris: a
  // sliver of a status box or half a letter showing round the side of a list
  // that was drawn over it but is not quite as big.
  // (Not mid-blink: a struck animal that is briefly not drawn leaves the top
  // edge of its platform showing above the menu, which is as it should be.)
  if (!b.snare && b.flash === 0) {
    const shapes = findBlobs(s.frame, 0, lay.boxes).filter((x) => x.area >= 3);
    const sprites = battleSprites(s.frame, lay);
    const same = (a: Rect, b: Rect | undefined): boolean =>
      b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    const debris = shapes.filter((x) => listUp || (!same(x, sprites.enemy) && !same(x, sprites.player)));
    const first = debris[0];
    t.check('clean', first === undefined, () =>
      `${where}: ${debris.length} stray shape(s) on the field${listUp ? ' round the edge of the list' : ''}, ` +
      `the first at ${first === undefined ? '' : rectText(first)}`);

    // And no box may cut through an animal. Where one does, the animal's dark
    // pixels run right up to the box's edge, because the rest of it is under
    // there. (Its platform is light, and tucking that under a menu is fine.)
    for (const [who, blob] of [['the enemy', sprites.enemy], ['your animal', sprites.player]] as const) {
      if (blob === undefined) continue;
      for (const box of lay.boxes) {
        let touching = 0;
        const probe = (x: number, y: number): void => {
          if (x < blob.x || y < blob.y || x >= blob.x + blob.w || y >= blob.y + blob.h) return;
          if (s.frame.at(x, y) >= 2) touching++;
        };
        for (let x = box.x - 1; x <= box.x + box.w; x++) {
          probe(x, box.y - 1);
          probe(x, box.y + box.h);
        }
        for (let y = box.y; y < box.y + box.h; y++) {
          probe(box.x - 1, y);
          probe(box.x + box.w, y);
        }
        t.check('clean', touching < 3, () =>
          `${where}: the box at ${rectText(box)} cuts through ${who} - ${touching} of its pixels run straight into the box's edge`);
      }
    }
  }

  if (!listUp) {
    inspectSide(t, where, lay, parts.enemyBox, 'the enemy', b.enemy, b.shownEnemyHp, false);
    inspectSide(t, where, lay, parts.playerBox, 'your creature', b.player, b.shownPlayerHp, true);

    // A struck animal blinks, and a snared one is somewhere else: both are
    // checked on their own terms, from the frames around them.
    const sprites = battleSprites(s.frame, lay);
    if (b.enemyGone) {
      t.check('sprites', spriteVerdict(sprites.enemy) !== null, () =>
        `${where}: the enemy ${b.enemy.name} has gone down but is still standing on the field`);
    } else if (!b.snare && !(b.flash > 0 && b.flashSide === 'enemy')) {
      const verdict = spriteVerdict(sprites.enemy);
      t.check('sprites', verdict === null, () => `${where}: the enemy ${b.enemy.name}: ${verdict}`);
    }
    if (b.playerGone) {
      t.check('sprites', spriteVerdict(sprites.player) !== null, () =>
        `${where}: your ${b.player.name} has gone down but is still standing on the field`);
    } else if (!(b.flash > 0 && b.flashSide === 'player')) {
      const verdict = spriteVerdict(sprites.player);
      t.check('sprites', verdict === null, () => `${where}: your ${b.player.name}: ${verdict}`);
    }
  }

  if (narrating) {
    const box = textBox(lay);
    if (!t.check('words', box !== null, () => `${where}: the battle is narrating ${quote(s.seen.text)} but there is no text box`) || box === null) return;
    const got = messageRows(lay, box);
    const want = wrapText(s.seen.text, 18).map((r) => asDrawn(r));
    t.check('words', want.length <= 2 && got.join('\n') === want.join('\n'), () =>
      `${where}: the battle means ${quote(s.seen.text)} but the screen reads ${quote(got.join(' / '))}`);
    const missing = unprintable(s.seen.text);
    t.check('words', missing.length === 0, () => `${where}: the font has no glyph for ${missing.map(quote).join(' ')} in ${quote(s.seen.text)}`);
    return;
  }

  if (b.sub === 'main') {
    const menu = parts.bottom.find((r) => r.x >= 60);
    const name = parts.bottom.find((r) => r.x < 60);
    if (!t.check('words', menu !== undefined, () => `${where}: it is your turn but there is no command menu`) || menu === undefined) return;
    const rd = lay.read(menu);
    for (const c of COMMANDS) {
      t.check('words', hasRun(rd, c), () => `${where}: the command menu should offer ${c}; it reads ${quote(allText(rd).replace(/\n/g, ' / '))}`);
    }
    const cursor = rd.runs.find((r) => r.text === '▶');
    const chosen = rd.runs.find((r) => r.text === COMMANDS[b.cursor]);
    t.check('words', cursor !== undefined && chosen !== undefined && cursor.y === chosen.y, () =>
      `${where}: the cursor should be on ${COMMANDS[b.cursor]}`);
    if (name !== undefined) {
      const got = squash(allText(lay.read(name)));
      t.check('words', got === squash(asDrawn(b.player.name)), () =>
        `${where}: the box beside the menu should name ${quote(b.player.name)}; it reads ${quote(allText(lay.read(name)).replace(/\n/g, ' / '))}`);
    }
    return;
  }

  if (b.sub === 'moves') {
    const box = parts.bottom.find((r) => r.w >= 140);
    if (!t.check('words', box !== undefined, () => `${where}: the move list is open but no list is on screen`) || box === undefined) return;
    const rows = rowsOf(lay.read(box)).map((r) => r.text.replace('▶', '').trim());
    for (const m of b.moves) {
      t.check('words', rows.includes(asDrawn(m.name)), () =>
        `${where}: the move ${quote(m.name)} is not written out in full; the list reads ${quote(rows.join(' / '))}`);
    }
    // The highlighted move's type and remaining power, on the row under the names.
    const chosen = b.moves[b.moveCursor];
    if (chosen !== undefined) {
      const rd = lay.read(box);
      const pp = `PP ${chosen.pp}/${chosen.maxPp}`;
      t.check('words', hasRun(rd, pp), () =>
        `${where}: ${quote(chosen.name)} has ${pp} but the list reads ${quote(rows.join(' / '))}`);
      t.check('words', hasRun(rd, chosen.type.toUpperCase()), () =>
        `${where}: ${quote(chosen.name)} is a ${chosen.type} move but the list reads ${quote(rows.join(' / '))}`);
    }
    return;
  }

  if (listUp && parts.overlay !== null) {
    const rd = lay.read(parts.overlay);
    if (b.sub === 'bag') {
      for (const stack of s.seen.bag) {
        const name = stack.item.replace(/_/g, ' ');
        t.check('words', hasRun(rd, name), () => `${where}: the bag holds ${quote(name)} but the list reads ${quote(allText(rd))}`);
      }
    } else {
      for (const m of s.seen.party) {
        t.check('words', hasRun(rd, m.name), () => `${where}: ${quote(m.name)} is in the party but the list reads ${quote(allText(rd))}`);
      }
    }
  }
}

/** Everything that can be checked about one screen, whatever it is showing. */
export function inspect(t: Tally, where: string, s: Sight, world: World): Layout {
  const lay = inspectFrame(t, where, s);
  switch (s.seen.scene) {
    case 'title':
      inspectTitle(t, where, s);
      break;
    case 'dialogue':
      inspectDialogue(t, where, s, lay);
      inspectActors(t, where, s, lay, world);
      break;
    case 'starterPick':
      inspectStarterPick(t, where, s, lay, world);
      break;
    case 'overworld':
      inspectBanner(t, where, s, lay, world);
      inspectActors(t, where, s, lay, world);
      break;
    case 'menu':
      inspectMenu(t, where, s, lay);
      if (s.seen.sub === 'root') inspectActors(t, where, s, lay, world);
      break;
    case 'battle':
      inspectBattle(t, where, s, lay);
      break;
    default:
      break;
  }
  return lay;
}

// ---------------------------------------------------------------------------
// The page: does the browser show the canvas whole?
// ---------------------------------------------------------------------------

/**
 * `shot` is a composited screenshot of the whole page; `canvas` is the game's
 * canvas read back at the same instant. The game's screen must appear in the
 * shot as a clean whole-number enlargement with nothing drawn over it.
 */
export function inspectPage(t: Tally, where: string, shot: Frame, canvas: Frame): void {
  // The screen is the only thing on the page in Game Boy colours.
  let x0 = shot.w;
  let y0 = shot.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.h; y++) {
    for (let x = 0; x < canvas.w; x++) {
      if (canvas.at(x, y) > 3) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!t.check('page', x1 >= 0, () => `${where}: the game's screen is not on the page at all`)) return;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const k = w / 160;
  if (!t.check('page', Number.isInteger(k) && k >= 1 && h === 144 * k, () =>
    `${where}: the screen is drawn ${w}x${h}, which is not a whole multiple of 160x144 - pixels will be uneven`)) return;

  let uneven = 0;
  let covered = 0;
  for (let ly = 0; ly < 144; ly++) {
    for (let lx = 0; lx < 160; lx++) {
      const want = canvas.at(x0 + lx * k, y0 + ly * k);
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const px = x0 + lx * k + dx;
          const py = y0 + ly * k + dy;
          if (canvas.at(px, py) !== want) uneven++;
          if (shot.at(px, py) !== canvas.at(px, py)) covered++;
        }
      }
    }
  }
  t.check('page', uneven === 0, () => `${where}: ${uneven} screen pixels are not clean ${k}x${k} squares (blurred scaling)`);
  t.check('page', covered === 0, () =>
    `${where}: ${covered} pixels of the game's screen are hidden or altered by something on the page`);
}

// ---------------------------------------------------------------------------
// Motion: a battle, frame by frame
// ---------------------------------------------------------------------------

interface StatusFacts {
  readonly enemy: string;
  readonly player: string;
  /** A fingerprint of each animal as drawn, or null while it is not on show. */
  readonly enemySprite: number | null;
  readonly playerSprite: number | null;
}

/**
 * What the two status boxes are saying on this frame - names, levels, numbers
 * and how full each bar is - or null while they are covered or not yet drawn.
 */
function statusFacts(s: Sight): StatusFacts | null {
  const b = s.seen.battle;
  if (b === null || b.intro > 0) return null;
  if (!battleNarrating(s.seen) && (b.sub === 'party' || b.sub === 'bag' || b.sub === 'forceSwitch')) return null;
  const lay = layoutOf(s.frame);
  const parts = battleParts(lay);
  if (parts.enemyBox === null || parts.playerBox === null) return null;
  const say = (box: Rect): string => {
    const bar = lay.bars.find((x) => contains(box, x));
    return `${allText(lay.read(box)).replace(/\n/g, ' ')} [bar ${bar ? `${bar.fill}/${bar.track}` : 'none'}]`;
  };
  const sprites = battleSprites(s.frame, lay);
  // The fingerprint is the top twenty rows of the animal, across its half of
  // the field. Not the whole shape: menus come and go over its feet and its
  // platform, and that is not the animal changing.
  const print = (blob: Blob | undefined, x: number, w: number): number | null =>
    blob === undefined || spriteVerdict(blob) !== null ? null : s.frame.hash({ x, y: blob.y, w, h: 20 });
  return {
    enemy: say(parts.enemyBox),
    player: say(parts.playerBox),
    // A snare in flight crosses both halves of the field.
    enemySprite: b.snare ? null : print(sprites.enemy, 106, 54),
    playerSprite: b.snare ? null : print(sprites.player, 0, 54),
  };
}

/**
 * The rules of a fight on screen, checked across every painted frame of it.
 *
 * The one that matters most: nothing in either status box may change except on
 * a frame where a new message appears to explain it. The engine resolves a
 * whole turn the instant a move is chosen, so a renderer that draws the truth
 * shows both bars emptying - or a level going up, or a different animal - while
 * the box still says something from before. Every "the text and the attacks are
 * out of order" report was this.
 */
export function inspectBattleTape(t: Tally, where: string, tape: readonly Sight[], world: World): void {
  let prevFacts: StatusFacts | null = null;
  let prev: Sight | null = null;
  /** The last picture of each animal that was actually on show, across blinks. */
  const lastSprite: { enemy: number | null; player: number | null } = { enemy: null, player: null };
  /** A line that could explain a new animal has gone up since that side's was last on show. */
  const told = { enemy: false, player: false };
  let blinkOwed: { side: string; from: number; seenGone: boolean } | null = null;
  let snareFrames = 0;
  let snareMoving = 0;

  for (const [i, s] of tape.entries()) {
    const at = `${where} frame ${i}`;
    const b = s.seen.battle;
    if (b === null) {
      prev = s;
      prevFacts = null;
      continue;
    }
    inspect(t, at, s, world);

    const facts = statusFacts(s);
    const pb = prev?.seen.battle ?? null;
    if (facts !== null && prevFacts !== null && prev !== null && pb !== null) {
      // A change is explained if a message arrived on this very frame, or if
      // the turn just finished being told and the boxes are catching up.
      const newMessage = (b.awaiting && !pb.awaiting) || s.seen.text !== prev.seen.text;
      const turnOver = battleNarrating(prev.seen) && !battleNarrating(s.seen);
      const explained = newMessage || turnOver;
      for (const side of ['enemy', 'player'] as const) {
        const before = prevFacts[side];
        const after = facts[side];
        if (before === after) {
          t.check('sync', true, () => '');
          continue;
        }
        // "X used Y." announces a move; it does not describe one landing. If a
        // bar, a level or a name moves on that line, the screen has shown the
        // result before the game has said what happened. This is also what
        // stops the rule above being satisfied by accident: a turn's first
        // message goes up on the same frame the move is chosen.
        const announcing = s.seen.text.includes(' used ');
        t.check('sync', explained && !announcing, () =>
          `${at}: ${side === 'enemy' ? "the enemy's" : 'your'} status box changed from ${quote(before)} to ${quote(after)} ` +
          (explained
            ? `on the line ${quote(s.seen.text)}, which only announces a move - the result is on screen before it has been described`
            : `while the text still read ${quote(s.seen.text)} - the screen is ahead of the story`));
      }
    }

    // Some changes have to be SAID, not merely timed well. A level that goes up
    // on a line about something else, or a new name in a box with no line
    // sending it in, is an event the game resolved and never told anyone.
    if (pb !== null && prev !== null && battleNarrating(s.seen)) {
      if (b.player.name === pb.player.name && b.player.level > pb.player.level) {
        t.check('sync', s.seen.text.includes(`level ${b.player.level}`), () =>
          `${at}: ${b.player.name} went from level ${pb.player.level} to ${b.player.level} on the line ${quote(s.seen.text)}, which does not say so`);
      }
      for (const side of ['enemy', 'player'] as const) {
        if (b[side].name !== pb[side].name) {
          t.check('sync', s.seen.text.includes(b[side].name), () =>
            `${at}: ${b[side].name} replaced ${pb[side].name} on the line ${quote(s.seen.text)}, which does not mention it`);
        }
      }
    }

    // The animals themselves. A different creature may only appear on the line
    // that sends it in - never on a move announcement, and never in silence.
    if (prev !== null && pb !== null) {
      const newMessage = (b.awaiting && !pb.awaiting) || s.seen.text !== prev.seen.text;
      if (newMessage && !s.seen.text.includes(' used ')) {
        told.enemy = true;
        told.player = true;
      }
      for (const side of ['enemy', 'player'] as const) {
        const now = facts === null ? null : side === 'enemy' ? facts.enemySprite : facts.playerSprite;
        if (now === null) continue;
        const before = lastSprite[side];
        const explained = told[side];
        lastSprite[side] = now;
        told[side] = false;
        if (before === null || before === now) continue;
        t.check('sync', explained, () =>
          `${at}: ${side === 'enemy' ? 'the enemy' : 'your'} animal changed into a different one ` +
          `while the text read ${quote(s.seen.text)}`);
      }
    }

    // Nothing old comes back. Once the command menu has been up, the next text
    // on screen has to be something new; a box that briefly shows the previous
    // turn's last line again is the game stuttering.
    if (pb !== null && prev !== null && !battleNarrating(prev.seen) && battleNarrating(s.seen) && !b.snare && pb.intro === 0) {
      const reading = shownMessage(s).join(' ');
      if (reading !== '') {
        t.check('sync', b.awaiting, () =>
          `${at}: the box is showing ${quote(reading)} with nothing waiting to be read - old text left on screen after a choice was made`);
      }
    }

    // The flinch: when a hit lands, the struck animal must actually vanish for
    // a frame or two, and it must be the one the game says was struck.
    if (pb !== null && b.flash > 0 && pb.flash === 0) {
      blinkOwed = { side: b.flashSide, from: i, seenGone: false };
    }
    if (blinkOwed !== null && !b.snare) {
      const sprites = battleSprites(s.frame, layoutOf(s.frame));
      const victim = blinkOwed.side === 'enemy' ? sprites.enemy : sprites.player;
      if (spriteVerdict(victim) !== null) blinkOwed.seenGone = true;
      if (b.flash === 0 || i === tape.length - 1) {
        const owed = blinkOwed;
        t.check('flinch', owed.seenGone, () =>
          `${where} frame ${owed.from}: a hit landed on ${owed.side === 'enemy' ? 'the enemy' : 'your creature'} but it never blinked`);
        blinkOwed = null;
      }
    }

    // The snare: while one is in the air the picture must keep moving.
    if (b.snare && pb !== null && pb.snare && prev !== null) {
      snareFrames++;
      if (s.frame.diff(prev.frame, { x: 0, y: 0, w: s.frame.w, h: 96 }) > 0) snareMoving++;
    }

    prev = s;
    prevFacts = facts;
  }

  if (snareFrames > 0) {
    t.check('snare', snareMoving >= snareFrames * 0.6, () =>
      `${where}: a snare was in the air for ${snareFrames} frames but the picture only changed on ${snareMoving} of them`);
  }
}

// ---------------------------------------------------------------------------
// Motion: walking, frame by frame
// ---------------------------------------------------------------------------

/**
 * `tape` is every painted frame of one straight walk in direction `dir`,
 * starting and ending at rest.
 *
 * The position measured is where the player was drawn relative to the MAP, so
 * it works the same whether the room is small and she crosses it, or the world
 * is large and it scrolls under her.
 */
export function inspectWalkTape(
  t: Tally, where: string, tape: readonly Sight[], dir: 'up' | 'down' | 'left' | 'right', tiles: number,
): void {
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const pos = (s: Sight): number => (horizontal ? s.seen.px - s.seen.camX : s.seen.py - s.seen.camY);
  const first = tape[0];
  const last = tape[tape.length - 1];
  if (first === undefined || last === undefined) return;

  let stalled = 0;
  let worstStall = 0;
  for (let i = 1; i < tape.length; i++) {
    const a = tape[i - 1];
    const b = tape[i];
    if (a === undefined || b === undefined) continue;
    const at = `${where} frame ${i}`;
    const moved = (pos(b) - pos(a)) * sign;

    t.check('smooth', moved >= 0, () =>
      `${at}: the player slid ${-moved}px BACKWARDS while walking ${dir} (drawn at ${pos(a)}, then ${pos(b)})`);
    // One pixel per tick; a painted frame that ran two ticks may move two.
    const limit = Math.max(1, b.seen.ticks) + 1;
    t.check('smooth', moved <= limit, () =>
      `${at}: the player jumped ${moved}px in one frame while walking ${dir} (that frame ran ${b.seen.ticks} tick(s))`);

    if (b.seen.walking && a.seen.walking) {
      stalled = moved === 0 ? stalled + 1 : 0;
      worstStall = Math.max(worstStall, stalled);
    } else {
      stalled = 0;
    }

    // The picture has to agree with the numbers: if the game says the map was
    // drawn somewhere new, the pixels must actually have shifted by that much.
    const dx = b.seen.camX - a.seen.camX;
    const dy = b.seen.camY - a.seen.camY;
    if ((dx !== 0 || dy !== 0) && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
      let same = 0;
      let total = 0;
      for (let y = 32; y < 112; y += 2) {
        for (let x = 16; x < 144; x += 2) {
          // Skip the player's own square in both frames.
          if (Math.abs(x - 80) < 20 && Math.abs(y - 72) < 20) continue;
          total++;
          if (b.frame.at(x, y) === a.frame.at(x - dx, y - dy)) same++;
        }
      }
      t.check('smooth', same >= total * 0.9, () =>
        `${at}: the game says the world scrolled by (${dx},${dy}) but only ${Math.round((same / total) * 100)}% of the picture moved with it`);
    }
  }

  t.check('smooth', worstStall < 2, () =>
    `${where}: the player froze for ${worstStall} painted frames in a row mid-walk`);
  const travelled = (pos(last) - pos(first)) * sign;
  t.check('smooth', travelled === tiles * 16 && pos(last) % 16 === 0, () =>
    `${where}: walking ${tiles} tile(s) ${dir} moved the player ${travelled}px on screen, not ${tiles * 16}`);
}
