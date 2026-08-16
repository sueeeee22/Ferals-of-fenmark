/**
 * Shared helpers for driving the real battle engine outside the UI: building a
 * `Dex` from the generated content tables, rolling a legal `Feral`, and playing
 * a battle to completion with a reasonable (not optimal) player policy.
 *
 * Every gauntlet that needs to run battles imports from here instead of
 * re-implementing "how do I build a creature" or "how do I drive a fight" —
 * one implementation, so the sims can never quietly diverge from each other.
 *
 * Pure and DOM-free, like the rest of src/core.
 */

import type { Rng } from './rng.ts';
import type { BaseStats, Feral, Move, MoveSlot, Species } from './creature.ts';
import { computeDamage, expForLevel, maxHp, stab, statOf, typeMultiplier } from './creature.ts';
import type { BattleEvent, BattleState, Dex, Side } from './battle.ts';
import { activeOf, forceSwitch, resolveTurn } from './battle.ts';

// ---------------------------------------------------------------------------
// Dex construction
// ---------------------------------------------------------------------------

/** Builds a `Dex` (the battle engine's only view of content) from lookup tables. */
export function makeDex(
  species: Readonly<Record<string, Species>>,
  moves: Readonly<Record<string, Move>>,
): Dex {
  return {
    species(id: string): Species {
      const s = species[id];
      if (!s) throw new Error(`testkit.makeDex: unknown species id '${id}'`);
      return s;
    },
    move(id: string): Move {
      const m = moves[id];
      if (!m) throw new Error(`testkit.makeDex: unknown move id '${id}'`);
      return m;
    },
  };
}

// ---------------------------------------------------------------------------
// Creature construction
// ---------------------------------------------------------------------------

const IV_MAX = 15;

/**
 * Builds a legal `Feral`: full HP, zero EVs, IVs rolled 0..15 per stat, exp set
 * to exactly what the level requires, and the 4 most recently learnable moves
 * from its learnset at or below `level` — exactly how wild encounters and
 * trainer teams are built in the real game, so sim results transfer.
 */
export function makeFeral(dex: Dex, speciesId: string, level: number, rng: Rng): Feral {
  const species = dex.species(speciesId);

  const ivs: BaseStats = {
    hp: rng.range(0, IV_MAX),
    atk: rng.range(0, IV_MAX),
    def: rng.range(0, IV_MAX),
    spa: rng.range(0, IV_MAX),
    spd: rng.range(0, IV_MAX),
    spe: rng.range(0, IV_MAX),
  };
  const evs: BaseStats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  const feral: Feral = {
    species: species.id,
    nickname: species.name,
    level,
    exp: expForLevel(level),
    hp: 1,
    ivs,
    evs,
    moves: recentLearnableMoves(dex, species, level),
    status: null,
    statusTurns: 0,
    caughtAt: 0,
    originalTrainer: 'gauntlet',
  };
  feral.hp = maxHp(species, feral);
  return feral;
}

/** The last (up to) 4 learnset entries whose level does not exceed `level`. */
function recentLearnableMoves(dex: Dex, species: Species, level: number): MoveSlot[] {
  const eligible = species.learnset.filter((entry) => entry.level <= level);
  const recent = eligible.slice(-4);
  return recent.map((entry) => {
    const mv = dex.move(entry.move);
    return { move: mv.id, pp: mv.pp, maxPp: mv.pp };
  });
}

// ---------------------------------------------------------------------------
// Player policy — highest expected damage, switch only on faint
// ---------------------------------------------------------------------------

/** A representative (non-crit) damage roll, matching the engine's own AI estimator. */
const EXPECTED_ROLL = 0.925;

/**
 * Picks the legal move slot (pp > 0) with the highest expected damage against
 * the current target, ties broken by `rng`. Mirrors the shape of the engine's
 * own `chooseEnemyAction` scoring so both sides play at a comparable standard.
 */
