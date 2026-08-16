/**
 * Creature data model, stat math, and the damage formula.
 *
 * This file is the contract every content generator and every gauntlet codes
 * against. Change a shape here and the schema gauntlet will tell you what broke.
 *
 * Shaped like Gen 1, with its bugs deliberately removed — see PLAN.md §5.
 */

import type { FeralType } from './types.ts';
import { effectiveness, stab } from './types.ts';
import type { Rng } from './rng.ts';

// ---------------------------------------------------------------------------
// Static species data (generated into src/data/species.gen.ts)
// ---------------------------------------------------------------------------

/** Where a species sits in its evolution line. Drives the stat budget band. */
export type Stage = 'pup' | 'adult' | 'apex';

/**
 * Role archetype. Decides how a species' stat budget is distributed, so that
 * 150 statlines come from a generator with ~20 knobs rather than 150 hand edits.
 */
export type Archetype =
  | 'bruiser' // high Atk/HP, low Spe
  | 'skirmisher' // high Spe/Atk, paper defences
  | 'bulwark' // high Def/HP
  | 'channeler' // high SpA
  | 'warden' // high SpD/HP
  | 'allrounder'; // flat spread

export interface BaseStats {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly spa: number;
  readonly spd: number;
  readonly spe: number;
}

export type StatKey = keyof BaseStats;

export const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

/** How a species learns a move: by level, by evolving, or as a starting move. */
export interface LearnEntry {
  readonly level: number;
  readonly move: string;
}

export interface Evolution {
  /** Dex id of what this becomes. */
  readonly into: string;
  readonly level: number;
}

export interface Species {
  /** Stable string id, e.g. 'winter_pup'. Never renumbered. */
  readonly id: string;
  /** National dex number, 1..N, unique. */
  readonly dex: number;
  readonly name: string;
  /** The real animal. Non-negotiable: every creature is a real animal. */
  readonly animal: string;
  readonly family: Family;
  readonly types: readonly [FeralType] | readonly [FeralType, FeralType];
  readonly stage: Stage;
  readonly archetype: Archetype;
  readonly base: BaseStats;
  /** Sorted ascending by level, covering 1..60 with no gap > MAX_LEARN_GAP. */
  readonly learnset: readonly LearnEntry[];
  readonly evolvesTo?: Evolution;
  /** Set on every stage after the first; lets the schema gauntlet find orphans. */
  readonly evolvesFrom?: string;
  /** Base experience yield when defeated. */
  readonly expYield: number;
  /** 0..255, Gen 1's catch-rate scale. Legendaries sit at 3. */
  readonly catchRate: number;
  readonly dexEntry: string;
  /** Seed for the procedural sprite forge. Deterministic per species. */
  readonly spriteSeed: number;
  readonly legendary?: boolean;
}

/** Silhouette family — drives the sprite forge's base shape and the encounter tables. */
export type Family =
  | 'canid'
  | 'felid'
  | 'ursid'
  | 'bird'
  | 'mustelid'
  | 'rodent'
  | 'ungulate'
  | 'reptile';

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export type MoveCategory = 'physical' | 'special' | 'status';

export type StatusName = 'burn' | 'chill' | 'venom' | 'panic' | 'sleep' | 'stun';

export interface MoveEffect {
  /** 0..1 chance the secondary effect fires. */
  readonly chance: number;
  readonly status?: StatusName;
  /** Stat stage changes applied to target (negative) or self (positive). */
  readonly stages?: Partial<Record<StatKey, number>>;
  readonly targetsSelf?: boolean;
  /** Fraction of damage dealt returned as recoil. */
  readonly recoil?: number;
  /** Fraction of damage dealt healed to the user. */
  readonly drain?: number;
  /** Fraction of the user's max HP healed. */
  readonly heal?: number;
  /** Always hits twice..n times. */
  readonly multiHit?: readonly [number, number];
  /** Ignores accuracy checks entirely. */
  readonly alwaysHits?: boolean;
  /** Elevated critical-hit rate. */
  readonly highCrit?: boolean;
}

