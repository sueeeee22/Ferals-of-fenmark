/**
 * gauntlet:curve — the difficulty-curve gauntlet.
 *
 * Simulates a legal playthrough at each of the 8 gyms plus the Elite Four and
 * the Champion. For every stop it derives the team a real player would
 * plausibly be carrying — a starter evolved to whatever stage its level
 * allows, plus creatures caught along the routes walked to get there — and
 * fights the real trainer's real team hundreds of times at the intended
 * level and again 20 levels under, for all three starters.
 *
 * A gym that folds under a 65% win rate is too hard; a gym that still falls
 * to a team 20 levels under is not a gate at all; a level curve that jumps
 * more than 9 levels between stops or stalls for fewer than 3 is a cliff or
 * a plateau; a gym only one starter can clear is a starter-parity bug. This
 * gauntlet exists to catch all four before a human has to grind into them.
 *
 * Exit 0 or the curve does not ship.
 */
import { startBattle } from '../../src/core/battle.ts';
import type { Dex } from '../../src/core/battle.ts';
import type { Feral } from '../../src/core/creature.ts';
import type { GameMap } from '../../src/core/world.ts';
import { STARTERS } from '../../src/core/game.ts';
import type { StarterId, TrainerDef } from '../../src/core/game.ts';
import { makeFeral, autoBattle } from '../../src/core/testkit.ts';
import { Rng } from '../../src/core/rng.ts';
import { loadContent } from './content-loader.ts';
import type { LoadedContent } from './content-loader.ts';

