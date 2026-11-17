/**
 * GAUNTLET 6: VISUAL - see the screen.
 *
 * Every other gate reads data. This one looks. It plays the PRODUCTION build in
 * a real browser, from the title screen to the second town, and at every step
 * reads the actual pixels: the words in each box (matched letter by letter
 * against the game's own font), how full each health bar is, where the sprites
 * are and whether they are more than a shadow, and - frame by frame - whether
 * anything on screen moved before the game had said why.
 *
 * It exists because data-level tests kept passing while the screen was broken:
 * the player invisible when facing right, names cut to four letters, the bars
 * emptying before a word of the turn had appeared, a walk that snapped a whole
 * tile backwards once per step, and a screenshot labelled "battle-midturn" that
 * was actually the blackout screen.
 *
 * Nothing here sets game state. Every scene is reached by pressing buttons, and
 * the route adapts to what happens (a lost fight means walking back), so a
 * balance change cannot quietly turn the tour into a tour of something else.
 *
 * Run: npm run gauntlet:visual
 *   VISUAL_DIST=<folder>   check an existing build instead of building
 *   VISUAL_NO_WRITE=1      do not rewrite screenshots/
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from './content-loader.ts';
import { RUN_FRAMES, STARTERS } from '../../src/core/game.ts';
import { shopStock } from '../../src/core/items.ts';
import { DIR_VEC, canWalk, propsOf, tileAt, type Dir, type GameMap } from '../../src/core/world.ts';
import { spriteFor } from '../../src/render/forge.ts';
import { GB_VIEW, PHONE_VIEW, ROOT, Stage, build, type Btn, type Seen, type Sight } from '../visual/stage.ts';
import { asDrawn, squash, unprintable } from '../visual/pixels.ts';
import { CHARS_PER_ROW, CREATURE_NAME_COLS, MOVE_NAME_COLS } from '../../src/core/text.ts';
import { HIT_LINES } from '../../src/data/hitlines.ts';
import {
  RULES, Tally, dialogueTyped, inspect, inspectBattleTape, inspectNotBlank, inspectPage,
  inspectWalkTape, selectedStarter, shownMessage, spriteDifference, battleNarrating,
  type World,
} from '../visual/checks.ts';

const OUT = join(ROOT, 'screenshots');
const WRITE = process.env['VISUAL_NO_WRITE'] !== '1';
const PREBUILT = process.env['VISUAL_DIST'];
/** Stop the tour after this checkpoint. For trying one thing quickly; the verdict will say what was skipped. */
const UNTIL = process.env['VISUAL_UNTIL'];

class StopHere extends Error {}

console.log('\n=== GAUNTLET 6: VISUAL ===\n');

const loaded = await loadContent();
if (loaded === null) {
  console.log('  content tables are missing - run `npm run gen:all` first');
  console.log('\nGAUNTLET 6 FAIL\n');
  process.exit(1);
}
const content = loaded.content;
const moveList = loaded.moveList;
const world: World = {
  map: (id) => content.world.map(id),
  species: (id) => content.dex.species(id),
  starters: STARTERS,
  speciesIds: content.speciesIds,
};

const tally = new Tally();
/** Things that stopped the tour itself, as opposed to things wrong on screen. */
const tourProblems: string[] = [];
/** Things the tour could not get round to. Reported, but not a failure. */
const tourGaps: string[] = [];

// ---------------------------------------------------------------------------
// 1. Sprites, straight from the forge. Data-level, and labelled as such: it
//    covers all 153 animals, where the browser tour only meets a handful.
// ---------------------------------------------------------------------------

{
  const fronts = new Map<string, string>();
  for (const sp of loaded.speciesList) {
    const views = (['front', 'back'] as const).map((view) =>
      spriteFor(sp.id, sp.family, sp.stage, sp.spriteSeed, sp.legendary ?? false, view));
    const [front, back] = views;
    if (front === undefined || back === undefined) continue;
    for (const [view, px] of [['front', front], ['back', back]] as const) {
      const counts = [0, 0, 0, 0];
      for (const v of px) counts[v] = (counts[v] ?? 0) + 1;
      const drawn = px.length - (counts[0] ?? 0);
      const shades = counts.slice(1).filter((n) => n > 0).length;
      tally.check('forge', drawn >= 150 && shades >= 2, () =>
        `${sp.name} (${view}) is nearly blank: ${drawn} pixels drawn in ${shades} shade(s)`);
    }
    tally.check('forge', front.join('') !== back.join(''), () =>
      `${sp.name}: the back view is the same picture as the front view`);
    const key = front.join('');
    const twin = fronts.get(key);
    tally.check('forge', twin === undefined, () => `${sp.name} and ${twin} have identical sprites`);
    fronts.set(key, sp.name);
  }
}

// ---------------------------------------------------------------------------
// 1b. Names, across ALL the content. Also data-level, for the same reason: the
//     tour meets a few moves and a dozen animals, and the two creatures whose
//     names were being cut short live at the far end of the game.
// ---------------------------------------------------------------------------

{
  for (const mv of moveList) {
    tally.check('fits', mv.name.length <= MOVE_NAME_COLS, () =>
      `the move "${mv.name}" is ${mv.name.length} letters; the move list fits ${MOVE_NAME_COLS}`);
    tally.check('fits', mv.type.length <= 8, () => `the type "${mv.type}" is too long for the move-info box`);
  }
  for (const sp of loaded.speciesList) {
    tally.check('fits', sp.name.length <= CREATURE_NAME_COLS, () =>
      `"${sp.name}" is ${sp.name.length} letters; a status box fits ${CREATURE_NAME_COLS}`);
  }
  // Every map that can be walked to, found the way a player finds them.
  const reached = new Set(['fenmark_house']);
  const queue = ['fenmark_house'];
  const placeNames: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const map = content.world.map(id);
    placeNames.push(map.name);
    if (!map.indoor) {
      tally.check('fits', map.name.length <= CHARS_PER_ROW, () =>
        `the place "${map.name}" is ${map.name.length} letters; its banner fits ${CHARS_PER_ROW}`);
    }
    for (const w of map.warps) {
      if (reached.has(w.toMap)) continue;
      reached.add(w.toMap);
      queue.push(w.toMap);
    }
  }
  // And every letter of every one of them has to exist in the font, or it is
  // drawn as a gap. (Dialogue gets the same treatment in gauntlet:tone.)
  const written: string[] = [
    ...moveList.map((m) => m.name),
    ...moveList.map((m) => m.type.toUpperCase()),
    ...loaded.speciesList.flatMap((sp) => [sp.name, sp.dexEntry]),
    ...placeNames.map((n) => n.toUpperCase()),
    ...Object.values(loaded.trainers).flatMap((tr) => [tr.name, tr.title]),
    ...Object.values(HIT_LINES).flat(),
  ];
  for (const text of written) {
    const missing = unprintable(text);
    tally.check('fits', missing.length === 0, () =>
      `the font has no glyph for ${missing.map((c) => JSON.stringify(c)).join(' ')}, used in ${JSON.stringify(text)}`);
  }
}

