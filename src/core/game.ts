/**
 * The top-level game reducer.
 *
 * `step(content, state, buttons)` advances exactly one frame (1/60s) and returns
 * the next state. The renderer draws whatever this produces and never writes
 * back. `gauntlet:playthrough` feeds it button presses, which is why the bot is
 * playing the real game rather than a test-only imitation of it.
 *
 * Everything here is serializable: the save file is this state.
 */

import { Rng, type RngState } from './rng.ts';
import { paginate, pageLength } from './text.ts';
import { HIT_LINES, hitBucket } from '../data/hitlines.ts';
import type { Feral, Species } from './creature.ts';
import { computeStat, expForLevel, maxHp, selectMoveset } from './creature.ts';
import {
  canWalk, DIR_VEC, isLedgeHop, npcAt, rollEncounter, triggeredTrainer, tileAt,
  warpAt, facingToward, propsOf,
  type Dir, type GameMap, type NpcDef, type World,
} from './world.ts';
import {
  activeOf, forceSwitch, hasAlive, resolveTurn, startBattle,
  type BattleAction, type BattleEvent, type BattleState, type Dex,
} from './battle.ts';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface Buttons {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly a: boolean;
  readonly b: boolean;
  readonly start: boolean;
  readonly select: boolean;
}

export const NO_BUTTONS: Buttons = {
  up: false, down: false, left: false, right: false,
  a: false, b: false, start: false, select: false,
};

export type ButtonName = keyof Buttons;

/** Frames a tile step takes. Gen 1 walked at roughly this pace. */
/**
 * Ticks to cross one tile. 16px over 16 ticks = exactly ONE PIXEL per tick.
 *
 * Two reasons for 16 rather than 8:
 *
 *  - Control. A step only auto-repeats while the direction is still held when
 *    the tile completes, so the tile duration IS the tap threshold. At 8 ticks
 *    that threshold was 133ms, right in the middle of the 120-180ms a human tap
 *    actually lasts - so the same press produced one tile or two at random, and
 *    lining up on a doorway became a coin flip. At 16 ticks the threshold is
 *    267ms and a tap reliably means one tile.
 *  - Smoothness. 16 divides 16, so every tick moves exactly one pixel. At 8 the
 *    sprite jumped two pixels a tick, which is twice as coarse and reads as
 *    faint judder even when the pacing is perfect.
 *
 * This is also Gen 1's real walking speed. We had been going twice as fast.
 */
export const WALK_FRAMES = 16;

// ---------------------------------------------------------------------------
// Content injection — core never imports src/data
// ---------------------------------------------------------------------------

export interface TrainerMember {
  readonly species: string;
  readonly level: number;
}

export interface TrainerDef {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly team: readonly TrainerMember[];
  readonly aiLevel: number;
  readonly prize: number;
  /** Badge granted on defeat, if this is a gym leader. */
  readonly badge?: string;
  readonly introKey: string;
  readonly defeatKey: string;
}

