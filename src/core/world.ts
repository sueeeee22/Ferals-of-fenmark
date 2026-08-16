/**
 * The overworld: tile grid, collision, warps, encounter tables and NPC
 * line-of-sight aggro.
 *
 * Pure and headless, like everything in src/core. The renderer reads this; it
 * never writes to it. `gauntlet:playthrough` walks a bot through these same
 * functions, so if the bot can reach the Champion, a player can.
 */

import type { Rng } from './rng.ts';

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/**
 * Tile ids are bytes so a map is a Uint8Array and a save stays small.
 * The properties table is what collision and encounters actually read.
 */
export const Tile = {
  Void: 0,
  Floor: 1,
  Grass: 2,
  TallGrass: 3,
  Path: 4,
  Water: 5,
  Wall: 6,
  Tree: 7,
  Rock: 8,
  House: 9,
  Door: 10,
  Sign: 11,
  Counter: 12,
  Carpet: 13,
  LedgeDown: 14,
  Sand: 15,
  Snow: 16,
  DeepSnow: 17,
  Flower: 18,
  Fence: 19,
  Bridge: 20,
  CaveFloor: 21,
  CaveWall: 22,
  Stairs: 23,
  Bed: 24,
  Table: 25,
} as const;

export type Tile = (typeof Tile)[keyof typeof Tile];

export interface TileProps {
  readonly solid: boolean;
  /** Wild encounters can trigger here. */
  readonly encounter: boolean;
  /** Requires the Tide badge equivalent to cross. */
  readonly water: boolean;
  /** One-way hop southward, like Gen 1's ledges. */
  readonly ledge: boolean;
  /** Blocks NPC line of sight. */
  readonly blocksSight: boolean;
}

const T = (
  solid: boolean,
  encounter = false,
  water = false,
  ledge = false,
  blocksSight = solid,
): TileProps => ({ solid, encounter, water, ledge, blocksSight });

export const TILE_PROPS: Readonly<Record<number, TileProps>> = {
  [Tile.Void]: T(true),
  [Tile.Floor]: T(false),
  [Tile.Grass]: T(false),
  [Tile.TallGrass]: T(false, true, false, false, false),
  [Tile.Path]: T(false),
  [Tile.Water]: T(true, true, true, false, false),
  [Tile.Wall]: T(true),
  [Tile.Tree]: T(true),
  [Tile.Rock]: T(true),
  [Tile.House]: T(true),
  [Tile.Door]: T(false),
  [Tile.Sign]: T(true, false, false, false, false),
  [Tile.Counter]: T(true, false, false, false, false),
  [Tile.Carpet]: T(false),
  [Tile.LedgeDown]: T(false, false, false, true, false),
  [Tile.Sand]: T(false),
  [Tile.Snow]: T(false),
  [Tile.DeepSnow]: T(false, true, false, false, false),
  [Tile.Flower]: T(false),
  [Tile.Fence]: T(true, false, false, false, false),
  [Tile.Bridge]: T(false),
  [Tile.CaveFloor]: T(false, true, false, false, false),
  [Tile.CaveWall]: T(true),
  [Tile.Stairs]: T(false),
  [Tile.Bed]: T(false),
  [Tile.Table]: T(true, false, false, false, false),
};