// ---------------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------------

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}
function section(title: string): void {
  const bar = '='.repeat(78);
  console.log(`\n${bar}\n${title}\n${bar}`);
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 'fenmark-gauntlet-curve-v1';
const BATTLES_PER_CONFIG = 250;

const WIN_AT_LEVEL_MIN = 0.65;
const WIN_UNDERLEVEL_MAX = 0.15;
const UNDERLEVEL_DELTA = 20;
const LEVEL_FLOOR = 2;

const JUMP_MIN = 3;
const JUMP_MAX = 9;

const CAUGHT_MIN = 2;
const CAUGHT_MAX = 5;

// ---------------------------------------------------------------------------
// The spine: one entry per gym, Elite Four member and the Champion
// ---------------------------------------------------------------------------

interface Entity {
  readonly id: string;
  readonly kind: 'gym' | 'endgame';
  readonly label: string;
  readonly town: string;
  readonly type: string;
  readonly intendedLevel: number;
  readonly downLevel: number;
  /** Route maps walked to reach this stop, oldest first — the encounter pool. */
  readonly routeIds: readonly string[];
  readonly caughtCount: number;
}

/** Probes `route_1`, `route_2`, ... via the world, stopping at the first gap. */
function discoverRoutes(loaded: LoadedContent, maxProbe = 40): string[] {
  const routes: string[] = [];
  for (let i = 1; i <= maxProbe; i++) {
    const id = `route_${i}`;
    try {
      loaded.content.world.map(id);
    } catch {
      break;
    }
    routes.push(id);
  }
  return routes;
}

/** The map that hosts a trainer's arena, for the endgame table's "house" column. */
function arenaMapId(loaded: LoadedContent, trainerId: string): string {
  for (const candidate of [trainerId, `${trainerId}_hall`]) {
    try {
      const map = loaded.content.world.map(candidate);
      if (map.npcs.some((n) => n.team === trainerId)) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return trainerId;
}

function buildEntities(loaded: LoadedContent, allRoutes: readonly string[]): Entity[] {
  const entities: Entity[] = [];

  loaded.gymOrder.forEach((gymId, i) => {
    const def = loaded.content.trainer(gymId);
    const intendedLevel = loaded.gymLevels[i] ?? 10;
    const town = loaded.gymTowns[i]?.town ?? gymId;
    entities.push({
      id: gymId,
      kind: 'gym',
      label: `Gym ${i + 1}`,
      town,
      type: def.badge !== undefined ? capitalize(def.badge) : '—',
      intendedLevel,
      downLevel: Math.max(LEVEL_FLOOR, intendedLevel - UNDERLEVEL_DELTA),
      // Routes walked before this gym: route_1 is the road into gym 1's town,
      // route_2 the road out of it toward gym 2, and so on — the first (i+1)
      // discovered routes are everything a player has walked through by now.
      routeIds: allRoutes.slice(0, i + 1),
      caughtCount: Math.min(CAUGHT_MAX, Math.max(CAUGHT_MIN, i + 2)),
    });
  });

  loaded.eliteOrder.forEach((id, i) => {
    const def = loaded.content.trainer(id);
    const levels = def.team.map((m) => m.level);
    const intendedLevel = levels.length > 0 ? Math.max(...levels) : 10;
    entities.push({
      id,
      kind: 'endgame',
      label: id === 'champion' ? 'Champion' : `Elite Four #${i + 1}`,
      town: arenaMapId(loaded, id),
      type: '—',
      intendedLevel,
      downLevel: Math.max(LEVEL_FLOOR, intendedLevel - UNDERLEVEL_DELTA),
      // By the endgame a player has walked every route in the game.
      routeIds: allRoutes,
      caughtCount: CAUGHT_MAX,
    });
  });

  return entities;
}

// ---------------------------------------------------------------------------
// Team composition — derived from encounter tables, not hardcoded
// ---------------------------------------------------------------------------

/** Species -> summed encounter weight across every route in `routeIds`. */
function buildEncounterPool(loaded: LoadedContent, routeIds: readonly string[]): Map<string, number> {
  const pool = new Map<string, number>();
  for (const routeId of routeIds) {
    let encounters: GameMap['encounters'];
    try {
      encounters = loaded.content.world.map(routeId).encounters;
    } catch {
      continue;
    }
    if (!encounters) continue;
    for (const slot of encounters.slots) {
      pool.set(slot.species, (pool.get(slot.species) ?? 0) + slot.weight);
    }
  }
  return pool;
}

/** Weighted sample without replacement — commoner encounters are likelier catches. */
function pickCaughtSpecies(rng: Rng, pool: ReadonlyMap<string, number>, count: number): string[] {
  const entries = [...pool.entries()].map(([id, weight]) => ({ id, weight }));
  const chosen: string[] = [];
  while (chosen.length < count && entries.length > 0) {
    const picked = rng.weighted(entries, entries.map((e) => e.weight));
    chosen.push(picked.id);
    entries.splice(entries.indexOf(picked), 1);
  }
  return chosen;
}

/** Walks evolvesTo thresholds forward to whatever stage `level` allows — the same rule game.ts's checkEvolutions applies after every battle. */
function evolveToLevel(dex: Dex, speciesId: string, level: number): string {
  let id = speciesId;
  for (let i = 0; i < 8; i++) {
    const sp = dex.species(id);
    if (!sp.evolvesTo || level < sp.evolvesTo.level) break;
    id = sp.evolvesTo.into;
  }
  return id;
}

function buildPlayerTeam(dex: Dex, compositionIds: readonly string[], level: number, rng: Rng): Feral[] {
  return compositionIds.map((id) => makeFeral(dex, evolveToLevel(dex, id, level), level, rng));
}

// ---------------------------------------------------------------------------
// Running battles
// ---------------------------------------------------------------------------

interface WinRate {
  readonly wins: number;
  readonly battles: number;
  readonly timeouts: number;
}

function winPct(w: WinRate): number {
  return w.battles > 0 ? w.wins / w.battles : 0;
}

/**
 * Fresh `Feral`s and a fresh `BattleState` every battle — `resolveTurn`
 * mutates what it is given, so anything reused across iterations would leak
 * HP and status between battles and the win rate would be garbage.
 */
function runConfiguration(
  dex: Dex,
  compositionIds: readonly string[],
  level: number,
  def: TrainerDef,
  battles: number,
  rng: Rng,
): WinRate {
  let wins = 0;
  let timeouts = 0;
  for (let i = 0; i < battles; i++) {
    const playerParty = buildPlayerTeam(dex, compositionIds, level, rng);
    const enemyParty = def.team.map((m) => makeFeral(dex, m.species, m.level, rng));
    const state = startBattle(playerParty, enemyParty, {
      kind: 'trainer',
      trainerId: def.id,
      aiLevel: def.aiLevel,
    });
    const result = autoBattle(dex, state, rng, { mirrorPolicy: true, collectEvents: false });
    if (result.winner === 'player') wins++;
    else if (result.winner === 'timeout') timeouts++;
  }
  return { wins, battles, timeouts };
}

// ---------------------------------------------------------------------------
// Per-entity, per-starter result
// ---------------------------------------------------------------------------

interface EntityResult {
  readonly entity: Entity;
  readonly atLevel: WinRate;
  readonly underLevel: WinRate;
  readonly beatable: boolean;
  readonly gated: boolean;
}

function verdictOf(r: EntityResult): string {
  if (r.beatable && r.gated) return 'PASS';
  if (!r.beatable && !r.gated) return 'FAIL (hard + no gate)';
  if (!r.beatable) return 'FAIL (too hard)';
  return 'FAIL (no gate)';
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function printCurveTable(title: string, rows: readonly EntityResult[]): void {
  console.log(`\n  ${title}`);
  console.log(
    `  ${'STOP'.padEnd(16)}${'TOWN/HOUSE'.padEnd(15)}${'TYPE'.padEnd(8)}${'LVL'.padStart(4)}  ` +
      `${'WIN%@LVL'.padStart(9)}  ${'WIN%@LVL-20'.padStart(12)}  VERDICT`,
  );
  for (const r of rows) {
    const e = r.entity;
    console.log(
      `  ${e.label.padEnd(16)}${e.town.padEnd(15)}${e.type.padEnd(8)}${String(e.intendedLevel).padStart(4)}  ` +
        `${pct(winPct(r.atLevel)).padStart(9)}  ${pct(winPct(r.underLevel)).padStart(12)}  ${verdictOf(r)}`,
    );
  }
}

function printSpineTable(entities: readonly Entity[]): void {
  console.log(`\n  ${'STOP'.padEnd(16)}${'TOWN/HOUSE'.padEnd(15)}${'TYPE'.padEnd(8)}${'LVL'.padStart(4)}  JUMP`);
  let prevGymLevel: number | null = null;
  for (const e of entities) {
    let jump = '—';
    if (e.kind === 'gym') {
      if (prevGymLevel !== null) jump = `+${e.intendedLevel - prevGymLevel}`;
      prevGymLevel = e.intendedLevel;
    }
    console.log(
      `  ${e.label.padEnd(16)}${e.town.padEnd(15)}${e.type.padEnd(8)}${String(e.intendedLevel).padStart(4)}  ${jump}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Structural checks: monotonic curve, no cliffs — independent of any starter
// ---------------------------------------------------------------------------

function checkSpine(entities: readonly Entity[]): void {
  const gyms = entities.filter((e) => e.kind === 'gym');
  const endgame = entities.filter((e) => e.kind === 'endgame');

  for (let i = 1; i < gyms.length; i++) {
    const prev = gyms[i - 1]!;
    const cur = gyms[i]!;
    if (!(cur.intendedLevel > prev.intendedLevel)) {
      fail(
        `monotonic curve: ${cur.label} (level ${cur.intendedLevel}) is not strictly greater than ` +
          `${prev.label} (level ${prev.intendedLevel})`,
      );
    }
    const jump = cur.intendedLevel - prev.intendedLevel;
    if (jump < JUMP_MIN || jump > JUMP_MAX) {
      fail(
        `difficulty cliff: ${prev.label} -> ${cur.label} jumps ${jump} level(s), outside the ` +
          `${JUMP_MIN}-${JUMP_MAX} window`,
      );
    }
  }

  const gym8 = gyms[gyms.length - 1];
  if (gym8) {
    for (const e of endgame) {
      if (!(e.intendedLevel > gym8.intendedLevel)) {
        fail(
          `monotonic curve: ${e.label} (level ${e.intendedLevel}) does not exceed Gym 8 ` +
            `(level ${gym8.intendedLevel})`,
        );
      }
    }
  } else {
    fail('monotonic curve: no gyms found — cannot check the endgame against Gym 8');
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n########################################################################');
  console.log('#  FERALS OF FENMARK — DIFFICULTY CURVE GAUNTLET');
  console.log('########################################################################');

  const loaded = await loadContent();
  if (!loaded) {
    console.log('\ncontent not generated yet — run `npm run gen:all`\n');
    process.exit(1);
  }

  console.log(`\n  seed:                   ${SEED}`);
  console.log(`  battles per configuration: ${BATTLES_PER_CONFIG}`);
  console.log(`  win floor at intended level:   >= ${pct(WIN_AT_LEVEL_MIN)}`);
  console.log(`  win ceiling at -${UNDERLEVEL_DELTA} levels: <= ${pct(WIN_UNDERLEVEL_MAX)}`);
  console.log(`  starters:               ${STARTERS.join(', ')}`);

  const dex = loaded.content.dex;
  const startedAt = Date.now();

  const allRoutes = discoverRoutes(loaded);
  console.log(`\n  routes discovered: ${allRoutes.join(', ')}`);

  const entities = buildEntities(loaded, allRoutes);

  // === Structural spine: monotonic levels, no cliffs — starter-independent ===
  section('LEVEL SPINE (structural, starter-independent)');
  printSpineTable(entities.filter((e) => e.kind === 'gym'));
  console.log(`\n  ${'ENDGAME'}`);
  printSpineTable(entities.filter((e) => e.kind === 'endgame'));
  checkSpine(entities);
  console.log(failures === 0 ? '\n  ok — levels rise monotonically, no cliff wider than the window' : '');

  // === Team composition: same caught species pool for every starter, so the
  // comparison across starters is apples-to-apples — only the starter differs.
  const compositions = new Map<string, readonly string[]>();
  for (const e of entities) {
    const pool = buildEncounterPool(loaded, e.routeIds);
    const count = Math.min(e.caughtCount, pool.size);
    const compRng = Rng.fromSeed(`${SEED}:team:${e.id}`);
    compositions.set(e.id, pickCaughtSpecies(compRng, pool, count));
  }

  // === Per-starter simulation ==============================================
  const allResults = new Map<StarterId, EntityResult[]>();

  for (const starter of STARTERS) {
    const starterName = dex.species(starter).name;
    section(`STARTER: ${starterName} (${starter})`);

    const battleRng = Rng.fromSeed(`${SEED}:battles:${starter}`);
    const results: EntityResult[] = [];

    for (const e of entities) {
      const def = loaded.content.trainer(e.id);
      const caught = compositions.get(e.id) ?? [];
      const compositionIds = [starter, ...caught];
      console.log(`  ${e.label.padEnd(16)} team: ${compositionIds.join(', ')}`);

      const atLevel = runConfiguration(dex, compositionIds, e.intendedLevel, def, BATTLES_PER_CONFIG, battleRng);
      const underLevel = runConfiguration(dex, compositionIds, e.downLevel, def, BATTLES_PER_CONFIG, battleRng);

      const beatable = winPct(atLevel) >= WIN_AT_LEVEL_MIN;
      const gated = winPct(underLevel) <= WIN_UNDERLEVEL_MAX;

      if (!beatable) {
        fail(
          `${starterName} (${starter}) / ${e.label} (${e.id}): win rate at level ${e.intendedLevel} is ` +
            `${pct(winPct(atLevel))} over ${atLevel.battles} battles — below the ${pct(WIN_AT_LEVEL_MIN)} floor`,
        );
      }
      if (!gated) {
        fail(
          `${starterName} (${starter}) / ${e.label} (${e.id}): win rate at level ${e.downLevel} ` +
            `(intended -${UNDERLEVEL_DELTA}) is ${pct(winPct(underLevel))} over ${underLevel.battles} battles — ` +
            `above the ${pct(WIN_UNDERLEVEL_MAX)} ceiling, this gym is not a gate`,
        );
      }

      results.push({ entity: e, atLevel, underLevel, beatable, gated });
    }

    allResults.set(starter, results);

    printCurveTable('GYM CURVE', results.filter((r) => r.entity.kind === 'gym'));
    printCurveTable('ENDGAME', results.filter((r) => r.entity.kind === 'endgame'));
  }

  // === Cross-starter lockout check =========================================
  section('STARTER PARITY — is any stop only beatable with one starter?');
  console.log(`\n  ${'STOP'.padEnd(16)}${STARTERS.map((s) => s.padEnd(14)).join('')}`);
  for (const e of entities) {
    const cells = STARTERS.map((s) => {
      const r = allResults.get(s)?.find((x) => x.entity.id === e.id);
      const rate = r ? pct(winPct(r.atLevel)) : 'n/a';
      const mark = r?.beatable === true ? '' : '*';
      return `${rate}${mark}`.padEnd(14);
    });
    console.log(`  ${e.label.padEnd(16)}${cells.join('')}`);

    const beatableCount = STARTERS.filter((s) => allResults.get(s)?.find((x) => x.entity.id === e.id)?.beatable === true).length;
    if (beatableCount > 0 && beatableCount < STARTERS.length) {
      const locked = STARTERS.filter(
        (s) => allResults.get(s)?.find((x) => x.entity.id === e.id)?.beatable !== true,
      );
      fail(
        `starter lockout: ${e.label} (${e.id}) clears the ${pct(WIN_AT_LEVEL_MIN)} floor for only ` +
          `${beatableCount}/${STARTERS.length} starters — locked out for ${locked.join(', ')}`,
      );
    }
  }
  console.log('\n  (* = below the win floor at intended level for that starter)');

  // === Summary ==============================================================
  const elapsedS = (Date.now() - startedAt) / 1000;
  const totalBattles = STARTERS.length * entities.length * 2 * BATTLES_PER_CONFIG;
  section('SUMMARY');
  console.log(`  battles run:     ${totalBattles}`);
  console.log(`  wall-clock time: ${elapsedS.toFixed(1)}s`);
  console.log(`  seed:            ${SEED}`);
  console.log(
    failures === 0 ? '\nGAUNTLET CURVE PASS\n' : `\nGAUNTLET CURVE FAIL — ${failures} problem(s)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