export interface Content {
  readonly world: World;
  readonly dex: Dex;
  dialogue(key: string): readonly string[];
  trainer(id: string): TrainerDef;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ItemStack {
  readonly item: string;
  count: number;
}

export interface PlayerState {
  name: string;
  mapId: string;
  x: number;
  y: number;
  facing: Dir;
  party: Feral[];
  box: Feral[];
  bag: ItemStack[];
  money: number;
  badges: string[];
  starter: string;
  rivalStarter: string;
  /** Story flags: trainers defeated, doors opened, cutscenes seen. */
  flags: string[];
  repelSteps: number;
  steps: number;
  playtimeFrames: number;
  /**
   * Where a blackout sends you. Gen 1 returns you to the last healer you used,
   * not to your mother's house; hardcoding the start town meant every loss late
   * in the game teleported you across the entire map.
   */
  respawnMap: string;
  respawnX: number;
  respawnY: number;
}

export interface WalkState {
  /** 0 when standing still, else 1..WALK_FRAMES. */
  progress: number;
  dir: Dir;
  /** Ledge hops cover two tiles. */
  hop: boolean;
  fromX: number;
  fromY: number;
}

export interface DialogueScene {
  readonly kind: 'dialogue';
  lines: string[];
  index: number;
  /** Characters revealed of the current PAGE, for the typewriter. */
  chars: number;
  /**
   * Which box of the current line is showing. A line longer than two rows is
   * shown a box at a time - without this the renderer drew the first two rows
   * and silently dropped the rest.
   */
  page: number;
  /** Queued scene to enter when the dialogue ends. */
  then: PendingAction | null;
}

export type PendingAction =
  | { readonly kind: 'battle'; readonly trainerId: string; readonly npcFlag?: string }
  | { readonly kind: 'heal' }
  | { readonly kind: 'giveItem'; readonly item: string; readonly count: number }
  | { readonly kind: 'setFlag'; readonly flag: string }
  | { readonly kind: 'starterPick' };

/**
 * A snare in flight. Purely presentational: the catch was decided the moment
 * the throw resolved (see `catchShakes`), exactly as in Gen 1, and this only
 * governs how long the game spends showing you the answer.
 *
 * Held in the scene rather than the renderer because the reducer has to STOP
 * for it. A snare that resolved instantly meant the box jumped straight from
 * "You sling a snare." to "It shook loose." with nothing in between - the most
 * dramatic moment in the game had no picture at all.
 */
export interface SnareThrow {
  /** Frames elapsed since the throw left the hand. */
  frames: number;
  /** Wobbles earned, 0-3. Four means it held. */
  shakes: number;
  caught: boolean;
}

/** How long the struck animal blinks. Long enough to see, short enough to mash past. */
export const FLASH_FRAMES = 18;

/** The arc, from hand to animal. */
export const SNARE_THROW_FRAMES = 22;
/** The animal folding down into the snare. */
export const SNARE_PULL_FRAMES = 14;
/** One rock, left or right. */
export const SNARE_WOBBLE_FRAMES = 22;
/** The click, or the burst. */
export const SNARE_SETTLE_FRAMES = 20;

/** Total frames a given throw occupies. A catch always wobbles three times. */
export function snareLength(t: { shakes: number; caught: boolean }): number {
  const wobbles = t.caught ? 3 : Math.max(0, Math.min(3, t.shakes));
  return (
    SNARE_THROW_FRAMES + SNARE_PULL_FRAMES + wobbles * SNARE_WOBBLE_FRAMES + SNARE_SETTLE_FRAMES
  );
}

export interface BattleScene {
  readonly kind: 'battle';
  battle: BattleState;
  /** Events still to be shown; the UI drains these one at a time. */
  queue: BattleEvent[];
  /** Frames the current event has been displayed. */
  ticks: number;
  /**
   * A message is on screen and the game is waiting for the player to dismiss it.
   *
   * Battle text used to advance on a timer, which meant guessing a reading speed
   * that suited everybody and suited nobody - too fast to read, then too slow to
   * grind through. Gen 1 does not guess: the box waits. So does this.
   */
  awaitingAck: boolean;
  /**
   * Health as currently DRAWN, which trails the real health until the events
   * that caused the change have been narrated.
   *
   * `scene.battle` is replaced with the end-of-turn state the moment a move is
   * chosen, so both bars used to empty before a single word appeared - your
   * animal visibly lost half its health, and only then did the game say who had
   * hit it. That is what "the text and the attacks are out of order" was: the
   * words were in the right order all along, the bars were simply ahead of them.
   */
  shownPlayerHp: number;
  shownEnemyHp: number;
  /** Non-null while a snare is in the air. Nothing else moves until it lands. */
  snare: SnareThrow | null;
  /**
   * Frames left of the struck animal's flinch, and which side is flinching.
   *
   * The bars trailing the text fixed the ORDER, but nothing on screen still
   * moved when a blow landed - the whole fight was two motionless animals and a
   * box of prose, so "which of these two sentences belongs to which attack" was
   * left entirely to the words. The victim now blinks on the exact message that
   * narrates the hit, which is what Gen 1 does and what makes the pairing
   * readable without reading.
   */
  flash: number;
  flashSide: 'player' | 'enemy';
  /**
   * Counts down while the pre-battle transition plays. Input is ignored and no
   * events drain until it reaches zero, exactly like Gen 1's wipe - the battle
   * should never start under a player who is still mid-step.
   */
  intro: number;
  /** 0 = fight, 1 = bag, 2 = party, 3 = run. */
  cursor: number;
  /** Which submenu is open. */
  sub: 'main' | 'moves' | 'party' | 'bag' | 'forceSwitch';
  moveCursor: number;
  partyCursor: number;
  bagCursor: number;
  trainerId: string | null;
  npcFlag: string | null;
}

export interface MenuScene {
  readonly kind: 'menu';
  cursor: number;
  sub: 'root' | 'party' | 'bag' | 'dex' | 'save';
  subCursor: number;
}

export type Scene =
  | { readonly kind: 'title'; cursor: number }
  | { readonly kind: 'starterPick'; cursor: number }
  | { readonly kind: 'overworld'; walk: WalkState }
  | DialogueScene
  | BattleScene
  | MenuScene
  | { readonly kind: 'gameover'; ticks: number }
  | { readonly kind: 'hallOfFame'; ticks: number };

export interface GameState {
  frame: number;
  rngState: RngState;
  scene: Scene;
  player: PlayerState;
  prev: Buttons;
  /** Set for one frame when a save is requested; the shell performs it. */
  saveRequested: boolean;
  /** Rolling log for debugging and the playthrough bot's failure reports. */
  lastText: string;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export const STARTERS = ['winter_pup', 'baloo_pup', 'plato_pup'] as const;
export type StarterId = (typeof STARTERS)[number];

/** Each starter loses to the next one in this cycle: Winter > Plato > Baloo > Winter. */
const RIVAL_PICK: Readonly<Record<string, string>> = {
  winter_pup: 'baloo_pup',
  plato_pup: 'winter_pup',
  baloo_pup: 'plato_pup',
};

export function newGame(seed: number | string): GameState {
  const rng = Rng.fromSeed(seed);
  return {
    frame: 0,
    rngState: rng.state,
    scene: { kind: 'title', cursor: 0 },
    prev: NO_BUTTONS,
    saveRequested: false,
    lastText: '',
    player: {
      name: 'Tabitha',
      // Standing on the door's column. The exit is at (4,8); starting at x=3
      // meant the very first thing a new player does - walk down and out - hit
      // the wall beside the door instead.
      mapId: 'fenmark_house',
      x: 4,
      y: 4,
      facing: 'down',
      party: [],
      box: [],
      bag: [{ item: 'snare', count: 5 }, { item: 'poultice', count: 3 }],
      money: 3000,
      badges: [],
      starter: '',
      rivalStarter: '',
      flags: [],
      repelSteps: 0,
      steps: 0,
      playtimeFrames: 0,
      respawnMap: 'fenmark_lodge',
      respawnX: 4,
      respawnY: 6,
    },
  };
}

/** Build a legal creature at a level, with the four most recent learnset moves. */
export function makeFeral(dex: Dex, speciesId: string, level: number, rng: Rng, ot = 'Tabitha'): Feral {
  const sp: Species = dex.species(speciesId);
  const ivs = {
    hp: rng.int(16), atk: rng.int(16), def: rng.int(16),
    spa: rng.int(16), spd: rng.int(16), spe: rng.int(16),
  };
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  const unique = selectMoveset(sp.learnset, level, sp.types, (id) => dex.move(id));
  if (unique.length === 0) {
    const first = sp.learnset[0];
    if (first) unique.push(first.move);
  }

  const f: Feral = {
    species: speciesId,
    nickname: sp.name,
    level,
    exp: expForLevel(level),
    hp: 1,
    ivs,
    evs,
    moves: unique.map((id) => {
      const mv = dex.move(id);
      return { move: mv.id, pp: mv.pp, maxPp: mv.pp };
    }),
    status: null,
    statusTurns: 0,
    caughtAt: level,
    originalTrainer: ot,
  };
  f.hp = computeStat(sp.base.hp, ivs.hp, 0, level, true);
  return f;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pressed(state: GameState, b: Buttons, key: ButtonName): boolean {
  return b[key] && !state.prev[key];
}

function flagSet(p: PlayerState): Set<string> {
  return new Set(p.flags);
}

export function hasFlag(p: PlayerState, flag: string): boolean {
  return p.flags.includes(flag);
}

function setFlag(p: PlayerState, flag: string): void {
  if (!p.flags.includes(flag)) p.flags.push(flag);
}

function currentMap(content: Content, p: PlayerState): GameMap {
  return content.world.map(p.mapId);
}

export function partyAlive(p: PlayerState): boolean {
  return p.party.some((f) => f.hp > 0);
}

function healParty(content: Content, p: PlayerState): void {
  for (const f of p.party) {
    f.hp = maxHp(content.dex.species(f.species), f);
    f.status = null;
    f.statusTurns = 0;
    for (const m of f.moves) m.pp = m.maxPp;
  }
}

function say(state: GameState, content: Content, key: string, then: PendingAction | null = null): void {
  const lines = content.dialogue(key);
  state.scene = {
    kind: 'dialogue',
    lines: lines.length > 0 ? [...lines] : ['...'],
    index: 0,
    chars: 0,
    page: 0,
    then,
  };
  state.lastText = lines[0] ?? '';
}

function sayRaw(state: GameState, lines: readonly string[], then: PendingAction | null = null): void {
  state.scene = { kind: 'dialogue', lines: [...lines], index: 0, chars: 0, page: 0, then };
  state.lastText = lines[0] ?? '';
}

function enterOverworld(state: GameState): void {
  state.scene = {
    kind: 'overworld',
    walk: { progress: 0, dir: state.player.facing, hop: false, fromX: state.player.x, fromY: state.player.y },
  };
}

// ---------------------------------------------------------------------------
// Evolution — checked after every battle, like Gen 1 does
// ---------------------------------------------------------------------------

export function checkEvolutions(content: Content, p: PlayerState): string[] {
  const evolved: string[] = [];
  for (const f of p.party) {
    const sp = content.dex.species(f.species);
    if (!sp.evolvesTo || f.level < sp.evolvesTo.level) continue;
    const before = maxHp(sp, f);
    const wasNamedForSpecies = f.nickname === sp.name;
    f.species = sp.evolvesTo.into;
    const next = content.dex.species(f.species);
    if (wasNamedForSpecies) f.nickname = next.name;
    f.hp += maxHp(next, f) - before;
    evolved.push(next.name);
  }
  return evolved;
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export function step(content: Content, state: GameState, buttons: Buttons): GameState {
  state.frame++;
  state.player.playtimeFrames++;
  state.saveRequested = false;
  const rng = new Rng(state.rngState);

  switch (state.scene.kind) {
    case 'title': stepTitle(content, state, buttons); break;
    case 'starterPick': stepStarterPick(content, state, state.scene, buttons); break;
    case 'overworld': stepOverworld(content, state, state.scene, buttons, rng); break;
    case 'dialogue': stepDialogue(content, state, state.scene, buttons, rng); break;
    case 'battle': stepBattle(content, state, state.scene, buttons, rng); break;
    case 'menu': stepMenu(content, state, state.scene, buttons); break;
    case 'gameover': stepGameOver(content, state, buttons); break;
    case 'hallOfFame': state.scene.ticks++; break;
  }

  state.rngState = rng.state;
  state.prev = buttons;
  return state;
}

// --- Title -----------------------------------------------------------------

function stepTitle(content: Content, state: GameState, b: Buttons): void {
  if (!pressed(state, b, 'a') && !pressed(state, b, 'start')) return;
  if (state.player.starter === '') {
    say(state, content, 'intro', { kind: 'starterPick' });
  } else {
    enterOverworld(state);
  }
}

// --- Overworld -------------------------------------------------------------

function stepOverworld(
  content: Content,
  state: GameState,
  scene: { kind: 'overworld'; walk: WalkState },
  b: Buttons,
  rng: Rng,
): void {
  const p = state.player;
  const map = currentMap(content, p);
  const walk = scene.walk;

  // --- Mid-step: finish the tile transition -------------------------------
  //
  // Arrival is handled ON the last frame of the step, and if nothing interrupts
  // (no warp, trainer or encounter) this falls THROUGH to the input handling
  // below so a held direction starts the next step in the same tick.
  //
  // Two separate defects lived here, both firing once per tile - about six
  // times a second while walking, which is what "the frame rate isn't right"
  // was describing. Smoothing the character WITHIN a step left both untouched.
  //
  //  1. `fromX/fromY` were not re-anchored on arrival, so the one frame drawn
  //     with progress 0 interpolated to t=0 and put the player a WHOLE TILE
  //     BACKWARDS before the next step snapped her forward again.
  //  2. That frame was dead anyway: the tick only noticed the step had ended,
  //     and input was not read until the tick after. Falling through spends it.
  if (walk.progress > 0) {
    walk.progress++;
    if (walk.progress <= WALK_FRAMES) return;

    walk.progress = 0;
    // Re-anchor the interpolation to where we actually ARE. `fromX/fromY` still
    // held the tile we left, and a render with progress 0 lerps to t=0 - which
    // drew the player a WHOLE TILE BACKWARDS for one frame at the end of every
    // single step. That backward snap, once per tile, is the screen "glitching"
    // while walking; it is far more visible than a dropped frame.
    walk.fromX = p.x;
    walk.fromY = p.y;
    p.steps++;
    if (p.repelSteps > 0) p.repelSteps--;

    // Arrival effects, in Gen 1's order: warp, then trainer, then encounter.
    const warp = warpAt(map, p.x, p.y);
    if (warp) {
      if (warp.requiresFlag !== undefined && !hasFlag(p, warp.requiresFlag)) {
        p.x = walk.fromX;
        p.y = walk.fromY;
        sayRaw(state, [warp.blockedText ?? 'It will not open.']);
        return;
      }
      p.mapId = warp.toMap;
      p.x = warp.toX;
      p.y = warp.toY;
      return;
    }

    const trainer = triggeredTrainer(map, flagSet(p), p.x, p.y);
    if (trainer && trainer.team !== undefined) {
      p.facing = facingToward(p.x, p.y, trainer.x, trainer.y);
      startTrainerEncounter(content, state, trainer);
      return;
    }

    const lead = p.party.find((f) => f.hp > 0);
    const repelLevel = p.repelSteps > 0 && lead ? lead.level : 0;
    const enc = rollEncounter(map, p.x, p.y, rng, repelLevel);
    if (enc) {
      beginWildBattle(content, state, enc.species, enc.level, rng);
      return;
    }
    // Nothing interrupted the step. Fall through to the movement handling below
    // so walking is continuous instead of stopping dead on every tile boundary.
  }

  // --- Standing: menu, interaction, movement ------------------------------
  if (pressed(state, b, 'start')) {
    state.scene = { kind: 'menu', cursor: 0, sub: 'root', subCursor: 0 };
    return;
  }

  if (pressed(state, b, 'a')) {
    const [dx, dy] = DIR_VEC[p.facing];
    const npc = npcAt(map, flagSet(p), p.x + dx, p.y + dy);
    if (npc) {
      interactWithNpc(content, state, npc);
      return;
    }
    const t = tileAt(map, p.x + dx, p.y + dy);
    if (t === 11 /* Tile.Sign */) {
      sayRaw(state, ['Someone has carved something here. It is not flattering.']);
      return;
    }
  }

  const dir: Dir | null =
    b.up ? 'up' : b.down ? 'down' : b.left ? 'left' : b.right ? 'right' : null;
  if (dir === null) return;

  // Turning in place costs a frame, exactly like Gen 1 — it is why the game
  // feels deliberate rather than slippery.
  if (p.facing !== dir) {
    p.facing = dir;
    if (!state.prev[dir]) return;
  }

  const canSwim = p.badges.includes('tide');
  if (!canWalk(map, flagSet(p), p.x, p.y, dir, canSwim)) return;

  const hop = isLedgeHop(map, p.x, p.y, dir);
  walk.fromX = p.x;
  walk.fromY = p.y;
  walk.dir = dir;
  walk.hop = hop;
  walk.progress = 1;
  const [dx, dy] = DIR_VEC[dir];
  p.x += dx * (hop ? 2 : 1);
  p.y += dy * (hop ? 2 : 1);
}

function interactWithNpc(content: Content, state: GameState, npc: NpcDef): void {
  const p = state.player;
  switch (npc.kind) {
    case 'healer': {
      // Usable whenever, exactly like a Gen 1 centre - not only after a blackout.
      // It always healed on contact, but it never SAID so, so there was no way
      // to tell it had worked and no reason to walk in with a hurt party.
      const hurt = p.party.some((f) => f.hp < maxHp(content.dex.species(f.species), f) || f.status !== null);
      healParty(content, p);
      p.respawnMap = p.mapId;
      p.respawnX = p.x;
      p.respawnY = p.y;
      const lines = [...content.dialogue(npc.dialogue)];
      lines.push(hurt
        ? 'Your lot are fed, patched and asleep by the fire. Good as new.'
        : 'Nothing wrong with any of them. They sleep here anyway.');
      sayRaw(state, lines);
      return;
    }
    case 'item': {
      const flag = npc.flag ?? `item_${npc.id}`;
      if (hasFlag(p, flag)) {
        sayRaw(state, ['Already taken. By you. Earlier.']);
        return;
      }
      setFlag(p, flag);
      say(state, content, npc.dialogue);
      return;
    }
    case 'trainer':
    case 'rival':
    case 'leader':
      if (npc.flag !== undefined && hasFlag(p, npc.flag)) {
        say(state, content, `${npc.dialogue}_after`);
        return;
      }
      startTrainerEncounter(content, state, npc);
      return;
    default:
      say(state, content, npc.dialogue);
  }
}

function startTrainerEncounter(content: Content, state: GameState, npc: NpcDef): void {
  if (npc.team === undefined) {
    say(state, content, npc.dialogue);
    return;
  }
  const def = content.trainer(npc.team);
  say(state, content, def.introKey, {
    kind: 'battle',
    trainerId: npc.team,
    ...(npc.flag === undefined ? {} : { npcFlag: npc.flag }),
  });
}

function beginWildBattle(
  content: Content,
  state: GameState,
  speciesId: string,
  level: number,
  rng: Rng,
): void {
  const wild = makeFeral(content.dex, speciesId, level, rng, 'wild');
  const battle = startBattle(state.player.party, [wild], { kind: 'wild', aiLevel: 1 });
  state.scene = makeBattleScene(battle, null, null);
  state.lastText = `A wild ${wild.nickname} blocks the way.`;
}

function beginTrainerBattle(
  content: Content,
  state: GameState,
  trainerId: string,
  npcFlag: string | null,
  rng: Rng,
): void {
  const def = content.trainer(trainerId);
  const team = def.team.map((m) => makeFeral(content.dex, m.species, m.level, rng, def.name));
  const battle = startBattle(state.player.party, team, {
    kind: 'trainer',
    trainerId,
    aiLevel: def.aiLevel,
  });
  state.scene = makeBattleScene(battle, trainerId, npcFlag);
  state.lastText = `${def.title} ${def.name} wants to fight.`;
}

function makeBattleScene(
  battle: BattleState,
  trainerId: string | null,
  npcFlag: string | null,
): BattleScene {
  return {
    kind: 'battle',
    battle,
    queue: [],
    ticks: 0,
    awaitingAck: false,
    shownPlayerHp: activeOf(battle.player).hp,
    shownEnemyHp: activeOf(battle.enemy).hp,
    snare: null,
    flash: 0,
    flashSide: 'enemy',
    intro: BATTLE_INTRO_FRAMES,
    cursor: 0,
    sub: 'main',
    moveCursor: 0,
    partyCursor: 0,
    bagCursor: 0,
    trainerId,
    npcFlag,
  };
}

// --- Dialogue --------------------------------------------------------------

/** Characters revealed per frame. Fast enough to not annoy, slow enough to read. */
const TYPE_SPEED = 2;

function stepDialogue(
  content: Content,
  state: GameState,
  scene: DialogueScene,
  b: Buttons,
  rng: Rng,
): void {
  const line = scene.lines[scene.index] ?? '';
  const advance = pressed(state, b, 'a') || pressed(state, b, 'b');

  // A line is shown a BOX at a time. The renderer only ever draws two rows, so
  // anything longer has to be paged through here - it used to be drawn once and
  // the overflow thrown away, which lost the tail of 96% of the script.
  const pages = paginate(line);
  const rows = pages[scene.page] ?? [];
  const visible = pageLength(rows);

  // Still typing: A/B fills the box instantly rather than advancing past it.
  if (scene.chars < visible) {
    scene.chars = advance ? visible : Math.min(visible, scene.chars + TYPE_SPEED);
    state.lastText = line;
    return;
  }
  if (!advance) return;

  // More of this line to read before moving on.
  if (scene.page < pages.length - 1) {
    scene.page++;
    scene.chars = 0;
    return;
  }

  if (scene.index < scene.lines.length - 1) {
    scene.index++;
    scene.page = 0;
    scene.chars = 0;
    state.lastText = scene.lines[scene.index] ?? '';
    return;
  }

  const then = scene.then;
  if (then === null) {
    enterOverworld(state);
    return;
  }
  runPending(content, state, then, rng);
}

function runPending(content: Content, state: GameState, action: PendingAction, rng: Rng): void {
  const p = state.player;
  switch (action.kind) {
    case 'battle':
      beginTrainerBattle(content, state, action.trainerId, action.npcFlag ?? null, rng);
      return;
    case 'heal':
      healParty(content, p);
      enterOverworld(state);
      return;
    case 'giveItem': {
      const stack = p.bag.find((s) => s.item === action.item);
      if (stack) stack.count += action.count;
      else p.bag.push({ item: action.item, count: action.count });
      enterOverworld(state);
      return;
    }
    case 'setFlag':
      setFlag(p, action.flag);
      enterOverworld(state);
      return;
    case 'starterPick':
      if (p.starter === '') state.scene = { kind: 'starterPick', cursor: 0 };
      else enterOverworld(state);
      return;
  }
}

/**
 * Choosing a starter.
 *
 * This scene did not exist: `runPending` for 'starterPick' dropped straight into
 * the overworld, so a browser player began the game with an EMPTY PARTY and no
 * way to ever get one. The headless bot never caught it because it calls
 * chooseStarter() directly, which is exactly the kind of hole a test-only path
 * hides. Found by driving the real build with real key presses.
 */
function stepStarterPick(
  content: Content,
  state: GameState,
  scene: { kind: 'starterPick'; cursor: number },
  b: Buttons,
): void {
  if (pressed(state, b, 'right')) scene.cursor = (scene.cursor + 1) % STARTERS.length;
  if (pressed(state, b, 'left')) scene.cursor = (scene.cursor + STARTERS.length - 1) % STARTERS.length;
  if (!pressed(state, b, 'a')) return;
  const pick = STARTERS[scene.cursor] ?? STARTERS[0];
  chooseStarter(content, state, pick);
  sayRaw(state, [
    `${content.dex.species(pick).name} it is.`,
    'Cass takes the one that beats yours. Of course Cass does.',
  ]);
}

/** Called by the starter-selection UI (and by the playthrough bot). */
export function chooseStarter(content: Content, state: GameState, starter: StarterId): void {
  const rng = new Rng(state.rngState);
  const p = state.player;
  if (p.starter !== '') return;
  p.starter = starter;
  p.rivalStarter = RIVAL_PICK[starter] ?? 'baloo_pup';
  p.party.push(makeFeral(content.dex, starter, 5, rng, p.name));
  setFlag(p, 'has_starter');
  state.rngState = rng.state;
  enterOverworld(state);
}

/** The three starters, for the picker UI. */
export function starterChoices(): readonly StarterId[] {
  return STARTERS;
}

// --- Battle ----------------------------------------------------------------

/** Frames each battle event is held on screen before the next is shown. */
/**
 * How long a non-text battle beat (damage, hp drain, a faint) holds before the
 * next one. Text is NOT on a timer - see `awaitingAck`.
 */
const EVENT_FRAMES = 6;

/** Length of the pre-battle wipe. Gen 1's is a touch under a second. */
export const BATTLE_INTRO_FRAMES = 52;

/**
 * Push battle events, splitting any message too long for the text box into one
 * event per box.
 *
 * The battle box shows two rows and drains on a timer, so unlike dialogue there
 * is nobody to press A for a second page - an over-long message simply lost its
 * tail. Move names run to twenty-one characters ("Under The Floorboards") and
 * creature names to twelve, so "Nightreynard used Under The Floorboards!" needs
 * three rows and used to show two. Splitting here means the existing drain
 * shows each box in turn and nothing is dropped.
 */
function pushEvents(scene: BattleScene, events: readonly BattleEvent[]): void {
  for (const ev of events) {
    if (ev.t !== 'text') {
      scene.queue.push(ev);
      continue;
    }
    for (const rows of paginate(ev.text)) {
      scene.queue.push({ t: 'text', text: rows.join(' ') });
    }
  }
}

/**
 * The words for a battle beat, or null if it is a pure animation.
 *
 * Only `text` events used to reach the screen. A move, a miss, a faint and the
 * effectiveness of a hit were all structured events that nothing ever turned
 * into a sentence - so "Winter used Frost Fang" was never shown at ALL, and the
 * box just held whatever stale line was there while the HP bar drained. That is
 * what "it skips past the attacks of the opponent" really was: not too fast,
 * never written.
 */
function battleMessage(scene: BattleScene, ev: BattleEvent): string | null {
  switch (ev.t) {
    case 'text':
      return ev.text;
    case 'move': {
      // `ev.actor` was captured when the move was used. Reading the active
      // creature here instead read the state AFTER the whole turn resolved, so
      // a creature that fainted or switched got someone else's name.
      const who = ev.side === 'player'
        ? ev.actor
        : `${scene.battle.kind === 'wild' ? 'The wild' : 'Their'} ${ev.actor}`;
      return `${who} used ${ev.name}.`;
    }
    case 'miss':
      return 'It misses by a street.';
    case 'faint':
      return `${ev.name} is down.`;
    case 'caught':
      return `${ev.name} is yours now.`;
    case 'damage': {
      if (ev.effectiveness === 0) return 'Nothing. Wrong animal.';
      // The line is chosen by how much health the hit actually TOOK, so a graze
      // and a near-kill never read the same.
      const pool = HIT_LINES[hitBucket(ev.amount, ev.maxHp)] ?? [];
      if (pool.length === 0) return null;
      // Deterministic pick: the same hit always narrates the same way, so the
      // engine stays reproducible and gauntlet:playthrough is unaffected.
      const seed = ev.amount * 31 + ev.hpAfter * 7 + (ev.critical ? 3 : 0);
      const line = pool[seed % pool.length] ?? '';

      // ONE BOX PER HIT. A single attack used to cost up to three button
      // presses - the move, the flavour line, then a separate box for
      // "It could not hold that." Reading a fight was mostly pressing A.
      // The tag now rides in the same box whenever the two fit together, which
      // the hit lines are written short enough to guarantee; if a name or a
      // long line ever pushes it over, the tag wins, because "Critical." is
      // information and the flavour is decoration.
      const tag = ev.critical ? 'Critical.'
        : ev.effectiveness > 1 ? 'Effective.'
        : ev.effectiveness < 1 ? 'Resisted.'
        : '';
      if (tag === '') return line;
      const both = `${line} ${tag}`;
      return paginate(both).length === 1 ? both : tag;
    }
    default:
      return null;
  }
}

function stepBattle(
  content: Content,
  state: GameState,
  scene: BattleScene,
  b: Buttons,
  rng: Rng,
): void {
  // The flinch runs on wall-clock frames, not on the drain, so it has to be
  // decremented before any of the early returns below can swallow it.
  if (scene.flash > 0) scene.flash--;

  // The transition owns the screen until it finishes.
  if (scene.intro > 0) {
    scene.intro--;
    return;
  }

  // So does a snare. No input, no drain, no bars moving: the throw is the only
  // thing happening until it has finished being wrong or right.
  if (scene.snare !== null) {
    scene.snare.frames++;
    if (scene.snare.frames < snareLength(scene.snare)) return;
    scene.snare = null;
    if (scene.queue.length === 0) {
      afterEvents(content, state, scene, rng);
      return;
    }
  }

  // A message holds the screen until the player presses A or B. Read at your
  // own pace; mash through a fight you have seen before.
  if (scene.awaitingAck) {
    if (!pressed(state, b, 'a') && !pressed(state, b, 'b')) return;
    scene.awaitingAck = false;
    scene.ticks = 0;
    // The acknowledged message may have been the last thing in the turn.
    if (scene.queue.length === 0) afterEvents(content, state, scene, rng);
    return;
  }

  // Drain queued events; the player cannot act mid-animation. Only the beats
  // WITHOUT words are on a timer.
  if (scene.queue.length > 0) {
    scene.ticks++;
    if (scene.ticks < EVENT_FRAMES) return;
    scene.ticks = 0;
    const ev = scene.queue.shift();
    // The bar moves WITH the message that explains it, not before it.
    if (ev !== undefined && (ev.t === 'damage' || ev.t === 'heal')) {
      if (ev.side === 'player') scene.shownPlayerHp = ev.hpAfter;
      else scene.shownEnemyHp = ev.hpAfter;
    }
    // `shake` carries no words - it IS the animation. Launching it here rather
    // than narrating it keeps the wobble count and the picture in step.
    if (ev !== undefined && ev.t === 'shake') {
      scene.snare = { frames: 0, shakes: ev.count, caught: ev.count >= 4 };
      state.lastText = 'You sling a snare.';
      return;
    }
    const msg = ev === undefined ? null : battleMessage(scene, ev);
    if (msg !== null) {
      // The one who got hit is the one who flinches, and only for a real hit -
      // an immune "Nothing. Wrong animal." should look like nothing happened.
      if (ev !== undefined && ev.t === 'damage' && ev.amount > 0) {
        scene.flash = FLASH_FRAMES;
        scene.flashSide = ev.side;
      }
      // The battle box shows two rows. Messages are composed here, AFTER the
      // enqueue-time pagination, so a long one was simply cut off mid-sentence.
      // Split it and push the remainder back to the front of the queue, which
      // keeps everything in order and gives each page its own press.
      const pages = paginate(msg);
      state.lastText = (pages[0] ?? []).join(' ');
      for (let i = pages.length - 1; i >= 1; i--) {
        scene.queue.unshift({ t: 'text', text: (pages[i] ?? []).join(' ') });
      }
      scene.awaitingAck = true;
      return;
    }
    if (scene.queue.length === 0) afterEvents(content, state, scene, rng);
    return;
  }

  const battle = scene.battle;
  if (battle.outcome !== 'ongoing') {
    endBattle(content, state, scene, rng);
    return;
  }

  // The player must replace a fainted creature before anything else happens.
  if (scene.sub === 'forceSwitch' || activeOf(battle.player).hp <= 0) {
    scene.sub = 'forceSwitch';
    handlePartyMenu(state, scene, b, (idx) => {
      const target = battle.player.party[idx];
      if (!target || target.hp <= 0) return false;
      pushEvents(scene, forceSwitch(content.dex, battle, 'player', idx));
      scene.sub = 'main';
      return true;
    });
    return;
  }

  switch (scene.sub) {
    case 'main': {
      if (pressed(state, b, 'right')) scene.cursor = (scene.cursor + 1) % 4;
      if (pressed(state, b, 'left')) scene.cursor = (scene.cursor + 3) % 4;
      if (pressed(state, b, 'down')) scene.cursor = (scene.cursor + 2) % 4;
      if (pressed(state, b, 'up')) scene.cursor = (scene.cursor + 2) % 4;
      if (!pressed(state, b, 'a')) return;
      if (scene.cursor === 0) scene.sub = 'moves';
      else if (scene.cursor === 1) scene.sub = 'bag';
      else if (scene.cursor === 2) scene.sub = 'party';
      else submitAction(content, state, scene, { kind: 'run' }, rng);
      return;
    }
    case 'moves': {
      const moves = activeOf(battle.player).moves;
      if (pressed(state, b, 'down')) scene.moveCursor = (scene.moveCursor + 1) % Math.max(1, moves.length);
      if (pressed(state, b, 'up')) scene.moveCursor = (scene.moveCursor + moves.length - 1) % Math.max(1, moves.length);
      if (pressed(state, b, 'b')) { scene.sub = 'main'; return; }
      if (!pressed(state, b, 'a')) return;
      const slot = moves[scene.moveCursor];
      // If EVERY move is spent, the selection must still go through: the engine
      // answers an empty movepool with Struggle. Rejecting it here left the
      // player unable to act at all - a real, shipping soft-lock, found by
      // gauntlet:playthrough hanging on route 1 with "No power left in that one."
      const anyPp = moves.some((m) => m.pp > 0);
      if (anyPp && (!slot || slot.pp <= 0)) {
        state.lastText = 'No power left in that one.';
        return;
      }
      submitAction(content, state, scene, { kind: 'move', slot: scene.moveCursor }, rng);
      return;
    }
    case 'party': {
      handlePartyMenu(state, scene, b, (idx) => {
        const target = battle.player.party[idx];
        if (!target || target.hp <= 0 || idx === battle.player.active) return false;
        submitAction(content, state, scene, { kind: 'switch', index: idx }, rng);
        return true;
      });
      return;
    }
    case 'bag': {
      const bag = state.player.bag;
      if (pressed(state, b, 'down')) scene.bagCursor = (scene.bagCursor + 1) % Math.max(1, bag.length);
      if (pressed(state, b, 'up')) scene.bagCursor = (scene.bagCursor + bag.length - 1) % Math.max(1, bag.length);
      if (pressed(state, b, 'b')) { scene.sub = 'main'; return; }
      if (!pressed(state, b, 'a')) return;
      const stack = bag[scene.bagCursor];
      if (!stack || stack.count <= 0) return;
      useBattleItem(content, state, scene, stack.item, rng);
      return;
    }
  }
}

function handlePartyMenu(
  state: GameState,
  scene: BattleScene,
  b: Buttons,
  confirm: (index: number) => boolean,
): void {
  const party = scene.battle.player.party;
  if (pressed(state, b, 'down')) scene.partyCursor = (scene.partyCursor + 1) % Math.max(1, party.length);
  if (pressed(state, b, 'up')) scene.partyCursor = (scene.partyCursor + party.length - 1) % Math.max(1, party.length);
  if (pressed(state, b, 'b') && scene.sub !== 'forceSwitch') { scene.sub = 'main'; return; }
  if (!pressed(state, b, 'a')) return;
  if (!confirm(scene.partyCursor)) state.lastText = 'Not that one.';
}

function useBattleItem(
  content: Content,
  state: GameState,
  scene: BattleScene,
  item: string,
  rng: Rng,
): void {
  const p = state.player;
  const stack = p.bag.find((s) => s.item === item);
  if (!stack || stack.count <= 0) return;

  if (item === 'snare' || item === 'good_snare' || item === 'great_snare') {
    if (scene.battle.kind === 'trainer') {
      state.lastText = "That would be theft, and they're watching.";
      return;
    }
    stack.count--;
    const bonus = item === 'great_snare' ? 3 : item === 'good_snare' ? 2 : 1;
    submitAction(content, state, scene, { kind: 'ball', bonus }, rng);
    return;
  }

  if (item === 'poultice' || item === 'strong_poultice') {
    const target = activeOf(scene.battle.player);
    const sp = content.dex.species(target.species);
    const max = maxHp(sp, target);
    if (target.hp >= max) { state.lastText = 'It is already fine. Better than you.'; return; }
    stack.count--;
    target.hp = Math.min(max, target.hp + (item === 'strong_poultice' ? 120 : 40));
    scene.queue.push({ t: 'heal', side: 'player', amount: 40, hpAfter: target.hp });
    submitAction(content, state, scene, { kind: 'item', item }, rng);
    return;
  }

  state.lastText = 'Not now.';
}

function submitAction(
  content: Content,
  state: GameState,
  scene: BattleScene,
  action: BattleAction,
  rng: Rng,
): void {
  const result = resolveTurn(content.dex, scene.battle, action, rng);
  scene.battle = result.state;
  pushEvents(scene, result.events);
  scene.sub = 'main';
  scene.ticks = 0;
  if (scene.queue.length === 0) afterEvents(content, state, scene, rng);
}

function afterEvents(content: Content, state: GameState, scene: BattleScene, rng: Rng): void {
  // Everything has been narrated, so the drawn health can catch up to the truth.
  // This also covers switches, items and faints without special-casing each.
  scene.shownPlayerHp = activeOf(scene.battle.player).hp;
  scene.shownEnemyHp = activeOf(scene.battle.enemy).hp;
  if (scene.battle.outcome !== 'ongoing') endBattle(content, state, scene, rng);
}

function endBattle(content: Content, state: GameState, scene: BattleScene, rng: Rng): void {
  const p = state.player;
  const outcome = scene.battle.outcome;

  if (outcome === 'caught' && scene.battle.caught) {
    const caught = scene.battle.caught;
    caught.originalTrainer = p.name;
    if (p.party.length < 6) p.party.push(caught);
    else p.box.push(caught);
  }

  if (outcome === 'won' && scene.trainerId !== null) {
    const def = content.trainer(scene.trainerId);
    p.money += def.prize;
    if (scene.npcFlag !== null) setFlag(p, scene.npcFlag);
    setFlag(p, `beat_${def.id}`);
    if (def.badge !== undefined && !p.badges.includes(def.badge)) p.badges.push(def.badge);
  }

  if (outcome === 'lost' || !partyAlive(p)) {
    // Gen 1's blackout: wake up at the last healer, lighter in the pocket.
    p.money = Math.floor(p.money / 2);
    healParty(content, p);
    p.mapId = p.respawnMap;
    p.x = p.respawnX;
    p.y = p.respawnY;
    sayRaw(state, [
      'You come round on a bench that smells like wet dog and cheap brandy.',
      'Someone has taken half your money and left a note reading "FOR THE TROUBLE".',
    ]);
    return;
  }

  const evolved = checkEvolutions(content, p);
  const lines: string[] = [];
  for (const name of evolved) lines.push(`...it changed. It is ${name} now.`);

  if (outcome === 'won' && scene.trainerId !== null) {
    const def = content.trainer(scene.trainerId);
    lines.push(...content.dialogue(def.defeatKey));
    if (def.badge !== undefined) lines.push(`You take the ${def.badge.toUpperCase()} badge.`);
    if (def.id === 'champion') {
      setFlag(p, 'champion');
      state.scene = { kind: 'hallOfFame', ticks: 0 };
      return;
    }
  }

  void rng;
  if (lines.length > 0) sayRaw(state, lines);
  else enterOverworld(state);
}

// --- Pause menu ------------------------------------------------------------

const MENU_ROOT = ['PARTY', 'BAG', 'DEX', 'SAVE', 'BACK'] as const;

function stepMenu(content: Content, state: GameState, scene: MenuScene, b: Buttons): void {
  if (scene.sub === 'root') {
    if (pressed(state, b, 'down')) scene.cursor = (scene.cursor + 1) % MENU_ROOT.length;
    if (pressed(state, b, 'up')) scene.cursor = (scene.cursor + MENU_ROOT.length - 1) % MENU_ROOT.length;
    if (pressed(state, b, 'b') || pressed(state, b, 'start')) { enterOverworld(state); return; }
    if (!pressed(state, b, 'a')) return;
    const choice = MENU_ROOT[scene.cursor];
    if (choice === 'BACK') { enterOverworld(state); return; }
    if (choice === 'SAVE') {
      state.saveRequested = true;
      sayRaw(state, ['Saved. The Fenmark remembers.']);
      return;
    }
    scene.sub = choice === 'PARTY' ? 'party' : choice === 'BAG' ? 'bag' : 'dex';
    scene.subCursor = 0;
    return;
  }

  const len = scene.sub === 'party' ? state.player.party.length : state.player.bag.length;
  if (pressed(state, b, 'down') && len > 0) scene.subCursor = (scene.subCursor + 1) % len;
  if (pressed(state, b, 'up') && len > 0) scene.subCursor = (scene.subCursor + len - 1) % len;
  if (pressed(state, b, 'b')) { scene.sub = 'root'; return; }

  if (pressed(state, b, 'a') && scene.sub === 'bag') {
    const stack = state.player.bag[scene.subCursor];
    if (stack && stack.count > 0 && (stack.item === 'poultice' || stack.item === 'strong_poultice')) {
      const target = state.player.party[0];
      if (target) {
        const sp = content.dex.species(target.species);
        const max = maxHp(sp, target);
        if (target.hp < max) {
          stack.count--;
          target.hp = Math.min(max, target.hp + (stack.item === 'strong_poultice' ? 120 : 40));
        }
      }
    }
  }
}

function stepGameOver(content: Content, state: GameState, b: Buttons): void {
  void content;
  if (pressed(state, b, 'a') || pressed(state, b, 'start')) {
    state.scene = { kind: 'title', cursor: 0 };
  }
}

// ---------------------------------------------------------------------------
// Queries the renderer and the bot both use
// ---------------------------------------------------------------------------

export function isBlocked(content: Content, state: GameState, dir: Dir): boolean {
  const p = state.player;
  return !canWalk(currentMap(content, p), flagSet(p), p.x, p.y, dir, p.badges.includes('tide'));
}

export function tileInFront(content: Content, state: GameState): number {
  const p = state.player;
  const [dx, dy] = DIR_VEC[p.facing];
  return tileAt(currentMap(content, p), p.x + dx, p.y + dy);
}

export function onEncounterTile(content: Content, state: GameState): boolean {
  const p = state.player;
  return propsOf(tileAt(currentMap(content, p), p.x, p.y)).encounter;
}

export { hasAlive };