export interface Move {
  readonly id: string;
  readonly name: string;
  readonly type: FeralType;
  readonly category: MoveCategory;
  /** 0 for status moves. */
  readonly power: number;
  /** 0..100. 101 means "cannot miss". */
  readonly accuracy: number;
  readonly pp: number;
  readonly priority: number;
  readonly effect?: MoveEffect;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Live creature instances
// ---------------------------------------------------------------------------

export interface MoveSlot {
  readonly move: string;
  pp: number;
  readonly maxPp: number;
}

export interface Feral {
  readonly species: string;
  /** Player-given name, or the species name. */
  nickname: string;
  level: number;
  exp: number;
  hp: number;
  /** Individual values, 0..15 per stat, Gen 1's scale. */
  readonly ivs: BaseStats;
  /** Effort values, 0..65535 per stat, Gen 1's scale. */
  evs: BaseStats;
  moves: MoveSlot[];
  status: StatusName | null;
  /** Turns remaining for sleep. */
  statusTurns: number;
  /** Set once at capture; used by the Hall of Fame and the dex. */
  readonly caughtAt: number;
  readonly originalTrainer: string;
}

// ---------------------------------------------------------------------------
// Stat math
// ---------------------------------------------------------------------------

/**
 * Gen 1's stat formula, kept because it produces the level curve players expect.
 * HP gets +level+10; everything else gets +5.
 */
export function computeStat(
  base: number,
  iv: number,
  ev: number,
  level: number,
  isHp: boolean,
): number {
  const evTerm = Math.floor(Math.min(255, Math.ceil(Math.sqrt(ev))) / 4);
  const core = Math.floor((((base + iv) * 2 + evTerm) * level) / 100);
  return isHp ? core + level + 10 : core + 5;
}

export function maxHp(species: Species, f: Feral): number {
  return computeStat(species.base.hp, f.ivs.hp, f.evs.hp, f.level, true);
}

export function statOf(species: Species, f: Feral, key: StatKey): number {
  if (key === 'hp') return maxHp(species, f);
  return computeStat(species.base[key], f.ivs[key], f.evs[key], f.level, false);
}

/** Sum of base stats. The schema gauntlet bands this by evolution stage. */
export function baseStatTotal(b: BaseStats): number {
  return b.hp + b.atk + b.def + b.spa + b.spd + b.spe;
}

// ---------------------------------------------------------------------------
// Stat stages (-6..+6), Gen 1's multiplier table
// ---------------------------------------------------------------------------

const STAGE_NUM = [25, 28, 33, 40, 50, 66, 100, 150, 200, 250, 300, 350, 400] as const;

export function stageMultiplier(stage: number): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return STAGE_NUM[clamped + 6]! / 100;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export interface DamageInput {
  readonly attackerLevel: number;
  readonly attack: number;
  readonly defense: number;
  readonly power: number;
  readonly stabMult: number;
  readonly typeMult: number;
  readonly critical: boolean;
  /** Burn halves physical attack. */
  readonly burned: boolean;
  /** 0.85..1.00 roll, passed in so damage stays a pure function. */
  readonly roll: number;
}

export interface DamageResult {
  readonly damage: number;
  readonly typeMult: number;
  readonly critical: boolean;
}

/**
 * Gen 1's damage shape: (((2*L/5 + 2) * P * A / D) / 50 + 2) * modifiers.
 * A critical hit multiplies by 2 (Gen 1 used a level-ratio term that produced
 * absurd numbers at low level; 2x is the sane version every later gen adopted).
 */
export function computeDamage(input: DamageInput): DamageResult {
  if (input.power <= 0 || input.typeMult === 0) {
    return { damage: 0, typeMult: input.typeMult, critical: false };
  }

  let attack = input.attack;
  if (input.burned) attack = Math.floor(attack / 2);

  const levelTerm = Math.floor((2 * input.attackerLevel) / 5) + 2;
  let dmg = Math.floor((levelTerm * input.power * Math.max(1, attack)) / Math.max(1, input.defense));
  dmg = Math.floor(dmg / 50) + 2;

  if (input.critical) dmg *= 2;
  dmg = Math.floor(dmg * input.stabMult);
  dmg = Math.floor(dmg * input.typeMult);
  dmg = Math.floor(dmg * input.roll);

  return {
    damage: Math.max(1, dmg),
    typeMult: input.typeMult,
    critical: input.critical,
  };
}

/** The 0.85..1.00 damage spread, as 217..255 over 255 — Gen 1's exact granularity. */
export function damageRoll(rng: Rng): number {
  return rng.range(217, 255) / 255;
}

/**
 * Critical-hit chance from base Speed, like Gen 1, but without the bug that made
 * high-crit moves *worse* on fast creatures. Capped so nothing crits half the time.
 */
export function critChance(baseSpeed: number, highCrit: boolean): number {
  const base = baseSpeed / 512;
  return Math.min(0.25, highCrit ? base * 4 : base);
}

/** Full type multiplier for a move against a defender. */
export function typeMultiplier(
  moveType: FeralType,
  defenderTypes: readonly [FeralType] | readonly [FeralType, FeralType],
): number {
  return effectiveness(moveType, defenderTypes);
}

export { stab };

// ---------------------------------------------------------------------------
// Experience — Gen 1's medium-fast curve
// ---------------------------------------------------------------------------

export function expForLevel(level: number): number {
  return Math.floor(level ** 3);
}

export function levelForExp(exp: number): number {
  let lvl = 1;
  while (lvl < MAX_LEVEL && expForLevel(lvl + 1) <= exp) lvl++;
  return lvl;
}

/** Exp awarded for defeating a creature. Gen 1's formula, wild/trainer split included. */
export function expGain(defeated: Species, defeatedLevel: number, fromTrainer: boolean): number {
  const raw = Math.floor((defeated.expYield * defeatedLevel) / 7);
  return Math.max(1, fromTrainer ? Math.floor(raw * 1.5) : raw);
}

export const MAX_LEVEL = 100;
/** Learnsets must not leave a creature without a new move for longer than this. */
export const MAX_LEARN_GAP = 12;

// ---------------------------------------------------------------------------
// Catching
// ---------------------------------------------------------------------------

export interface CatchInput {
  readonly catchRate: number;
  readonly maxHp: number;
  readonly currentHp: number;
  /** 1 = standard, higher = better ball. */
  readonly ballBonus: number;
  readonly status: StatusName | null;
}

/**
 * Gen 1's catch maths, cleaned up: HP ratio dominates, status helps, ball
 * multiplies. Returns the number of shakes (0..4); 4 is a capture.
 */
export function catchShakes(input: CatchInput, rng: Rng): number {
  const statusBonus =
    input.status === 'sleep' ? 2.5 : input.status === 'stun' || input.status === 'chill' ? 2 : 1;

  const hpFactor = (3 * input.maxHp - 2 * Math.max(1, input.currentHp)) / (3 * input.maxHp);
  const rate = Math.min(
    255,
    Math.max(1, Math.floor(input.catchRate * input.ballBonus * hpFactor * statusBonus)),
  );

  if (rate >= 255) return 4;

  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (rng.int(256) < rate) shakes++;
    else break;
  }
  return shakes;
}
