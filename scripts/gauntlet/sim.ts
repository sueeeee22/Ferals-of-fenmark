/**
 * gauntlet:sim — the self-play simulation gauntlet.
 *
 * Drives the real battle engine (src/core/battle.ts, via src/core/testkit.ts)
 * through tens of thousands of automated fights across the generated roster,
 * and asserts the design properties a balance pass depends on: no dominant or
 * dead-weight move, no unusable or mandatory creature, no infinite loops, no
 * slow turns, a Gen-1-plausible battle length, starter parity, and a healthy
 * type chart.
 *
 * Exit 0 or the roster is not balanced enough to ship.
 */
import { Rng } from '../../src/core/rng.ts';
import { TYPES } from '../../src/core/types.ts';
import type { FeralType } from '../../src/core/types.ts';
import type { Species, Move } from '../../src/core/creature.ts';
import { startBattle } from '../../src/core/battle.ts';
import type { Feral } from '../../src/core/creature.ts';
import type { BattleEvent, Dex } from '../../src/core/battle.ts';
import { DEFAULT_TURN_CAP, makeDex, makeFeral, autoBattle } from '../../src/core/testkit.ts';
import type { BattleWinner } from '../../src/core/testkit.ts';

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
function sub(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// ---------------------------------------------------------------------------
// Dynamic, guarded loading of the generated content tables. species.gen.ts may
// not exist yet — that is a normal, expected state, not a crash.
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
  return isRecord(mod) && isRecord(mod.SPECIES) && Array.isArray(mod.SPECIES_LIST);
}
function isMoveModule(mod: unknown): mod is MoveModuleShape {
  return isRecord(mod) && isRecord(mod.MOVES) && Array.isArray(mod.MOVE_LIST);
}

const SPECIES_MODULE_PATH = '../../src/data/species.gen.ts';
const MOVES_MODULE_PATH = '../../src/data/moves.gen.ts';

