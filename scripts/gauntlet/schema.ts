/**
 * gauntlet:schema — validates the generated content tables (species + moves)
 * against the contract in src/core/creature.ts.
 *
 * The tables are produced by scripts/gen/* and do not exist until `npm run
 * gen:all` has been run at least once. That is a normal, expected state
 * early in Phase 3 — this gauntlet reports it clearly and exits 1 rather
 * than crashing with a module-not-found stack trace.
 *
 * Exit 0 or Phase 3 does not advance.
 */
import { TYPES } from '../../src/core/types.ts';
import type { FeralType } from '../../src/core/types.ts';
import { MAX_LEARN_GAP, STAT_KEYS, baseStatTotal } from '../../src/core/creature.ts';
import type { Species, Move, Stage } from '../../src/core/creature.ts';

// ---------------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;

function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

function warn(msg: string): void {
  warnings++;
  console.error(`  WARN  ${msg}`);
}

function section(title: string): { done: () => void } {
  console.log(`\n--- ${title} ---`);
  const start = failures;
  return {
    done: () => {
      const delta = failures - start;
      console.log(delta === 0 ? '  ok' : `  ${delta} problem(s) in this section`);
    },
  };
}

// ---------------------------------------------------------------------------
// Dynamic, guarded loading of the generated tables
// ---------------------------------------------------------------------------

interface SpeciesModuleShape {
  readonly SPECIES: Readonly<Record<string, Species>>;
  readonly SPECIES_LIST: readonly Species[];
}