// ---------------------------------------------------------------------------
// 2. The build, and the stage it runs on
// ---------------------------------------------------------------------------

let dist = PREBUILT ?? '';
if (PREBUILT === undefined) {
  const built = build();
  if (built.error !== null) {
    console.log('  npm run build ... FAIL');
    console.log(`      ${built.error.split('\n').join('\n      ')}`);
    console.log('\nGAUNTLET 6 FAIL - there is no build to look at\n');
    process.exit(1);
  }
  dist = built.dist;
  console.log(`  build ... ok  ${built.seconds.toFixed(1)}s`);
} else {
  console.log(`  build ... using ${PREBUILT}`);
}

if (WRITE) {
  mkdirSync(OUT, { recursive: true });
  // Only the numbered captures are ours to replace.
  for (const name of readdirSync(OUT)) {
    if (/^\d\d-.*\.png$/.test(name) || name === 'index.json') rmSync(join(OUT, name));
  }
}

const st = await Stage.open(dist);
const t0 = Date.now();

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

interface ShotRecord {
  readonly n: number;
  readonly name: string;
  readonly scene: string;
  readonly files: readonly string[];
}

const shots: ShotRecord[] = [];
const pictures = new Map<number, string>();

interface Want {
  readonly scene: string;
  readonly sub?: string;
  /** For battle checkpoints: must the game be mid-message, or waiting on the menu? */
  readonly narrating?: boolean;
}

/**
 * A named moment in the tour. Checks that the game really is showing what the
 * name claims, inspects the picture, and saves it twice: the Game Boy screen
 * pixel for pixel, and the whole page at phone size.
 */
async function checkpoint(name: string, want: Want): Promise<Sight> {
  const sight = await st.see();
  const seen = sight.seen;
  const n = shots.length + 1;
  const pad = String(n).padStart(2, '0');

  const showing = `${seen.scene}${seen.sub === '' ? '' : `/${seen.sub}`}`;
  const sceneOk = seen.scene === want.scene && (want.sub === undefined || seen.sub === want.sub);
  const phaseOk = want.narrating === undefined || battleNarrating(seen) === want.narrating;
  tally.check('label', sceneOk && phaseOk, () =>
    `"${name}" should show ${want.scene}${want.sub === undefined ? '' : `/${want.sub}`}` +
    `${want.narrating === undefined ? '' : want.narrating ? ' mid-message' : ' at a menu'}, ` +
    `but the game was showing ${showing}${seen.battle ? (battleNarrating(seen) ? ' mid-message' : ' at a menu') : ''}`);

  inspect(tally, name, sight, world);
  inspectNotBlank(tally, name, sight.frame);

  const hash = sight.frame.hash();
  const twin = pictures.get(hash);
  tally.check('distinct', twin === undefined, () => `"${name}" is pixel-for-pixel the same picture as "${twin}"`);
  pictures.set(hash, name);

  // The page at phone size, through the compositor.
  await st.resize(PHONE_VIEW);
  const shot = await st.screenshot();
  const canvas = await st.see();
  inspectPage(tally, `${name} (phone page)`, shot.frame, canvas.frame);
  await st.resize(GB_VIEW);

  const files = [`${pad}-${name}-gb.png`, `${pad}-${name}-phone.png`];
  if (WRITE) {
    writeFileSync(join(OUT, files[0] ?? ''), sight.frame.toPng(1));
    writeFileSync(join(OUT, files[1] ?? ''), shot.png);
  }
  shots.push({ n, name, scene: showing, files });
  console.log(`  ${pad}  ${name.padEnd(20)} ${showing}`);
  if (name === UNTIL) throw new StopHere();
  return sight;
}

// ---------------------------------------------------------------------------
// Reading dialogue
// ---------------------------------------------------------------------------

/**
 * Read a conversation to its end, the way a player does: wait for each box to
 * finish typing, look at it, press A.
 *
 * Checks every box against what the game means, and - the part a per-box check
 * cannot see - that each LINE arrived whole across however many boxes it took.
 * A line that lost its tail to a box that only shows two rows passes every
 * box-by-box comparison, because each box is exactly what the game decided to
 * show; it only fails when the boxes are added back up.
 */
async function readDialogue(where: string, capture?: { name: string; atBox: number }): Promise<string[]> {
  const lines: string[] = [];
  let line: string | null = null;
  let told = '';
  let boxes = 0;

  const closeLine = (): void => {
    if (line === null) return;
    const meant = line;
    const got = told;
    tally.check('words', squash(got) === squash(asDrawn(meant)), () =>
      `${where}: the line ${JSON.stringify(meant)} reached the screen as ${JSON.stringify(got.trim())}`);
    lines.push(meant);
  };

  for (let guard = 0; guard < 600; guard++) {
    let s = await st.see();
    if (s.seen.scene !== 'dialogue') break;
    if (line !== s.seen.text) {
      closeLine();
      line = s.seen.text;
      told = '';
    }
    // A look while it is still typing, then wait for the box to fill.
    if (!dialogueTyped(s.seen)) {
      await st.frames(3);
      s = await st.see();
      if (s.seen.scene !== 'dialogue') break;
      inspect(tally, `${where} (typing)`, s, world);
      for (let i = 0; i < 40 && !dialogueTyped(s.seen); i++) {
        await st.frames(2);
        s = await st.see();
      }
    }
    boxes++;
    inspect(tally, `${where} box ${boxes}`, s, world);
    told += `${shownMessage(s).join(' ')} `;
    if (capture !== undefined && capture.atBox === boxes) {
      await checkpoint(capture.name, { scene: 'dialogue' });
    }
    await st.press('a');
  }
  closeLine();
  return lines;
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** Shortest walk across one map, as a list of steps. Ledges and other doors are avoided. */
function pathTo(
  map: GameMap, seen: Seen, goalX: number, goalY: number, avoid: ReadonlySet<string> = new Set(),
): Dir[] | null {
  const flags = new Set(seen.flags);
  const key = (x: number, y: number): string => `${x},${y}`;
  const from = new Map<string, { prev: string; dir: Dir }>();
  const queue: Array<readonly [number, number]> = [[seen.x, seen.y]];
  const start = key(seen.x, seen.y);
  const visited = new Set([start]);
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const [x, y] = cur;
    if (x === goalX && y === goalY) {
      const steps: Dir[] = [];
      let k = key(x, y);
      while (k !== start) {
        const step = from.get(k);
        if (step === undefined) return null;
        steps.unshift(step.dir);
        k = step.prev;
      }
      return steps;
    }
    for (const dir of DIRS) {
      if (!canWalk(map, flags, x, y, dir, false)) continue;
      const [dx, dy] = DIR_VEC[dir];
      const nx = x + dx;
      const ny = y + dy;
      const nk = key(nx, ny);
      if (visited.has(nk) || avoid.has(nk)) continue;
      if (propsOf(tileAt(map, nx, ny)).ledge) continue;
      const isGoal = nx === goalX && ny === goalY;
      if (!isGoal && map.warps.some((w) => w.x === nx && w.y === ny)) continue;
      visited.add(nk);
      from.set(nk, { prev: key(x, y), dir });
      queue.push([nx, ny]);
    }
  }
  return null;
}

