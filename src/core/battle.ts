/**
 * The battle engine.
 *
 * Pure and serializable: `resolveTurn(state, action, rng)` returns a new state plus
 * a list of events. The UI animates the events; `gauntlet:sim` inspects them. There
 * is exactly one implementation, so the simulation can never drift from the game.
 *
 * Shaped like Gen 1 (priority -> speed -> accuracy -> damage -> secondary effect),
 * with its known defects removed: Special is split, there is no 1/256 miss, crit
 * rate does not invert on fast creatures, and status does not stack incoherently.
 */

import type { Rng } from './rng.ts';
import type { FeralType } from './types.ts';
import { effectivenessMessage } from './types.ts';
import type { Feral, Move, Species, StatKey, StatusName } from './creature.ts';
import {
  catchShakes,
  computeDamage,
  critChance,
  damageRoll,
  expGain,
  levelForExp,
  maxHp,
  stab,
  stageMultiplier,
  statOf,
  typeMultiplier,
  MAX_LEVEL,
} from './creature.ts';

// ---------------------------------------------------------------------------
// Content lookup — injected so core never imports src/data (keeps the graph acyclic)
// ---------------------------------------------------------------------------

export interface Dex {
  species(id: string): Species;
  move(id: string): Move;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type StageMap = Record<Exclude<StatKey, 'hp'>, number>;

export function freshStages(): StageMap {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

export interface Side {
  party: Feral[];
  active: number;
  stages: StageMap;
  /** Turns the active creature has been out; resets on switch. Drives Bide-likes and AI. */
  turnsOut: number;
  /** Set while the creature must recharge or is locked into a multi-turn move. */
  mustRecharge: boolean;
}

export type BattleOutcome = 'ongoing' | 'won' | 'lost' | 'caught' | 'fled';

export interface BattleState {
  readonly kind: 'wild' | 'trainer';
  /** Present for trainer battles; drives payout, AI quality and post-battle dialogue. */
  readonly trainerId?: string;
  /** AI skill 0..3. 0 = random, 3 = gym leader / Elite Four. */
  readonly aiLevel: number;
  player: Side;
  enemy: Side;
  turn: number;
  outcome: BattleOutcome;
  /** Escape attempts, for Gen 1's escalating flee formula. */
  runAttempts: number;
  /** Set when a capture succeeds. */
  caught: Feral | null;
  expAwarded: number;
}

export type BattleAction =
  | { readonly kind: 'move'; readonly slot: number }
  | { readonly kind: 'switch'; readonly index: number }
  | { readonly kind: 'ball'; readonly bonus: number }
  | { readonly kind: 'item'; readonly item: string }
  | { readonly kind: 'run' };

// ---------------------------------------------------------------------------
// Events — everything the UI needs to narrate a turn, and everything the sim
// needs to assert on. Never contains rendering concerns.
// ---------------------------------------------------------------------------

export type BattleEvent =
  | { readonly t: 'text'; readonly text: string }
  | { readonly t: 'move'; readonly side: 'player' | 'enemy'; readonly move: string; readonly name: string }
  | {
      readonly t: 'damage';
      readonly side: 'player' | 'enemy';
      readonly amount: number;
      readonly hpAfter: number;
      readonly maxHp: number;
      readonly effectiveness: number;
      readonly critical: boolean;
    }
  | { readonly t: 'miss'; readonly side: 'player' | 'enemy' }
  | { readonly t: 'status'; readonly side: 'player' | 'enemy'; readonly status: StatusName }
  | { readonly t: 'stage'; readonly side: 'player' | 'enemy'; readonly stat: StatKey; readonly delta: number }
  | { readonly t: 'heal'; readonly side: 'player' | 'enemy'; readonly amount: number; readonly hpAfter: number }
  | { readonly t: 'faint'; readonly side: 'player' | 'enemy'; readonly name: string }
  | { readonly t: 'switch'; readonly side: 'player' | 'enemy'; readonly name: string }
  | { readonly t: 'shake'; readonly count: number }
  | { readonly t: 'caught'; readonly name: string }
  | { readonly t: 'exp'; readonly amount: number; readonly name: string }
  | { readonly t: 'levelup'; readonly name: string; readonly level: number }
  | { readonly t: 'learn'; readonly name: string; readonly move: string }
  | { readonly t: 'outcome'; readonly outcome: BattleOutcome };

export interface TurnResult {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function startBattle(
  playerParty: Feral[],
  enemyParty: Feral[],
  opts: { kind: 'wild' | 'trainer'; trainerId?: string; aiLevel?: number },
): BattleState {
  return {
    kind: opts.kind,
    ...(opts.trainerId === undefined ? {} : { trainerId: opts.trainerId }),
    aiLevel: opts.aiLevel ?? (opts.kind === 'wild' ? 1 : 2),
    player: { party: playerParty, active: firstAlive(playerParty), stages: freshStages(), turnsOut: 0, mustRecharge: false },
    enemy: { party: enemyParty, active: firstAlive(enemyParty), stages: freshStages(), turnsOut: 0, mustRecharge: false },
    turn: 0,
    outcome: 'ongoing',
    runAttempts: 0,
    caught: null,
    expAwarded: 0,
  };
}

function firstAlive(party: readonly Feral[]): number {
  const i = party.findIndex((f) => f.hp > 0);
  return i < 0 ? 0 : i;
}

export function activeOf(side: Side): Feral {
  const f = side.party[side.active];
  if (!f) throw new Error('battle: side has no active creature');
  return f;
}

export function hasAlive(side: Side): boolean {
  return side.party.some((f) => f.hp > 0);
}

// ---------------------------------------------------------------------------
// Effective stats
// ---------------------------------------------------------------------------

function effectiveStat(dex: Dex, side: Side, key: Exclude<StatKey, 'hp'>): number {
  const f = activeOf(side);
  const sp = dex.species(f.species);
  let v = statOf(sp, f, key);
  v = Math.floor(v * stageMultiplier(side.stages[key]));
  // Stun quarters Speed; chill halves it. Gen 1's paralysis speed cut, made consistent.
  if (key === 'spe') {
    if (f.status === 'stun') v = Math.floor(v / 4);
    else if (f.status === 'chill') v = Math.floor(v / 2);
  }
  return Math.max(1, v);
}

// ---------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------

export function resolveTurn(
  dex: Dex,
  state: BattleState,
  action: BattleAction,
  rng: Rng,
): TurnResult {
  const events: BattleEvent[] = [];
  if (state.outcome !== 'ongoing') return { state, events };

  state.turn++;

  // --- Non-move player actions resolve before any exchange -----------------
  if (action.kind === 'run') {
    return finishTurn(dex, state, tryRun(dex, state, rng, events), events);
  }
  if (action.kind === 'ball') {
    return finishTurn(dex, state, tryCatch(dex, state, action.bonus, rng, events), events);
  }

  const enemyAction = chooseAiAction(dex, state, 'enemy', rng);

  // Switching always precedes moves, both sides, exactly like Gen 1.
  if (action.kind === 'switch') doSwitch(dex, state.player, 'player', action.index, events);
  if (enemyAction.kind === 'switch') doSwitch(dex, state.enemy, 'enemy', enemyAction.index, events);

  const playerMoves = action.kind === 'move';
  const enemyMoves = enemyAction.kind === 'move';

  if (playerMoves || enemyMoves) {
    const order = decideOrder(dex, state, playerMoves ? action.slot : -1, enemyMoves ? enemyAction.slot : -1, rng);
    for (const who of order) {
      if (state.outcome !== 'ongoing') break;
      if (who === 'player' && playerMoves) {
        if (activeOf(state.player).hp > 0) executeMove(dex, state, 'player', action.slot, rng, events);
      } else if (who === 'enemy' && enemyMoves) {
        if (activeOf(state.enemy).hp > 0) executeMove(dex, state, 'enemy', enemyAction.slot, rng, events);
      }
    }
  }

  // --- End of turn: residual status damage ---------------------------------
  if (state.outcome === 'ongoing') {
    for (const who of ['player', 'enemy'] as const) {
      applyResidual(dex, state, who, events);
      if (state.outcome !== 'ongoing') break;
    }
  }

  state.player.turnsOut++;
  state.enemy.turnsOut++;

  return finishTurn(dex, state, false, events);
}

function finishTurn(
  dex: Dex,
  state: BattleState,
  short: boolean,
  events: BattleEvent[],
): TurnResult {
  void short;
  if (state.outcome === 'ongoing') {
    if (!hasAlive(state.enemy)) {
      awardExp(dex, state, events);
      state.outcome = 'won';
    } else if (!hasAlive(state.player)) {
      state.outcome = 'lost';
    }
  }
  if (state.outcome !== 'ongoing') events.push({ t: 'outcome', outcome: state.outcome });
  return { state, events };
}

/** Priority first, then effective Speed, then a coin flip. */
function decideOrder(
  dex: Dex,
  state: BattleState,
  playerSlot: number,
  enemySlot: number,
  rng: Rng,
): readonly ('player' | 'enemy')[] {
  const pPri = playerSlot >= 0 ? movePriority(dex, state.player, playerSlot) : -99;
  const ePri = enemySlot >= 0 ? movePriority(dex, state.enemy, enemySlot) : -99;
  if (pPri !== ePri) return pPri > ePri ? ['player', 'enemy'] : ['enemy', 'player'];

  const pSpe = effectiveStat(dex, state.player, 'spe');
  const eSpe = effectiveStat(dex, state.enemy, 'spe');
  if (pSpe !== eSpe) return pSpe > eSpe ? ['player', 'enemy'] : ['enemy', 'player'];
  return rng.chance(0.5) ? ['player', 'enemy'] : ['enemy', 'player'];
}

function movePriority(dex: Dex, side: Side, slot: number): number {
  const f = activeOf(side);
  const s = f.moves[slot];
  if (!s) return 0;
  return dex.move(s.move).priority;
}

// ---------------------------------------------------------------------------
// Executing a move
// ---------------------------------------------------------------------------

function executeMove(
  dex: Dex,
  state: BattleState,
  who: 'player' | 'enemy',
  slot: number,
  rng: Rng,
  events: BattleEvent[],
): void {
  const side = who === 'player' ? state.player : state.enemy;
  const foeSide = who === 'player' ? state.enemy : state.player;
  const user = activeOf(side);
  const target = activeOf(foeSide);

  if (user.hp <= 0 || target.hp <= 0) return;

  // --- Pre-move status gates ---------------------------------------------
  if (user.status === 'sleep') {
    user.statusTurns--;
    if (user.statusTurns <= 0) {
      user.status = null;
      events.push({ t: 'text', text: `${user.nickname} wakes up.` });
    } else {
      events.push({ t: 'text', text: `${user.nickname} is fast asleep.` });
      return;
    }
  }
  if (user.status === 'stun' && rng.chance(0.25)) {
    events.push({ t: 'text', text: `${user.nickname} is too stunned to move.` });
    return;
  }
  if (user.status === 'chill' && rng.chance(0.25)) {
    events.push({ t: 'text', text: `${user.nickname} is stiff with cold.` });
    return;
  }
  if (user.status === 'panic') {
    user.statusTurns--;
    if (user.statusTurns <= 0) {
      user.status = null;
      events.push({ t: 'text', text: `${user.nickname} pulls itself together.` });
    } else if (rng.chance(1 / 3)) {
      // Panicking creatures hurt themselves with a typeless 40-power hit.
      const sp = dex.species(user.species);
      const self = computeDamage({
        attackerLevel: user.level,
        attack: statOf(sp, user, 'atk'),
        defense: statOf(sp, user, 'def'),
        power: 40,
        stabMult: 1,
        typeMult: 1,
        critical: false,
        burned: false,
        roll: damageRoll(rng),
      });
      user.hp = Math.max(0, user.hp - self.damage);
      events.push({ t: 'text', text: `${user.nickname} panics and hurts itself.` });
      events.push({
        t: 'damage', side: who, amount: self.damage, hpAfter: user.hp,
        maxHp: maxHp(sp, user), effectiveness: 1, critical: false,
      });
      if (user.hp <= 0) handleFaint(dex, state, who, events);
      return;
    }
  }

  const slotRef = user.moves[slot];
  if (!slotRef) return;

  // Struggle. When every move is out of PP a creature is not simply idle — it
  // throws itself at the problem and hurts itself doing it. Without this, two
  // creatures that exhaust their PP stall forever, which is exactly what
  // gauntlet:sim caught (one battle in ten thousand hit the 300-turn cap).
  const anyPp = user.moves.some((m) => m.pp > 0);
  if (!anyPp) {
    events.push({ t: 'move', side: who, move: 'struggle', name: 'Struggle' });
    const uSp = dex.species(user.species);
    const tSp = dex.species(target.species);
    const res = computeDamage({
      attackerLevel: user.level,
      attack: effectiveStat(dex, side, 'atk'),
      defense: effectiveStat(dex, foeSide, 'def'),
      power: 50,
      stabMult: 1,
      typeMult: 1, // typeless: Struggle ignores the chart entirely
      critical: false,
      burned: user.status === 'burn',
      roll: damageRoll(rng),
    });
    const dealt = Math.min(res.damage, target.hp);
    target.hp -= dealt;
    events.push({
      t: 'damage', side: who === 'player' ? 'enemy' : 'player', amount: dealt,
      hpAfter: target.hp, maxHp: maxHp(tSp, target), effectiveness: 1, critical: false,
    });
    const recoil = Math.max(1, Math.floor(dealt / 2));
    user.hp = Math.max(0, user.hp - recoil);
    events.push({
      t: 'damage', side: who, amount: recoil, hpAfter: user.hp,
      maxHp: maxHp(uSp, user), effectiveness: 1, critical: false,
    });
    if (target.hp <= 0) handleFaint(dex, state, who === 'player' ? 'enemy' : 'player', events);
    if (user.hp <= 0) handleFaint(dex, state, who, events);
    return;
  }

  const move = dex.move(slotRef.move);
  if (slotRef.pp <= 0) {
    events.push({ t: 'text', text: `${user.nickname} has no power left for that.` });
    return;
  }
  slotRef.pp--;

  events.push({ t: 'move', side: who, move: move.id, name: move.name });

  // --- Accuracy ------------------------------------------------------------
  if (!move.effect?.alwaysHits && move.accuracy <= 100) {
    // Gen 1 used a 1/256 floor here that made 100%-accuracy moves miss. Removed.
    const acc = move.accuracy / 100;
    if (!rng.chance(acc)) {
      events.push({ t: 'miss', side: who });
      return;
    }
  }

  const targetSp = dex.species(target.species);
  const userSp = dex.species(user.species);

  // --- Damage --------------------------------------------------------------
  if (move.category !== 'status' && move.power > 0) {
    const mult = typeMultiplier(move.type, targetSp.types);
    if (mult === 0) {
      events.push({ t: 'text', text: effectivenessMessage(0) ?? 'Nothing happens.' });
      return;
    }

    const physical = move.category === 'physical';
    const atkKey: Exclude<StatKey, 'hp'> = physical ? 'atk' : 'spa';
    const defKey: Exclude<StatKey, 'hp'> = physical ? 'def' : 'spd';

    const hits = move.effect?.multiHit
      ? rng.range(move.effect.multiHit[0], move.effect.multiHit[1])
      : 1;

    let totalDealt = 0;
    for (let h = 0; h < hits; h++) {
      if (target.hp <= 0) break;
      const crit = rng.chance(critChance(userSp.base.spe, move.effect?.highCrit ?? false));
      // A critical hit ignores the defender's positive stages and the attacker's
      // negative ones — the standard rule, and the reason crits feel like a reprieve.
      const atk = crit
        ? statOf(userSp, user, atkKey)
        : effectiveStat(dex, side, atkKey);
      const def = crit
        ? statOf(targetSp, target, defKey)
        : effectiveStat(dex, foeSide, defKey);

      const res = computeDamage({
        attackerLevel: user.level,
        attack: atk,
        defense: def,
        power: move.power,
        stabMult: stab(move.type, userSp.types),
        typeMult: mult,
        critical: crit,
        burned: physical && user.status === 'burn',
        roll: damageRoll(rng),
      });

      const dealt = Math.min(res.damage, target.hp);
      target.hp -= dealt;
      totalDealt += dealt;

      events.push({
        t: 'damage',
        side: who === 'player' ? 'enemy' : 'player',
        amount: dealt,
        hpAfter: target.hp,
        maxHp: maxHp(targetSp, target),
        effectiveness: mult,
        critical: crit,
      });
    }

    if (hits > 1) events.push({ t: 'text', text: `Hit ${hits} times.` });
    const msg = effectivenessMessage(mult);
    if (msg) events.push({ t: 'text', text: msg });

    // Recoil and drain
    const eff = move.effect;
    if (eff?.recoil && totalDealt > 0) {
      const recoil = Math.max(1, Math.floor(totalDealt * eff.recoil));
      user.hp = Math.max(0, user.hp - recoil);
      events.push({ t: 'text', text: `${user.nickname} takes the impact too.` });
      events.push({
        t: 'damage', side: who, amount: recoil, hpAfter: user.hp,
        maxHp: maxHp(userSp, user), effectiveness: 1, critical: false,
      });
    }
    if (eff?.drain && totalDealt > 0) {
      const healed = Math.min(maxHp(userSp, user) - user.hp, Math.max(1, Math.floor(totalDealt * eff.drain)));
      if (healed > 0) {
        user.hp += healed;
        events.push({ t: 'heal', side: who, amount: healed, hpAfter: user.hp });
      }
    }

    if (target.hp <= 0) {
      handleFaint(dex, state, who === 'player' ? 'enemy' : 'player', events);
    }
    if (user.hp <= 0) {
      handleFaint(dex, state, who, events);
      return;
    }
  }

  // --- Secondary / status effects -----------------------------------------
  applyEffect(dex, state, who, move, rng, events);
}

function applyEffect(
  dex: Dex,
  state: BattleState,
  who: 'player' | 'enemy',
  move: Move,
  rng: Rng,
  events: BattleEvent[],
): void {
  const eff = move.effect;
  if (!eff) return;
  if (!rng.chance(eff.chance)) return;

  const side = who === 'player' ? state.player : state.enemy;
  const foeSide = who === 'player' ? state.enemy : state.player;
  const user = activeOf(side);
  const target = activeOf(foeSide);

  // Self-heal
  if (eff.heal) {
    const sp = dex.species(user.species);
    const max = maxHp(sp, user);
    const healed = Math.min(max - user.hp, Math.floor(max * eff.heal));
    if (healed > 0) {
      user.hp += healed;
      events.push({ t: 'heal', side: who, amount: healed, hpAfter: user.hp });
    } else {
      events.push({ t: 'text', text: `${user.nickname} is already at full strength.` });
    }
  }

  // Stat stages
  if (eff.stages) {
    const onSelf = eff.targetsSelf ?? false;
    const s = onSelf ? side : foeSide;
    const recipient = onSelf ? user : target;
    if (recipient.hp > 0) {
      for (const [k, delta] of Object.entries(eff.stages)) {
        // HP has no stat stage; a move that tries to shift it is a content bug,
        // caught by gauntlet:schema, and ignored here rather than crashing a battle.
        if (k === 'hp') continue;
        const key = k as Exclude<StatKey, 'hp'>;
        const before = s.stages[key];
        const after = Math.max(-6, Math.min(6, before + delta));
        if (after === before) {
          events.push({
            t: 'text',
            text: `${recipient.nickname}'s ${key.toUpperCase()} will not shift any further.`,
          });
        } else {
          s.stages[key] = after;
          events.push({ t: 'stage', side: onSelf ? who : who === 'player' ? 'enemy' : 'player', stat: key, delta });
        }
      }
    }
  }

  // Status infliction — never overwrites an existing status. Consistent, unlike Gen 1.
  if (eff.status && target.hp > 0) {
    if (target.status !== null) {
      events.push({ t: 'text', text: `${target.nickname} is already in a bad way.` });
    } else if (isImmuneToStatus(dex, target, eff.status)) {
      events.push({ t: 'text', text: `It has no effect on ${target.nickname}.` });
    } else {
      target.status = eff.status;
      target.statusTurns = eff.status === 'sleep' ? rng.range(1, 3) : eff.status === 'panic' ? rng.range(2, 5) : 0;
      events.push({ t: 'status', side: who === 'player' ? 'enemy' : 'player', status: eff.status });
      events.push({ t: 'text', text: statusMessage(target.nickname, eff.status) });
    }
  }
}

/** A creature cannot be burned by its own element, chilled if it lives in the cold, etc. */
function isImmuneToStatus(dex: Dex, f: Feral, status: StatusName): boolean {
  const types: readonly FeralType[] = dex.species(f.species).types;
  if (status === 'burn' && types.includes('Ember')) return true;
  if (status === 'chill' && types.includes('Frost')) return true;
  if (status === 'venom' && types.includes('Thorn')) return true;
  if (status === 'panic' && types.includes('Gloom')) return true;
  return false;
}

function statusMessage(name: string, s: StatusName): string {
  switch (s) {
    case 'burn': return `${name} is scorched.`;
    case 'chill': return `${name} is going numb.`;
    case 'venom': return `${name} is poisoned.`;
    case 'panic': return `${name} loses the plot.`;
    case 'sleep': return `${name} drops off.`;
    case 'stun': return `${name} is stunned.`;
  }
}

// ---------------------------------------------------------------------------
// End-of-turn residuals
// ---------------------------------------------------------------------------

function applyResidual(
  dex: Dex,
  state: BattleState,
  who: 'player' | 'enemy',
  events: BattleEvent[],
): void {
  const side = who === 'player' ? state.player : state.enemy;
  const f = activeOf(side);
  if (f.hp <= 0) return;
  const sp = dex.species(f.species);
  const max = maxHp(sp, f);

  let chip = 0;
  if (f.status === 'burn') chip = Math.max(1, Math.floor(max / 16));
  else if (f.status === 'venom') chip = Math.max(1, Math.floor(max / 8));

  if (chip > 0) {
    f.hp = Math.max(0, f.hp - chip);
    events.push({
      t: 'damage', side: who, amount: chip, hpAfter: f.hp,
      maxHp: max, effectiveness: 1, critical: false,
    });
    events.push({
      t: 'text',
      text: f.status === 'burn' ? `${f.nickname} is hurt by burns.` : `${f.nickname} is hurt by venom.`,
    });
    if (f.hp <= 0) handleFaint(dex, state, who, events);
  }
}

// ---------------------------------------------------------------------------
// Fainting and switching
// ---------------------------------------------------------------------------

function handleFaint(
  dex: Dex,
  state: BattleState,
  who: 'player' | 'enemy',
  events: BattleEvent[],
): void {
  const side = who === 'player' ? state.player : state.enemy;
  const f = activeOf(side);
  if (f.hp > 0) return;
  f.status = null;
  f.statusTurns = 0;
  events.push({ t: 'faint', side: who, name: f.nickname });

  if (who === 'enemy') awardExp(dex, state, events);

  if (!hasAlive(side)) {
    state.outcome = who === 'player' ? 'lost' : 'won';
    return;
  }

  // The enemy sends out its next creature immediately; the player is prompted by
  // the UI layer, which calls forceSwitch(). Keeping the AI inline here means the
  // sim and the game make the identical choice.
  if (who === 'enemy') {
    const next = pickEnemySwitch(dex, state);
    doSwitch(dex, side, who, next, events);
  }
}

export function forceSwitch(
  dex: Dex,
  state: BattleState,
  who: 'player' | 'enemy',
  index: number,
): readonly BattleEvent[] {
  const events: BattleEvent[] = [];
  const side = who === 'player' ? state.player : state.enemy;
  doSwitch(dex, side, who, index, events);
  return events;
}

function doSwitch(
  dex: Dex,
  side: Side,
  who: 'player' | 'enemy',
  index: number,
  events: BattleEvent[],
): void {
  const target = side.party[index];
  if (!target || target.hp <= 0 || index === side.active) return;
  side.active = index;
  side.stages = freshStages();
  side.turnsOut = 0;
  side.mustRecharge = false;
  void dex;
  events.push({ t: 'switch', side: who, name: target.nickname });
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

function awardExp(dex: Dex, state: BattleState, events: BattleEvent[]): void {
  const fainted = state.enemy.party.filter((f) => f.hp <= 0);
  const last = fainted[fainted.length - 1];
  if (!last) return;
  const sp = dex.species(last.species);
  const gain = expGain(sp, last.level, state.kind === 'trainer');

  for (const f of state.player.party) {
    if (f.hp <= 0) continue;
    f.exp += gain;
    state.expAwarded += gain;
    events.push({ t: 'exp', amount: gain, name: f.nickname });

    const newLevel = Math.min(MAX_LEVEL, levelForExp(f.exp));
    while (f.level < newLevel) {
      const before = maxHp(dex.species(f.species), f);
      f.level++;
      const after = maxHp(dex.species(f.species), f);
      f.hp += after - before; // levelling raises current HP by the max-HP delta
      events.push({ t: 'levelup', name: f.nickname, level: f.level });
      learnLevelMoves(dex, f, events);
    }
  }
}

function learnLevelMoves(dex: Dex, f: Feral, events: BattleEvent[]): void {
  const sp = dex.species(f.species);
  for (const entry of sp.learnset) {
    if (entry.level !== f.level) continue;
    if (f.moves.some((m) => m.move === entry.move)) continue;
    const mv = dex.move(entry.move);
    if (f.moves.length < 4) {
      f.moves.push({ move: mv.id, pp: mv.pp, maxPp: mv.pp });
    } else {
      // Replace the weakest known move. The UI offers a real choice; the bot and
      // the sim need a deterministic default, and "drop the worst" is it.
      let worst = 0;
      let worstPower = Infinity;
      for (let i = 0; i < f.moves.length; i++) {
        const cur = f.moves[i];
        if (!cur) continue;
        const p = dex.move(cur.move).power;
        if (p < worstPower) {
          worstPower = p;
          worst = i;
        }
      }
      if (mv.power > worstPower) f.moves[worst] = { move: mv.id, pp: mv.pp, maxPp: mv.pp };
      else continue;
    }
    events.push({ t: 'learn', name: f.nickname, move: mv.name });
  }
}

// ---------------------------------------------------------------------------
// Catching and running
// ---------------------------------------------------------------------------

function tryCatch(
  dex: Dex,
  state: BattleState,
  bonus: number,
  rng: Rng,
  events: BattleEvent[],
): boolean {
  if (state.kind === 'trainer') {
    events.push({ t: 'text', text: "That would be theft, and they're watching." });
    return true;
  }
  const target = activeOf(state.enemy);
  const sp = dex.species(target.species);
  const shakes = catchShakes(
    {
      catchRate: sp.catchRate,
      maxHp: maxHp(sp, target),
      currentHp: target.hp,
      ballBonus: bonus,
      status: target.status,
    },
    rng,
  );
  events.push({ t: 'shake', count: shakes });
  if (shakes >= 4) {
    state.caught = target;
    state.outcome = 'caught';
    events.push({ t: 'caught', name: target.nickname });
    return true;
  }
  events.push({
    t: 'text',
    text: shakes >= 3 ? 'So close.' : shakes >= 1 ? 'It shook loose.' : 'Not even briefly.',
  });
  return false;
}

function tryRun(dex: Dex, state: BattleState, rng: Rng, events: BattleEvent[]): boolean {
  if (state.kind === 'trainer') {
    events.push({ t: 'text', text: 'There is nowhere to go. They have seen you.' });
    return true;
  }
  state.runAttempts++;
  const p = effectiveStat(dex, state.player, 'spe');
  const e = effectiveStat(dex, state.enemy, 'spe');
  // Gen 1's escape odds, which get better the more you try.
  const odds = ((p * 32) / Math.max(1, (e / 4) % 256) + 30 * state.runAttempts) / 256;
  if (e <= 0 || rng.chance(Math.min(1, odds))) {
    state.outcome = 'fled';
    events.push({ t: 'text', text: 'Got away clean.' });
    return true;
  }
  events.push({ t: 'text', text: "Couldn't get away." });
  return false;
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------

function pickEnemySwitch(dex: Dex, state: BattleState): number {
  const party = state.enemy.party;
  if (state.aiLevel < 2) return firstAlive(party);

  // Smarter trainers lead with whatever resists the player's active typing best.
  const playerSp = dex.species(activeOf(state.player).species);
  let best = firstAlive(party);
  let bestScore = -Infinity;
  for (let i = 0; i < party.length; i++) {
    const cand = party[i];
    if (!cand || cand.hp <= 0) continue;
    const sp = dex.species(cand.species);
    let score = 0;
    for (const t of playerSp.types) score -= typeMultiplier(t, sp.types);
    for (const t of sp.types) score += typeMultiplier(t, playerSp.types);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Enemy move choice. Level 0 is random; higher levels weight by expected damage
 * and, at gym-leader level, actually use their status moves at the right moment.
 */
export function chooseAiAction(
  dex: Dex,
  state: BattleState,
  who: 'player' | 'enemy',
  rng: Rng,
): BattleAction {
  const side = who === 'enemy' ? state.enemy : state.player;
  const foe = who === 'enemy' ? state.player : state.enemy;
  const f = activeOf(side);
  const usable = f.moves
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.pp > 0);
  if (usable.length === 0) return { kind: 'move', slot: 0 };
  if (state.aiLevel <= 0) return { kind: 'move', slot: rng.pick(usable).i };

  const target = activeOf(foe);
  const targetSp = dex.species(target.species);
  const userSp = dex.species(f.species);

  const scored = usable.map(({ m, i }) => {
    const mv = dex.move(m.move);
    let score: number;
    if (mv.category === 'status') {
      // Status is worth a lot on a healthy target and nearly nothing on a dying one.
      const hpFrac = target.hp / Math.max(1, maxHp(targetSp, target));
      const alreadyStatused = target.status !== null && (mv.effect?.status !== undefined);
      score = alreadyStatused ? 1 : 18 * hpFrac;
      if (state.aiLevel < 2) score *= 0.5;
    } else {
      const mult = typeMultiplier(mv.type, targetSp.types);
      const physical = mv.category === 'physical';
      const atk = statOf(userSp, f, physical ? 'atk' : 'spa');
      const def = statOf(targetSp, target, physical ? 'def' : 'spd');
      const est = computeDamage({
        attackerLevel: f.level,
        attack: atk,
        defense: def,
        power: mv.power,
        stabMult: stab(mv.type, userSp.types),
        typeMult: mult,
        critical: false,
        burned: physical && f.status === 'burn',
        roll: 0.92,
      });
      score = est.damage * (mv.accuracy >= 100 ? 1 : mv.accuracy / 100);
      // Reward a lethal hit outright — good trainers take the kill.
      if (state.aiLevel >= 2 && est.damage >= target.hp) score *= 3;
    }
    return { i, score };
  });

  if (state.aiLevel === 1) {
    // Slightly dim: picks well most of the time, sometimes just swings.
    if (rng.chance(0.25)) return { kind: 'move', slot: rng.pick(usable).i };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { kind: 'move', slot: usable[0]!.i };
  if (state.aiLevel >= 3) return { kind: 'move', slot: top.i };

  // Weighted pick among the top few, so battles are not perfectly predictable.
  const pool = scored.slice(0, Math.min(3, scored.length));
  return {
    kind: 'move',
    slot: rng.weighted(pool.map((p) => p.i), pool.map((p) => Math.max(0.1, p.score))),
  };
}
