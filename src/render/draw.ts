/**
 * `draw(ctx, content, state)` — the entire renderer, dispatching on
 * `state.scene.kind`. Reads state and content, draws, mutates neither. No
 * game rule lives here; every number that reads as a rule (HP thresholds,
 * catch odds, damage) is asked of `src/core`, never recomputed.
 *
 * Two small, deliberate exceptions to "pure function of state", both purely
 * cosmetic and both documented at their call site: the location banner needs
 * to know *when* the map changed (edge-detected across frames, since
 * `GameState` has no "just arrived" flag), and the starter-picker cursor is
 * UI-only state game.ts explicitly delegates to the shell (see its
 * `runPending`/`starterPick` comment) — `main.ts` owns it and passes it in.
 */

import type { Content, GameState, BattleScene, BoxScene, MenuScene, NamingScene, ShopScene, ShownSide } from '../core/game.ts';
import { paginate, pageLength, CREATURE_NAME_COLS, MOVE_NAME_COLS } from '../core/text.ts';
import {
  STARTERS, WALK_FRAMES, starterChoices, BATTLE_INTRO_FRAMES, HALL_HOLD_TICKS,
  SNARE_THROW_FRAMES, SNARE_PULL_FRAMES, SNARE_WOBBLE_FRAMES, FLASH_FRAMES,
  bagCount, boxScroll, BOX_MAX, BOX_ROWS, DEX_ROWS, NAME_KEYS, NAME_MAX, NAME_ROWS, PARTY_ACTIONS,
  MENU_ROOT, type SnareThrow,
} from '../core/game.ts';
import { TYPES, effectiveness, effectTag, kindSheet, type FeralType } from '../core/types.ts';
import { itemName, shopStock } from '../core/items.ts';
import { activeOf } from '../core/battle.ts';
import type { BattleState } from '../core/battle.ts';
import { Tile, tileAt, visibleNpcs, type GameMap, type Dir } from '../core/world.ts';
import { maxHp } from '../core/creature.ts';
import type { Feral, StatusName } from '../core/creature.ts';
import { spriteFor, SPRITE_SIZE, type Pixels, type SpriteView } from './forge.ts';
import * as gb from './gb.ts';
import { LOGICAL_W, LOGICAL_H, TILE_SIZE, shadeColor } from './gb.ts';

// ---------------------------------------------------------------------------
// Creature sprite cache — forged once per species id, reused forever after.
// ---------------------------------------------------------------------------

const creaturePixelsCache = new Map<string, Pixels>();

function creaturePixels(content: Content, speciesId: string, view: SpriteView = 'front'): Pixels {
  // The view MUST be part of the cache key, or the first sprite drawn for a
  // species is reused for both orientations and the player's creature faces the
  // wrong way for the rest of the session.
  const key = `${speciesId}:${view}`;
  const cached = creaturePixelsCache.get(key);
  if (cached) return cached;
  const sp = content.dex.species(speciesId);
  const px = spriteFor(sp.id, sp.family, sp.stage, sp.spriteSeed, sp.legendary ?? false, view);
  creaturePixelsCache.set(key, px);
  return px;
}

function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shade: gb.Shade,
): void {
  // Row by row, in whole pixels. The canvas's own `ellipse()` anti-aliases its
  // edge, which put a ring of in-between greens round every platform - colours
  // a Game Boy does not have. `gauntlet:visual` counts off-palette pixels and
  // found about a hundred of them on every battle screen.
  ctx.fillStyle = shadeColor(shade);
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    if (half > 0) ctx.fillRect(x0 - half, y0 + dy, half * 2, 1);
  }
}

function clearScreen(ctx: CanvasRenderingContext2D, shade: gb.Shade = 0): void {
  ctx.fillStyle = shadeColor(shade);
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
}