/** The door on this map that leads, eventually, to `goalMap`. */
function doorToward(fromMap: string, goalMap: string, flags: ReadonlySet<string>): { x: number; y: number } | null {
  const first = new Map<string, { x: number; y: number }>();
  const queue = [fromMap];
  const visited = new Set([fromMap]);
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const w of world.map(id).warps) {
      if (w.requiresFlag !== undefined && !flags.has(w.requiresFlag)) continue;
      if (visited.has(w.toMap)) continue;
      visited.add(w.toMap);
      const door = id === fromMap ? { x: w.x, y: w.y } : first.get(id);
      if (door === undefined) continue;
      first.set(w.toMap, door);
      if (w.toMap === goalMap) return door;
      queue.push(w.toMap);
    }
  }
  return null;
}

/** Walk exactly one tile (or turn and walk), then wait for the step to finish. */
async function stepDir(dir: Dir): Promise<void> {
  await st.down(dir);
  await st.frames(3);
  await st.up(dir);
  for (let i = 0; i < 30; i++) {
    const s = await st.peek();
    if (s.scene !== 'overworld' || !s.walking) break;
    await st.frames(2);
  }
  await st.frames(1);
}

/** Turn to face a direction without leaving the tile. */
async function face(dir: Dir): Promise<void> {
  const s = await st.peek();
  if (s.facing === dir) return;
  // One tick of a fresh press turns; the walk only starts if it is still held
  // on the next tick. A single painted frame is at most one of those.
  await st.down(dir);
  await st.frames(1);
  await st.up(dir);
  await st.frames(2);
  const after = await st.peek();
  if (after.facing !== dir) {
    await st.down(dir);
    await st.frames(1);
    await st.up(dir);
    await st.frames(2);
  }
}

let battlesFought = 0;
const MAX_BATTLES = 30;

/**
 * Get to a tile on a map, dealing with whatever the road does about it:
 * fights are fought, conversations are read, and a blackout just means the
 * walk starts again from the healer's.
 */
async function travel(goalMap: string, gx: number, gy: number, avoid: ReadonlySet<string> = new Set()): Promise<boolean> {
  for (let guard = 0; guard < 900; guard++) {
    const s = await st.peek();
    if (s.scene === 'battle') {
      if (battlesFought >= MAX_BATTLES) return false;
      await fight({});
      continue;
    }
    if (s.scene === 'naming') {
      await settleNaming();
      continue;
    }
    if (s.scene === 'dialogue') {
      await readDialogue(`on the way to ${goalMap}`);
      continue;
    }
    if (s.scene === 'menu') {
      await st.press('b');
      continue;
    }
    if (s.scene !== 'overworld') return false;
    if (s.map === goalMap && s.x === gx && s.y === gy) return true;

    let tx = gx;
    let ty = gy;
    if (s.map !== goalMap) {
      const door = doorToward(s.map, goalMap, new Set(s.flags));
      if (door === null) return false;
      tx = door.x;
      ty = door.y;
    }
    const path = pathTo(world.map(s.map), s, tx, ty, s.map === goalMap ? avoid : new Set());
    const next = path?.[0];
    if (next === undefined) return false;
    await stepDir(next);
  }
  return false;
}

/** Hold a direction for `tiles` tiles, recording every painted frame of it. */
async function walkTape(dir: Dir, tiles: number, hitchAt = -1, run = false): Promise<Sight[]> {
  const tape: Sight[] = [await st.see()];
  const first = tape[0];
  if (first === undefined) return tape;
  const [dx, dy] = DIR_VEC[dir];
  const goalX = first.seen.x + dx * tiles;
  const goalY = first.seen.y + dy * tiles;
  if (run) await st.down('b');
  await st.down(dir);
  let released = false;
  for (let i = 0; i < tiles * 20 + 60; i++) {
    if (i === hitchAt) await st.hitch(90);
    else await st.frames(1);
    const s = await st.see();
    tape.push(s);
    if (s.seen.scene !== 'overworld') break;
    // The tile coordinate jumps at the START of each step, so once it reads the
    // goal the last step is already under way and the button can come up.
    if (!released && s.seen.x === goalX && s.seen.y === goalY) {
      await st.up(dir);
      released = true;
    }
    if (released && !s.seen.walking) {
      for (let k = 0; k < 2; k++) {
        await st.frames(1);
        tape.push(await st.see());
      }
      break;
    }
  }
  if (!released) await st.up(dir);
  if (run) await st.up('b');
  return tape;
}

/**
 * For looking at what the gate saw. `VISUAL_DUMP="battle 8:100-110"` writes
 * those frames of that recording, enlarged, to `VISUAL_DUMP_DIR` (default
 * /tmp/fenmark-frames). A failure message names the recording and the frame.
 */
function dumpFrames(label: string, tape: readonly Sight[]): void {
  const ask = process.env['VISUAL_DUMP'];
  if (ask === undefined) return;
  const m = /^(.*):(\d+)-(\d+)$/.exec(ask);
  if (m === null || m[1] !== label) return;
  const dir = process.env['VISUAL_DUMP_DIR'] ?? '/tmp/fenmark-frames';
  mkdirSync(dir, { recursive: true });
  for (let i = Number(m[2]); i <= Number(m[3]); i++) {
    const s = tape[i];
    if (s === undefined) continue;
    writeFileSync(join(dir, `${label.replace(/\W+/g, '-')}-${String(i).padStart(4, '0')}.png`), s.frame.toPng(3));
    console.log(`      [dump] frame ${i}: ${JSON.stringify(s.seen.text)} ${JSON.stringify(s.seen.battle)}`);
  }
}

// ---------------------------------------------------------------------------
// Fighting
// ---------------------------------------------------------------------------