interface MoveModuleShape {
  readonly MOVES: Readonly<Record<string, Move>>;
  readonly MOVE_LIST: readonly Move[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isSpeciesModule(mod: unknown): mod is SpeciesModuleShape {
  if (!isRecord(mod)) return false;
  return isRecord(mod.SPECIES) && Array.isArray(mod.SPECIES_LIST);
}

function isMoveModule(mod: unknown): mod is MoveModuleShape {
  if (!isRecord(mod)) return false;
  return isRecord(mod.MOVES) && Array.isArray(mod.MOVE_LIST);
}

type LoadResult<T> = { readonly ok: true; readonly mod: T } | { readonly ok: false; readonly reason: string };

/**
 * Imports `path` (kept out of a literal so tsc never tries to resolve the
 * module at compile time — the whole point is that this file must typecheck
 * whether or not the target exists yet) and narrows the result with `guard`
 * instead of trusting an `any`.
 */
async function loadModule<T>(path: string, guard: (v: unknown) => v is T, label: string): Promise<LoadResult<T>> {
  let mod: unknown;
  try {
    mod = await import(path);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `${label} — not found (${detail})` };
  }
  if (!guard(mod)) {
    return { ok: false, reason: `${label} — imported but does not export the expected shape` };
  }
  return { ok: true, mod };
}

const SPECIES_MODULE_PATH = '../../src/data/species.gen.ts';
const MOVES_MODULE_PATH = '../../src/data/moves.gen.ts';

// ---------------------------------------------------------------------------
// Constants driving the assertions
// ---------------------------------------------------------------------------

const STAGE_ORDER: Readonly<Record<Stage, number>> = { pup: 0, adult: 1, apex: 2 };
const STAGES: readonly Stage[] = ['pup', 'adult', 'apex'];

const BST_BANDS: Readonly<Record<Stage, readonly [number, number]>> = {
  pup: [190, 330],
  adult: [320, 460],
  apex: [450, 600],
};
const LEGENDARY_BST_BAND: readonly [number, number] = [560, 680];

const STAT_MIN = 5;
const STAT_MAX = 190;

const EXP_YIELD_RANGE: readonly [number, number] = [30, 280];
const CATCH_RATE_RANGE: readonly [number, number] = [3, 255];
const LEGENDARY_CATCH_RATE = 3;
const DEX_ENTRY_MAX_LEN = 200;

const EVOLVE_LEVEL_RANGE: readonly [number, number] = [2, 55];

const MOVE_POWER_RANGE: readonly [number, number] = [0, 120];
const MOVE_ACCURACY_RANGE: readonly [number, number] = [1, 101];
const MOVE_PP_RANGE: readonly [number, number] = [5, 40];
const MOVE_PRIORITY_RANGE: readonly [number, number] = [-6, 6];

const MIN_SPECIES_PER_TYPE = 12;
const ORPHAN_MOVE_FAIL_PCT = 15;

interface StarterLine {
  readonly name: string;
  readonly ids: readonly [string, string, string];
  readonly types: readonly [FeralType, FeralType];
}

const STARTER_LINES: readonly StarterLine[] = [
  { name: 'Winter', ids: ['winter_pup', 'winter_adult', 'winter_apex'], types: ['Fang', 'Frost'] },
  { name: 'Baloo', ids: ['baloo_pup', 'baloo_adult', 'baloo_apex'], types: ['Fang', 'Ember'] },
  { name: 'Plato', ids: ['plato_pup', 'plato_adult', 'plato_apex'], types: ['Claw', 'Hearth'] },
];
const STARTER_PUP_TO_ADULT_LEVEL = 16;
const STARTER_ADULT_TO_APEX_LEVEL = 36;
const STARTER_BST_SPREAD_PCT = 5;

function inRange(v: number, range: readonly [number, number]): boolean {
  return v >= range[0] && v <= range[1];
}

// ---------------------------------------------------------------------------
// Evolution graph helpers
// ---------------------------------------------------------------------------

/** True if starting from `startId` and walking evolvesFrom pointers ever returns to it. */
function ancestorChainCycles(startId: string, SPECIES: Readonly<Record<string, Species>>, limit: number): boolean {
  let currentId = SPECIES[startId]?.evolvesFrom;
  let steps = 0;
  while (currentId !== undefined) {
    if (currentId === startId) return true;
    steps++;
    if (steps > limit) return true;
    currentId = SPECIES[currentId]?.evolvesFrom;
  }
  return false;
}

/** True if walking evolvesFrom pointers from `startId` terminates at a species with no evolvesFrom. */
function reachesBaseSpecies(startId: string, SPECIES: Readonly<Record<string, Species>>, limit: number): boolean {
  let currentId: string | undefined = startId;
  let steps = 0;
  while (currentId !== undefined) {
    const cur: Species | undefined = SPECIES[currentId];
    if (!cur) return false;
    if (cur.evolvesFrom === undefined) return true;
    currentId = cur.evolvesFrom;
    steps++;
    if (steps > limit) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== GAUNTLET 2: SCHEMA ===\n');
  console.log('  loading generated content tables...');

  const speciesResult = await loadModule(SPECIES_MODULE_PATH, isSpeciesModule, 'src/data/species.gen.ts');
  const movesResult = await loadModule(MOVES_MODULE_PATH, isMoveModule, 'src/data/moves.gen.ts');

  if (!speciesResult.ok || !movesResult.ok) {
    console.log('\n  content not generated yet:');
    if (!speciesResult.ok) console.log(`    - ${speciesResult.reason}`);
    if (!movesResult.ok) console.log(`    - ${movesResult.reason}`);
    console.log('\n  run `npm run gen:all` to produce src/data/species.gen.ts and');
    console.log('  src/data/moves.gen.ts, then re-run `npm run gauntlet:schema`.\n');
    console.log('GAUNTLET 2 FAIL — content not generated\n');
    process.exit(1);
  }

  const { SPECIES, SPECIES_LIST } = speciesResult.mod;
  const { MOVES, MOVE_LIST } = movesResult.mod;
  console.log(`  species.gen.ts ... ok (${SPECIES_LIST.length} species)`);
  console.log(`  moves.gen.ts   ... ok (${MOVE_LIST.length} moves)`);

  // --- Dex numbers & unique IDs --------------------------------------------
  {
    const s = section('Dex numbers & unique IDs');

    const dexCounts = new Map<number, number>();
    for (const sp of SPECIES_LIST) dexCounts.set(sp.dex, (dexCounts.get(sp.dex) ?? 0) + 1);
    for (const [dex, count] of dexCounts) {
      if (count > 1) fail(`dex ${dex} is used by ${count} species (must be unique)`);
    }

    const sortedDex = SPECIES_LIST.map((sp) => sp.dex).sort((a, b) => a - b);
    for (let i = 0; i < sortedDex.length; i++) {
      const expected = i + 1;
      const got = sortedDex[i]!;
      if (got !== expected) {
        fail(
          `dex numbers are not contiguous 1..${sortedDex.length} — expected ${expected} at ` +
            `sorted position ${i + 1}, found ${got}`,
        );
        break;
      }
    }

    const idCounts = new Map<string, number>();
    for (const sp of SPECIES_LIST) idCounts.set(sp.id, (idCounts.get(sp.id) ?? 0) + 1);
    for (const [id, count] of idCounts) {
      if (count > 1) fail(`species id '${id}' appears ${count} times in SPECIES_LIST`);
    }

    for (const [key, sp] of Object.entries(SPECIES)) {
      if (key !== sp.id) fail(`SPECIES['${key}'] holds a species whose id is '${sp.id}' — record key must equal id`);
    }

    s.done();
  }

  // --- Types & base stats ---------------------------------------------------
  {
    const s = section('Types & base stats');

    for (const sp of SPECIES_LIST) {
      if (sp.types.length < 1 || sp.types.length > 2) {
        fail(`${sp.id}: types has ${sp.types.length} entries (must be 1 or 2)`);
      }
      for (const t of sp.types) {
        if (!TYPES.includes(t)) fail(`${sp.id}: type '${t}' is not a member of TYPES`);
      }
      if (sp.types.length === 2 && sp.types[0] === sp.types[1]) {
        fail(`${sp.id}: dual type repeats the same type twice (${sp.types[0]})`);
      }

      for (const key of STAT_KEYS) {
        const val = sp.base[key];
        if (val < STAT_MIN || val > STAT_MAX) {
          fail(`${sp.id}: base.${key} = ${val} is outside ${STAT_MIN}..${STAT_MAX}`);
        }
      }

      const bst = baseStatTotal(sp.base);
      const band = sp.legendary ? LEGENDARY_BST_BAND : BST_BANDS[sp.stage];
      if (!band) {
        fail(`${sp.id}: unknown stage '${sp.stage}' — no BST band defined for it`);
      } else if (bst < band[0] || bst > band[1]) {
        const bandName = sp.legendary ? 'legendary' : sp.stage;
        fail(`${sp.id}: BST ${bst} is outside the ${bandName} band ${band[0]}-${band[1]}`);
      }
    }

    s.done();
  }

  // --- Learnsets --------------------------------------------------------
  {
    const s = section('Learnsets');

    for (const sp of SPECIES_LIST) {
      const ls = sp.learnset;
      if (ls.length === 0) {
        fail(`${sp.id}: learnset is empty`);
        continue;
      }

      for (let i = 1; i < ls.length; i++) {
        const prev = ls[i - 1]!;
        const curr = ls[i]!;
        if (curr.level < prev.level) {
          fail(`${sp.id}: learnset not sorted ascending at index ${i} (level ${prev.level} then ${curr.level})`);
        }
      }

      const first = ls[0]!;
      if (first.level !== 1) fail(`${sp.id}: first learnset entry is level ${first.level}, expected 1`);

      const atLevelOne = ls.filter((e) => e.level <= 1);
      if (atLevelOne.length < 2) {
        fail(`${sp.id}: only ${atLevelOne.length} move(s) known at level 1 (need at least 2)`);
      }

      const seenMoves = new Set<string>();
      for (const entry of ls) {
        if (seenMoves.has(entry.move)) {
          fail(`${sp.id}: move '${entry.move}' is duplicated in the learnset`);
        }
        seenMoves.add(entry.move);
        if (!MOVES[entry.move]) {
          fail(`${sp.id}: learns unknown move '${entry.move}' at level ${entry.level}`);
        }
      }

      const distinctLevels = [...new Set(ls.map((e) => e.level))].sort((a, b) => a - b);
      for (let i = 1; i < distinctLevels.length; i++) {
        const prevLevel = distinctLevels[i - 1]!;
        const currLevel = distinctLevels[i]!;
        const gap = currLevel - prevLevel;
        if (gap > MAX_LEARN_GAP) {
          fail(
            `${sp.id}: learn-level gap of ${gap} between level ${prevLevel} and ${currLevel} exceeds ` +
              `MAX_LEARN_GAP (${MAX_LEARN_GAP})`,
          );
        }
      }
      const lastLevel = distinctLevels[distinctLevels.length - 1]!;
      if (lastLevel < 60 && 60 - lastLevel > MAX_LEARN_GAP) {
        fail(
          `${sp.id}: no new move between level ${lastLevel} and 60 (gap ${60 - lastLevel} exceeds ` +
            `MAX_LEARN_GAP; learnset must cover 1..60)`,
        );
      }

      const hasDamagingAtOne = atLevelOne.some((e) => {
        const mv = MOVES[e.move];
        return mv !== undefined && mv.power > 0;
      });
      if (!hasDamagingAtOne) fail(`${sp.id}: no damaging move (power > 0) available at level 1`);

      const hasStabByTwenty = ls.some((e) => {
        if (e.level > 20) return false;
        const mv = MOVES[e.move];
        return mv !== undefined && mv.power > 0 && sp.types.includes(mv.type);
      });
      if (!hasStabByTwenty) fail(`${sp.id}: no STAB damaging move (matching its own types) learnable by level 20`);
    }

    s.done();
  }

  // --- Evolution --------------------------------------------------------
  {
    const s = section('Evolution');
    const cycleLimit = SPECIES_LIST.length + 2;

    for (const sp of SPECIES_LIST) {
      if (sp.evolvesTo) {
        const target = SPECIES[sp.evolvesTo.into];
        if (!target) {
          fail(`${sp.id}: evolvesTo.into '${sp.evolvesTo.into}' does not exist`);
        } else {
          if (target.evolvesFrom !== sp.id) {
            fail(
              `${sp.id}: evolves into '${target.id}', but '${target.id}'.evolvesFrom is ` +
                `'${target.evolvesFrom ?? 'undefined'}' instead of pointing back`,
            );
          }
          if (!(STAGE_ORDER[target.stage] > STAGE_ORDER[sp.stage])) {
            fail(`${sp.id} (${sp.stage}) evolves into '${target.id}' (${target.stage}) — target stage must be strictly later`);
          }
          const fromBst = baseStatTotal(sp.base);
          const toBst = baseStatTotal(target.base);
          if (!(toBst > fromBst)) {
            fail(`${sp.id}: evolution target '${target.id}' BST ${toBst} is not strictly greater than ${fromBst}`);
          }
        }
        if (!inRange(sp.evolvesTo.level, EVOLVE_LEVEL_RANGE)) {
          fail(`${sp.id}: evolvesTo.level ${sp.evolvesTo.level} is outside ${EVOLVE_LEVEL_RANGE[0]}..${EVOLVE_LEVEL_RANGE[1]}`);
        }
      }

      if (sp.evolvesFrom !== undefined) {
        const source = SPECIES[sp.evolvesFrom];
        if (!source) {
          fail(`${sp.id}: evolvesFrom '${sp.evolvesFrom}' does not exist`);
        } else if (source.evolvesTo?.into !== sp.id) {
          fail(
            `${sp.id}: evolvesFrom points at '${source.id}', but '${source.id}'.evolvesTo is ` +
              `'${source.evolvesTo?.into ?? 'undefined'}' instead of pointing back`,
          );
        }
      }
    }

    for (const sp of SPECIES_LIST) {
      if (ancestorChainCycles(sp.id, SPECIES, cycleLimit)) {
        fail(`${sp.id}: is its own ancestor — the evolvesFrom chain cycles`);
      }
      if (sp.evolvesFrom !== undefined && !reachesBaseSpecies(sp.id, SPECIES, cycleLimit)) {
        fail(`${sp.id}: evolvesFrom chain never reaches a base species (orphaned evolution line)`);
      }
    }

    s.done();
  }

  // --- Misc per-species fields -----------------------------------------
  {
    const s = section('expYield, catchRate, dexEntry, animal, spriteSeed');

    for (const sp of SPECIES_LIST) {
      if (!inRange(sp.expYield, EXP_YIELD_RANGE)) {
        fail(`${sp.id}: expYield ${sp.expYield} is outside ${EXP_YIELD_RANGE[0]}..${EXP_YIELD_RANGE[1]}`);
      }
      if (!inRange(sp.catchRate, CATCH_RATE_RANGE)) {
        fail(`${sp.id}: catchRate ${sp.catchRate} is outside ${CATCH_RATE_RANGE[0]}..${CATCH_RATE_RANGE[1]}`);
      }
      if (sp.legendary && sp.catchRate !== LEGENDARY_CATCH_RATE) {
        fail(`${sp.id}: legendary catchRate is ${sp.catchRate}, must be exactly ${LEGENDARY_CATCH_RATE}`);
      }
      if (sp.dexEntry.trim().length === 0) {
        fail(`${sp.id}: dexEntry is empty`);
      } else if (sp.dexEntry.length > DEX_ENTRY_MAX_LEN) {
        fail(`${sp.id}: dexEntry is ${sp.dexEntry.length} chars, exceeds ${DEX_ENTRY_MAX_LEN}`);
      }
      if (sp.animal.trim().length === 0) fail(`${sp.id}: animal is empty`);
      if (!Number.isFinite(sp.spriteSeed) || !Number.isInteger(sp.spriteSeed)) {
        fail(`${sp.id}: spriteSeed ${sp.spriteSeed} is not a finite integer`);
      }
    }

    s.done();
  }

  // --- Moves --------------------------------------------------------------
  {
    const s = section('Moves');

    const idCounts = new Map<string, number>();
    for (const mv of MOVE_LIST) idCounts.set(mv.id, (idCounts.get(mv.id) ?? 0) + 1);
    for (const [id, count] of idCounts) {
      if (count > 1) fail(`move id '${id}' appears ${count} times in MOVE_LIST`);
    }

    for (const [key, mv] of Object.entries(MOVES)) {
      if (key !== mv.id) fail(`MOVES['${key}'] holds a move whose id is '${mv.id}' — record key must equal id`);
    }

    for (const mv of MOVE_LIST) {
      if (!TYPES.includes(mv.type)) fail(`${mv.id}: type '${mv.type}' is not a member of TYPES`);

      if (!inRange(mv.power, MOVE_POWER_RANGE)) {
        fail(`${mv.id}: power ${mv.power} is outside ${MOVE_POWER_RANGE[0]}..${MOVE_POWER_RANGE[1]}`);
      }
      if (mv.category === 'status') {
        if (mv.power !== 0) fail(`${mv.id}: status move has power ${mv.power}, must be 0`);
      } else if (mv.power <= 0) {
        fail(`${mv.id}: non-status move (${mv.category}) has power ${mv.power}, must be > 0`);
      }

      if (!inRange(mv.accuracy, MOVE_ACCURACY_RANGE)) {
        fail(`${mv.id}: accuracy ${mv.accuracy} is outside ${MOVE_ACCURACY_RANGE[0]}..${MOVE_ACCURACY_RANGE[1]}`);
      }
      if (!inRange(mv.pp, MOVE_PP_RANGE)) {
        fail(`${mv.id}: pp ${mv.pp} is outside ${MOVE_PP_RANGE[0]}..${MOVE_PP_RANGE[1]}`);
      }
      if (!inRange(mv.priority, MOVE_PRIORITY_RANGE)) {
        fail(`${mv.id}: priority ${mv.priority} is outside ${MOVE_PRIORITY_RANGE[0]}..${MOVE_PRIORITY_RANGE[1]}`);
      }
      if (mv.effect?.chance !== undefined && !inRange(mv.effect.chance, [0, 1])) {
        fail(`${mv.id}: effect.chance ${mv.effect.chance} is outside 0..1`);
      }
    }

    s.done();
  }

  // --- Starters -----------------------------------------------------------
  console.log('\n--- STARTERS (Winter / Baloo / Plato) ---');
  const starterApexTotals: Array<{ readonly name: string; readonly id: string; readonly bst: number }> = [];
  {
    for (const line of STARTER_LINES) {
      const [pupId, adultId, apexId] = line.ids;
      const pup = SPECIES[pupId];
      const adult = SPECIES[adultId];
      const apex = SPECIES[apexId];

      if (!pup) fail(`${line.name}: '${pupId}' does not exist`);
      if (!adult) fail(`${line.name}: '${adultId}' does not exist`);
      if (!apex) fail(`${line.name}: '${apexId}' does not exist`);
      if (!pup || !adult || !apex) continue;

      if (pup.stage !== 'pup') fail(`${line.name}: '${pup.id}' stage is '${pup.stage}', expected pup`);
      if (adult.stage !== 'adult') fail(`${line.name}: '${adult.id}' stage is '${adult.stage}', expected adult`);
      if (apex.stage !== 'apex') fail(`${line.name}: '${apex.id}' stage is '${apex.stage}', expected apex`);

      if (pup.evolvesFrom !== undefined) fail(`${line.name}: pup '${pup.id}' should not have evolvesFrom`);
      if (pup.evolvesTo?.into !== adult.id) {
        fail(`${line.name}: pup '${pup.id}' does not evolve into adult '${adult.id}'`);
      }
      if (adult.evolvesFrom !== pup.id) {
        fail(`${line.name}: adult '${adult.id}' evolvesFrom does not point to pup '${pup.id}'`);
      }
      if (adult.evolvesTo?.into !== apex.id) {
        fail(`${line.name}: adult '${adult.id}' does not evolve into apex '${apex.id}'`);
      }
      if (apex.evolvesFrom !== adult.id) {
        fail(`${line.name}: apex '${apex.id}' evolvesFrom does not point to adult '${adult.id}'`);
      }
      if (apex.evolvesTo !== undefined) fail(`${line.name}: apex '${apex.id}' should be terminal (no evolvesTo)`);

      if (pup.evolvesTo && pup.evolvesTo.level !== STARTER_PUP_TO_ADULT_LEVEL) {
        fail(`${line.name}: pup->adult evolves at level ${pup.evolvesTo.level}, expected ${STARTER_PUP_TO_ADULT_LEVEL}`);
      }
      if (adult.evolvesTo && adult.evolvesTo.level !== STARTER_ADULT_TO_APEX_LEVEL) {
        fail(`${line.name}: adult->apex evolves at level ${adult.evolvesTo.level}, expected ${STARTER_ADULT_TO_APEX_LEVEL}`);
      }

      for (const stageSpecies of [pup, adult, apex]) {
        const got = [...stageSpecies.types].sort().join('/');
        const want = [...line.types].sort().join('/');
        if (got !== want) {
          fail(
            `${line.name}: '${stageSpecies.id}' has types ${stageSpecies.types.join('/')}, expected ` +
              `${line.types.join('/')}`,
          );
        }
      }

      starterApexTotals.push({ name: line.name, id: apex.id, bst: baseStatTotal(apex.base) });
    }

    console.log('\n  apex base-stat totals:');
    for (const t of starterApexTotals) {
      console.log(`    ${t.name.padEnd(8)} ${t.id.padEnd(16)} BST ${t.bst}`);
    }
    if (starterApexTotals.length === 3) {
      const values = starterApexTotals.map((t) => t.bst);
      const max = Math.max(...values);
      const min = Math.min(...values);
      const spreadPct = min > 0 ? ((max - min) / min) * 100 : Number.POSITIVE_INFINITY;
      console.log(`    spread: ${max - min} points (${spreadPct.toFixed(2)}% of the smallest total)`);
      if (spreadPct > STARTER_BST_SPREAD_PCT) {
        fail(`starter apex BSTs spread ${spreadPct.toFixed(2)}% apart — exceeds the ${STARTER_BST_SPREAD_PCT}% tolerance`);
      }
    } else {
      fail('cannot compare starter apex BSTs — one or more starter lines are missing or malformed');
    }
  }

  // --- Roster-wide: type coverage -----------------------------------------
  {
    const s = section('Roster-wide: type coverage');

    const typeCounts = new Map<FeralType, number>(TYPES.map((t) => [t, 0]));
    for (const sp of SPECIES_LIST) {
      for (const t of sp.types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    for (const t of TYPES) {
      const count = typeCounts.get(t) ?? 0;
      if (count < MIN_SPECIES_PER_TYPE) {
        fail(`type '${t}' appears on only ${count} species (need at least ${MIN_SPECIES_PER_TYPE})`);
      }
    }

    s.done();
  }

  // --- Roster-wide: move usage ---------------------------------------------
  {
    const s = section('Roster-wide: move usage');

    const learnedMoveIds = new Set<string>();
    for (const sp of SPECIES_LIST) {
      for (const entry of sp.learnset) learnedMoveIds.add(entry.move);
    }
    const orphanMoves = MOVE_LIST.filter((mv) => !learnedMoveIds.has(mv.id));
    for (const mv of orphanMoves) warn(`move '${mv.id}' (${mv.name}) is not learned by any species`);

    const orphanPct = MOVE_LIST.length > 0 ? (orphanMoves.length / MOVE_LIST.length) * 100 : 0;
    console.log(`  ${orphanMoves.length}/${MOVE_LIST.length} moves orphaned (${orphanPct.toFixed(1)}%)`);
    if (orphanPct > ORPHAN_MOVE_FAIL_PCT) {
      fail(`${orphanPct.toFixed(1)}% of moves are orphaned — exceeds the ${ORPHAN_MOVE_FAIL_PCT}% ceiling`);
    }

    s.done();
  }

  // --- Summary --------------------------------------------------------------
  console.log('\n=== SUMMARY ===\n');
  console.log(`  species: ${SPECIES_LIST.length}`);
  console.log(`  moves:   ${MOVE_LIST.length}`);

  console.log('\n  BST by stage (n, min / median / max):');
  for (const stage of STAGES) {
    const totals = SPECIES_LIST.filter((sp) => sp.stage === stage && !sp.legendary)
      .map((sp) => baseStatTotal(sp.base))
      .sort((a, b) => a - b);
    if (totals.length === 0) {
      console.log(`    ${stage.padEnd(10)} (none)`);
      continue;
    }
    const min = totals[0]!;
    const max = totals[totals.length - 1]!;
    const median = totals[Math.floor(totals.length / 2)]!;
    console.log(`    ${stage.padEnd(10)} n=${totals.length.toString().padEnd(4)} min ${min}  median ${median}  max ${max}`);
  }
  const legendaryTotals = SPECIES_LIST.filter((sp) => sp.legendary)
    .map((sp) => baseStatTotal(sp.base))
    .sort((a, b) => a - b);
  if (legendaryTotals.length > 0) {
    const min = legendaryTotals[0]!;
    const max = legendaryTotals[legendaryTotals.length - 1]!;
    const median = legendaryTotals[Math.floor(legendaryTotals.length / 2)]!;
    console.log(
      `    ${'legendary'.padEnd(10)} n=${legendaryTotals.length.toString().padEnd(4)} min ${min}  median ${median}  max ${max}`,
    );
  }

  console.log('\n  type distribution:');
  for (const t of TYPES) {
    const count = SPECIES_LIST.filter((sp) => sp.types.includes(t)).length;
    console.log(`    ${t.padEnd(8)} ${count}`);
  }

  console.log(
    failures === 0
      ? `\nGAUNTLET 2 PASS${warnings > 0 ? ` (${warnings} warning(s))` : ''}\n`
      : `\nGAUNTLET 2 FAIL — ${failures} problem(s), ${warnings} warning(s)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