function bestMoveSlot(dex: Dex, side: Side, foeSide: Side, rng: Rng): number {
  const user = activeOf(side);
  const target = activeOf(foeSide);
  const userSp = dex.species(user.species);
  const targetSp = dex.species(target.species);

  const usable = user.moves
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => entry.slot.pp > 0);
  if (usable.length === 0) return 0;

  const scored = usable.map(({ slot, index }) => {
    const mv = dex.move(slot.move);
    const physical = mv.category === 'physical';
    const atk = statOf(userSp, user, physical ? 'atk' : 'spa');
    const def = statOf(targetSp, target, physical ? 'def' : 'spd');
    const est = computeDamage({
      attackerLevel: user.level,
      attack: atk,
      defense: def,
      power: mv.power,
      stabMult: stab(mv.type, userSp.types),
      typeMult: typeMultiplier(mv.type, targetSp.types),
      critical: false,
      burned: physical && user.status === 'burn',
      roll: EXPECTED_ROLL,
    });
    const accFactor = mv.accuracy >= 100 ? 1 : mv.accuracy / 100;
    return { index, score: est.damage * accFactor };
  });

  let bestScore = -Infinity;
  for (const s of scored) if (s.score > bestScore) bestScore = s.score;
  const ties = scored.filter((s) => s.score === bestScore);
  return ties.length === 1 ? ties[0]!.index : rng.pick(ties).index;
}

function nextAliveIndex(side: Side): number {
  return side.party.findIndex((f) => f.hp > 0);
}

// ---------------------------------------------------------------------------
// Driving a battle to completion
// ---------------------------------------------------------------------------

export type BattleWinner = 'player' | 'enemy' | 'timeout';

export interface AutoBattleResult {
  readonly winner: BattleWinner;
  readonly turns: number;
  readonly events: readonly BattleEvent[];
}

export interface AutoBattleOptions {
  /** Hard cap on `resolveTurn` calls before declaring `'timeout'`. Default 300. */
  readonly turnCap?: number;
  /** Set false to skip retaining events — saves allocation in bulk sims. Default true. */
  readonly collectEvents?: boolean;
  /** Called with the wall-clock duration (ms) of every `resolveTurn` call. */
  readonly onTurnTime?: (ms: number) => void;
}

/** Turn cap shared by every gauntlet that calls `autoBattle` without overriding it. */
export const DEFAULT_TURN_CAP = 300;

/**
 * Plays a battle to completion: each turn, the player picks the
 * highest-expected-damage legal move; the enemy is driven by the engine's own
 * AI (exactly as a real trainer/wild battle would run it). When the player's
 * active creature faints, the next living party member is sent in via
 * `forceSwitch` before play continues — matching how the UI layer works.
 *
 * Never loops forever: past `opts.turnCap` (default 300) resolution stops and
 * the winner is reported as `'timeout'`.
 */
export function autoBattle(
  dex: Dex,
  state: BattleState,
  rng: Rng,
  opts: AutoBattleOptions = {},
): AutoBattleResult {
  const turnCap = opts.turnCap ?? DEFAULT_TURN_CAP;
  const collect = opts.collectEvents ?? true;
  const events: BattleEvent[] = [];
  let turns = 0;

  // Bounded independently of turnCap: switching can iterate at most once per
  // living party member, never once per turn, so a stuck loop here would be a
  // genuine bug rather than a long battle.
  const switchGuardMax = state.player.party.length + 1;
  let switchGuard = 0;

  while (state.outcome === 'ongoing' && turns < turnCap) {
    if (activeOf(state.player).hp <= 0) {
      if (switchGuard++ > switchGuardMax) break;
      const next = nextAliveIndex(state.player);
      if (next < 0) break; // no one left; outcome should already read 'lost'
      const switchEvents = forceSwitch(dex, state, 'player', next);
      if (collect) events.push(...switchEvents);
      continue;
    }
    switchGuard = 0;

    const slot = bestMoveSlot(dex, state.player, state.enemy, rng);
    const t0 = performance.now();
    const result = resolveTurn(dex, state, { kind: 'move', slot }, rng);
    opts.onTurnTime?.(performance.now() - t0);
    if (collect) events.push(...result.events);
    turns++;
  }

  const winner: BattleWinner =
    state.outcome === 'won' ? 'player' : state.outcome === 'lost' ? 'enemy' : 'timeout';

  return { winner, turns, events };
}