interface FightPlan {
  /** Names for the checkpoints to take during this fight, if any. */
  readonly shots?: {
    readonly menu?: string; readonly moves?: string; readonly midturn?: string;
    readonly snare?: string; readonly party?: string;
  };
  /** Open with a snare instead of a move. */
  readonly snareFirst?: boolean;
  /** First, offer a poultice to an animal that does not need one, to see the game say no. */
  readonly tryRefusal?: boolean;
  /** Wear it down, then snare it: the tour wants a second animal in the party. */
  readonly capture?: boolean;
  /** Swap to the other animal once, to watch the change happen on screen. */
  readonly switchOnce?: boolean;
}

/**
 * Fight one battle to its end, recording every painted frame, then hold the
 * whole recording against the rules of a fight on screen.
 */
async function fight(plan: FightPlan): Promise<string> {
  battlesFought++;
  const label = `battle ${battlesFought}`;
  const tape: Sight[] = [await st.see()];
  const tick = async (n = 1): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await st.frames(1);
      tape.push(await st.see());
    }
  };
  const press = async (b: Btn): Promise<void> => {
    await st.down(b);
    await tick(2);
    await st.up(b);
    await tick(2);
  };
  const taken = new Set<string>();
  const shotOnce = async (name: string | undefined, want: Want): Promise<void> => {
    if (name === undefined || taken.has(name)) return;
    taken.add(name);
    await checkpoint(name, want);
    // The checkpoint painted frames of its own; pick the recording back up.
    tape.push(await st.see());
  };

  let outcome = 'ongoing';
  let threw = false;
  let throws = 0;
  let refused = false;
  let switched = false;
  let snareFrames = 0;

  /** What to do with this turn, decided fresh each time it is asked. */
  const intent = (s: Sight): 'refusal' | 'snare' | 'poultice' | 'switch' | 'fight' => {
    const b = s.seen.battle;
    if (b === null) return 'fight';
    const has = (item: string): boolean => s.seen.bag.some((x) => x.item === item && x.count > 0);
    const whole = b.player.hp >= b.player.maxHp;
    if (plan.tryRefusal === true && !refused && whole && has('poultice')) return 'refusal';
    if (plan.snareFirst === true && !threw && b.kind === 'wild' && has('snare')) return 'snare';
    if (plan.switchOnce === true && !switched && s.seen.party.filter((m) => m.hp > 0).length > 1) return 'switch';
    if (plan.capture === true && b.kind === 'wild' && has('snare') && throws < 3 && b.enemy.hp <= b.enemy.maxHp * 0.4) return 'snare';
    if (b.player.hp < b.player.maxHp * 0.4 && has('poultice')) return 'poultice';
    return 'fight';
  };

  for (let guard = 0; guard < 9000; guard++) {
    const s = tape[tape.length - 1];
    if (s === undefined) break;
    const b = s.seen.battle;
    if (s.seen.scene !== 'battle' || b === null) break;
    outcome = b.outcome;

    if (b.snare) {
      snareFrames++;
      if (snareFrames === 14) await shotOnce(plan.shots?.snare, { scene: 'battle', narrating: true });
      await tick();
      continue;
    }
    if (b.intro > 0 || (!b.awaiting && (b.queued > 0 || b.outcome !== 'ongoing'))) {
      await tick();
      continue;
    }
    if (b.awaiting) {
      if (s.seen.text.includes(' used ')) await shotOnce(plan.shots?.midturn, { scene: 'battle', narrating: true });
      await press('a');
      continue;
    }

    // Our move.
    const want = intent(s);
    if (b.sub === 'forceSwitch') {
      const alive = s.seen.party.findIndex((m) => m.hp > 0);
      if (alive < 0) {
        await tick();
        continue;
      }
      if (b.partyCursor !== alive) await press('down');
      else await press('a');
      continue;
    }
    if (b.sub === 'main') {
      await shotOnce(plan.shots?.menu, { scene: 'battle', sub: 'main', narrating: false });
      const target = want === 'fight' ? 0 : want === 'switch' ? 2 : 1;
      if (b.cursor !== target) await press(b.cursor > target ? 'up' : 'down');
      else await press('a');
      continue;
    }
    if (b.sub === 'party') {
      if (want !== 'switch') {
        await press('b');
        continue;
      }
      // Anyone standing who is not already out.
      const other = s.seen.party.findIndex((m) => m.hp > 0 && m.name !== b.player.name);
      if (other < 0) {
        switched = true;
        await press('b');
        continue;
      }
      await shotOnce(plan.shots?.party, { scene: 'battle', sub: 'party', narrating: false });
      if (b.partyCursor !== other) await press('down');
      else {
        switched = true;
        await press('a');
      }
      continue;
    }
    if (b.sub === 'bag') {
      if (want === 'fight') {
        await press('b');
        continue;
      }
      const item = want === 'snare' ? 'snare' : 'poultice';
      const at = s.seen.bag.findIndex((x) => x.item === item && x.count > 0);
      if (b.bagCursor !== at) {
        await press('down');
        continue;
      }
      await press('a');
      if (want === 'snare') {
        threw = true;
        throws++;
      }
      if (want === 'refusal') {
        refused = true;
        // The game has an answer for this. It has to be ON SCREEN: it used to
        // be written where nothing displayed it, and the button just did nothing.
        const after = tape[tape.length - 1];
        tally.check('words', after !== undefined && after.seen.battle?.awaiting === true && shownMessage(after).length > 0, () =>
          `${label}: offering a poultice to a healthy animal got no answer on screen ` +
          `(the game meant ${JSON.stringify(after?.seen.text ?? '')})`);
      }
      continue;
    }
    if (b.sub === 'moves') {
      if (want !== 'fight') {
        await press('b');
        continue;
      }
      await shotOnce(plan.shots?.moves, { scene: 'battle', sub: 'moves', narrating: false });
      // Hardest-hitting move that still has power; anything at all if none
      // does. When the plan is to snare the thing, the GENTLEST one that still
      // does damage - knocking it out leaves nothing to catch.
      const gentle = plan.capture === true && b.kind === 'wild';
      let best = 0;
      let bestScore = -Infinity;
      for (const [i, m] of b.moves.entries()) {
        const power = m.pp > 0 ? (moveList.find((x) => x.name === m.name)?.power ?? 0) : -1;
        const score = gentle && power > 0 ? 1000 - power : power;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (b.moveCursor !== best) await press('down');
      else await press('a');
      continue;
    }
    await press('b');
  }

  inspectBattleTape(tally, label, tape, world);
  console.log(`      ${label}: ${outcome}, ${tape.length} frames watched`);
  dumpFrames(label, tape);
  return outcome;
}

// ---------------------------------------------------------------------------
// Naming a catch
// ---------------------------------------------------------------------------

let nameShown = false;