const STATUS_TAG: Readonly<Record<StatusName, string>> = {
  burn: 'BRN', chill: 'CHL', venom: 'PSN', panic: 'CNF', sleep: 'SLP', stun: 'PAR',
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function drawTitle(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  clearScreen(ctx, 1);
  const px = creaturePixels(content, 'winter_pup');
  gb.drawSprite(ctx, px, LOGICAL_W / 2 - SPRITE_SIZE / 2, 18, 1);

  const title1 = 'FERALS OF';
  const title2 = 'FENMARK';
  gb.drawText(ctx, (LOGICAL_W - gb.measureText(title1)) / 2, 82, title1, 3);
  gb.drawText(ctx, (LOGICAL_W - gb.measureText(title2)) / 2, 92, title2, 3);

  if (Math.floor(state.frame / 30) % 2 === 0) {
    const prompt = 'PRESS START';
    gb.drawText(ctx, (LOGICAL_W - gb.measureText(prompt)) / 2, 122, prompt, 3);
  }
}

// ---------------------------------------------------------------------------
// Overworld — camera, tiles, actors
// ---------------------------------------------------------------------------

interface Camera {
  readonly originX: number;
  readonly originY: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Centers on the player, then clamps to the map's edges so a room smaller
 * than the screen (or a player standing by a door) never scrolls out into
 * void — exactly like Gen 1's camera, which never shows past the map edge.
 * Returns the *clamped* origin plus the player's true (pre-clamp) world
 * pixel position, since near an edge the two diverge and the player sprite
 * has to be drawn off-center to match.
 */
/**
 * Camera and player position, in WHOLE PIXELS.
 *
 * The player pixel is rounded FIRST and the camera is derived from the rounded
 * value, so the two can never disagree. Rounding them independently (which is
 * what this used to do) left the player drifting up to a pixel against the tile
 * grid and back again on alternate frames - a shimmer that reads as the sprite
 * wobbling while the world stands still.
 *
 * `progress` may be fractional: the shell adds the leftover accumulator so
 * motion is smooth even on a frame where the fixed-timestep loop ran no
 * simulation tick at all.
 */
function cameraFor(
  map: GameMap,
  x: number, y: number, fromX: number, fromY: number, progress: number, span: number,
): Camera & { playerPxX: number; playerPxY: number } {
  // Standing still, she is drawn where she IS. Interpolating to t=0 instead
  // drew her at `from`, and after a doorway `from` is a tile on the map she
  // just left - so she appeared somewhere else entirely until her first step.
  const t = progress > 0 ? Math.min(1, progress / span) : 1;
  const playerPxX = Math.round(lerp(fromX, x, t) * TILE_SIZE);
  const playerPxY = Math.round(lerp(fromY, y, t) * TILE_SIZE);
  const rawX = Math.round(LOGICAL_W / 2 - TILE_SIZE / 2) - playerPxX;
  const rawY = Math.round(LOGICAL_H / 2 - TILE_SIZE / 2) - playerPxY;
  const mapPxW = map.width * TILE_SIZE;
  const mapPxH = map.height * TILE_SIZE;
  const originX = Math.round(
    mapPxW <= LOGICAL_W ? (LOGICAL_W - mapPxW) / 2 : Math.min(0, Math.max(LOGICAL_W - mapPxW, rawX)),
  );
  const originY = Math.round(
    mapPxH <= LOGICAL_H ? (LOGICAL_H - mapPxH) / 2 : Math.min(0, Math.max(LOGICAL_H - mapPxH, rawY)),
  );
  return { originX, originY, playerPxX, playerPxY };
}

const ANIM_TICKS = 20;

/** Which sides of the water tile at (tx,ty) are land - see gb.SHORE. */
function shoreOf(map: GameMap, tx: number, ty: number): number {
  const land = (x: number, y: number): boolean => tileAt(map, x, y) !== Tile.Water;
  return (land(tx, ty - 1) ? gb.SHORE.N : 0) | (land(tx + 1, ty) ? gb.SHORE.E : 0)
    | (land(tx, ty + 1) ? gb.SHORE.S : 0) | (land(tx - 1, ty) ? gb.SHORE.W : 0);
}

function drawTiles(ctx: CanvasRenderingContext2D, map: GameMap, cam: Camera, frame: number): void {
  const animFrame = Math.floor(frame / ANIM_TICKS);
  const startTx = Math.floor(-cam.originX / TILE_SIZE) - 1;
  const endTx = startTx + Math.ceil(LOGICAL_W / TILE_SIZE) + 2;
  const startTy = Math.floor(-cam.originY / TILE_SIZE) - 1;
  const endTy = startTy + Math.ceil(LOGICAL_H / TILE_SIZE) + 2;
  for (let ty = startTy; ty <= endTy; ty++) {
    for (let tx = startTx; tx <= endTx; tx++) {
      const id = tileAt(map, tx, ty);
      // A house tile with another house directly above it is WALL; the top
      // course of the building carries the roof. Without this every tile drew
      // its own little roof and a frontage became texture instead of a wall.
      const variant =
        id === Tile.House ? (tileAt(map, tx, ty - 1) === Tile.House ? 1 : 0)
          : id === Tile.Water ? shoreOf(map, tx, ty)
            : 0;
      // Every tile of a kind is on the same beat, on purpose: the screen gate
      // finds an undrawn person by comparing her square with a bare square of
      // the same ground, and that only works while the two are identical.
      gb.drawTile(ctx, id, animFrame, cam.originX + tx * TILE_SIZE, cam.originY + ty * TILE_SIZE, variant);
    }
  }
}

// --- Life ---------------------------------------------------------------------
//
// Nothing below is game state. It is all worked out from the frame counter and
// from where the player was drawn, so the reducer, the save file and the
// playthrough bot have never heard of any of it.

function hashText(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const DIRS: readonly Dir[] = ['down', 'left', 'right', 'up'];

/**
 * Which way somebody with nothing to do is looking. Most of the time, the way
 * they were put; now and then, for a second, somewhere else. Only for people
 * who are just standing about - a trainer's facing is a sightline and a
 * shopkeeper's is a counter, and neither is free to wander.
 */
function idleFacing(id: string, kind: string, facing: Dir, frame: number): Dir {
  if (kind !== 'talker') return facing;
  const h = hashText(id);
  const beat = Math.floor((frame + (h % 420)) / 60) % 7;
  if (beat !== 5) return facing;
  const other = DIRS[(h >>> 9) % DIRS.length] ?? facing;
  return other === facing ? (DIRS[((h >>> 9) + 1) % DIRS.length] ?? facing) : other;
}

/** Where the grass was last stepped into, and when. */
let rustleX = -1;
let rustleY = -1;
let rustleFrom = -1000;
let rustleMap = '';
let feetX = -1;
let feetY = -1;

const RUSTLE_TICKS = 15;

/** The grass round the player's feet: parted where she just stepped, and in front of her legs. */
function drawGrassRoundFeet(
  ctx: CanvasRenderingContext2D, map: GameMap, cam: Camera, frame: number, px: number, py: number,
): void {
  // The tile her feet are on, from where she was DRAWN - half way through a
  // step she is between two tiles and the nearer one is the one she is in.
  const tx = Math.floor((px + TILE_SIZE / 2) / TILE_SIZE);
  const ty = Math.floor((py + TILE_SIZE / 2) / TILE_SIZE);
  const inGrass = tileAt(map, tx, ty) === Tile.TallGrass;
  if (tx !== feetX || ty !== feetY || map.id !== rustleMap) {
    // Arriving on a map is not stepping into grass, even if that is where the door is.
    const stepped = map.id === rustleMap && feetX >= 0;
    feetX = tx;
    feetY = ty;
    rustleMap = map.id;
    if (inGrass && stepped) {
      rustleX = tx;
      rustleY = ty;
      rustleFrom = frame;
    }
  }
  if (inGrass) {
    gb.drawGrassFront(ctx, Math.floor(frame / ANIM_TICKS), cam.originX + px, cam.originY + py);
  }
  const age = frame - rustleFrom;
  if (age >= 0 && age < RUSTLE_TICKS && tileAt(map, rustleX, rustleY) === Tile.TallGrass) {
    gb.drawGrassRustle(ctx, age, cam.originX + rustleX * TILE_SIZE, cam.originY + rustleY * TILE_SIZE);
  }
}

const airCache = new Map<string, 'flowers' | 'snow' | 'none'>();

function airOf(map: GameMap): 'flowers' | 'snow' | 'none' {
  const known = airCache.get(map.id);
  if (known !== undefined) return known;
  const air = map.indoor ? 'none'
    : map.tiles.includes(Tile.Snow) ? 'snow'
      : map.tiles.includes(Tile.Flower) ? 'flowers'
        : 'none';
  airCache.set(map.id, air);
  return air;
}

/** What is in the air: butterflies where there are flowers, snow where there is snow. */
function drawAir(ctx: CanvasRenderingContext2D, map: GameMap, cam: Camera, frame: number): void {
  const air = airOf(map);
  if (air === 'flowers') {
    const seed = hashText(map.id);
    for (let i = 0; i < 3; i++) {
      // Each one loops round a home of its own, on two speeds that never
      // quite line up, so it wanders rather than orbits.
      const hx = ((seed >>> (i * 5)) % (map.width - 4) + 2) * TILE_SIZE;
      const hy = ((seed >>> (i * 5 + 3)) % (map.height - 4) + 2) * TILE_SIZE;
      const t = frame + i * 211;
      const x = hx + Math.round(Math.sin(t / 47) * 26 + Math.sin(t / 13) * 5);
      const y = hy + Math.round(Math.cos(t / 61) * 18 + Math.sin(t / 9) * 3);
      gb.drawButterfly(ctx, Math.floor(t / 6) % 2 === 0, cam.originX + x, cam.originY + y);
    }
  } else if (air === 'snow') {
    // Fixed to the screen, not the map: snow falls where you are looking.
    for (let i = 0; i < 26; i++) {
      const h = hashText(`flake${i}`);
      const near = i % 3 === 0;
      const speed = near ? 0.9 : 0.5;
      const x = ((h % LOGICAL_W) + Math.round(Math.sin((frame + h) / 40) * 6) + LOGICAL_W) % LOGICAL_W;
      const y = Math.floor(((h >>> 8) % LOGICAL_H) + frame * speed) % LOGICAL_H;
      gb.drawSnowflake(ctx, near, x, y);
    }
  }
}

/** Walk-cycle frame + which leg leads, derived from WalkState without new core fields. */
function walkPose(progress: number, fromX: number, fromY: number): { frame: number; step: -1 | 0 | 1 } {
  if (progress <= 0) return { frame: 0, step: 0 };
  const parity = ((fromX + fromY) % 2 + 2) % 2;
  return { frame: 1, step: parity === 0 ? 1 : -1 };
}

/**
 * Draws the map, NPCs and the player. `walk` is null for the (rare) idle
 * frame drawn behind a dialogue box, where nobody is mid-step.
 */
function drawWorldBackground(
  ctx: CanvasRenderingContext2D,
  content: Content,
  state: GameState,
  walk: { progress: number; span: number; dir: Dir; fromX: number; fromY: number } | null,
): void {
  const p = state.player;
  const map = content.world.map(p.mapId);
  // Mid-step, advance by the sub-frame remainder so motion does not stall on a
  // frame that ran no tick. Standing still stays exactly still.
  const rawProgress = walk?.progress ?? 0;
  const progress = rawProgress > 0 ? rawProgress + frameAlpha : 0;
  const fromX = walk?.fromX ?? p.x;
  const fromY = walk?.fromY ?? p.y;
  const cam = cameraFor(map, p.x, p.y, fromX, fromY, progress, walk?.span ?? WALK_FRAMES);

  clearScreen(ctx, map.indoor ? 0 : 1);
  drawTiles(ctx, map, cam, state.frame);

  const flags = new Set(p.flags);
  for (const npc of visibleNpcs(map, flags)) {
    const sx = cam.originX + npc.x * TILE_SIZE;
    const sy = cam.originY + npc.y * TILE_SIZE;
    if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > LOGICAL_W || sy > LOGICAL_H) continue;
    if (npc.kind === 'beast' && npc.species !== undefined) {
      // Not a person: the animal itself, small, and breathing.
      const bob = Math.floor(state.frame / 30) % 2;
      gb.drawSprite(ctx, creaturePixels(content, npc.species), sx - 3, sy - 7 + bob, 0.4);
      continue;
    }
    gb.drawActor(ctx, lookIdFor(npc), idleFacing(npc.id, npc.kind, npc.facing, state.frame), 0, 0, sx, sy);
  }

  const pose = walkPose(progress, fromX, fromY);
  const dir = progress > 0 ? (walk?.dir ?? p.facing) : p.facing;
  // Both terms are already whole pixels - see cameraFor.
  const playerSx = cam.originX + cam.playerPxX;
  const playerSy = cam.originY + cam.playerPxY;
  lastDrawnX = playerSx;
  lastDrawnY = playerSy;
  lastCamX = cam.originX;
  lastCamY = cam.originY;
  gb.drawActor(ctx, 'player', dir, pose.frame, pose.step, playerSx, playerSy);
  drawGrassRoundFeet(ctx, map, cam, state.frame, cam.playerPxX, cam.playerPxY);
  drawAir(ctx, map, cam, state.frame);
}

/**
 * Who a person on the map IS, for the purpose of what they look like. Everyone
 * of a kind used to share one sprite id, so all thirty villagers were the same
 * villager. Named people (Cass, the house heads, the Table, the Warden) are
 * keyed by name so they look the same on every map they turn up on; everyone
 * else by their own id, so no two strangers are twins.
 */
function lookIdFor(npc: { readonly id: string; readonly sprite: string; readonly name: string }): string {
  const named = npc.sprite === 'rival' || npc.sprite === 'leader' || npc.sprite === 'elite' || npc.name === 'The Warden';
  return named ? `person:${npc.name}` : `npc:${npc.id}`;
}

/**
 * Sub-frame interpolation, 0..1, set by the shell before each draw.
 *
 * The simulation runs on a fixed 1/60s timestep while the browser paints on its
 * own schedule, so the two drift: measured on the real build, 20 of 180 painted
 * frames advanced the simulation by NOTHING and 19 advanced it by two. That is
 * one frame in five either frozen or lurching, which is what makes walking feel
 * choppy and, over a long corridor, faintly seasick.
 *
 * The frames are not lost - the leftover accumulator says how far through the
 * next tick we are, and adding it to the walk progress lets the renderer show
 * the in-between position. Rendering only; the reducer never sees it, so the
 * game stays perfectly deterministic and the playthrough gauntlet is unaffected.
 */
let frameAlpha = 0;

export function setFrameAlpha(alpha: number): void {
  frameAlpha = Math.max(0, Math.min(1, alpha));
}

/**
 * Where the player was last actually DRAWN, in logical pixels.
 *
 * Read-only diagnostic, published on the observation hook. The tile coordinate
 * alone cannot show a stutter - it only changes once per tile - so measuring
 * smoothness from outside the game needs the interpolated position the renderer
 * really used.
 */
let lastDrawnX = 0;
let lastDrawnY = 0;
/**
 * Where the map's top-left corner was drawn. Outdoors the camera follows the
 * player, so her SCREEN position never changes and all the motion is in this.
 */
let lastCamX = 0;
let lastCamY = 0;

export function drawnPlayerPos(): { x: number; y: number; camX: number; camY: number } {
  return { x: lastDrawnX, y: lastDrawnY, camX: lastCamX, camY: lastCamY };
}

// Location banner: shown for a beat after the map id changes. Edge-detected
// across draw calls (see file header) — never consulted by game logic.
let bannerMapId: string | null = null;
let bannerUntil = -1;

function drawLocationBanner(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  const p = state.player;
  if (p.mapId !== bannerMapId) {
    bannerMapId = p.mapId;
    bannerUntil = state.frame + 80;
  }
  if (state.frame > bannerUntil) return;
  const map = content.world.map(p.mapId);
  // Outdoors only, as `GameMap.indoor` has always said. And the place's NAME:
  // this used to print the map's internal id, so the Astacio house announced
  // itself as "FENMARK HOUSE", and an id longer than the box ran out of it.
  if (map.indoor) return;
  const name = map.name.toUpperCase();
  const w = Math.min(gb.TEXTBOX_W, gb.measureText(name) + gb.TEXTBOX_PAD * 2);
  // Walking in from the north puts her at the top of the screen, which is where
  // the banner goes - it covered her completely. Drop it to the bottom instead.
  const y = lastDrawnY < 40 ? LOGICAL_H - 28 : 8;
  gb.drawBox(ctx, gb.TEXTBOX_X, y, w, 20);
  gb.drawText(ctx, gb.TEXTBOX_X + gb.TEXTBOX_PAD, y + 6, name.slice(0, TEXT_COLS), 3);
}

const STARTER_NAMES: Readonly<Record<string, string>> = {
  winter_pup: 'WINTER', baloo_pup: 'BALOO', plato_pup: 'PLATO',
};

/** The one interaction game.ts hands to the shell instead of the reducer. */
function drawStarterPicker(ctx: CanvasRenderingContext2D, content: Content, cursor: number): void {
  clearScreen(ctx, 0);
  gb.drawText(ctx, 8, 8, 'PICK YOUR FERAL', 3);
  const slotW = 48;
  for (let i = 0; i < STARTERS.length; i++) {
    const id = STARTERS[i];
    if (id === undefined) continue;
    const x = 8 + i * (slotW + 4);
    const selected = i === cursor;
    if (selected) gb.drawBox(ctx, x, 24, slotW, 92);
    const px = creaturePixels(content, id);
    gb.drawSprite(ctx, px, x + (slotW - SPRITE_SIZE) / 2, 30, 0.7);
    const label = STARTER_NAMES[id] ?? id.toUpperCase();
    gb.drawText(ctx, x + Math.max(0, (slotW - gb.measureText(label)) / 2), 96, label, 3);
    if (selected) gb.drawText(ctx, x + slotW / 2 - 4, 108, gb.ADVANCE_PROMPT, 3);
  }
  void content;
  gb.drawTextBox(ctx, ['Left/Right to choose,', 'A to confirm.'], 999, false);
}

function drawOverworld(
  ctx: CanvasRenderingContext2D,
  content: Content,
  state: GameState,
  starterCursor: number,
): void {
  if (state.player.starter === '') {
    drawStarterPicker(ctx, content, starterCursor);
    return;
  }
  if (state.scene.kind !== 'overworld') return;
  drawWorldBackground(ctx, content, state, state.scene.walk);
  drawLocationBanner(ctx, content, state);
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

function drawDialogue(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  if (state.scene.kind !== 'dialogue') return;
  const scene = state.scene;
  drawWorldBackground(ctx, content, state, null);
  const line = scene.lines[scene.index] ?? '';
  // Draw the page the reducer says we are on. Both sides count characters with
  // pageLength() so the "press A" prompt can never appear over hidden text.
  const pages = paginate(line);
  const rows = pages[scene.page] ?? [];
  const revealed = pageLength(rows);
  const showPrompt = scene.chars >= revealed && Math.floor(state.frame / 20) % 2 === 0;
  gb.drawTextBox(ctx, rows, Math.min(scene.chars, Math.max(0, revealed)), showPrompt);
}

/**
 * The pre-battle transition.
 *
 * Gen 1 freezes the overworld, flashes the screen, then closes it off before
 * the battle appears. The point is not decoration: it tells you a battle has
 * started and gives your eyes somewhere to land, instead of the world being
 * replaced between one frame and the next.
 *
 * Three beats over BATTLE_INTRO_FRAMES:
 *   1. two hard flashes to white, then to black
 *   2. horizontal blinds closing from both edges toward the middle
 *   3. a fully black hold, from which the battle screen appears
 */
function drawBattleIntro(
  ctx: CanvasRenderingContext2D,
  content: Content,
  state: GameState,
  intro: number,
): void {
  // `intro` counts DOWN, so invert it into elapsed progress.
  const elapsed = BATTLE_INTRO_FRAMES - intro;
  const t = elapsed / BATTLE_INTRO_FRAMES;

  drawWorldBackground(ctx, content, state, null);

  // Beat 1 - flashes. Alternating full-screen fills read as a jolt at 60fps.
  if (t < 0.30) {
    const phase = Math.floor(elapsed / 5) % 2;
    ctx.fillStyle = shadeColor(phase === 0 ? 0 : 3);
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    return;
  }

  // Beat 3 - hold black.
  if (t > 0.82) {
    ctx.fillStyle = shadeColor(3);
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    return;
  }

  // Beat 2 - blinds. Each band grows from its own top edge, so the world is
  // swallowed in stripes rather than wiped in one direction.
  const k = (t - 0.30) / (0.82 - 0.30);
  const BANDS = 8;
  const bandH = LOGICAL_H / BANDS;
  ctx.fillStyle = shadeColor(3);
  for (let i = 0; i < BANDS; i++) {
    const h = Math.ceil(bandH * Math.min(1, k * 1.15));
    ctx.fillRect(0, Math.round(i * bandH), LOGICAL_W, h);
  }
}

// ---------------------------------------------------------------------------
// Battle — the most important screen
// ---------------------------------------------------------------------------

// A non-overlapping grid over the full 160x144 screen. Sprites are anchored
// by their *baseline* (feet/platform), not their bounding-box center, so
// "how tall is this sprite" can never sneak it into a box below it — a bug
// the center-anchored version of this code had.
/*
 * The player box was 76px wide with the level sharing the name's row, which left
 * exactly four characters for a name: "Winter" rendered as "Wint" and
 * "Cinderkit" as "Cinder". The level now sits on the HP row, beside the bar,
 * so the whole top row belongs to the name - eleven characters, more than the
 * ten-character nickname limit.
 */
/*
 * ...and then twelve, because two animals in the roster have twelve-letter
 * names (Nightreynard, Thornbristle) and were being drawn as "Nightreyna.".
 * Both boxes are now exactly wide enough for CREATURE_NAME_COLS.
 */
const ENEMY_BOX = { x: 2, y: 2, w: 102, h: 26 };
const PLAYER_BOX = { x: 56, y: 54, w: 102, h: 32 };
const ENEMY_ANCHOR = { cx: 128, baseline: 48, scale: 0.66 };
/*
 * Your animal stands clear of every box: left of its own status box and above
 * the move list. It used to sit four pixels further right and two lower, which
 * put the right-hand edge of a wide creature under the status box and its feet
 * under the menu.
 */
const PLAYER_ANCHOR = { cx: 30, baseline: 90, scale: 0.92 };

/** Names are held to CREATURE_NAME_COLS by gauntlet:schema, so this only ever guards bad data. */
function nameLabel(name: string): string {
  return name.length > CREATURE_NAME_COLS ? `${name.slice(0, CREATURE_NAME_COLS - 1)}.` : name;
}

function creatureLabel(f: Feral): string {
  return nameLabel(f.nickname);
}

/**
 * The starter picker. Three creatures on plinths, the selected one raised and
 * named, with its typing and a line of its personality underneath.
 */
function drawStarterPick(
  ctx: CanvasRenderingContext2D,
  content: Content,
  scene: { readonly kind: 'starterPick'; cursor: number },
): void {
  ctx.fillStyle = gb.shadeColor(0);
  ctx.fillRect(0, 0, gb.LOGICAL_W, gb.LOGICAL_H);
  gb.drawText(ctx, 44, 4, 'PICK ONE.', 3);

  const ids = starterChoices();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === undefined) continue;
    const cx = 30 + i * 50;
    const selected = i === scene.cursor;
    const baseline = selected ? 58 : 60;
    const scale = selected ? 0.72 : 0.56;

    fillEllipse(ctx, cx, baseline, selected ? 18 : 14, 4, 1);
    gb.drawSprite(
      ctx, creaturePixels(content, id),
      Math.round(cx - (SPRITE_SIZE * scale) / 2), Math.round(baseline - SPRITE_SIZE * scale), scale, false,
    );
    if (selected) gb.drawText(ctx, cx - 4, baseline + 6, gb.CURSOR_GLYPH, 3);
  }

  /*
   * The description box. It used to give the description three rows of
   * seventeen characters and draw whatever fitted, so all three starters were
   * introduced by a sentence that stopped in the middle: "Does not bark.
   * Screams. Has never once been". The name and typing now share the top row,
   * which frees enough of the box to show the whole thing.
   */
  const chosen = ids[scene.cursor] ?? ids[0];
  if (chosen !== undefined) {
    const sp = content.dex.species(chosen);
    const box = { x: gb.TEXTBOX_X, y: 74, w: gb.TEXTBOX_W, h: 66 };
    gb.drawBox(ctx, box.x, box.y, box.w, box.h);
    const left = box.x + gb.TEXTBOX_PAD;
    const types = sp.types.join('/');
    gb.drawText(ctx, left, box.y + 4, sp.name, 3);
    gb.drawText(ctx, left + (TEXT_COLS - types.length) * 8, box.y + 4, types, 3);
    const rows = gb.wrapText(sp.dexEntry, TEXT_COLS);
    for (let i = 0; i < rows.length; i++) {
      gb.drawText(ctx, left, box.y + 15 + i * 10, rows[i] ?? '', 3);
    }
  }
}

/**
 * One side's status box. Everything in it - name, level, bar, numbers, status -
 * comes from `ShownSide`, which only moves as the turn is narrated; see
 * `BattleScene.shown` for why none of it may be read from the engine.
 */
function drawSideInfo(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  f: ShownSide,
  showNumbers: boolean,
): void {
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);

  // Top row: the name alone, with the full box width to itself.
  const nameX = box.x + 4;
  gb.drawText(ctx, nameX, box.y + 4, nameLabel(f.name), 3);

  // Second row: HP bar, then the level, then any status tag.
  const barWidth = Math.min(48, box.w - 12);
  gb.drawHpBar(ctx, box.x + 5, box.y + 14, f.hp, f.maxHp, barWidth);
  const levelText = `Lv${f.level}`;
  let cursorX = box.x + 8 + barWidth;
  if (cursorX + gb.measureText(levelText) <= box.x + box.w - 3) {
    gb.drawText(ctx, cursorX, box.y + 12, levelText, 3);
    cursorX += gb.measureText(levelText) + 3;
  }
  if (f.status && cursorX + gb.measureText(STATUS_TAG[f.status]) <= box.x + box.w - 3) {
    gb.drawText(ctx, cursorX, box.y + 12, STATUS_TAG[f.status], 3);
  }
  if (showNumbers) {
    const text = `${f.hp}/${f.maxHp}`;
    gb.drawText(ctx, box.x + box.w - gb.measureText(text) - 5, box.y + 22, text, 3);
  }
}