async function tryLoad<T>(path: string, guard: (v: unknown) => v is T): Promise<T | null> {
  let mod: unknown;
  try {
    mod = await import(path);
  } catch {
    return null;
  }
  return guard(mod) ? mod : null;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

interface Counter {
  uses: number;
  wins: number;
}

function bump(map: Map<string, Counter>, key: string, won: boolean): void {
  const c = map.get(key) ?? { uses: 0, wins: 0 };
  c.uses++;
  if (won) c.wins++;
  map.set(key, c);
}

function winRate(c: Counter): number {
  return c.uses > 0 ? c.wins / c.uses : 0;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/** Small ASCII histogram: fixed-width buckets from 1 up to maxBucketStart, plus an overflow bucket. */
function printHistogram(values: readonly number[], bucketWidth: number, maxBucketStart: number): void {
  const buckets = new Map<number, number>();
  let overflow = 0;
  for (const v of values) {
    if (v > maxBucketStart + bucketWidth - 1) {
      overflow++;
      continue;
    }
    const b = Math.floor((v - 1) / bucketWidth) * bucketWidth + 1;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const counts = [...buckets.values(), overflow];
  const maxCount = Math.max(1, ...counts);
  const barWidth = 40;
  for (let b = 1; b <= maxBucketStart; b += bucketWidth) {
    const count = buckets.get(b) ?? 0;
    const bar = '#'.repeat(Math.round((count / maxCount) * barWidth));
    const label = `${b}-${b + bucketWidth - 1}`;
    console.log(`    ${label.padStart(9)} | ${bar.padEnd(barWidth)} ${count}`);
  }
  if (overflow > 0) {
    const bar = '#'.repeat(Math.round((overflow / maxCount) * barWidth));
    const label = `${maxBucketStart + bucketWidth}+`;
    console.log(`    ${label.padStart(9)} | ${bar.padEnd(barWidth)} ${overflow}`);
  }
}

// ---------------------------------------------------------------------------
// Driving one matched-level fight. Which species plays 'player' vs 'enemy' is
// randomized per battle: the engine's own AI (chooseEnemyAction) drives the
// enemy side and is measurably sharper than the greedy player policy in
// testkit.ts at aiLevel 2 (it values status moves and rewards a lethal hit),
// so alternating the slot keeps that asymmetry from leaking into the species,
// move, and type numbers as a one-sided bias.
// ---------------------------------------------------------------------------

interface MatchOutcome {
  readonly playerId: string;
  readonly enemyId: string;
  readonly winner: BattleWinner;
  readonly turns: number;
  readonly events: readonly BattleEvent[];
}

function runMatch(
  dex: Dex,
  aId: string,
  bId: string,
  level: number,
  rng: Rng,
  onTurnTime?: (ms: number) => void,
): MatchOutcome {
  const aIsPlayer = rng.chance(0.5);
  const playerId = aIsPlayer ? aId : bId;
  const enemyId = aIsPlayer ? bId : aId;
  // TEAMS, not singles, and both sides on the SAME policy. Measuring 1v1 length
  // against a window written for team play was measuring the wrong thing, and
  // driving the player greedily while the AI drove the enemy meant every status
  // move's win rate reported one policy against the other rather than the move.
  const team = (id: string): Feral[] => [
    makeFeral(dex, id, level, rng),
    makeFeral(dex, id, level, rng),
    makeFeral(dex, id, level, rng),
  ];
  const state = startBattle(team(playerId), team(enemyId), { kind: 'trainer', aiLevel: 2 });
  const result = autoBattle(dex, state, rng, { turnCap: DEFAULT_TURN_CAP, onTurnTime, mirrorPolicy: true });
  return { playerId, enemyId, winner: result.winner, turns: result.turns, events: result.events };
}


/**
 * Pair species WITHIN an evolution stage. Pairing across stages at a matched
 * level is not a matched condition: a 262-BST pup losing to a 528-BST apex is
 * the evolution curve working exactly as designed, the same way a level-50
 * Caterpie loses to a level-50 Charizard. gauntlet:schema already enforces the
 * BST bands; judging "no creature is unusable" on cross-stage fights just
 * re-measures them. Within a bucket the number means what it claims.
 */
function buildMatchPools(list: readonly Species[]): readonly (readonly Species[])[] {
  const byStage = new Map<string, Species[]>();
  for (const sp of list) {
    const key = sp.legendary === true ? 'legendary' : sp.stage;
    const bucket = byStage.get(key) ?? [];
    bucket.push(sp);
    byStage.set(key, bucket);
  }
  // Only three legendaries exist - too few to sample as their own bucket.
  return ['pup', 'adult', 'apex']
    .map((k) => {
      const base = byStage.get(k) ?? [];
      return k === 'apex' ? [...base, ...(byStage.get('legendary') ?? [])] : base;
    })
    .filter((pool) => pool.length > 1);
}

function pickMatchedPair(
  rng: Rng,
  pools: readonly (readonly Species[])[],
): readonly [Species, Species] {
  const pool = rng.pick(pools);
  return [rng.pick(pool), rng.pick(pool)];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 'fenmark-gauntlet-sim-v1';
const LEVEL = 50;

const RANDOM_BATTLES = 10_000;
const MIN_MOVE_SAMPLE = 200;
const MOVE_WIN_LO = 0.35;
const MOVE_WIN_HI = 0.65;

const MIN_SPECIES_SAMPLE = 40;
const SPECIES_WIN_LO = 0.25;
const SPECIES_WIN_HI = 0.75;

const TYPE_WIN_LO = 0.35;
const TYPE_WIN_HI = 0.65;

const MAX_TURN_MS = 5;
const MEDIAN_TURNS_LO = 5;
const MEDIAN_TURNS_HI = 40;

const STARTERS: readonly { readonly key: string; readonly id: string }[] = [
  { key: 'Winter', id: 'winter_apex' },
  { key: 'Baloo', id: 'baloo_apex' },
  { key: 'Plato', id: 'plato_apex' },
];
const STARTER_BATTLES_PER_PAIR = 2000;
const STARTER_WIN_LO = 0.42;
const STARTER_WIN_HI = 0.58;

const WARMUP_BATTLES = 50;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const speciesMod = await tryLoad(SPECIES_MODULE_PATH, isSpeciesModule);
  const movesMod = await tryLoad(MOVES_MODULE_PATH, isMoveModule);

  if (!speciesMod || !movesMod) {
    console.log('content not generated yet — run npm run gen:all');
    process.exit(1);
  }

  const { SPECIES, SPECIES_LIST } = speciesMod;
  const { MOVES, MOVE_LIST } = movesMod;
  const dex = makeDex(SPECIES, MOVES);
  const matchPools = buildMatchPools(SPECIES_LIST);
  const rng = Rng.fromSeed(SEED);
  const startedAt = Date.now();

  console.log('\n########################################################################');
  console.log('#  FERALS OF FENMARK — SELF-PLAY SIMULATION GAUNTLET');
  console.log('########################################################################');
  console.log(`\n  seed:    ${SEED}`);
  console.log(`  species: ${SPECIES_LIST.length}`);
  console.log(`  moves:   ${MOVE_LIST.length}`);
  console.log(`  level:   ${LEVEL} (both sides, matched, full HP — differences are attributable to design)`);

  // Warm the JIT on the real hot path before timing anything, so a cold-start
  // compilation spike in the first few calls can't masquerade as a slow turn.
  for (let i = 0; i < WARMUP_BATTLES; i++) {
    const [a, b] = pickMatchedPair(rng, matchPools);
    runMatch(dex, a.id, b.id, LEVEL, rng);
  }
  console.log(`  warmup:  ${WARMUP_BATTLES} untimed battles run first (JIT warmup, not scored)`);

  // =========================================================================
  // PART A — 10,000 randomized battles across the roster
  // =========================================================================
  section(`A. ROSTER-WIDE RANDOM BATTLES  (n=${RANDOM_BATTLES})`);

  const moveStats = new Map<string, Counter>();
  const speciesStats = new Map<string, Counter>();
  const battleLengths: number[] = [];
  const turnDurations: number[] = [];
  let timeouts = 0;
  const timeoutExamples: { a: string; b: string; turns: number }[] = [];

  for (let i = 0; i < RANDOM_BATTLES; i++) {
    const [a, b] = pickMatchedPair(rng, matchPools);
    const m = runMatch(dex, a.id, b.id, LEVEL, rng, (ms) => turnDurations.push(ms));

    battleLengths.push(m.turns);
    if (m.winner === 'timeout') {
      timeouts++;
      if (timeoutExamples.length < 10) timeoutExamples.push({ a: a.id, b: b.id, turns: m.turns });
    }

    bump(speciesStats, m.playerId, m.winner === 'player');
    bump(speciesStats, m.enemyId, m.winner === 'enemy');

    for (const ev of m.events) {
      if (ev.t !== 'move') continue;
      bump(moveStats, ev.move, ev.side === m.winner);
    }
  }

  // --- A1: move dominance ---------------------------------------------------
  sub('A1. Move balance — no dominant or dead-weight move');
  const moveRows = MOVE_LIST.map((mv) => ({
    mv,
    c: moveStats.get(mv.id) ?? { uses: 0, wins: 0 },
  })).sort((x, y) => winRate(x.c) - winRate(y.c));

  const qualifyingMoves = moveRows.filter((r) => r.c.uses >= MIN_MOVE_SAMPLE);
  console.log(
    `  ${qualifyingMoves.length}/${MOVE_LIST.length} moves reached the >=${MIN_MOVE_SAMPLE}-use sample and were judged.`,
  );
  console.log(
    '  (the player policy always picks the highest-expected-damage move, so a pure-status move is only',
  );
  console.log('   ever chosen by the enemy AI half of the time it appears — its numbers reflect that alone.)\n');
  console.log('  MOVE                      TYPE      CAT       USES    WIN%');
  for (const { mv, c } of moveRows) {
    if (c.uses < MIN_MOVE_SAMPLE) continue;
    const rate = winRate(c);
    const bad = rate > MOVE_WIN_HI || rate < MOVE_WIN_LO;
    console.log(
      `  ${mv.name.padEnd(25)} ${mv.type.padEnd(9)} ${mv.category.padEnd(9)} ${String(c.uses).padStart(6)}  ${pct(rate).padStart(6)}${bad ? '  <-- FAIL' : ''}`,
    );
    if (bad) {
      fail(
        `move '${mv.id}' (${mv.name}) win rate ${pct(rate)} over ${c.uses} uses is outside ${pct(MOVE_WIN_LO)}-${pct(MOVE_WIN_HI)}`,
      );
    }
  }

  // --- A2: species usability --------------------------------------------------
  sub('A2. Species balance — no unusable creature, none mandatory');
  const speciesRows = SPECIES_LIST.map((sp) => ({
    sp,
    c: speciesStats.get(sp.id) ?? { uses: 0, wins: 0 },
  })).sort((x, y) => winRate(x.c) - winRate(y.c));
  const qualifyingSpecies = speciesRows.filter((r) => r.c.uses >= MIN_SPECIES_SAMPLE);
  console.log(
    `  ${qualifyingSpecies.length}/${SPECIES_LIST.length} species reached the >=${MIN_SPECIES_SAMPLE}-battle sample and were judged.`,
  );

  for (const { sp, c } of qualifyingSpecies) {
    const rate = winRate(c);
    if (rate < SPECIES_WIN_LO || rate > SPECIES_WIN_HI) {
      const tag = sp.legendary ? ` [legendary, ${sp.stage}]` : ` [${sp.stage}]`;
      fail(`species '${sp.id}' (${sp.name})${tag} win rate ${pct(rate)} over ${c.uses} battles is outside ${pct(SPECIES_WIN_LO)}-${pct(SPECIES_WIN_HI)}`);
    }
  }

  // Win rate by evolution stage — this is the pattern to read the individual
  // failures above through: pup/adult/apex sit on very different stat budgets
  // by design (see BST_BANDS in gauntlet:schema), so at a single matched level
  // a whole stage losing most of its fights is a BST-curve finding, not
  // necessarily N unrelated per-species bugs.
  const stageStats = new Map<string, Counter>();
  for (const sp of SPECIES_LIST) {
    const c = speciesStats.get(sp.id);
    if (!c) continue;
    const key = sp.legendary ? 'legendary' : sp.stage;
    const agg = stageStats.get(key) ?? { uses: 0, wins: 0 };
    agg.uses += c.uses;
    agg.wins += c.wins;
    stageStats.set(key, agg);
  }
  console.log('\n  win rate by evolution stage (context for the failures above):');
  console.log('    STAGE        N SPECIES   BATTLES    WIN%');
  for (const stageKey of ['pup', 'adult', 'apex', 'legendary']) {
    const c = stageStats.get(stageKey);
    if (!c) continue;
    const n = SPECIES_LIST.filter((sp) => (sp.legendary ? 'legendary' : sp.stage) === stageKey).length;
    console.log(
      `    ${stageKey.padEnd(12)} ${String(n).padStart(9)}   ${String(c.uses).padStart(7)}   ${pct(winRate(c)).padStart(6)}`,
    );
  }

  console.log('\n  10 weakest (lowest win rate):');
  for (const { sp, c } of qualifyingSpecies.slice(0, 10)) {
    console.log(`    ${sp.name.padEnd(24)} ${sp.id.padEnd(20)} ${pct(winRate(c)).padStart(6)}  (${c.uses} battles)`);
  }
  console.log('\n  10 strongest (highest win rate):');
  for (const { sp, c } of qualifyingSpecies.slice(-10).reverse()) {
    console.log(`    ${sp.name.padEnd(24)} ${sp.id.padEnd(20)} ${pct(winRate(c)).padStart(6)}  (${c.uses} battles)`);
  }

  // --- A3: no infinite loops --------------------------------------------------
  sub('A3. No infinite loops');
  if (timeouts > 0) {
    fail(`${timeouts}/${RANDOM_BATTLES} battles hit the ${DEFAULT_TURN_CAP}-turn cap`);
    console.log('  examples:');
    for (const ex of timeoutExamples) console.log(`    ${ex.a} vs ${ex.b} — ${ex.turns} turns`);
  } else {
    console.log(`  ok — 0/${RANDOM_BATTLES} battles hit the ${DEFAULT_TURN_CAP}-turn cap`);
  }

  // --- A4: turn performance ----------------------------------------------------
  sub('A4. Turn performance');
  const sortedDurations = [...turnDurations].sort((x, y) => x - y);
  const maxMs = sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1]! : 0;
  const p99Ms = percentile(sortedDurations, 0.99);
  const meanMs = sortedDurations.length > 0 ? sortedDurations.reduce((s, v) => s + v, 0) / sortedDurations.length : 0;
  console.log(`  resolveTurn calls: ${sortedDurations.length}`);
  console.log(`  mean: ${meanMs.toFixed(3)}ms   p99: ${p99Ms.toFixed(3)}ms   max: ${maxMs.toFixed(3)}ms`);
  if (maxMs > MAX_TURN_MS) {
    fail(`slowest resolveTurn call was ${maxMs.toFixed(3)}ms, exceeds the ${MAX_TURN_MS}ms ceiling`);
  } else {
    console.log(`  ok — max turn time is under the ${MAX_TURN_MS}ms ceiling`);
  }

  // --- A5: battle length plausibility -------------------------------------------
  sub('A5. Battle length — Gen-1-plausible');
  const sortedLengths = [...battleLengths].sort((x, y) => x - y);
  const med = median(sortedLengths);
  const p10 = percentile(sortedLengths, 0.1);
  const p90 = percentile(sortedLengths, 0.9);
  console.log(`  median: ${med}   p10: ${p10}   p90: ${p90}   min: ${sortedLengths[0] ?? 0}   max: ${sortedLengths[sortedLengths.length - 1] ?? 0}`);
  console.log('\n  distribution (turns):');
  printHistogram(battleLengths, 5, 60);
  if (med < MEDIAN_TURNS_LO || med > MEDIAN_TURNS_HI) {
    fail(`median battle length ${med} turns is outside the ${MEDIAN_TURNS_LO}-${MEDIAN_TURNS_HI} Gen-1-plausible window`);
  } else {
    console.log(`\n  ok — median ${med} turns is within ${MEDIAN_TURNS_LO}-${MEDIAN_TURNS_HI}`);
  }

  // =========================================================================
  // PART B — starter parity
  // =========================================================================
  section('B. STARTER PARITY — Winter / Baloo / Plato apex forms');

  const missingStarters = STARTERS.filter((s) => !SPECIES[s.id]);
  if (missingStarters.length > 0) {
    fail(`starter parity: missing species ${missingStarters.map((s) => s.id).join(', ')}`);
  } else {
    const winter = STARTERS[0]!;
    const baloo = STARTERS[1]!;
    const plato = STARTERS[2]!;
    const pairs: readonly (readonly [{ readonly key: string; readonly id: string }, { readonly key: string; readonly id: string }])[] = [
      [winter, baloo],
      [winter, plato],
      [baloo, plato],
    ];

    const directedWinRate = new Map<string, number>();
    console.log(`  ${STARTER_BATTLES_PER_PAIR} battles per pairing, level ${LEVEL}, matched:\n`);
    for (const [x, y] of pairs) {
      let xWins = 0;
      let counted = 0;
      for (let i = 0; i < STARTER_BATTLES_PER_PAIR; i++) {
        const m = runMatch(dex, x.id, y.id, LEVEL, rng);
        if (m.winner === 'timeout') continue;
        counted++;
        const winnerId = m.winner === 'player' ? m.playerId : m.enemyId;
        if (winnerId === x.id) xWins++;
      }
      const rate = counted > 0 ? xWins / counted : 0;
      directedWinRate.set(`${x.key}->${y.key}`, rate);
      directedWinRate.set(`${y.key}->${x.key}`, 1 - rate);
      console.log(`  ${x.key} vs ${y.key}: ${pct(rate)} / ${pct(1 - rate)}  (${counted} decisive battles)`);
      if (rate < STARTER_WIN_LO || rate > STARTER_WIN_HI) {
        fail(
          `starter pairing ${x.key} vs ${y.key}: ${x.key}'s win rate ${pct(rate)} is outside ${pct(STARTER_WIN_LO)}-${pct(STARTER_WIN_HI)}`,
        );
      }
    }

    console.log('\n  3x3 matrix (row win rate vs column):');
    const colWidth = 11;
    console.log(`  ${''.padEnd(colWidth)}${STARTERS.map((s) => s.key.padStart(colWidth)).join('')}`);
    for (const row of STARTERS) {
      const cells = STARTERS.map((col) => {
        if (row.key === col.key) return '—'.padStart(colWidth);
        const rate = directedWinRate.get(`${row.key}->${col.key}`);
        return (rate === undefined ? 'n/a' : pct(rate)).padStart(colWidth);
      });
      console.log(`  ${row.key.padEnd(colWidth)}${cells.join('')}`);
    }
  }

  // =========================================================================
  // PART C — type-chart health (derived from Part A's roster-wide pool)
  // =========================================================================
  section('C. TYPE-CHART HEALTH');
  console.log('  aggregated from Part A: a dual-typed species contributes its battles to both of its types.\n');

  const typeStats = new Map<FeralType, Counter>(TYPES.map((t) => [t, { uses: 0, wins: 0 }]));
  for (const sp of SPECIES_LIST) {
    const c = speciesStats.get(sp.id);
    if (!c) continue;
    for (const t of sp.types) {
      const agg = typeStats.get(t)!;
      agg.uses += c.uses;
      agg.wins += c.wins;
    }
  }
  const typeRows = [...typeStats.entries()]
    .map(([type, c]) => ({ type, c }))
    .sort((x, y) => winRate(x.c) - winRate(y.c));

  console.log('  TYPE        BATTLES    WIN%');
  for (const { type, c } of typeRows) {
    const rate = winRate(c);
    const bad = rate < TYPE_WIN_LO || rate > TYPE_WIN_HI;
    console.log(`  ${type.padEnd(11)} ${String(c.uses).padStart(7)}   ${pct(rate).padStart(6)}${bad ? '  <-- FAIL' : ''}`);
    if (bad) {
      fail(`type '${type}' aggregate win rate ${pct(rate)} over ${c.uses} contributing battles is outside ${pct(TYPE_WIN_LO)}-${pct(TYPE_WIN_HI)}`);
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  const elapsedS = (Date.now() - startedAt) / 1000;
  section('SUMMARY');
  console.log(`  battles run:     ${RANDOM_BATTLES + STARTER_BATTLES_PER_PAIR * 3}`);
  console.log(`  wall-clock time: ${elapsedS.toFixed(1)}s`);
  console.log(`  seed:            ${SEED}`);
  console.log(
    failures === 0 ? `\nGAUNTLET SIM PASS\n` : `\nGAUNTLET SIM FAIL — ${failures} problem(s)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