/** Put the letter cursor on a cell, one press at a time, looking at every frame. */
async function nameCursorTo(row: number, col: number): Promise<void> {
  for (let guard = 0; guard < 40; guard++) {
    const s = await st.see();
    const n = s.seen.naming;
    if (n === null || n.asking) return;
    inspect(tally, 'naming, moving the cursor', s, world);
    if (n.row !== row) await st.press('down');
    else if (n.col !== col) await st.press('right');
    else return;
  }
}

/**
 * The question that follows a catch. The first time, say yes and call it Rex -
 * a capital, then two small letters, so the case key is used too. After that,
 * say no: once is enough to have seen it.
 */
async function settleNaming(): Promise<void> {
  const s = await st.peek();
  if (s.scene !== 'naming') return;
  if (nameShown) {
    inspect(tally, 'declining to name a catch', await st.see(), world);
    await st.press('down');
    inspect(tally, 'declining to name a catch, on NO', await st.see(), world);
    await st.press('a');
    return;
  }
  nameShown = true;
  const before = s.party.map((m) => m.name);
  await checkpoint('name-ask', { scene: 'naming' });
  await st.press('a');
  await nameCursorTo(1, 8); // R
  await st.press('a');
  await nameCursorTo(3, 0); // the case key
  await st.press('a');
  await nameCursorTo(0, 4); // e
  await st.press('a');
  await nameCursorTo(2, 5); // x
  await st.press('a');
  const typed = await checkpoint('name-grid', { scene: 'naming' });
  tally.check('words', typed.seen.naming?.typed === 'Rex', () =>
    `pressing R, the case key, e and x typed ${JSON.stringify(typed.seen.naming?.typed)}`);
  // B rubs one out; type it again.
  await st.press('b');
  const rubbed = await st.see();
  inspect(tally, 'naming, after rubbing one out', rubbed, world);
  tally.check('words', rubbed.seen.naming?.typed === 'Re', () => `B should rub out one letter; the name is now ${JSON.stringify(rubbed.seen.naming?.typed)}`);
  await st.press('a');
  await st.press('start');
  const after = await st.peek();
  tally.check('words', after.party.some((m) => m.name === 'Rex') && !before.includes('Rex'), () =>
    `the catch was named Rex, but the party is called ${after.party.map((m) => m.name).join(', ')}`);
}

/** Whatever a fight leaves behind: the naming question, then anything left to say. */
async function afterFight(where: string): Promise<void> {
  await settleNaming();
  if ((await st.peek()).scene === 'dialogue') await readDialogue(where);
}

// ---------------------------------------------------------------------------
// 3. The tour
// ---------------------------------------------------------------------------