const BOTTOM_Y = 96;
const BOTTOM_W = 144;
const BOTTOM_H = 40;

const COMMANDS = ['FIGHT', 'BAG', 'PARTY', 'RUN'] as const;
const CMD_W = 64;
const CMD_X = 8 + BOTTOM_W - CMD_W;

/*
 * Gen 1's battle bottom is a FULL-WIDTH text box with the command menu drawn as
 * an overlay panel on its right, not a bottom bar split into two halves.
 *
 * The split version was wrong twice over: the message box came out 9 characters
 * wide (the brief and the Game Boy both want 18), and the command menu tried to
 * fit two 5-character columns into 60px at an 8px fixed advance, so FIGHT and
 * BAG were literally drawn on top of each other - "FIGHBAG" on screen.
 *
 * One fixed-width column of four is the honest fit for an 8px font. Gen 1 got a
 * 2x2 out of a narrower kerned font; we do not have one, so we do not pretend.
 */

function drawCommandGrid(ctx: CanvasRenderingContext2D, cursor: number): void {
  gb.drawBox(ctx, CMD_X, BOTTOM_Y, CMD_W, BOTTOM_H);
  for (let i = 0; i < COMMANDS.length; i++) {
    // Four rows in a forty-pixel box leaves two pixels each end. Starting two
    // lower put RUN's feet on the border line.
    const y = BOTTOM_Y + 3 + i * 9;
    if (i === cursor) gb.drawText(ctx, CMD_X + 4, y, gb.CURSOR_GLYPH, 3);
    gb.drawText(ctx, CMD_X + 13, y, COMMANDS[i] ?? '', 3);
  }
}

