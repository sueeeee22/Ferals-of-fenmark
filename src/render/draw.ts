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

import type { Content, GameState, BattleScene, MenuScene } from '../core/game.ts';
import { STARTERS, WALK_FRAMES } from '../core/game.ts';
import { activeOf } from '../core/battle.ts';
import type { BattleState, Side } from '../core/battle.ts';
import { tileAt, visibleNpcs, type GameMap, type Dir } from '../core/world.ts';
import { maxHp } from '../core/creature.ts';
import type { Feral, Species, StatusName } from '../core/creature.ts';
import { spriteFor, SPRITE_SIZE, type Pixels } from './forge.ts';
import * as gb from './gb.ts';
import { LOGICAL_W, LOGICAL_H, TILE_SIZE, shadeColor } from './gb.ts';

// ---------------------------------------------------------------------------
// Creature sprite cache — forged once per species id, reused forever after.
// ---------------------------------------------------------------------------

const creaturePixelsCache = new Map<string, Pixels>();

function creaturePixels(content: Content, speciesId: string): Pixels {
  const cached = creaturePixelsCache.get(speciesId);
  if (cached) return cached;
  const sp = content.dex.species(speciesId);
  const px = spriteFor(sp.id, sp.family, sp.stage, sp.spriteSeed, sp.legendary ?? false);
  creaturePixelsCache.set(speciesId, px);
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
  ctx.fillStyle = shadeColor(shade);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
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

function cameraFor(x: number, y: number, fromX: number, fromY: number, progress: number): Camera {
  const t = progress > 0 ? Math.min(1, progress / WALK_FRAMES) : 0;
  const px = lerp(fromX, x, t) * TILE_SIZE;
  const py = lerp(fromY, y, t) * TILE_SIZE;
  const originX = Math.round(LOGICAL_W / 2 - TILE_SIZE / 2 - px);
  const originY = Math.round(LOGICAL_H / 2 - TILE_SIZE / 2 - py);
  return { originX, originY };
}

const ANIM_TICKS = 20;

function drawTiles(ctx: CanvasRenderingContext2D, map: GameMap, cam: Camera, frame: number): void {
  const animFrame = Math.floor(frame / ANIM_TICKS);
  const startTx = Math.floor(-cam.originX / TILE_SIZE) - 1;
  const endTx = startTx + Math.ceil(LOGICAL_W / TILE_SIZE) + 2;
  const startTy = Math.floor(-cam.originY / TILE_SIZE) - 1;
  const endTy = startTy + Math.ceil(LOGICAL_H / TILE_SIZE) + 2;
  for (let ty = startTy; ty <= endTy; ty++) {
    for (let tx = startTx; tx <= endTx; tx++) {
      const id = tileAt(map, tx, ty);
      gb.drawTile(ctx, id, animFrame, cam.originX + tx * TILE_SIZE, cam.originY + ty * TILE_SIZE);
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
  walk: { progress: number; dir: Dir; fromX: number; fromY: number } | null,
): void {
  const p = state.player;
  const map = content.world.map(p.mapId);
  const progress = walk?.progress ?? 0;
  const fromX = walk?.fromX ?? p.x;
  const fromY = walk?.fromY ?? p.y;
  const cam = cameraFor(p.x, p.y, fromX, fromY, progress);

  clearScreen(ctx, map.indoor ? 0 : 1);
  drawTiles(ctx, map, cam, state.frame);

  const flags = new Set(p.flags);
  for (const npc of visibleNpcs(map, flags)) {
    const sx = cam.originX + npc.x * TILE_SIZE;
    const sy = cam.originY + npc.y * TILE_SIZE;
    if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > LOGICAL_W || sy > LOGICAL_H) continue;
    gb.drawActor(ctx, npc.sprite, npc.facing, 0, 0, sx, sy);
  }

  const pose = walkPose(progress, fromX, fromY);
  const dir = progress > 0 ? (walk?.dir ?? p.facing) : p.facing;
  const playerSx = Math.round(LOGICAL_W / 2 - TILE_SIZE / 2);
  const playerSy = Math.round(LOGICAL_H / 2 - TILE_SIZE / 2);
  gb.drawActor(ctx, 'player', dir, pose.frame, pose.step, playerSx, playerSy);
}

// Location banner: shown for a beat after the map id changes. Edge-detected
// across draw calls (see file header) — never consulted by game logic.
let bannerMapId: string | null = null;
let bannerUntil = -1;

function drawLocationBanner(ctx: CanvasRenderingContext2D, state: GameState): void {
  const p = state.player;
  if (p.mapId !== bannerMapId) {
    bannerMapId = p.mapId;
    bannerUntil = state.frame + 80;
  }
  if (state.frame > bannerUntil) return;
  const map = bannerMapId;
  if (map === null) return;
  const name = map.replace(/_/g, ' ').toUpperCase();
  const w = Math.min(LOGICAL_W - 16, gb.measureText(name) + 16);
  gb.drawBox(ctx, 8, 8, w, 20);
  gb.drawText(ctx, 16, 14, name.slice(0, 18), 3);
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
  drawLocationBanner(ctx, state);
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

function drawDialogue(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  if (state.scene.kind !== 'dialogue') return;
  const scene = state.scene;
  drawWorldBackground(ctx, content, state, null);
  const line = scene.lines[scene.index] ?? '';
  const rows = gb.wrapText(line, 18);
  const revealed = rows.reduce((a, r) => a + r.length + 1, 0) - 1;
  const showPrompt = scene.chars >= line.length && Math.floor(state.frame / 20) % 2 === 0;
  gb.drawTextBox(ctx, rows, Math.min(scene.chars, Math.max(0, revealed)), showPrompt);
}

// ---------------------------------------------------------------------------
// Battle — the most important screen
// ---------------------------------------------------------------------------

const ENEMY_BOX = { x: 4, y: 4, w: 92, h: 28 };
const PLAYER_BOX = { x: 84, y: 58, w: 72, h: 34 };
const ENEMY_ANCHOR = { cx: 126, cy: 56, scale: 0.72 };
const PLAYER_ANCHOR = { cx: 38, cy: 104, scale: 1.02 };

function creatureLabel(f: Feral): string {
  return f.nickname.length > 10 ? f.nickname.slice(0, 10) : f.nickname;
}

function drawSideInfo(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  f: Feral,
  showNumbers: boolean,
  sp: Species,
): void {
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  const name = `${creatureLabel(f)} ${f.level < 10 ? ' ' : ''}Lv${f.level}`;
  gb.drawText(ctx, box.x + 5, box.y + 4, name, 3);
  if (f.status) {
    gb.drawText(ctx, box.x + box.w - 34, box.y + 4, STATUS_TAG[f.status], 3);
  }
  gb.drawHpBar(ctx, box.x + 5, box.y + 14, f.hp, maxHp(sp, f), Math.min(48, box.w - 12));
  if (showNumbers) {
    const text = `${f.hp}/${maxHp(sp, f)}`;
    gb.drawText(ctx, box.x + box.w - gb.measureText(text) - 5, box.y + 22, text, 3);
  }
}

function sideActive(side: Side): Feral {
  return activeOf(side);
}

const BOTTOM_Y = 96;
const BOTTOM_W = 144;
const BOTTOM_H = 40;
const LEFT_W = 84;
const RIGHT_X = 8 + LEFT_W;
const RIGHT_W = BOTTOM_W - LEFT_W;

const COMMANDS = ['FIGHT', 'BAG', 'PARTY', 'RUN'] as const;

function drawCommandGrid(ctx: CanvasRenderingContext2D, cursor: number): void {
  gb.drawBox(ctx, RIGHT_X, BOTTOM_Y, RIGHT_W, BOTTOM_H);
  for (let i = 0; i < COMMANDS.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = RIGHT_X + 8 + col * 32;
    const y = BOTTOM_Y + 6 + row * 16;
    if (i === cursor) gb.drawText(ctx, x - 8, y, gb.CURSOR_GLYPH, 3);
    gb.drawText(ctx, x, y, COMMANDS[i] ?? '', 3);
  }
}

function drawMessageBox(ctx: CanvasRenderingContext2D, text: string): void {
  gb.drawBox(ctx, 8, BOTTOM_Y, LEFT_W, BOTTOM_H);
  const rows = gb.wrapText(text, 12);
  for (let i = 0; i < 2; i++) {
    const row = rows[i];
    if (row) gb.drawText(ctx, 8 + 6, BOTTOM_Y + 6 + i * 14, row, 3);
  }
}

function drawMoveList(ctx: CanvasRenderingContext2D, content: Content, scene: BattleScene): void {
  const box = { x: 8, y: 80, w: 144, h: 56 };
  gb.drawBox(ctx, box.x, box.y, box.w, box.h);
  const moves = activeOf(scene.battle.player).moves;
  for (let i = 0; i < 4; i++) {
    const slot = moves[i];
    const y = box.y + 6 + i * 12;
    if (i === scene.moveCursor) gb.drawText(ctx, box.x + 4, y, gb.CURSOR_GLYPH, 3);
    if (!slot) continue;
    const mv = content.dex.move(slot.move);
    const name = mv.name.length > 12 ? `${mv.name.slice(0, 11)}.` : mv.name;
    gb.drawText(ctx, box.x + 16, y, name, 3);
    const pp = `${slot.pp}/${slot.maxPp}`;
    gb.drawText(ctx, box.x + box.w - gb.measureText(pp) - 8, y, pp, 3);
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

function drawPartyOverlay(
  ctx: CanvasRenderingContext2D,
  content: Content,
  party: readonly Feral[],
  cursor: number,
  title: string,
): void {
  const rows = party.map((f) => creatureLabel(f));
  drawListOverlay(ctx, title, rows, cursor, (i, x, y) => {
    const f = party[i];
    if (!f) return;
    const sp = content.dex.species(f.species);
    gb.drawHpBar(ctx, x, y + 1, f.hp, maxHp(sp, f), 40);
  });
}

function drawBagOverlay(
  ctx: CanvasRenderingContext2D,
  bag: readonly { item: string; count: number }[],
  cursor: number,
): void {
  const rows = bag.map((s) => s.item.replace(/_/g, ' '));
  drawListOverlay(ctx, 'BAG', rows, cursor, (i, x, y) => {
    const s = bag[i];
    if (!s) return;
    gb.drawText(ctx, x + 40 - gb.measureText(`x${s.count}`), y, `x${s.count}`, 3);
  });
}

function drawBattle(ctx: CanvasRenderingContext2D, content: Content, state: GameState): void {
  if (state.scene.kind !== 'battle') return;
  const scene = state.scene;
  const battle: BattleState = scene.battle;

  clearScreen(ctx, 0);

  const enemy = sideActive(battle.enemy);
  const enemySp = content.dex.species(enemy.species);
  const player = sideActive(battle.player);
  const playerSp = content.dex.species(player.species);

  fillEllipse(ctx, ENEMY_ANCHOR.cx, ENEMY_ANCHOR.cy + 20, 22, 6, 1);
  gb.drawSprite(
    ctx, creaturePixels(content, enemy.species),
    ENEMY_ANCHOR.cx - (SPRITE_SIZE * ENEMY_ANCHOR.scale) / 2,
    ENEMY_ANCHOR.cy - SPRITE_SIZE * ENEMY_ANCHOR.scale + 20,
    ENEMY_ANCHOR.scale, false,
  );
  drawSideInfo(ctx, ENEMY_BOX, enemy, false, enemySp);

  fillEllipse(ctx, PLAYER_ANCHOR.cx, PLAYER_ANCHOR.cy + 20, 26, 7, 1);
  gb.drawSprite(
    ctx, creaturePixels(content, player.species),
    PLAYER_ANCHOR.cx - (SPRITE_SIZE * PLAYER_ANCHOR.scale) / 2,
    PLAYER_ANCHOR.cy - SPRITE_SIZE * PLAYER_ANCHOR.scale + 20,
    PLAYER_ANCHOR.scale, true,
  );
  drawSideInfo(ctx, PLAYER_BOX, player, true, playerSp);

  const draining = scene.queue.length > 0 || battle.outcome !== 'ongoing';
  if (draining) {
    const rows = gb.wrapText(state.lastText, 18);
    gb.drawTextBox(ctx, rows, 999, false);
    return;
  }

  if (scene.sub === 'forceSwitch' || scene.sub === 'party') {
    drawPartyOverlay(ctx, content, battle.player.party, scene.partyCursor, scene.sub === 'forceSwitch' ? 'SEND OUT WHO?' : 'PARTY');
    return;
  }
  if (scene.sub === 'bag') {
    drawBagOverlay(ctx, state.player.bag, scene.bagCursor);
    return;
  }
  if (scene.sub === 'moves') {
    drawMoveList(ctx, content, scene);
    return;
  }

  drawMessageBox(ctx, state.lastText || `What will ${creatureLabel(player)} do?`);
  drawCommandGrid(ctx, scene.cursor);
}

// ---------------------------------------------------------------------------
// Menu (the pause menu)
// ---------------------------------------------------------------------------

/** Mirrors game.ts's private MENU_ROOT — the cursor math there assumes this order. */
const MENU_ROOT = ['PARTY', 'BAG', 'DEX', 'SAVE', 'BACK'] as const;

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
    drawPartyOverlay(ctx, content, state.player.party, scene.subCursor, 'PARTY');
    return;
  }
  if (scene.sub === 'bag') {
    drawBagOverlay(ctx, state.player.bag, scene.subCursor);
    return;
  }
  // 'dex' and the unreachable 'save' sub share a simple placeholder box.
  drawListOverlay(ctx, scene.sub.toUpperCase(), ['Coming soon.'], -1);
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
  gb.drawText(ctx, (LOGICAL_W - gb.measureText(title)) / 2, 12, title, 3);
  const party = state.player.party.slice(0, 6);
  for (let i = 0; i < party.length; i++) {
    const f = party[i];
    if (!f) continue;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 12 + col * 48;
    const y = 28 + row * 56;
    gb.drawSprite(ctx, creaturePixels(content, f.species), x, y, 0.6);
    gb.drawText(ctx, x, y + 40, creatureLabel(f), 3);
  }
  if (Math.floor(state.frame / 30) % 2 === 0) {
    const prompt = 'THE END';
    gb.drawText(ctx, (LOGICAL_W - gb.measureText(prompt)) / 2, LOGICAL_H - 16, prompt, 3);
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
    case 'gameover':
      drawGameOver(ctx);
      return;
    case 'hallOfFame':
      drawHallOfFame(ctx, content, state);
      return;
  }
}