async function tour(): Promise<void> {
  // --- Title ---------------------------------------------------------------
  await st.frames(40);
  await checkpoint('title', { scene: 'title' });

  // --- The opening, read in full ---------------------------------------------
  await st.press('start');
  const intro = await readDialogue('intro', { name: 'intro-dialogue', atBox: 1 });
  const authored = content.dialogue('intro');
  tally.check('words', intro.join('\n') === authored.join('\n'), () =>
    `the opening is ${authored.length} lines long but ${intro.length} reached the screen`);

  // --- Choosing a starter ------------------------------------------------------
  const cutouts: Array<{ name: string; frame: NonNullable<ReturnType<typeof selectedStarter>> }> = [];
  for (const [i, id] of STARTERS.entries()) {
    const name = world.species(id).name.toLowerCase();
    const sight = await checkpoint(`starter-${name}`, { scene: 'starterPick' });
    tally.check('label', sight.seen.cursor === i, () => `starter-${name}: the cursor is on starter ${sight.seen.cursor + 1}, not ${i + 1}`);
    const cut = selectedStarter(sight);
    if (cut === null) tally.bad('starters', `starter-${name}: no sprite could be found under the cursor`);
    else cutouts.push({ name, frame: cut });
    if (i < STARTERS.length - 1) await st.press('right');
  }
  for (let i = 0; i < cutouts.length; i++) {
    for (let j = i + 1; j < cutouts.length; j++) {
      const a = cutouts[i];
      const b = cutouts[j];
      if (a === undefined || b === undefined) continue;
      const d = spriteDifference(a.frame, b.frame);
      tally.check('starters', d >= 0.2, () =>
        `${a.name} and ${b.name} are ${Math.round((1 - d) * 100)}% the same picture`);
    }
  }
  await st.press('left', 2);
  await st.press('a');
  await readDialogue('after choosing');

  // --- The house: is she drawn, facing every way, and does she walk cleanly? ---
  await st.frames(4);
  await checkpoint('overworld-house', { scene: 'overworld' });
  for (const [dir, tiles] of [['down', 2], ['left', 3], ['right', 6], ['up', 3]] as const) {
    const tape = await walkTape(dir, tiles);
    inspectWalkTape(tally, `house, walking ${dir}`, tape, dir, tiles);
    const rest = tape[tape.length - 1];
    if (rest !== undefined) inspect(tally, `house, facing ${dir}`, rest, world);
  }
  // Taps: a press of any ordinary length is one tile. This is control, not
  // decoration - it is what makes lining up on a doorway possible.
  await face('left');
  for (const hold of [3, 6, 9, 13]) {
    const before = await st.peek();
    await st.down('left');
    await st.frames(hold);
    await st.up('left');
    await st.frames(24);
    const after = await st.peek();
    tally.check('taps', before.x - after.x === 1 && !after.walking, () =>
      `holding left for ${hold} frames (${hold * 16}ms) walked ${before.x - after.x} tile(s)`);
  }

  // --- Out into town -----------------------------------------------------------
  if (!(await travel('fenmark', 9, 5))) throw new Error('could not leave the house');
  await st.frames(2);
  await checkpoint('overworld-town', { scene: 'overworld' });
  // Out here the world is bigger than the screen, so it scrolls under her.
  for (const [dir, tiles, hitchAt] of [['down', 3, -1], ['right', 4, -1], ['left', 6, 30]] as const) {
    const tape = await walkTape(dir, tiles, hitchAt);
    inspectWalkTape(tally, `town, walking ${dir}`, tape, dir, tiles);
    const rest = tape[tape.length - 1];
    if (rest !== undefined) inspect(tally, `town, facing ${dir}`, rest, world);
  }
  if (await travel('fenmark', 9, 8)) {
    const tape = await walkTape('up', 2);
    inspectWalkTape(tally, 'town, walking up', tape, 'up', 2);
  }

  // --- Running: B held. Twice the pace, whole pixels, and it still stops on a tile ---
  if (await travel('fenmark', 9, 8)) {
    for (const dir of ['down', 'up'] as const) {
      const tape = await walkTape(dir, 5, -1, true);
      inspectWalkTape(tally, `town, running ${dir}`, tape, dir, 5, 2);
      const strides = new Set(tape.filter((s) => s.seen.walking).map((s) => s.seen.stride));
      tally.check('smooth', strides.size === 1 && strides.has(RUN_FRAMES), () =>
        `town, running ${dir}: with B held every step should take ${RUN_FRAMES} ticks; saw ${[...strides].join(', ')}`);
      const moving = tape.filter((s) => s.seen.walking).length;
      tally.check('smooth', moving <= 5 * RUN_FRAMES + 6, () =>
        `town, running ${dir}: five tiles took ${moving} frames, which is no faster than walking`);
    }
  }

  // --- Someone to talk to --------------------------------------------------------
  if (await travel('fenmark', 10, 6)) {
    await face('right');
    await st.press('a');
    await readDialogue('the rival, in town', { name: 'npc-talk', atBox: 1 });
  }

  // --- The pause menu ------------------------------------------------------------
  await st.press('start');
  await checkpoint('menu-root', { scene: 'menu', sub: 'root' });
  await st.press('a');
  await checkpoint('menu-party', { scene: 'menu', sub: 'party' });
  await st.press('b');
  await st.press('down');
  await st.press('a');
  await checkpoint('menu-bag', { scene: 'menu', sub: 'bag' });
  await st.press('b', 2);

  // --- The shop: look at the shelf, buy something, check the change ----------------
  if (!(await travel('fenmark_shop', 4, 4))) throw new Error('could not reach the shop counter');
  await face('up');
  await st.press('a');
  await readDialogue('the shopkeeper');
  {
    const shelf = await checkpoint('shop-shelf', { scene: 'shop' });
    const snaresBefore = shelf.seen.bag.find((b) => b.item === 'snare')?.count ?? 0;
    // Three snares: right twice, then A. Every frame on the way is looked at.
    for (let i = 0; i < 2; i++) {
      await st.press('right');
      inspect(tally, `shop, counting to ${i + 2}`, await st.see(), world);
    }
    await st.press('a');
    const sold = await checkpoint('shop-sold', { scene: 'shop' });
    const snaresAfter = sold.seen.bag.find((b) => b.item === 'snare')?.count ?? 0;
    tally.check('words', snaresAfter === snaresBefore + 3 && sold.seen.money === shelf.seen.money - 600, () =>
      `buying 3 snares at 200 took the bag from ${snaresBefore} to ${snaresAfter} and the purse from ${shelf.seen.money} to ${sold.seen.money}`);
    // Down the shelf to LEAVE, looking at each row with the cursor on it.
    for (let i = 0; i < 6; i++) {
      const now = await st.see();
      if (now.seen.scene !== 'shop') break;
      inspect(tally, `shop, row ${now.seen.cursor + 1}`, now, world);
      if (now.seen.cursor === shopStock(now.seen.badges).length) break;
      await st.press('down');
    }
    await st.press('a');
    await readDialogue('leaving the shop');
  }

  // --- Route 1: the long grass ---------------------------------------------------
  // The first trainer watches the road at row 7. The grass above him is safe.
  const watched = new Set(['8,7', '9,7', '10,7', '9,14', '10,14', '11,14']);
  if (!(await travel('route_1', 9, 3))) throw new Error('could not reach route 1');
  if (!(await travel('route_1', 5, 5, watched))) throw new Error('could not reach the long grass');
  if ((await st.peek()).scene === 'overworld') await checkpoint('route-grass', { scene: 'overworld' });

  const hunt = async (plan: FightPlan): Promise<string | null> => {
    const beat = [[2, 4], [6, 4], [6, 6], [2, 6], [2, 5], [6, 5]] as const;
    for (let lap = 0; lap < 12; lap++) {
      for (const [x, y] of beat) {
        for (let i = 0; i < 12; i++) {
          const s = await st.peek();
          if (s.scene === 'battle') return fight(plan);
          if (s.scene !== 'overworld' || s.map !== 'route_1') return null;
          if (s.x === x && s.y === y) break;
          const step = pathTo(world.map(s.map), s, x, y, watched)?.[0];
          if (step === undefined) break;
          await stepDir(step);
        }
      }
    }
    return null;
  };

  const first = await hunt({ shots: { menu: 'battle-wild', moves: 'battle-moves', midturn: 'battle-midturn' } });
  if (first === null) throw new Error('no wild creature appeared in the long grass');
  {
    const s = await st.peek();
    await checkpoint('battle-aftermath', { scene: s.scene === 'dialogue' ? 'dialogue' : 'overworld' });
    if (s.scene === 'dialogue') await readDialogue('after the first fight');
  }

  // --- A poultice from the bag, for whoever is picked -------------------------------
  // Open the bag, take the poultice, choose the patient, and check the sum.
  // Done the first time the lead comes out of a fight actually hurt, so the
  // sum being checked is a real one and not "nothing to mend".
  let poulticeShown = false;
  const usePoultice = async (): Promise<void> => {
    poulticeShown = true;
    if ((await st.peek()).scene === 'overworld') {
      await st.press('start');
      await st.press('down');
      await st.press('a');
      const bag = await st.see();
      const row = bag.seen.bag.findIndex((b) => b.item === 'poultice');
      if (bag.seen.sub === 'bag' && row >= 0) {
        // A snare cannot be used out here, and the bag says so instead of nothing.
        const snareRow = bag.seen.bag.findIndex((b) => b.item === 'snare');
        for (let i = 0; i < 6 && (await st.peek()).subCursor !== snareRow && snareRow >= 0; i++) await st.press('down');
        if (snareRow >= 0) {
          await st.press('a');
          const refused = await st.see();
          inspect(tally, 'bag, trying to use a snare', refused, world);
          tally.check('words', refused.seen.note !== '', () => 'pressing A on a snare in the bag did nothing and said nothing');
        }
        for (let i = 0; i < 6 && (await st.peek()).subCursor !== row; i++) await st.press('down');
        await st.press('a');
        const who = await st.see();
        inspect(tally, 'bag, choosing who gets the poultice', who, world);
        const patient = who.seen.party[0];
        const had = who.seen.bag[row]?.count ?? 0;
        await st.press('a');
        const done = await checkpoint('menu-poultice', { scene: 'menu', sub: 'party' });
        const now = done.seen.party[0];
        const left = done.seen.bag.find((b) => b.item === 'poultice')?.count ?? 0;
        if (patient !== undefined && now !== undefined) {
          const gain = Math.min(40, patient.maxHp - patient.hp);
          tally.check('words', now.hp === patient.hp + gain && left === had - (gain > 0 ? 1 : 0), () =>
            `a poultice on ${patient.name} at ${patient.hp}/${patient.maxHp} left it at ${now.hp} and the bag at ${left} (was ${had})`);
        }
        await st.press('b');
        inspect(tally, 'bag, after the poultice', await st.see(), world);
      }
      await st.press('b', 3);
    }
  };

  // A second one, opened with a snare, to watch it fly.
  if (!(await travel('route_1', 5, 5, watched))) throw new Error('could not get back to the long grass');
  const second = await hunt({ snareFirst: true, tryRefusal: true, shots: { snare: 'battle-snare' } });
  if (second === null) throw new Error('no second wild creature appeared');
  await afterFight('after the second fight');

  // --- Saving ----------------------------------------------------------------------
  if ((await st.peek()).scene === 'overworld') {
    await st.press('start');
    await st.press('down', 3);
    await st.press('a');
    await readDialogue('saving', { name: 'save-confirm', atBox: 1 });
  }

  // --- Back to the lodge to be patched up -------------------------------------------
  let healShot = false;
  let swapShown = false;
  const heal = async (): Promise<void> => {
    if (!(await travel('fenmark_lodge', 4, 4))) return;
    await face('up');
    await st.press('a');
    await readDialogue('the healer', healShot ? undefined : { name: 'lodge-heal', atBox: 1 });
    healShot = true;
    const after = await st.peek();
    tally.check('words', after.party.every((m) => m.hp === m.maxHp), () => 'the healer said they were good as new and they are not');
  };
  await heal();

  // --- Train up, the way a player would --------------------------------------------
  // Two trainers stand on the road south. Walking into them straight out of the
  // house loses, so do what anyone does: fight in the grass until the lead is a
  // level clear of the strongest animal they own. Every one of these fights is
  // watched frame by frame like the others.
  const roadTrainers = world.map('route_1').npcs.flatMap((n) => (n.team === undefined ? [] : content.trainer(n.team).team));
  const ready = Math.max(0, ...roadTrainers.map((m) => m.level)) + 2;
  for (let i = 0; i < 16; i++) {
    const s = await st.peek();
    const lead = s.party[0];
    if (lead === undefined || battlesFought >= MAX_BATTLES - 6) break;
    // Done when she is strong enough AND the swap has been seen - or cannot be,
    // because there is nothing left to catch a second animal with.
    const canStillCatch = s.party.length < 2 && s.bag.some((x) => x.item === 'snare' && x.count > 0);
    if (lead.level >= ready && (swapShown || !canStillCatch) && (s.party.length < 2 || swapShown)) break;
    if (!poulticeShown && lead.hp < lead.maxHp && s.scene === 'overworld') await usePoultice();
    else if (lead.hp < lead.maxHp * 0.5) await heal();
    if (!(await travel('route_1', 5, 5, watched))) break;
    // Until there is a second animal, try to catch one. Once there is, swap to
    // it once mid-fight, to watch one creature leave the screen and another
    // arrive - with the words to say so.
    const alone = s.party.length < 2;
    const plan: FightPlan = alone
      ? { capture: true }
      : swapShown ? {} : { switchOnce: true, shots: { party: 'battle-party' } };
    if (!alone) swapShown = true;
    if ((await hunt(plan)) === null) break;
    await afterFight('after a fight in the grass');
  }
  if (!poulticeShown) {
    await usePoultice();
    tourGaps.push('the lead was never hurt between fights, so the poultice from the bag was only seen being refused');
  }
  await heal();

  // The party list again, now that (with luck) there is more than one name in it.
  {
    const s = await st.peek();
    if (s.scene === 'overworld' && s.party.length > 1) {
      await st.press('start');
      await st.press('a');
      const two = await checkpoint('menu-party-two', { scene: 'menu', sub: 'party' });
      // Reorder: pick up the first, put it second, look, and put it back -
      // the road south is walked with the strong one in front.
      const order = two.seen.party.map((m) => m.name).join(',');
      for (let pass = 0; pass < 2; pass++) {
        await st.press('a');
        const acts = await st.see();
        inspect(tally, 'party, the row of actions', acts, world);
        tally.check('label', acts.seen.act === 0, () => 'pressing A on an animal in the party list did not offer anything to do');
        await st.press('a');
        inspect(tally, 'party, an animal picked up', await st.see(), world);
        await st.press('down');
        inspect(tally, 'party, choosing where it goes', await st.see(), world);
        await st.press('a');
        if (pass === 0) {
          const moved = await checkpoint('menu-party-moved', { scene: 'menu', sub: 'party' });
          const names = moved.seen.party.map((m) => m.name);
          tally.check('words', names.slice(0, 2).reverse().concat(names.slice(2)).join(',') === order, () =>
            `moving the first animal to second place turned ${order} into ${names.join(',')}`);
        }
        await st.press('up');
      }
      const back = await st.see();
      tally.check('words', back.seen.party.map((m) => m.name).join(',') === order, () =>
        `moving it back should restore ${order}; the party is ${back.seen.party.map((m) => m.name).join(',')}`);
      await st.press('b', 2);

      // --- The Dex: the list, an animal she owns, and one she has only met ----------
      await st.press('start');
      await st.press('down', 2);
      await st.press('a');
      const dex = await checkpoint('dex-list', { scene: 'menu', sub: 'dex' });
      const owns = new Set(dex.seen.party.map((m) => m.species));
      tally.check('words', [...owns].every((id) => dex.seen.caughtIds.includes(id)), () =>
        `the Dex says she owns ${dex.seen.caughtIds.join(', ')} but her party is ${[...owns].join(', ')}`);
      const dexTo = async (index: number): Promise<void> => {
        for (let guard = 0; guard < 60; guard++) {
          const now = await st.see();
          if (now.seen.sub !== 'dex' || now.seen.subCursor === index) return;
          inspect(tally, 'the Dex, scrolling', now, world);
          const gap = index - now.seen.subCursor;
          await st.press(gap >= 8 ? 'right' : gap > 0 ? 'down' : gap <= -8 ? 'left' : 'up');
        }
      };
      const ownedAt = content.speciesIds.findIndex((id) => dex.seen.caughtIds.includes(id));
      await dexTo(ownedAt);
      await st.press('a');
      const page = await checkpoint('dex-entry', { scene: 'menu', sub: 'dex' });
      tally.check('label', page.seen.entry, () => 'pressing A on an owned animal in the Dex did not open its page');
      await st.press('b');
      const metAt = content.speciesIds.findIndex((id) => dex.seen.seenIds.includes(id) && !dex.seen.caughtIds.includes(id));
      if (metAt >= 0) {
        await dexTo(metAt);
        await st.press('a');
        await checkpoint('dex-seen', { scene: 'menu', sub: 'dex' });
        await st.press('b');
      } else {
        tourGaps.push('every animal met so far is also owned, so the Dex page of a met-but-unowned animal was not seen');
      }
      // One she has never met has no page to open.
      const unmetAt = content.speciesIds.findIndex((id) => !dex.seen.seenIds.includes(id));
      if (unmetAt >= 0) {
        await dexTo(unmetAt);
        await st.press('a');
        const still = await st.see();
        inspect(tally, 'the Dex, A on an animal never met', still, world);
        tally.check('label', !still.seen.entry, () => 'the Dex opened a page for an animal that has never been met');
      }
      await st.press('b', 2);

      // --- The kennel box: leave one, look for it, take it back ---------------------
      if (await travel('fenmark_lodge', 6, 5)) {
        await face('right');
        await st.press('a');
        await readDialogue('the kennelhand');
        const open = await checkpoint('box-party', { scene: 'box' });
        const stay = open.seen.party[0]?.name ?? '';
        const goes = open.seen.party[1]?.name ?? '';
        await st.press('down');
        inspect(tally, 'box, cursor on the second animal', await st.see(), world);
        await st.press('a');
        const left = await st.see();
        inspect(tally, 'box, after leaving one', left, world);
        tally.check('words', left.seen.party.length === 1 && left.seen.box.some((m) => m.name === goes), () =>
          `leaving ${goes} should put it in the box; the party is ${left.seen.party.map((m) => m.name).join(',')} and the box ${left.seen.box.map((m) => m.name).join(',')}`);
        // The last one that can stand may not be left behind.
        await st.press('a');
        const refused = await st.see();
        inspect(tally, 'box, trying to leave the last animal', refused, world);
        tally.check('words', refused.seen.party.length === 1 && refused.seen.note !== '', () =>
          `the game let ${stay} be left in the box with nobody else to walk with`);
        await st.press('right');
        const stored = await checkpoint('box-stored', { scene: 'box' });
        tally.check('label', stored.seen.side === 'box', () => 'pressing right in the kennel box did not show the box');
        await st.press('a');
        const taken = await st.see();
        inspect(tally, 'box, after taking it back', taken, world);
        tally.check('words', taken.seen.box.length === 0 && taken.seen.party.map((m) => m.name).join(',') === `${stay},${goes}`, () =>
          `taking ${goes} back should restore the party; it is ${taken.seen.party.map((m) => m.name).join(',')}`);
        await st.press('b');
        await readDialogue('leaving the kennel');
      } else {
        tourGaps.push('the kennelhand could not be reached, so the box was not seen');
      }
    } else {
      tourGaps.push('no second animal was caught, so the party list, switching and the kennel box were only seen with one name in them');
    }
  }

  // --- South, past both trainers, to the next town -----------------------------------
  let trainerShot = false;
  for (let guard = 0; guard < 900; guard++) {
    const s = await st.peek();
    if (s.scene === 'overworld' && s.map === 'harrowfen') break;
    if (s.scene === 'battle') {
      if (battlesFought >= MAX_BATTLES) throw new Error(`still not at the second town after ${MAX_BATTLES} fights`);
      const isTrainer = s.battle?.kind === 'trainer';
      await fight(isTrainer && !trainerShot ? { shots: { menu: 'battle-trainer' } } : {});
      if (isTrainer) trainerShot = true;
      continue;
    }
    if (s.scene === 'naming') {
      await settleNaming();
      continue;
    }
    if (s.scene === 'dialogue') {
      await readDialogue('on the road south');
      continue;
    }
    if (s.scene === 'menu') {
      await st.press('b');
      continue;
    }
    if (s.scene !== 'overworld') throw new Error(`the road south ended on the ${s.scene} screen`);
    // Low on health with a fight ahead: go back and be healed rather than lose.
    const lead = s.party[0];
    if (lead !== undefined && lead.hp < lead.maxHp * 0.5 && s.map === 'route_1' && s.y < 14) {
      await heal();
      continue;
    }
    const door = s.map === 'route_1' ? { x: 9, y: 23 } : doorToward(s.map, 'harrowfen', new Set(s.flags));
    if (door === null) throw new Error(`no way to the second town from ${s.map}`);
    const step = pathTo(world.map(s.map), s, door.x, door.y)?.[0];
    if (step === undefined) throw new Error(`no path across ${s.map}`);
    await stepDir(step);
  }
  await st.frames(2);
  await checkpoint('town-second', { scene: 'overworld' });
}