/** Full width: 18 characters at an 8px advance, exactly like the Game Boy. */
export const TEXT_COLS = 18;
/**
 * When the command panel is up it overlays the right end of the full-width text
 * box, so the message must wrap short or it renders underneath the menu -
 * "A wild Stripeling blocks the way" showed as "A wild St / blocks th".
 */
const TEXT_COLS_WITH_MENU = Math.floor((BOTTOM_W - CMD_W - 12) / 8);

function drawMessageBox(ctx: CanvasRenderingContext2D, text: string, narrow = false): void {
  // With the menu up the box stops where the panel starts, rather than running
  // underneath it. Full width otherwise.
  gb.drawBox(ctx, 8, BOTTOM_Y, narrow ? CMD_X - 8 : BOTTOM_W, BOTTOM_H);
  const rows = gb.wrapText(text, narrow ? TEXT_COLS_WITH_MENU : TEXT_COLS);
  for (let i = 0; i < 2; i++) {
    const row = rows[i];
    if (row) gb.drawText(ctx, 8 + 6, BOTTOM_Y + 6 + i * 14, row, 3);
  }
}

/**
 * The move list: four names, each on a row of its own, and under them one row
 * for the highlighted move's type and the power it has left.
 *
 * It used to put the power on the same row as each name, which left nine
 * characters for a name. Sixty-two of the ninety-six moves are longer than that
 * and were drawn cut short with a full stop - "Quick Sn.", "Under Th." - so the
 * player was choosing between moves they could not read.
 *
 * Gen 1 shows type and power in a small box of its own, over the back sprite.
 * That was tried here and it sat on the head of any tall animal, so the row
 * lives inside the list instead, where it covers nothing.
 */
const MOVE_BOX = { x: gb.TEXTBOX_X, y: 88, w: gb.TEXTBOX_W, h: 48 };

/**
 * How hard the highlighted move lands on the animal you are facing: "x2",
 * "x1/2", "x0", or nothing for an ordinary hit or a move that does no damage.
 */
export function moveTagAgainst(content: Content, power: number, type: FeralType, enemySpecies: string): string {
  if (power <= 0) return '';
  return effectTag(effectiveness(type, content.dex.species(enemySpecies).types));
}

/**
 * The row under the move names: kind and hit mark on the left, power left on
 * the right. "PP" gives way when the mark needs the room, so the two halves
 * never run into each other: at least three spaces apart where they can be.
 */
export function moveInfoRow(type: string, tag: string, pp: number, maxPp: number): { left: string; right: string } {
  const left = tag === '' ? type.toUpperCase() : `${type.toUpperCase()} ${tag}`;
  const full = `PP ${pp}/${maxPp}`;
  const right = left.length + 3 + full.length <= MOVE_NAME_COLS ? full : `${pp}/${maxPp}`;
  return { left, right };
}

function drawMoveList(ctx: CanvasRenderingContext2D, content: Content, scene: BattleScene): void {
  const moves = activeOf(scene.battle.player).moves;
  const box = MOVE_BOX;
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  const nameX = box.x + 12;
  for (let i = 0; i < 4; i++) {
    const slot = moves[i];
    const y = box.y + 2 + i * 9;
    if (i === scene.moveCursor) gb.drawText(ctx, box.x + 2, y, gb.CURSOR_GLYPH, 3);
    if (!slot) continue;
    gb.drawText(ctx, nameX, y, content.dex.move(slot.move).name, 3);
  }

  const chosen = moves[scene.moveCursor];
  if (chosen) {
    const mv = content.dex.move(chosen.move);
    const y = box.y + 39;
    const row = moveInfoRow(mv.type, moveTagAgainst(content, mv.power, mv.type, scene.shown.enemy.species), chosen.pp, chosen.maxPp);
    gb.drawText(ctx, nameX, y, row.left, 3);
    gb.drawText(ctx, nameX + (MOVE_NAME_COLS - row.right.length) * 8, y, row.right, 3);
  }
}

function drawListOverlay(
  ctx: CanvasRenderingContext2D,
  title: string,
  rows: readonly string[],
  cursor: number,
  extra?: (i: number, x: number, y: number) => void,
): void {
  const box = { x: 8, y: 8, w: 144, h: 128 };
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  gb.drawText(ctx, box.x + 6, box.y + 4, title, 3);
  for (let i = 0; i < rows.length; i++) {
    const y = box.y + 20 + i * 14;
    if (y > box.y + box.h - 12) break;
    if (i === cursor) gb.drawText(ctx, box.x + 4, y, gb.CURSOR_GLYPH, 3);
    gb.drawText(ctx, box.x + 16, y, rows[i] ?? '', 3);
    extra?.(i, box.x + box.w - 56, y);
  }
}

/**
 * The party list: two lines an animal, six animals, the whole screen.
 *
 *   ▶Winter         Lv12
 *    [=======  ] PSN 31/40
 *
 * It used to be a name and a bar - no level, no numbers - so the only way to
 * learn how hurt anything was, or how strong, was to start a fight with it.
 * The box is the full width of the text box so that a twelve-letter name and
 * "Lv100" both fit on one row with air between them.
 */
const PARTY_BOX = { x: gb.TEXTBOX_X, y: 4, w: gb.TEXTBOX_W, h: 136 };
const PARTY_ROW_H = 19;