export function propsOf(tile: number): TileProps {
  return TILE_PROPS[tile] ?? TILE_PROPS[Tile.Void]!;
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIR_VEC: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export interface Warp {
  readonly x: number;
  readonly y: number;
  readonly toMap: string;
  readonly toX: number;
  readonly toY: number;
  /** Set for doors that need a badge or story flag. */
  readonly requiresFlag?: string;
  readonly blockedText?: string;
}

export interface EncounterSlot {
  readonly species: string;
  readonly min: number;
  readonly max: number;
  /** Relative weight within the table. */
  readonly weight: number;
}

export interface EncounterTable {
  /** Chance per encounter-tile step, 0..1. Gen 1 sat around 0.1. */
  readonly rate: number;
  readonly slots: readonly EncounterSlot[];
}

export type NpcKind = 'trainer' | 'talker' | 'shop' | 'healer' | 'rival' | 'leader' | 'item';

export interface NpcDef {
  readonly id: string;
  readonly kind: NpcKind;
  readonly x: number;
  readonly y: number;
  readonly facing: Dir;
  readonly sprite: string;
  readonly name: string;
  /** Tiles of line-of-sight aggro. 0 for non-trainers. */
  readonly sight: number;
  /** Dialogue key. */
  readonly dialogue: string;
  /** Trainer team; ids into the trainer table. */
  readonly team?: string;
  /** Set once defeated / talked to, so the world remembers. */
  readonly flag?: string;
  /** NPC is only present when this flag is set. */
  readonly requiresFlag?: string;
  /** NPC disappears once this flag is set. */
  readonly hiddenByFlag?: string;
}

export interface GameMap {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** width*height tile ids. */
  readonly tiles: Uint8Array;
  readonly warps: readonly Warp[];
  readonly npcs: readonly NpcDef[];
  readonly encounters: EncounterTable | null;
  /** Indoor maps do not show the location banner and use a different palette. */
  readonly indoor: boolean;
  readonly music: string;
}

export interface World {
  map(id: string): GameMap;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function tileAt(map: GameMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Tile.Void;
  return map.tiles[y * map.width + x] ?? Tile.Void;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Active NPCs, after flag filtering. */
export function visibleNpcs(map: GameMap, flags: ReadonlySet<string>): readonly NpcDef[] {
  return map.npcs.filter((n) => {
    if (n.requiresFlag !== undefined && !flags.has(n.requiresFlag)) return false;
    if (n.hiddenByFlag !== undefined && flags.has(n.hiddenByFlag)) return false;
    return true;
  });
}

export function npcAt(
  map: GameMap,
  flags: ReadonlySet<string>,
  x: number,
  y: number,
): NpcDef | null {
  return visibleNpcs(map, flags).find((n) => n.x === x && n.y === y) ?? null;
}

/**
 * Can the player step from (x,y) to (nx,ny)?
 * Ledges are one-way: enterable only while moving down, exactly like Gen 1.
 */
export function canWalk(
  map: GameMap,
  flags: ReadonlySet<string>,
  x: number,
  y: number,
  dir: Dir,
  canSwim: boolean,
): boolean {
  const [dx, dy] = DIR_VEC[dir];
  const nx = x + dx;
  const ny = y + dy;
  if (!inBounds(map, nx, ny)) return false;

  const p = propsOf(tileAt(map, nx, ny));
  if (p.ledge) return dir === 'down';
  if (p.water) return canSwim;
  if (p.solid) return false;
  if (npcAt(map, flags, nx, ny) !== null) return false;
  return true;
}

/** A ledge hop moves two tiles instead of one. */
export function isLedgeHop(map: GameMap, x: number, y: number, dir: Dir): boolean {
  if (dir !== 'down') return false;
  return propsOf(tileAt(map, x, y + 1)).ledge;
}

export function warpAt(map: GameMap, x: number, y: number): Warp | null {
  return map.warps.find((w) => w.x === x && w.y === y) ?? null;
}

// ---------------------------------------------------------------------------
// Wild encounters
// ---------------------------------------------------------------------------

export interface RolledEncounter {
  readonly species: string;
  readonly level: number;
}

/**
 * Rolled once per step onto an encounter tile. Returns null most of the time.
 * The RNG is advanced exactly once for the gate roll so that step counts stay
 * comparable across runs — determinism matters more here than micro-efficiency.
 */
export function rollEncounter(
  map: GameMap,
  x: number,
  y: number,
  rng: Rng,
  repelLevel: number,
): RolledEncounter | null {
  const table = map.encounters;
  if (!table || table.slots.length === 0) return null;
  if (!propsOf(tileAt(map, x, y)).encounter) return null;
  if (!rng.chance(table.rate)) return null;

  const slot = rng.weighted(table.slots, table.slots.map((s) => s.weight));
  const level = rng.range(slot.min, slot.max);
  // Repels suppress anything at or below the lead creature's level.
  if (repelLevel > 0 && level <= repelLevel) return null;
  return { species: slot.species, level };
}

// ---------------------------------------------------------------------------
// Trainer line of sight
// ---------------------------------------------------------------------------

/**
 * The trainer sees the player if they are in the straight line the trainer is
 * facing, within `sight` tiles, with nothing sight-blocking in between.
 * This is the Gen 1 rule and it is what makes routes feel like a gauntlet.
 */
export function seesPlayer(
  map: GameMap,
  npc: NpcDef,
  px: number,
  py: number,
): boolean {
  if (npc.kind !== 'trainer' && npc.kind !== 'rival') return false;
  if (npc.sight <= 0) return false;

  const [dx, dy] = DIR_VEC[npc.facing];
  for (let i = 1; i <= npc.sight; i++) {
    const cx = npc.x + dx * i;
    const cy = npc.y + dy * i;
    if (!inBounds(map, cx, cy)) return false;
    if (cx === px && cy === py) return true;
    if (propsOf(tileAt(map, cx, cy)).blocksSight) return false;
  }
  return false;
}

/** The first undefeated trainer with the player in their sightline, if any. */
export function triggeredTrainer(
  map: GameMap,
  flags: ReadonlySet<string>,
  px: number,
  py: number,
): NpcDef | null {
  for (const npc of visibleNpcs(map, flags)) {
    if (npc.flag !== undefined && flags.has(npc.flag)) continue;
    if (seesPlayer(map, npc, px, py)) return npc;
  }
  return null;
}

/** Where a triggered trainer walks to: one tile short of the player. */
export function approachTile(npc: NpcDef, px: number, py: number): readonly [number, number] {
  const [dx, dy] = DIR_VEC[npc.facing];
  return [px - dx, py - dy];
}

/** Direction from (x,y) toward (tx,ty), for turning to face someone. */
export function facingToward(x: number, y: number, tx: number, ty: number): Dir {
  if (Math.abs(tx - x) >= Math.abs(ty - y)) return tx >= x ? 'right' : 'left';
  return ty >= y ? 'down' : 'up';
}