try {
  await tour();
} catch (err) {
  const where = err instanceof StopHere ? null : await st.peek().catch(() => null);
  if (err instanceof StopHere) tourGaps.push(`stopped after "${UNTIL}" as asked - everything past it went unchecked`);
  else tourProblems.push(
    `${err instanceof Error ? err.message : String(err)}` +
    (where === null ? '' : `  (stopped at ${where.scene} on ${where.map} ${where.x},${where.y})`),
  );
}

// Every one of these has to have been reached. A checkpoint that silently
// stops being taken is a check that silently stops being made.
const REQUIRED = [
  'title', 'intro-dialogue', 'starter-winter', 'starter-baloo', 'starter-plato', 'overworld-house',
  'overworld-town', 'npc-talk', 'menu-root', 'menu-party', 'menu-bag', 'shop-shelf', 'shop-sold',
  'route-grass', 'battle-wild', 'menu-poultice', 'dex-list', 'dex-entry', 'box-party', 'box-stored',
  'name-ask', 'name-grid',
  'battle-moves', 'battle-midturn', 'battle-aftermath', 'battle-snare', 'save-confirm', 'lodge-heal',
  'battle-trainer', 'town-second',
];
if (UNTIL === undefined) {
  for (const name of REQUIRED) {
    tally.check('label', shots.some((x) => x.name === name), () => `the tour never reached "${name}"`);
  }
}

for (const e of st.errors) tourProblems.push(`the page logged an error: ${e}`);
const painted = st.painted;
await st.close();

if (WRITE) {
  writeFileSync(
    join(OUT, 'index.json'),
    `${JSON.stringify({ gb: GB_VIEW, phone: PHONE_VIEW, shots }, null, 2)}\n`,
  );
}

// ---------------------------------------------------------------------------
// 4. The verdict
// ---------------------------------------------------------------------------

console.log(`\n  ${shots.length} checkpoints, ${battlesFought} fights, ${painted} frames painted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (WRITE && existsSync(OUT)) console.log('  pictures saved to screenshots/');
console.log('');

const failing = tally.report();
for (const p of tourProblems) console.log(`  the tour did not finish ... FAIL\n      ${p}`);
for (const g of tourGaps) console.log(`  note: ${g}`);

const total = Object.keys(RULES).length;
if (failing === 0 && tourProblems.length === 0) {
  console.log(`\nGAUNTLET 6 PASS - all ${total} rules hold on the real screen\n`);
  process.exit(0);
}
console.log(`\nGAUNTLET 6 FAIL - ${failing} of ${total} rules broken${tourProblems.length > 0 ? ', and the tour did not finish' : ''}\n`);
process.exit(1);