function drawPartyOverlay(
  ctx: CanvasRenderingContext2D,
  content: Content,
  party: readonly Feral[],
  cursor: number,
  title: string,
  moving = -1,
): void {
  const box = PARTY_BOX;
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  gb.drawText(ctx, box.x + 2, box.y + 4, title, 3);
  const right = box.x + box.w - 4;
  for (let i = 0; i < party.length && i < 6; i++) {
    const f = party[i];
    if (!f) continue;
    const y = box.y + 16 + i * PARTY_ROW_H;
    // The animal picked up to be moved keeps a mark of its own while the
    // cursor goes looking for where to put it.
    if (i === cursor) gb.drawText(ctx, box.x + 2, y, gb.CURSOR_GLYPH, 3);
    else if (i === moving) gb.drawText(ctx, box.x + 2, y, gb.ADVANCE_PROMPT, 3);
    gb.drawText(ctx, box.x + 10, y, creatureLabel(f), 3);
    const level = `Lv${f.level}`;
    gb.drawText(ctx, right - gb.measureText(level), y, level, 3);

    const max = maxHp(content.dex.species(f.species), f);
    gb.drawHpBar(ctx, box.x + 10, y + 11, f.hp, max, 48);
    if (f.status) gb.drawText(ctx, box.x + 64, y + 10, STATUS_TAG[f.status], 3);
    const hp = `${f.hp}/${max}`;
    gb.drawText(ctx, right - gb.measureText(hp), y + 10, hp, 3);
  }
}

function drawBagOverlay(
  ctx: CanvasRenderingContext2D,
  bag: readonly { item: string; count: number }[],
  cursor: number,
  title = 'BAG',
): void {
  // Names come from the item table, which holds them to twelve characters so
  // the count always has the end of the row to itself. The raw id was drawn
  // before, and "strong poultice" ran straight through its own count.
  const rows = bag.map((s) => itemName(s.item));
  drawListOverlay(ctx, title, rows, cursor, (i, x, y) => {
    const s = bag[i];
    if (!s) return;
    gb.drawText(ctx, x + 48 - gb.measureText(`x${s.count}`), y, `x${s.count}`, 3);
  });
}

/**
 * The snare itself: a round woven trap with a seam round its middle and a
 * clasp on the seam - a closed ball, not a hoop, so that once something is in
 * it, it is plainly IN it. Plotted pixel by pixel rather than with the canvas's
 * arcs and rotation, both of which anti-alias - colours the Game Boy does not
 * have. The weave and the seam turn with `tilt`, which is what makes a wobble
 * read as the ball rocking rather than sliding.
 *
 * `inside` is the animal caught in it, drawn as a dark shape behind the weave.
 * `open` lifts the top half off by that many pixels, showing the dark inside.
 * `split` throws the two halves apart, for a break-out.
 */
interface TrapLook {
  readonly tilt?: number;
  readonly open?: number;
  readonly split?: number;
  readonly inside?: Pixels | null;
  /** Shake the shape inside by a pixel: something in there is fighting it. */
  readonly struggle?: number;
  readonly latched?: boolean;
}

function drawTrap(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, look: TrapLook = {}): void {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const rr = Math.max(3, Math.round(r));
  const outer = rr * rr + rr;
  const inner = (rr - 1) * (rr - 1) + (rr - 1);
  const tilt = look.tilt ?? 0;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const open = Math.round(look.open ?? 0);
  const split = Math.round(look.split ?? 0);
  const inside = look.inside ?? null;
  const struggle = look.struggle ?? 0;
  const plot = (x: number, y: number, s: gb.Shade): void => {
    ctx.fillStyle = shadeColor(s);
    ctx.fillRect(x, y, 1, 1);
  };
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const d = dx * dx + dy * dy;
      if (d > outer) continue;
      // Where this pixel sits on the ball itself, turned with the ball.
      const rx = Math.round(dx * cos + dy * sin);
      const ry = Math.round(-dx * sin + dy * cos);
      const lid = ry < 0;
      let shade: gb.Shade;
      if (d > inner) {
        shade = 3;
      } else if (ry === 0 || (open > 0 && lid && ry === -1)) {
        // The seam. With the lid up, the bottom half's rim is the dark mouth.
        shade = 3;
      } else if (open > 0 && !lid && ry === 1) {
        shade = 3;
      } else if (Math.abs(rx) <= 1 && Math.abs(ry) <= 1) {
        shade = 3;
      } else {
        const weave = ((rx + ry) % 3 + 3) % 3 === 0 || ((rx - ry) % 3 + 3) % 3 === 0;
        let body = false;
        if (inside !== null && open === 0 && split === 0) {
          // The whole sprite squeezed into the ball, sitting at the bottom.
          const u = Math.floor(((rx + struggle + rr) / (2 * rr + 1)) * SPRITE_SIZE);
          const v = Math.floor(((ry + rr) / (2 * rr + 1)) * SPRITE_SIZE);
          body = u >= 0 && u < SPRITE_SIZE && v >= 0 && v < SPRITE_SIZE && (inside[v * SPRITE_SIZE + u] ?? 0) !== 0;
        }
        shade = body ? (weave ? 3 : 2) : weave ? 1 : 0;
      }
      // The clasp: a light square on the seam, filled dark once it has locked.
      if (Math.abs(rx) === 0 && Math.abs(ry) === 0) shade = look.latched === true ? 3 : 0;
      let ox = 0;
      let oy = 0;
      if (lid) {
        oy -= open + split;
        ox -= split;
      } else if (split > 0) {
        ox += split;
        oy += Math.floor(split / 2);
      }
      plot(x0 + dx + ox, y0 + dy + oy, shade);
    }
  }
}

/**
 * An animal turned into a solid shape of one shade, at any size, by sampling
 * its pixels - so it can be pulled into the trap without the canvas smoothing
 * colours into it.
 */
function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  pixels: Pixels,
  cx: number,
  cy: number,
  scale: number,
  shade: gb.Shade,
): void {
  const size = Math.round(SPRITE_SIZE * scale);
  if (size < 1) return;
  const left = Math.round(cx - size / 2);
  const top = Math.round(cy - size / 2);
  ctx.fillStyle = shadeColor(shade);
  for (let y = 0; y < size; y++) {
    const v = Math.floor((y / size) * SPRITE_SIZE);
    for (let x = 0; x < size; x++) {
      const u = Math.floor((x / size) * SPRITE_SIZE);
      if ((pixels[v * SPRITE_SIZE + u] ?? 0) !== 0) ctx.fillRect(left + x, top + y, 1, 1);
    }
  }
}

/** A ring of dashes flying outward — used for both the click and the break-out. */
function drawBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spread: number,
  shade: gb.Shade,
): void {
  ctx.fillStyle = shadeColor(shade);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.fillRect(
      Math.round(cx + Math.cos(a) * spread) - 1,
      Math.round(cy + Math.sin(a) * spread) - 1,
      2, 2,
    );
  }
}

/** Streaks running from where the animal was into the trap's open mouth. */
function drawPullStreaks(ctx: CanvasRenderingContext2D, cx: number, cy: number, reach: number, frame: number): void {
  ctx.fillStyle = shadeColor(3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    // Each streak is a short dash that slides inward as the pull goes on.
    for (let s = 0; s < 3; s++) {
      const d = reach - ((frame * 2 + s * 4) % Math.max(4, reach));
      if (d < 3) continue;
      ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1, 1);
    }
  }
}

/**
 * The throw, in four beats. The catch was already decided before any of this
 * ran, so nothing here can change the outcome — it only spends the right amount
 * of time telling you about it.
 *
 *   1. arc      the shut trap leaves your hands and flies to the animal
 *   2. pull     it pops open, the animal goes dark and is sucked inside, the
 *               lid snaps shut on it, and the trap drops to the ground
 *   3. wobble   the trap rocks, with the animal visibly in it, once per shake
 *               earned, so a near miss LOOKS like a near miss
 *   4. settle   the clasp locks with a flash, or the trap bursts in two and
 *               the animal is back
 *
 * The audio (`src/audio/index.ts`) keys its land, wobble and verdict sounds off
 * the same SNARE_* marks: the land is the end of beat 2.
 */
/** The trap at rest after a catch: shut, locked, with the animal in it. */
function drawCaughtTrap(ctx: CanvasRenderingContext2D, enemyPixels: Pixels): void {
  drawTrap(ctx, ENEMY_ANCHOR.cx, ENEMY_ANCHOR.baseline - TRAP_R + 1, TRAP_R, { inside: enemyPixels, latched: true });
}

const TRAP_R = 7;

