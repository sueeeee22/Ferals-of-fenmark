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
import type { Feral, Species, StatusName } from './creature.ts';
import { computeStat, expForLevel, maxHp, selectMoveset } from './creature.ts';
import { isPoultice, isSnare, poulticeHeal, shopStock, STACK_MAX } from './items.ts';
import {
  canWalk, DIR_VEC, isLedgeHop, npcAt, rollEncounter, triggeredTrainer, tileAt,
  warpAt, facingToward, propsOf,
  type Dir, type GameMap, type NpcDef, type World,
} from './world.ts';
import {
  activeOf, forceSwitch, hasAlive, resolveTurn, startBattle,
  type BattleAction, type BattleEvent, type BattleState, type Dex, type Side,
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

/**
 * Ticks to cross one tile with B held: twice walking pace, two whole pixels a
 * tick. Gen 1 had no running (that arrived two generations later), but its
 * walking pace over a long route is the thing a modern player notices first.
 *
 * Walking stays the default on purpose - see WALK_FRAMES: a tap must mean one
 * tile, and at this speed it does not. Holding B is how you say you are going
 * somewhere and do not mean to stop on a particular square.
 */
export const RUN_FRAMES = 8;

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
  /** Every species id, in Dex order: number 1 first. */
  readonly speciesIds: readonly string[];
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
  /**
   * The Dex: species ids met in a fight, and species ids owned at some point.
   * Everything in `caught` is also in `seen`. Saves from before the Dex have
   * neither; `restore` fills them in from the animals the save does hold.
   */
  seen: string[];
  caught: string[];
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
  /** 0 when standing still, else 1..span. */
  progress: number;
  /**
   * How many ticks THIS step takes: WALK_FRAMES, or RUN_FRAMES if B was held
   * when it began. Fixed for the length of the step, so letting go of B half
   * way across a tile never changes speed mid-stride.
   */
  span: number;
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
  | { readonly kind: 'shop' }
  | { readonly kind: 'box' }
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

/** One side of a fight as the screen currently shows it. See `BattleScene.shown`. */
export interface ShownSide {
  /** Which member of that side's party this is. */
  index: number;
  species: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status: StatusName | null;
  /** It has gone down, and has been told so: its sprite is off the field. */
  gone: boolean;
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
   * Each side AS DRAWN, which trails the engine until the events that changed
   * it have been narrated. The renderer draws from this and nothing else.
   *
   * `scene.battle` is replaced with the end-of-turn state the moment a move is
   * chosen, so drawing the truth showed the whole turn's outcome before a word
   * of it had been told. First it was the bars: your animal visibly lost half
   * its health and only then did the game say who had hit it. Fixing only the
   * bars left the rest ahead - the level ticked up the instant you chose the
   * killing move, and a trainer's NEXT animal was standing on the field while
   * the text was still describing the blow that felled the last one.
   * `gauntlet:visual` found both by watching a fight frame by frame.
   */
  shown: { player: ShownSide; enemy: ShownSide };
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
   * What the most recently narrated event should SOUND like, as a space-
   * separated list of effect names, plus a counter so two identical sounds in a
   * row are still two sounds.
   *
   * The audio layer cannot work this out for itself: by the time it sees the
   * state the event has been consumed, and a hit flash cannot tell a critical
   * from a graze or a resisted hit from a neutral one. Recording it at the
   * moment of the drain is the only place the information still exists.
   * Nothing in the game reads these; they are for the speakers, like `flash` is
   * for the screen.
   */
  sfx: string;
  sfxSeq: number;
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
  /**
   * Party list: which of PARTY_ACTIONS is highlighted for the animal under the
   * cursor, or -1 while the list itself has the cursor.
   */
  act: number;
  /** Party list: the animal picked up to be moved, or -1. */
  moving: number;
  /** Party list reached from the bag: the item waiting for a patient, or ''. */
  using: string;
  /** The game's answer to the last press, shown where the heading goes. */
  note: string;
  /** Dex: true while one animal's page is open over the list. */
  entry: boolean;
}

/** How many of the Dex list are on screen at once. */
export const DEX_ROWS = 8;

/** What can be done to an animal from the party list. */
export const PARTY_ACTIONS = ['MOVE', 'NAME', 'BACK'] as const;

/** The longest a name the player types may be. Fits every box a name is drawn in. */
export const NAME_MAX = 10;
/** The letter grid, a row at a time. The fourth row is NAME_KEYS. */
export const NAME_ROWS = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ-'] as const;
/** Under the letters: switch case, a space, rub one out, finish. */
export const NAME_KEYS = ['case', 'SPC', 'DEL', 'END'] as const;

/**
 * Naming an animal.
 *
 * Reached two ways: straight after a catch, where it first asks whether you
 * want to bother (`asking`), and from the party list, where you have already
 * said so. Finishing with nothing typed gives the animal back its species name,
 * which is also how a name is taken off again.
 */
export interface NamingScene {
  readonly kind: 'naming';
  /** Whose name: an index into the party, or into the box for a seventh catch. */
  where: 'party' | 'box';
  index: number;
  asking: boolean;
  /** While asking: 0 is YES, 1 is NO. */
  choice: number;
  text: string;
  /** 0-2 are letter rows, 3 is the row of keys. */
  row: number;
  col: number;
  lower: boolean;
  /** Where the player came from, and so where they go back to. */
  back: 'overworld' | 'party';
  /** Anything the end of the fight still has to say once the naming is done. */
  after: string[];
}

/**
 * A shop counter. The list is `shopStock(badges)` with LEAVE on the end, so the
 * cursor runs 0..stock.length.
 *
 * The clerk used to be a `shop` NPC who said two lines about shelves and sold
 * nothing: money piled up with nowhere to go and the only snares in the game
 * were the five you were born with.
 */
export interface ShopScene {
  readonly kind: 'shop';
  cursor: number;
  /** How many of the highlighted thing A will buy. */
  qty: number;
  /** The shop's answer to the last press, shown until the cursor moves. */
  note: string;
  /** Something was bought this visit, so the clerk has a line about it. */
  bought: boolean;
}

/** Fenmark law, and the `box_full` line that quotes it: thirty to a household. */
export const BOX_MAX = 30;
/** How many of a list the kennel ledger shows at once. */
export const BOX_ROWS = 8;

/**
 * The kennel box: the animals you own and are not walking with.
 *
 * `player.box` has existed since the first save - a seventh catch went into it
 * - but nothing could ever take one out again, so it was a hole rather than a
 * box. Every lodge now has a kennelhand who opens this: one list at a time,
 * left and right to change list, A to send the animal under the cursor across.
 */
export interface BoxScene {
  readonly kind: 'box';
  /** Which list is showing: the party you walk with, or the box. */
  side: 'party' | 'box';
  cursor: number;
  note: string;
}

export type Scene =
  | { readonly kind: 'title'; cursor: number }
  | { readonly kind: 'starterPick'; cursor: number }
  | { readonly kind: 'overworld'; walk: WalkState }
  | DialogueScene
  | BattleScene
  | MenuScene
  | ShopScene
  | NamingScene
  | BoxScene
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
      seen: [],
      caught: [],
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

/** Record a species as met. Called when an animal is shown across a fight. */
function markSeen(p: PlayerState, speciesId: string): void {
  if (!p.seen.includes(speciesId)) p.seen.push(speciesId);
}

/** Record a species as owned: a catch, a starter, or what one of yours became. */
function markCaught(p: PlayerState, speciesId: string): void {
  markSeen(p, speciesId);
  if (!p.caught.includes(speciesId)) p.caught.push(speciesId);
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
    walk: {
      progress: 0, span: WALK_FRAMES, dir: state.player.facing, hop: false,
      fromX: state.player.x, fromY: state.player.y,
    },
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
    markCaught(p, next.id);
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
    case 'shop': stepShop(content, state, state.scene, buttons); break;
    case 'naming': stepNaming(content, state, state.scene, buttons); break;
    case 'box': stepBox(content, state, state.scene, buttons); break;
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
    if (walk.progress <= walk.span) return;

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
      // Re-anchor again, to the far side of the door. Without this `from` is
      // still a tile on the map she just LEFT, and the renderer drew her there
      // on the new map - wrong square, camera and all - until her first step.
      walk.fromX = p.x;
      walk.fromY = p.y;
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
    state.scene = openMenu('root', 0, 0);
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
  // A ledge hop is two tiles in one stride and is never hurried: at running
  // pace it would cover four pixels a tick, which reads as a teleport.
  walk.span = b.b && !hop ? RUN_FRAMES : WALK_FRAMES;
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
    case 'shop':
      say(state, content, npc.dialogue, { kind: 'shop' });
      return;
    case 'box':
      say(state, content, npc.dialogue, { kind: 'box' });
      return;
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
  state.scene = makeBattleScene(content, state, battle, null, null, `A wild ${wild.nickname} blocks the way.`);
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
  // "of the road" and "who took the crown first" follow a name; "Head of House
  // Wren" is an aside to it. Putting the title first read as "of the road
  // Fenwalker wants to fight", which is not a sentence.
  const trails = def.title.startsWith('of ') || def.title.startsWith('who ');
  const who = trails ? `${def.name} ${def.title}` : `${def.name}, ${def.title},`;
  state.scene = makeBattleScene(content, state, battle, trainerId, npcFlag, `${who} wants to fight.`);
}

/** A side exactly as the engine has it right now. */
function showSide(content: Content, side: Side): ShownSide {
  const f = activeOf(side);
  return {
    index: side.active,
    species: f.species,
    name: f.nickname,
    level: f.level,
    hp: f.hp,
    maxHp: maxHp(content.dex.species(f.species), f),
    status: f.status,
    gone: f.hp <= 0,
  };
}

/**
 * `opening` is the line that announces the fight. It is queued as a real
 * message, so it is the first thing on screen when the wipe clears and it waits
 * to be read. It used to be written straight to `lastText`, which nothing
 * displayed: the only time "A wild Stripeling blocks the way." ever reached the
 * screen was as a tenth-of-a-second flash AFTER you had chosen your first move.
 */
function makeBattleScene(
  content: Content,
  state: GameState,
  battle: BattleState,
  trainerId: string | null,
  npcFlag: string | null,
  opening: string,
): BattleScene {
  state.lastText = '';
  markSeen(state.player, activeOf(battle.enemy).species);
  const scene: BattleScene = {
    kind: 'battle',
    battle,
    queue: [],
    ticks: 0,
    awaitingAck: false,
    shown: { player: showSide(content, battle.player), enemy: showSide(content, battle.enemy) },
    snare: null,
    flash: 0,
    flashSide: 'enemy',
    sfx: '',
    sfxSeq: 0,
    intro: BATTLE_INTRO_FRAMES,
    cursor: 0,
    sub: 'main',
    moveCursor: 0,
    partyCursor: 0,
    bagCursor: 0,
    trainerId,
    npcFlag,
  };
  pushEvents(scene, [{ t: 'text', text: opening }]);
  return scene;
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
    case 'giveItem':
      addToBag(p, action.item, action.count);
      enterOverworld(state);
      return;
    case 'setFlag':
      setFlag(p, action.flag);
      enterOverworld(state);
      return;
    case 'shop':
      state.scene = { kind: 'shop', cursor: 0, qty: 1, note: '', bought: false };
      return;
    case 'box':
      state.scene = { kind: 'box', side: 'party', cursor: 0, note: '' };
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
  markCaught(p, starter);
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
    // These three were events nothing ever turned into words. A level was
    // gained, a move was learned and a trainer's next animal walked on, all in
    // silence - the numbers on screen simply changed.
    case 'switch':
      return ev.side === 'player' ? `${ev.name}. You're up.` : `They send in ${ev.name}.`;
    case 'levelup':
      return `${ev.name} makes level ${ev.level}.`;
    case 'learn':
      return `${ev.name} picks up ${ev.move}.`;
    case 'heal':
      return `${scene.shown[ev.side].name} gets ${ev.amount} back.`;
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

/**
 * The sound an event asks for. Space-separated because a single hit is often two
 * sounds - the impact, then the effectiveness tag over the top of it - and
 * splitting them lets the audio layer stagger the second one.
 */
function battleSfx(ev: BattleEvent): string {
  switch (ev.t) {
    case 'miss':
      return 'miss';
    case 'faint':
      return 'faint';
    case 'heal':
      return 'heal';
    case 'status':
      return 'status';
    case 'stage':
      return ev.delta > 0 ? 'stat_up' : 'stat_down';
    case 'levelup':
      return 'levelup';
    case 'learn':
      return 'confirm';
    case 'damage': {
      if (ev.effectiveness === 0) return 'immune';
      const frac = ev.maxHp > 0 ? ev.amount / ev.maxHp : 0;
      const impact = ev.critical ? 'hit_crit' : frac < 0.08 ? 'hit_weak' : frac < 0.32 ? 'hit' : 'hit_hard';
      const tag = ev.effectiveness > 1 ? ' super' : ev.effectiveness < 1 ? ' resist' : '';
      return impact + tag;
    }
    default:
      return '';
  }
}

/**
 * Move one side's drawn state on by one event. Called at the moment the event
 * is TOLD, never before - that timing is the whole point of `shown`.
 */
function showEvent(scene: BattleScene, ev: BattleEvent): void {
  switch (ev.t) {
    case 'damage':
    case 'heal':
      scene.shown[ev.side].hp = ev.hpAfter;
      return;
    case 'status':
      scene.shown[ev.side].status = ev.status;
      return;
    case 'faint':
      scene.shown[ev.side].gone = true;
      return;
    case 'switch':
      // A blink still running belongs to the animal that just left. Without
      // this the newcomer flickered on arrival as though it had been hit.
      if (scene.flashSide === ev.side) scene.flash = 0;
      scene.shown[ev.side] = {
        index: ev.index,
        species: ev.species,
        name: ev.name,
        level: ev.level,
        hp: ev.hp,
        maxHp: ev.maxHp,
        status: ev.status,
        gone: false,
      };
      return;
    case 'levelup': {
      // Everyone who fought gains, but only the one on the field is on screen.
      const mine = scene.shown.player;
      if (ev.index !== mine.index) return;
      mine.level = ev.level;
      mine.hp = ev.hp;
      mine.maxHp = ev.maxHp;
      return;
    }
    default:
      return;
  }
}

/**
 * Advance the fight to its next message, or to a snare throw, or to the end of
 * what there is to tell.
 *
 * Events that carry no words (a status landing, experience, the outcome) do not
 * get a beat of their own: they are applied on the way to the next message, so
 * whatever they change on screen changes ON the frame its explanation appears.
 * They used to take a timed beat each, which put a status tag in the box a
 * tenth of a second before the sentence saying why.
 */
function tellNext(content: Content, state: GameState, scene: BattleScene, rng: Rng): void {
  for (;;) {
    const ev = scene.queue.shift();
    if (ev === undefined) {
      afterEvents(content, state, scene, rng);
      return;
    }

    // `shake` carries no words - it IS the animation. Launching it here rather
    // than narrating it keeps the wobble count and the picture in step.
    if (ev.t === 'shake') {
      scene.snare = { frames: 0, shakes: ev.count, caught: ev.count >= 4 };
      state.lastText = 'You sling a snare.';
      return;
    }

    const msg = battleMessage(scene, ev);
    showEvent(scene, ev);
    // A trainer's next animal counts as met when it walks on, not before.
    if (ev.t === 'switch' && ev.side === 'enemy') markSeen(state.player, ev.species);
    if (msg === null) continue;

    // The one who got hit is the one who flinches, and only for a real hit -
    // an immune "Nothing. Wrong animal." should look like nothing happened.
    if (ev.t === 'damage' && ev.amount > 0) {
      scene.flash = FLASH_FRAMES;
      scene.flashSide = ev.side;
    }
    const sound = battleSfx(ev);
    if (sound !== '') {
      scene.sfx = sound;
      scene.sfxSeq++;
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
}

/**
 * Say no to something, in words, on screen.
 *
 * Every refusal - no power left in a move, a snare thrown at a trainer's
 * animal, a poultice for something already whole - used to be written to
 * `lastText` while a menu was covering the text box, so the button simply did
 * nothing and the game's answer was never seen by anyone.
 */
function refuse(content: Content, state: GameState, scene: BattleScene, text: string, rng: Rng): void {
  pushEvents(scene, [{ t: 'text', text }]);
  tellNext(content, state, scene, rng);
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

  // The transition owns the screen until it finishes, and the opening line is
  // up on the very frame it clears.
  if (scene.intro > 0) {
    scene.intro--;
    if (scene.intro === 0) tellNext(content, state, scene, rng);
    return;
  }

  // So does a snare. No input, no drain, no bars moving: the throw is the only
  // thing happening until it has finished being wrong or right.
  if (scene.snare !== null) {
    scene.snare.frames++;
    if (scene.snare.frames < snareLength(scene.snare)) return;
    scene.snare = null;
    tellNext(content, state, scene, rng);
    return;
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

  // A short beat between one message and the next, so a dismissed box is seen
  // to go before its successor arrives.
  if (scene.queue.length > 0) {
    scene.ticks++;
    if (scene.ticks < EVENT_FRAMES) return;
    scene.ticks = 0;
    tellNext(content, state, scene, rng);
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
    handlePartyMenu(content, state, scene, b, rng, (idx) => {
      const target = battle.player.party[idx];
      if (!target || target.hp <= 0) return false;
      pushEvents(scene, forceSwitch(content.dex, battle, 'player', idx));
      scene.sub = 'main';
      tellNext(content, state, scene, rng);
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
        refuse(content, state, scene, 'No power left in that one.', rng);
        return;
      }
      submitAction(content, state, scene, { kind: 'move', slot: scene.moveCursor }, rng);
      return;
    }
    case 'party': {
      handlePartyMenu(content, state, scene, b, rng, (idx) => {
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
  content: Content,
  state: GameState,
  scene: BattleScene,
  b: Buttons,
  rng: Rng,
  confirm: (index: number) => boolean,
): void {
  const party = scene.battle.player.party;
  if (pressed(state, b, 'down')) scene.partyCursor = (scene.partyCursor + 1) % Math.max(1, party.length);
  if (pressed(state, b, 'up')) scene.partyCursor = (scene.partyCursor + party.length - 1) % Math.max(1, party.length);
  if (pressed(state, b, 'b') && scene.sub !== 'forceSwitch') { scene.sub = 'main'; return; }
  if (!pressed(state, b, 'a')) return;
  if (!confirm(scene.partyCursor)) refuse(content, state, scene, 'Not that one.', rng);
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

  if (isSnare(item)) {
    if (scene.battle.kind === 'trainer') {
      refuse(content, state, scene, "That would be theft, and they're watching.", rng);
      return;
    }
    // Six on the lead and thirty in the box: there is nowhere for it to go,
    // and the game says so before the snare is spent rather than after.
    if (p.party.length >= 6 && p.box.length >= BOX_MAX) {
      refuse(content, state, scene, content.dialogue('box_full')[0] ?? 'The box is full.', rng);
      return;
    }
    stack.count--;
    const bonus = item === 'great_snare' ? 3 : item === 'good_snare' ? 2 : 1;
    submitAction(content, state, scene, { kind: 'ball', bonus }, rng);
    return;
  }

  if (isPoultice(item)) {
    const target = activeOf(scene.battle.player);
    const sp = content.dex.species(target.species);
    const max = maxHp(sp, target);
    if (target.hp >= max) {
      refuse(content, state, scene, 'It is already fine. Better than you.', rng);
      return;
    }
    stack.count--;
    const before = target.hp;
    target.hp = Math.min(max, target.hp + poulticeHeal(item));
    // The amount actually restored. This used to say 40 whatever happened, so a
    // strong poultice, or one that only topped up the last few points, lied.
    scene.queue.push({ t: 'heal', side: 'player', amount: target.hp - before, hpAfter: target.hp });
    submitAction(content, state, scene, { kind: 'item', item }, rng);
    return;
  }

  refuse(content, state, scene, 'Not now.', rng);
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
  // The first message goes up on the same frame as the press. Waiting a beat
  // here left the PREVIOUS turn's last line back on screen for a tenth of a
  // second every turn, since the box had nothing newer to show.
  tellNext(content, state, scene, rng);
}

function afterEvents(content: Content, state: GameState, scene: BattleScene, rng: Rng): void {
  // Everything has been narrated, so what is drawn can catch up to the truth.
  // By now the two should already agree; this covers anything with no event of
  // its own, such as a status wearing off.
  scene.shown.player = showSide(content, scene.battle.player);
  scene.shown.enemy = showSide(content, scene.battle.enemy);
  if (scene.battle.outcome !== 'ongoing') endBattle(content, state, scene, rng);
}

function endBattle(content: Content, state: GameState, scene: BattleScene, rng: Rng): void {
  const p = state.player;
  const outcome = scene.battle.outcome;

  let caughtAt: { where: 'party' | 'box'; index: number } | null = null;
  if (outcome === 'caught' && scene.battle.caught) {
    const caught = scene.battle.caught;
    caught.originalTrainer = p.name;
    markCaught(p, caught.species);
    if (p.party.length < 6) {
      p.party.push(caught);
      caughtAt = { where: 'party', index: p.party.length - 1 };
    } else {
      p.box.push(caught);
      caughtAt = { where: 'box', index: p.box.length - 1 };
    }
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
  if (caughtAt !== null) {
    // A seventh animal does not vanish: say where it went, after the naming.
    if (caughtAt.where === 'box') lines.push('No room on the lead. It goes to the kennel box at the lodge.');
    state.scene = {
      kind: 'naming', where: caughtAt.where, index: caughtAt.index,
      asking: true, choice: 0, text: '', row: 0, col: 0, lower: false,
      back: 'overworld', after: lines,
    };
    return;
  }
  if (lines.length > 0) sayRaw(state, lines);
  else enterOverworld(state);
}

// --- Pause menu ------------------------------------------------------------

const MENU_ROOT = ['PARTY', 'BAG', 'DEX', 'SAVE', 'BACK'] as const;

function openMenu(sub: MenuScene['sub'], cursor: number, subCursor: number): MenuScene {
  return { kind: 'menu', cursor, sub, subCursor, act: -1, moving: -1, using: '', note: '', entry: false };
}

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
    scene.act = -1;
    scene.moving = -1;
    scene.using = '';
    scene.note = '';
    scene.entry = false;
    return;
  }

  if (scene.sub === 'party') {
    stepMenuParty(content, state, scene, b);
    return;
  }

  if (scene.sub === 'dex') {
    // One animal's page is open: any of A or B closes it.
    if (scene.entry) {
      if (pressed(state, b, 'a') || pressed(state, b, 'b')) scene.entry = false;
      return;
    }
    const n = content.speciesIds.length;
    if (pressed(state, b, 'b')) { scene.sub = 'root'; return; }
    if (n === 0) return;
    if (pressed(state, b, 'down')) scene.subCursor = (scene.subCursor + 1) % n;
    if (pressed(state, b, 'up')) scene.subCursor = (scene.subCursor + n - 1) % n;
    // A hundred and fifty-three rows is a long way to walk one at a time.
    if (pressed(state, b, 'right')) scene.subCursor = Math.min(n - 1, scene.subCursor + DEX_ROWS);
    if (pressed(state, b, 'left')) scene.subCursor = Math.max(0, scene.subCursor - DEX_ROWS);
    if (pressed(state, b, 'a')) {
      const id = content.speciesIds[scene.subCursor];
      // An animal never met has no page: its row is a number and a blank.
      if (id !== undefined && state.player.seen.includes(id)) scene.entry = true;
    }
    return;
  }

  const len = state.player.bag.length;
  if (pressed(state, b, 'down') && len > 0) { scene.subCursor = (scene.subCursor + 1) % len; scene.note = ''; }
  if (pressed(state, b, 'up') && len > 0) { scene.subCursor = (scene.subCursor + len - 1) % len; scene.note = ''; }
  if (pressed(state, b, 'b')) { scene.sub = 'root'; scene.note = ''; return; }

  if (pressed(state, b, 'a') && scene.sub === 'bag') {
    const stack = state.player.bag[scene.subCursor];
    if (!stack || stack.count <= 0) return;
    if (!isPoultice(stack.item)) {
      // A snare has nothing to be thrown at out here. Say so: this press used
      // to do nothing at all, which reads as the game having hung.
      scene.note = 'No use out here.';
      return;
    }
    if (state.player.party.length === 0) return;
    // Pick who gets it. It used to go to whoever was first in the party,
    // silently, whether or not they were the one who was hurt.
    scene.sub = 'party';
    scene.subCursor = 0;
    scene.using = stack.item;
    scene.note = '';
  }
}

/**
 * The party list out of battle: look, reorder, rename, or - arriving from the
 * bag with a poultice in hand - choose who gets it.
 */
function stepMenuParty(content: Content, state: GameState, scene: MenuScene, b: Buttons): void {
  const p = state.player;
  const party = p.party;
  const len = party.length;

  // The row of actions for the animal under the cursor.
  if (scene.act >= 0) {
    const n = PARTY_ACTIONS.length;
    if (pressed(state, b, 'right') || pressed(state, b, 'down')) scene.act = (scene.act + 1) % n;
    if (pressed(state, b, 'left') || pressed(state, b, 'up')) scene.act = (scene.act + n - 1) % n;
    if (pressed(state, b, 'b')) { scene.act = -1; return; }
    if (!pressed(state, b, 'a')) return;
    const action = PARTY_ACTIONS[scene.act];
    scene.act = -1;
    if (action === 'MOVE') {
      scene.moving = scene.subCursor;
    } else if (action === 'NAME') {
      state.scene = {
        kind: 'naming', where: 'party', index: scene.subCursor,
        asking: false, choice: 0, text: '', row: 0, col: 0, lower: false,
        back: 'party', after: [],
      };
    }
    return;
  }

  if (pressed(state, b, 'down') && len > 0) { scene.subCursor = (scene.subCursor + 1) % len; scene.note = ''; }
  if (pressed(state, b, 'up') && len > 0) { scene.subCursor = (scene.subCursor + len - 1) % len; scene.note = ''; }

  if (pressed(state, b, 'b')) {
    scene.note = '';
    if (scene.moving >= 0) { scene.moving = -1; return; }
    if (scene.using !== '') {
      // Back to the bag, on the thing that was being used.
      const at = p.bag.findIndex((s) => s.item === scene.using);
      scene.using = '';
      scene.sub = 'bag';
      scene.subCursor = Math.max(0, at);
      return;
    }
    scene.sub = 'root';
    return;
  }
  if (!pressed(state, b, 'a')) return;
  const target = party[scene.subCursor];
  if (!target) return;

  if (scene.using !== '') {
    const stack = p.bag.find((s) => s.item === scene.using);
    if (!stack || stack.count <= 0) { scene.using = ''; scene.sub = 'bag'; scene.subCursor = 0; return; }
    const max = maxHp(content.dex.species(target.species), target);
    if (target.hp <= 0) { scene.note = 'Out cold. Lodge.'; return; }
    if (target.hp >= max) { scene.note = 'Nothing to mend.'; return; }
    const before = target.hp;
    target.hp = Math.min(max, target.hp + poulticeHeal(stack.item));
    stack.count--;
    scene.note = `Mended ${target.hp - before}.`;
    return;
  }

  if (scene.moving >= 0) {
    const from = scene.moving;
    const to = scene.subCursor;
    const a = party[from];
    if (a && from !== to) {
      party[from] = target;
      party[to] = a;
    }
    scene.moving = -1;
    return;
  }

  scene.act = 0;
  scene.note = '';
}

// --- Naming ----------------------------------------------------------------

function namingTarget(p: PlayerState, scene: NamingScene): Feral | undefined {
  return scene.where === 'party' ? p.party[scene.index] : p.box[scene.index];
}

function stepNaming(content: Content, state: GameState, scene: NamingScene, b: Buttons): void {
  const p = state.player;
  const target = namingTarget(p, scene);

  const finish = (): void => {
    if (scene.after.length > 0) { sayRaw(state, scene.after); return; }
    if (scene.back === 'party') {
      state.scene = openMenu('party', 0, Math.min(scene.index, Math.max(0, p.party.length - 1)));
      return;
    }
    enterOverworld(state);
  };
  const commit = (): void => {
    if (target) {
      const typed = scene.text.trim();
      target.nickname = typed === '' ? content.dex.species(target.species).name : typed;
    }
    finish();
  };

  if (!target) { finish(); return; }

  if (scene.asking) {
    if (pressed(state, b, 'down') || pressed(state, b, 'up')) scene.choice = 1 - scene.choice;
    if (pressed(state, b, 'b')) { finish(); return; }
    if (!pressed(state, b, 'a')) return;
    if (scene.choice === 0) scene.asking = false;
    else finish();
    return;
  }

  const erase = (): void => { scene.text = scene.text.slice(0, -1); };
  const type = (ch: string): void => {
    if (scene.text.length >= NAME_MAX) return;
    scene.text += ch;
    // Full: put the cursor on END, where the next press belongs.
    if (scene.text.length >= NAME_MAX) { scene.row = 3; scene.col = 3; }
  };

  if (pressed(state, b, 'start')) { commit(); return; }
  if (pressed(state, b, 'b')) { erase(); return; }

  const width = scene.row === 3 ? NAME_KEYS.length : 9;
  if (pressed(state, b, 'right')) scene.col = (scene.col + 1) % width;
  if (pressed(state, b, 'left')) scene.col = (scene.col + width - 1) % width;
  const vertical = pressed(state, b, 'down') ? 1 : pressed(state, b, 'up') ? -1 : 0;
  if (vertical !== 0) {
    const next = (scene.row + vertical + 4) % 4;
    // The keys are wider than the letters, so a column has to be translated
    // on the way in and out of that row rather than carried across.
    if (next === 3 && scene.row !== 3) scene.col = Math.min(NAME_KEYS.length - 1, Math.floor((scene.col * NAME_KEYS.length) / 9));
    else if (scene.row === 3 && next !== 3) scene.col = scene.col * 2 + 1;
    scene.row = next;
  }

  if (!pressed(state, b, 'a')) return;
  if (scene.row < 3) {
    const ch = (NAME_ROWS[scene.row] ?? '')[scene.col] ?? '';
    if (ch !== '') type(scene.lower ? ch.toLowerCase() : ch);
    return;
  }
  const key = NAME_KEYS[scene.col];
  if (key === 'case') scene.lower = !scene.lower;
  else if (key === 'SPC') { if (scene.text.length > 0) type(' '); }
  else if (key === 'DEL') erase();
  else commit();
}

// --- The kennel box --------------------------------------------------------

/** The first row of the list that is on screen, so the cursor is always in view. */
export function boxScroll(cursor: number, length: number): number {
  return Math.max(0, Math.min(cursor - 3, length - BOX_ROWS));
}

function stepBox(content: Content, state: GameState, scene: BoxScene, b: Buttons): void {
  const p = state.player;
  const list = scene.side === 'party' ? p.party : p.box;

  if (pressed(state, b, 'b')) {
    const lines = content.dialogue('kennel_leave');
    sayRaw(state, lines.length > 0 ? lines : ['...']);
    return;
  }
  if (pressed(state, b, 'left') || pressed(state, b, 'right')) {
    scene.side = scene.side === 'party' ? 'box' : 'party';
    scene.cursor = 0;
    scene.note = '';
    return;
  }
  if (list.length > 0) {
    if (pressed(state, b, 'down')) { scene.cursor = (scene.cursor + 1) % list.length; scene.note = ''; }
    if (pressed(state, b, 'up')) { scene.cursor = (scene.cursor + list.length - 1) % list.length; scene.note = ''; }
  }
  if (!pressed(state, b, 'a')) return;
  const chosen = list[scene.cursor];
  if (!chosen) return;

  if (scene.side === 'party') {
    // Someone has to walk out of here with you, and on its own feet.
    const others = p.party.filter((f) => f !== chosen);
    if (!others.some((f) => f.hp > 0)) { scene.note = 'Keep one walking.'; return; }
    if (p.box.length >= BOX_MAX) { scene.note = 'The box is full.'; return; }
    p.party.splice(scene.cursor, 1);
    p.box.push(chosen);
    scene.note = 'Left in the box.';
  } else {
    if (p.party.length >= 6) { scene.note = 'Six is the limit.'; return; }
    p.box.splice(scene.cursor, 1);
    p.party.push(chosen);
    scene.note = 'Back on the lead.';
  }
  scene.cursor = Math.max(0, Math.min(scene.cursor, list.length - 1));
}

// --- Shop ------------------------------------------------------------------

/** How many of `item` the player is carrying. */
export function bagCount(p: PlayerState, item: string): number {
  return p.bag.find((s) => s.item === item)?.count ?? 0;
}

function addToBag(p: PlayerState, item: string, count: number): void {
  const stack = p.bag.find((s) => s.item === item);
  if (stack) stack.count = Math.min(STACK_MAX, stack.count + count);
  else p.bag.push({ item, count: Math.min(STACK_MAX, count) });
}

/**
 * The most of one thing this player could buy right now: what the purse covers,
 * and what the bag has room for. Zero means A will be refused.
 */
export function shopLimit(p: PlayerState, item: string, price: number): number {
  const afford = price > 0 ? Math.floor(p.money / price) : STACK_MAX;
  return Math.max(0, Math.min(afford, STACK_MAX - bagCount(p, item)));
}

function stepShop(content: Content, state: GameState, scene: ShopScene, b: Buttons): void {
  const p = state.player;
  const stock = shopStock(p.badges.length);
  const rows = stock.length + 1;

  const leave = (): void => {
    const lines = scene.bought
      ? [...content.dialogue('shop_buy'), ...content.dialogue('shop_leave')]
      : content.dialogue('shop_leave');
    sayRaw(state, lines.length > 0 ? lines : ['...']);
  };

  if (pressed(state, b, 'b')) { leave(); return; }

  if (pressed(state, b, 'down') || pressed(state, b, 'up')) {
    scene.cursor = (scene.cursor + (pressed(state, b, 'down') ? 1 : rows - 1)) % rows;
    scene.qty = 1;
    scene.note = '';
    return;
  }

  const item = stock[scene.cursor];
  if (item === undefined) {
    if (pressed(state, b, 'a')) leave();
    return;
  }

  // Left and right count, and wrap, so ten of something is one press from one
  // of something in either direction. The ceiling is what can actually be
  // bought, so the total shown is never a number the purse cannot meet.
  const limit = Math.max(1, shopLimit(p, item.id, item.price));
  if (pressed(state, b, 'right')) { scene.qty = scene.qty >= limit ? 1 : scene.qty + 1; scene.note = ''; }
  if (pressed(state, b, 'left')) { scene.qty = scene.qty <= 1 ? limit : scene.qty - 1; scene.note = ''; }

  if (!pressed(state, b, 'a')) return;
  if (bagCount(p, item.id) >= STACK_MAX) {
    scene.note = 'No room for more.';
    return;
  }
  const cost = item.price * scene.qty;
  if (cost > p.money) {
    scene.note = "You can't pay that.";
    return;
  }
  p.money -= cost;
  addToBag(p, item.id, scene.qty);
  scene.bought = true;
  scene.note = scene.qty === 1 ? 'Sold.' : `Sold. All ${scene.qty}.`;
  scene.qty = 1;
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