function drawSnareThrow(
  ctx: CanvasRenderingContext2D,
  snare: SnareThrow,
  enemyPixels: Pixels,
): void {
  const f = snare.frames;
  const tx = ENEMY_ANCHOR.cx;
  const enemyH = SPRITE_SIZE * ENEMY_ANCHOR.scale;
  const ty = ENEMY_ANCHOR.baseline - enemyH * 0.5;
  const trapR = TRAP_R;
  const groundY = ENEMY_ANCHOR.baseline - trapR + 1;

  const drawEnemy = (scale: number, cx: number, baseline: number): void => {
    if (scale <= 0.02) return;
    gb.drawSprite(
      ctx, enemyPixels,
      cx - (SPRITE_SIZE * scale) / 2,
      baseline - SPRITE_SIZE * scale,
      scale, false,
    );
  };

  // --- Beat 1: the arc -----------------------------------------------------
  if (f < SNARE_THROW_FRAMES) {
    drawEnemy(ENEMY_ANCHOR.scale, ENEMY_ANCHOR.cx, ENEMY_ANCHOR.baseline);
    const k = f / SNARE_THROW_FRAMES;
    // Thrown from just off the bottom-left, where the player's hands would be.
    const sx = 18;
    const sy = LOGICAL_H - 8;
    const x = sx + (tx - sx) * k;
    // A parabola, not a straight line: 34px of lift at the apex.
    const y = sy + (ty - sy) * k - Math.sin(k * Math.PI) * 34;
    drawTrap(ctx, x, y, 5, { tilt: k * Math.PI * 3 });
    return;
  }

  // --- Beat 2: the pull ----------------------------------------------------
  const pf = f - SNARE_THROW_FRAMES;
  if (pf < SNARE_PULL_FRAMES) {
    const k = pf / SNARE_PULL_FRAMES;
    const trapY = ty - enemyH * 0.5 - 2;
    if (k < 0.2) {
      // It hits, hangs in the air above the animal and opens. The animal
      // flashes from itself to a dark shape: whatever this is, it has it.
      const q = k / 0.2;
      if (pf % 4 < 2) drawEnemy(ENEMY_ANCHOR.scale, tx, ENEMY_ANCHOR.baseline);
      else drawSilhouette(ctx, enemyPixels, tx, ty, ENEMY_ANCHOR.scale, 3);
      drawTrap(ctx, tx, trapY, trapR, { open: q * 4 });
      return;
    }
    if (k < 0.7) {
      // The dark shape shrinks and is drawn up into the mouth.
      const q = (k - 0.2) / 0.5;
      const e = q * q;
      const cy = ty + (trapY - ty) * e;
      drawSilhouette(ctx, enemyPixels, tx, cy, ENEMY_ANCHOR.scale * (1 - e * 0.92), 3);
      drawPullStreaks(ctx, tx, trapY, 22 - q * 10, pf);
      drawTrap(ctx, tx, trapY, trapR, { open: 4 });
      return;
    }
    if (k < 0.82) {
      // Snap. The lid comes down on it.
      const q = (k - 0.7) / 0.12;
      drawTrap(ctx, tx, trapY, trapR, { open: 4 * (1 - q), inside: q >= 1 ? enemyPixels : null });
      drawBurst(ctx, tx, trapY, trapR + 2 + q * 3, 3);
      return;
    }
    // Shut, with the animal in it, and falling to the ground.
    const q = (k - 0.82) / 0.18;
    drawTrap(ctx, tx, trapY + (groundY - trapY) * q * q, trapR, { inside: enemyPixels });
    return;
  }

  // --- Beat 3: the wobbles -------------------------------------------------
  const wobbles = snare.caught ? 3 : Math.max(0, Math.min(3, snare.shakes));
  const wf = pf - SNARE_PULL_FRAMES;
  if (wf < wobbles * SNARE_WOBBLE_FRAMES) {
    const idx = Math.floor(wf / SNARE_WOBBLE_FRAMES);
    const k = (wf % SNARE_WOBBLE_FRAMES) / SNARE_WOBBLE_FRAMES;
    // One full rock per wobble, alternating side so it never looks like a loop.
    const lean = Math.sin(k * Math.PI) * 0.55 * (idx % 2 === 0 ? 1 : -1);
    // The animal throws itself at the side it is rocking toward.
    const struggle = k > 0.15 && k < 0.85 ? (lean > 0 ? 1 : -1) : 0;
    drawTrap(ctx, tx + lean * 6, groundY, trapR, { tilt: lean, inside: enemyPixels, struggle });
    return;
  }

  // --- Beat 4: the answer --------------------------------------------------
  const sf = wf - wobbles * SNARE_WOBBLE_FRAMES;
  if (snare.caught) {
    // The clasp locks, a single bright flash, then stillness. Gen 1's ding.
    drawTrap(ctx, tx, groundY, trapR, { inside: enemyPixels, latched: true });
    if (sf < 10) drawBurst(ctx, tx, groundY, trapR + 2 + sf, 3);
    return;
  }
  // It got out. The trap bursts in two and the animal is back where it
  // started, growing out of the wreckage rather than simply reappearing.
  const k = Math.min(1, sf / 12);
  drawEnemy(ENEMY_ANCHOR.scale * k, ENEMY_ANCHOR.cx, ENEMY_ANCHOR.baseline);
  if (sf < 12) drawTrap(ctx, tx, groundY, trapR, { split: 1 + k * 6 });
  drawBurst(ctx, tx, groundY, 6 + k * 12, 2);
}

/**
 * Whether a side's sprite is painted this frame.
 *
 * The struck animal blinks off and on for FLASH_FRAMES, which is exactly how
 * Gen 1 shows a hit landing. Three frames on, three off: any faster reads as
 * flicker rather than as being hit.
 */
function visibleThroughFlinch(scene: BattleScene, side: 'player' | 'enemy'): boolean {
  if (scene.flash <= 0 || scene.flashSide !== side) return true;
  return Math.floor((FLASH_FRAMES - scene.flash) / 3) % 2 === 0;
}

function drawBattle(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  if (state.scene.kind === 'battle' && state.scene.intro > 0) {
    drawBattleIntro(ctx, content, state, state.scene.intro);
    return;
  }
  if (state.scene.kind !== 'battle') return;
  const scene = state.scene;
  const battle: BattleState = scene.battle;

  clearScreen(ctx, 0);

  // Both sides are drawn from what has been NARRATED so far, not from the
  // engine, which is already at the end of the turn.
  const enemy = scene.shown.enemy;
  const player = scene.shown.player;

  fillEllipse(ctx, ENEMY_ANCHOR.cx, ENEMY_ANCHOR.baseline, 20, 5, 1);
  // While a snare is in the air it owns the enemy half of the screen: it draws
  // the animal itself, because the animal spends most of the animation being
  // somewhere other than its usual spot.
  if (scene.snare !== null) {
    drawSnareThrow(ctx, scene.snare, creaturePixels(content, enemy.species));
  } else if (enemy.trapped === true) {
    // Caught means IN THE TRAP. The animal used to stand back up on the field
    // while the box said it was yours, which undid the whole animation.
    drawCaughtTrap(ctx, creaturePixels(content, enemy.species));
  } else if (!enemy.gone && visibleThroughFlinch(scene, 'enemy')) {
    gb.drawSprite(
      ctx, creaturePixels(content, enemy.species),
      ENEMY_ANCHOR.cx - (SPRITE_SIZE * ENEMY_ANCHOR.scale) / 2,
      ENEMY_ANCHOR.baseline - SPRITE_SIZE * ENEMY_ANCHOR.scale,
      ENEMY_ANCHOR.scale, false,
    );
  }
  drawSideInfo(ctx, ENEMY_BOX, enemy, false);

  fillEllipse(ctx, PLAYER_ANCHOR.cx, PLAYER_ANCHOR.baseline, 25, 6, 1);
  // A real back view, not the front sprite mirrored. Gen 1 draws your creature
  // from behind; flipping the front sprite leaves it staring at the camera with
  // its face and nose visible, which reads immediately as wrong.
  if (!player.gone && visibleThroughFlinch(scene, 'player')) {
    gb.drawSprite(
      ctx, creaturePixels(content, player.species, 'back'),
      PLAYER_ANCHOR.cx - (SPRITE_SIZE * PLAYER_ANCHOR.scale) / 2,
      PLAYER_ANCHOR.baseline - SPRITE_SIZE * PLAYER_ANCHOR.scale,
      PLAYER_ANCHOR.scale, false,
    );
  }
  drawSideInfo(ctx, PLAYER_BOX, player, true);

  const draining =
    scene.queue.length > 0 || scene.awaitingAck || scene.snare !== null || battle.outcome !== 'ongoing';
  if (draining) {
    // Messages are split into box-sized events at enqueue (see pushEvents), so
    // two rows always holds one whole message. The blinking prompt appears only
    // while the game is actually waiting on the player, so it means "press to
    // continue" rather than decorating a box that is about to vanish anyway.
    const rows = gb.wrapText(state.lastText, 18).slice(0, 2);
    const prompt = scene.awaitingAck && Math.floor(state.frame / 20) % 2 === 0;
    gb.drawTextBox(ctx, rows, 999, prompt);
    return;
  }

  // The party and bag lists take the whole screen, as they do in Gen 1. They
  // used to be drawn over the fight, and are a little smaller than it: slivers
  // of both status boxes and half-letters of a name showed round the edges.
  if (scene.sub === 'forceSwitch' || scene.sub === 'party') {
    clearScreen(ctx, 0);
    drawPartyOverlay(ctx, content, battle.player.party, scene.partyCursor, scene.sub === 'forceSwitch' ? ' SEND OUT WHO?' : ' PARTY');
    return;
  }
  if (scene.sub === 'bag') {
    clearScreen(ctx, 0);
    drawBagOverlay(ctx, state.player.bag, scene.bagCursor);
    return;
  }
  if (scene.sub === 'moves') {
    drawMoveList(ctx, content, scene);
    return;
  }

  // Gen 1 puts the active creature's NAME here beside the command menu, not a
  // sentence: there is only room for about nine characters once the panel takes
  // its half, and "What will Winter do?" simply clips.
  drawMessageBox(ctx, nameLabel(player.name), true);
  drawCommandGrid(ctx, scene.cursor);
}

// ---------------------------------------------------------------------------
// Menu (the pause menu)
// ---------------------------------------------------------------------------

/**
 * What the top row of the party list says. It is the list's only spare row, so
 * it does four jobs: the heading, the row of things you can do to the animal
 * under the cursor, the question a half-finished action is asking, and the
 * game's answer to the last press.
 */
export function partyHeading(scene: {
  readonly act: number; readonly moving: number; readonly using: string; readonly note: string;
}): string {
  if (scene.act >= 0) {
    return PARTY_ACTIONS.map((a, i) => `${i === scene.act ? gb.CURSOR_GLYPH : ' '}${a}`).join(' ');
  }
  if (scene.note !== '') return ` ${scene.note}`;
  if (scene.moving >= 0) return ' MOVE TO WHERE?';
  if (scene.using !== '') return ' USE ON WHO?';
  return ' PARTY';
}


function drawMenu(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  if (state.scene.kind !== 'menu') return;
  const scene: MenuScene = state.scene;
  drawWorldBackground(ctx, content, state, null);

  if (scene.sub === 'root') {
    const w = 64;
    const h = MENU_ROOT.length * 14 + 10;
    const x = LOGICAL_W - w - 8;
    const y = 8;
    gb.drawBox(ctx, x, y, w, h);
    for (let i = 0; i < MENU_ROOT.length; i++) {
      const ry = y + 6 + i * 14;
      if (i === scene.cursor) gb.drawText(ctx, x + 4, ry, gb.CURSOR_GLYPH, 3);
      gb.drawText(ctx, x + 16, ry, MENU_ROOT[i] ?? '', 3);
    }
    return;
  }

  if (scene.sub === 'party') {
    drawPartyOverlay(ctx, content, state.player.party, scene.subCursor, partyHeading(scene), scene.moving);
    return;
  }
  if (scene.sub === 'bag') {
    drawBagOverlay(ctx, state.player.bag, scene.subCursor, scene.note === '' ? 'BAG' : scene.note);
    return;
  }
  if (scene.sub === 'kinds') {
    drawKinds(ctx, scene.subCursor);
    return;
  }
  drawDex(ctx, content, state, scene);
}

// ---------------------------------------------------------------------------
// The kinds chart
// ---------------------------------------------------------------------------

/** One row of the chart page, and where its second column starts. */
export const KINDS_ROW_H = 9;
export const KINDS_COL2 = 10;

/**
 * The page for one kind, as rows of text: what its MOVES do to other kinds,
 * then what other kinds' moves do to a FERAL of it. Two columns, because the
 * longest list is five names and the screen is eighteen characters wide.
 * Every gap between two things that are not one phrase is at least two
 * spaces, or the eye (and the screen gate) reads them as one.
 */
export function kindsPage(kind: FeralType): string[] {
  const k = kindSheet(kind);
  const name = kind.toUpperCase();
  const pair = (left: string, right: string): string => ` ${left}`.padEnd(KINDS_COL2) + right;
  const cols = (left: readonly string[], right: readonly string[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < Math.max(left.length, right.length); i++) out.push(pair(left[i] ?? '', right[i] ?? '').trimEnd());
    return out;
  };
  const rows = [`${name} MOVES`, pair('GOOD VS', 'BAD VS')];
  rows.push(...cols(k.beats, k.blunted));
  if (k.cannotTouch.length > 0) rows.push(` NO EFFECT   ${k.cannotTouch.join('   ')}`);
  rows.push(`${name} FERALS`, pair('HURT BY', 'SAFE VS'));
  rows.push(...cols(k.hurtBy, k.toughVs));
  if (k.immuneTo.length > 0) rows.push(` IMMUNE   ${k.immuneTo.join('   ')}`);
  return rows;
}

function drawKinds(ctx: CanvasRenderingContext2D, cursor: number): void {
  const kind = TYPES[cursor] ?? TYPES[0];
  // Two pixels of the world show down each side, as round every other page.
  gb.drawBox(ctx, 2, 0, LOGICAL_W - 4, LOGICAL_H);
  const head = `◀   ${kind.toUpperCase()}   ▶`;
  // Centred on the 8px grid the rows below use.
  const cols = Math.floor((LOGICAL_W / 8 - head.length) / 2);
  gb.drawText(ctx, cols * 8, 6, head, 3);
  const rows = kindsPage(kind);
  for (let i = 0; i < rows.length; i++) {
    gb.drawText(ctx, 8, 19 + i * KINDS_ROW_H, rows[i] ?? '', 3);
  }
}

// ---------------------------------------------------------------------------
// The Dex
// ---------------------------------------------------------------------------

/** The mark beside an animal you have owned. */
export const OWNED_GLYPH = '●';
/** What stands in for the name of an animal never met. */
export const DEX_UNSEEN = '-----';

export function dexNumber(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * The list: every animal in the game by number. One you have met has its name;
 * one you have owned has the snare mark as well; one you have not met is a
 * number and a blank, so the size of what is left is always in view.
 */
function drawDex(ctx: CanvasRenderingContext2D, content: Content, state: GameState, scene: MenuScene): void {
  const p = state.player;
  const ids = content.speciesIds;
  if (scene.entry) {
    const id = ids[scene.subCursor];
    if (id !== undefined) {
      drawDexEntry(ctx, content, id, p.caught.includes(id));
      return;
    }
  }
  const box = PARTY_BOX;
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  gb.drawText(ctx, box.x + 10, box.y + 4, `SEEN ${p.seen.length}  OWN ${p.caught.length}`, 3);
  const top = boxScroll(scene.subCursor, ids.length);
  for (let row = 0; row < DEX_ROWS; row++) {
    const i = top + row;
    const id = ids[i];
    if (id === undefined) break;
    const sp = content.dex.species(id);
    const y = box.y + 18 + row * BOX_ROW_H;
    if (i === scene.subCursor) gb.drawText(ctx, box.x + 2, y, gb.CURSOR_GLYPH, 3);
    gb.drawText(ctx, box.x + 10, y, dexNumber(sp.dex), 3);
    gb.drawText(ctx, box.x + 38, y, p.seen.includes(id) ? nameLabel(sp.name) : DEX_UNSEEN, 3);
    if (p.caught.includes(id)) gb.drawText(ctx, box.x + box.w - 12, y, OWNED_GLYPH, 3);
  }
  gb.drawText(ctx, box.x + 10, box.y + box.h - 12, 'LEFT/RIGHT: PAGE', 3);
}

/** How wide the Dex page's column beside the picture is, in characters. */
const DEX_SIDE_COLS = 12;

/**
 * One animal's page. Met but never owned shows the picture, the number and the
 * name and admits it knows nothing else; owning one fills in what it really is,
 * its typing and its entry.
 */
function drawDexEntry(ctx: CanvasRenderingContext2D, content: Content, id: string, owned: boolean): void {
  clearScreen(ctx, 0);
  const sp = content.dex.species(id);
  const scale = 0.7;
  fillEllipse(ctx, 28, 47, 20, 4, 1);
  gb.drawSprite(ctx, creaturePixels(content, id), Math.round(28 - (SPRITE_SIZE * scale) / 2), Math.round(47 - SPRITE_SIZE * scale), scale, false);

  const sideX = LOGICAL_W - 4 - DEX_SIDE_COLS * 8;
  gb.drawText(ctx, sideX, 6, `No.${dexNumber(sp.dex)}`, 3);
  gb.drawText(ctx, sideX, 18, nameLabel(sp.name), 3);
  if (owned) gb.drawText(ctx, sideX, 30, sp.types.join('/'), 3);

  // What it actually is, in the world outside Fenmark. Two rows at most.
  const left = gb.TEXTBOX_X + gb.TEXTBOX_PAD;
  if (owned) {
    const animal = gb.wrapText(sp.animal, TEXT_COLS).slice(0, 2);
    for (let i = 0; i < animal.length; i++) gb.drawText(ctx, left, 52 + i * 10, animal[i] ?? '', 3);
  }

  const box = { x: gb.TEXTBOX_X, y: 73, w: gb.TEXTBOX_W, h: 67 };
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  const rows = gb.wrapText(owned ? sp.dexEntry : DEX_UNOWNED_TEXT, TEXT_COLS);
  for (let i = 0; i < rows.length && i < 6; i++) gb.drawText(ctx, left, box.y + 4 + i * 10, rows[i] ?? '', 3);
}

/** The page of an animal met and never owned. */
export const DEX_UNOWNED_TEXT = 'Seen. Never held. Catch one and this page fills in.';

// ---------------------------------------------------------------------------
// The kennel box
// ---------------------------------------------------------------------------

const BOX_ROW_H = 12;

/**
 * One list at a time, a line an animal: name and level. The heading says which
 * list and how full; the last row says how to get to the other one, because
 * left and right doing that is not something anyone would guess.
 */
function drawBoxScene(ctx: CanvasRenderingContext2D, content: Content, state: GameState, scene: BoxScene): void {
  drawWorldBackground(ctx, content, state, null);
  const p = state.player;
  const list = scene.side === 'party' ? p.party : p.box;
  const box = PARTY_BOX;
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  const heading = scene.note !== ''
    ? scene.note
    : scene.side === 'party' ? `PARTY ${p.party.length}/6` : `BOX ${p.box.length}/${BOX_MAX}`;
  gb.drawText(ctx, box.x + 10, box.y + 4, heading, 3);

  const right = box.x + box.w - 4;
  const top = boxScroll(scene.cursor, list.length);
  if (list.length === 0) gb.drawText(ctx, box.x + 10, box.y + 18, 'Nobody in here.', 3);
  for (let row = 0; row < BOX_ROWS; row++) {
    const i = top + row;
    const f = list[i];
    if (!f) break;
    const y = box.y + 18 + row * BOX_ROW_H;
    if (i === scene.cursor) gb.drawText(ctx, box.x + 2, y, gb.CURSOR_GLYPH, 3);
    gb.drawText(ctx, box.x + 10, y, creatureLabel(f), 3);
    const level = `Lv${f.level}`;
    gb.drawText(ctx, right - gb.measureText(level), y, level, 3);
  }
  // More below than fits: the same arrow a text box uses for "there is more".
  if (top + BOX_ROWS < list.length) gb.drawText(ctx, right - 8, box.y + 18 + BOX_ROWS * BOX_ROW_H - 2, gb.ADVANCE_PROMPT, 3);
  gb.drawText(ctx, box.x + 10, box.y + box.h - 12, scene.side === 'party' ? 'LEFT/RIGHT: BOX' : 'LEFT/RIGHT: PARTY', 3);
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const NAME_GRID = { x: gb.TEXTBOX_X, y: 48, w: gb.TEXTBOX_W, h: 92 };
/** Letters sit sixteen pixels apart, with the cursor in the gap before each. */
const NAME_CELL_W = 16;
const NAME_ROW_H = 18;
/** The four keys under the letters, three characters each. */
const NAME_KEY_W = 36;

/** What the case key is labelled: the case it will switch TO. */
export function caseKeyLabel(lower: boolean): string {
  return lower ? 'ABC' : 'abc';
}

function drawNaming(ctx: CanvasRenderingContext2D, content: Content, state: GameState, scene: NamingScene): void {
  clearScreen(ctx, 0);
  const p = state.player;
  const target = scene.where === 'party' ? p.party[scene.index] : p.box[scene.index];
  if (!target) return;
  const sp = content.dex.species(target.species);
  const px = creaturePixels(content, target.species);

  if (scene.asking) {
    // The animal you just caught, on its own, and one question about it.
    fillEllipse(ctx, 56, 78, 26, 6, 1);
    gb.drawSprite(ctx, px, 56 - SPRITE_SIZE / 2, 78 - SPRITE_SIZE, 1, false);
    const yn = { x: 112, y: 52, w: 44, h: 34 };
    gb.drawBox(ctx, yn.x, yn.y, yn.w, yn.h);
    for (const [i, label] of ['YES', 'NO'].entries()) {
      const y = yn.y + 6 + i * 13;
      if (i === scene.choice) gb.drawText(ctx, yn.x + 4, y, gb.CURSOR_GLYPH, 3);
      gb.drawText(ctx, yn.x + 14, y, label, 3);
    }
    gb.drawTextBox(ctx, ['Give it a name?', `It is a ${sp.name}.`], 999, false);
    return;
  }

  // Top: the animal, small, and the name as typed so far. Unfilled places are
  // dots, so the limit can be seen before it is hit.
  const scale = 0.6;
  fillEllipse(ctx, 26, 42, 18, 4, 1);
  gb.drawSprite(ctx, px, Math.round(26 - (SPRITE_SIZE * scale) / 2), Math.round(42 - SPRITE_SIZE * scale), scale, false);
  gb.drawText(ctx, 56, 10, `${sp.name}?`, 3);
  gb.drawText(ctx, 56, 26, scene.text + '.'.repeat(Math.max(0, NAME_MAX - scene.text.length)), 3);

  const box = NAME_GRID;
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  for (let r = 0; r < NAME_ROWS.length; r++) {
    const row = NAME_ROWS[r] ?? '';
    const y = box.y + 8 + r * NAME_ROW_H;
    for (let c = 0; c < row.length; c++) {
      const x = box.x + 10 + c * NAME_CELL_W;
      if (r === scene.row && c === scene.col) gb.drawText(ctx, x - 8, y, gb.CURSOR_GLYPH, 3);
      const ch = row[c] ?? '';
      gb.drawText(ctx, x, y, scene.lower ? ch.toLowerCase() : ch, 3);
    }
  }
  const keyY = box.y + 8 + 3 * NAME_ROW_H + 6;
  for (let k = 0; k < NAME_KEYS.length; k++) {
    const x = box.x + 10 + k * NAME_KEY_W;
    if (scene.row === 3 && k === scene.col) gb.drawText(ctx, x - 8, keyY, gb.CURSOR_GLYPH, 3);
    const key = NAME_KEYS[k] ?? '';
    gb.drawText(ctx, x, keyY, key === 'case' ? caseKeyLabel(scene.lower) : key, 3);
  }
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

/** The shelf: one row per thing for sale, its price at the end of the row. */
const SHOP_BOX = { x: 8, y: 4, w: 144, h: 88 };
const SHOP_ROW_H = 12;

function drawShop(ctx: CanvasRenderingContext2D, content: Content, state: GameState, scene: ShopScene): void {
  drawWorldBackground(ctx, content, state, null);
  const p = state.player;
  const stock = shopStock(p.badges.length);
  const box = SHOP_BOX;
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  gb.drawText(ctx, box.x + 12, box.y + 4, 'SUPPLIES', 3);

  const right = box.x + box.w - 4;
  for (let i = 0; i <= stock.length; i++) {
    const y = box.y + 18 + i * SHOP_ROW_H;
    if (i === scene.cursor) gb.drawText(ctx, box.x + 3, y, gb.CURSOR_GLYPH, 3);
    const item = stock[i];
    if (item === undefined) {
      gb.drawText(ctx, box.x + 12, y, 'LEAVE', 3);
      continue;
    }
    gb.drawText(ctx, box.x + 12, y, item.name, 3);
    const price = String(item.price);
    gb.drawText(ctx, right - gb.measureText(price), y, price, 3);
  }

  // Under the shelf: what you have, then what this press would do. The answer
  // to a press ("Sold.") takes the second row until the cursor moves.
  const chosen = stock[scene.cursor];
  const purse = `Purse ${p.money}`;
  const own = chosen === undefined ? '' : `Own ${bagCount(p, chosen.id)}`;
  const top = own === '' ? purse : `${purse}${' '.repeat(Math.max(1, TEXT_COLS - purse.length - own.length))}${own}`;
  const bottom = scene.note !== ''
    ? scene.note
    : chosen === undefined ? '' : `Buy ${scene.qty} for ${chosen.price * scene.qty}?`;
  gb.drawTextBox(ctx, [top, bottom], 999, false);
}

// ---------------------------------------------------------------------------
// Terminal screens
// ---------------------------------------------------------------------------

function drawGameOver(ctx: CanvasRenderingContext2D): void {
  clearScreen(ctx, 3);
  const text = 'GAME OVER';
  gb.drawText(ctx, (LOGICAL_W - gb.measureText(text)) / 2, 68, text, 0);
}

function drawHallOfFame(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  if (state.scene.kind !== 'hallOfFame') return;
  clearScreen(ctx, 0);
  const title = 'HALL OF FAME';
  gb.drawText(ctx, (LOGICAL_W - gb.measureText(title)) / 2, 8, title, 3);
  // One animal a line: picture, name, level. They used to stand three abreast
  // with the names underneath, and a twelve-letter name is twice as wide as
  // the column it was given, so every name was written across its neighbour.
  const party = state.player.party.slice(0, 6);
  for (let i = 0; i < party.length; i++) {
    const f = party[i];
    if (!f) continue;
    const y = 24 + i * 17;
    gb.drawSprite(ctx, creaturePixels(content, f.species), 6, y - 2, 0.3);
    gb.drawText(ctx, 28, y + 4, creatureLabel(f), 3);
    // Just the number: a twelve-letter name and "Lv100" do not both fit.
    const level = String(f.level);
    gb.drawText(ctx, LOGICAL_W - 8 - gb.measureText(level), y + 4, level, 3);
  }
  // It is not the end. Once the Hall has held long enough to be looked at, it
  // says how to go on.
  const ready = state.scene.ticks >= HALL_HOLD_TICKS;
  if (!ready || Math.floor(state.frame / 30) % 2 === 0) {
    const prompt = ready ? 'PRESS A' : 'CROWNED';
    gb.drawText(ctx, (LOGICAL_W - gb.measureText(prompt)) / 2, LOGICAL_H - 12, prompt, 3);
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * `starterCursor` is the one bit of shell-owned UI state (see file header);
 * it is ignored on every scene but the overworld-with-no-starter-yet screen.
 */
export function draw(
  ctx: CanvasRenderingContext2D,
  content: Content,
  state: GameState,
  starterCursor = 0,
): void {
  switch (state.scene.kind) {
    case 'starterPick':
      drawStarterPick(ctx, content, state.scene);
      break;
    case 'title':
      drawTitle(ctx, content, state);
      return;
    case 'overworld':
      drawOverworld(ctx, content, state, starterCursor);
      return;
    case 'dialogue':
      drawDialogue(ctx, content, state);
      return;
    case 'battle':
      drawBattle(ctx, content, state);
      return;
    case 'menu':
      drawMenu(ctx, content, state);
      return;
    case 'shop':
      drawShop(ctx, content, state, state.scene);
      return;
    case 'naming':
      drawNaming(ctx, content, state, state.scene);
      return;
    case 'box':
      drawBoxScene(ctx, content, state, state.scene);
      return;
    case 'gameover':
      drawGameOver(ctx);
      return;
    case 'hallOfFame':
      drawHallOfFame(ctx, content, state);
      return;
  }
}
