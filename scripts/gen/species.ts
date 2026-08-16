/**
 * The statline generator.
 *
 * Turns the hand-authored roster (id, animal, types, stage, archetype, evolution)
 * into 153 fully specified Species: base stats, learnsets, exp yields, catch rates,
 * sprite seeds. Balance lives in the ~20 knobs at the top of this file, so tuning
 * the whole roster is editing numbers here and re-running — never editing 150 rows.
 *
 * Deterministic: same roster in, byte-identical species.gen.ts out.
 *
 * Run: npm run gen:species   (needs src/data/moves.gen.ts to exist first)
 */
import { writeFileSync } from 'node:fs';
import { ROSTER, type RosterEntry } from './roster.ts';
import { MOVE_LIST } from '../../src/data/moves.gen.ts';
import type { Archetype, BaseStats, LearnEntry, Species, StatKey, Stage } from '../../src/core/creature.ts';
import type { FeralType } from '../../src/core/types.ts';

// ===========================================================================
// THE KNOBS — everything balance-relevant is in this block.
// ===========================================================================

/** Base stat total by stage, before jitter. */
const BST: Readonly<Record<Stage, number>> = { pup: 262, adult: 392, apex: 522 };
const BST_LEGENDARY = 618;

/** Deterministic per-species BST wobble, so a stage is a band and not a flat line. */
const BST_JITTER = 26;

/** How a role spends its budget. Each row sums to 1. */
const WEIGHTS: Readonly<Record<Archetype, Readonly<Record<StatKey, number>>>> = {
  bruiser: { hp: 0.19, atk: 0.26, def: 0.18, spa: 0.09, spd: 0.13, spe: 0.15 },
  skirmisher: { hp: 0.14, atk: 0.24, def: 0.11, spa: 0.14, spd: 0.12, spe: 0.25 },
  bulwark: { hp: 0.21, atk: 0.17, def: 0.26, spa: 0.1, spd: 0.16, spe: 0.1 },
  channeler: { hp: 0.15, atk: 0.09, def: 0.13, spa: 0.28, spd: 0.16, spe: 0.19 },
  warden: { hp: 0.23, atk: 0.13, def: 0.17, spa: 0.13, spd: 0.24, spe: 0.1 },
  allrounder: { hp: 0.17, atk: 0.17, def: 0.17, spa: 0.16, spd: 0.16, spe: 0.17 },
};

/** Per-stat jitter as a fraction of the stat, keeping siblings from feeling cloned. */
const STAT_JITTER = 0.09;

/** Hard clamp so no generated stat leaves the schema band. */
const STAT_MIN = 20;
const STAT_MAX = 185;

/**
 * Level schedule. Gaps must stay under MAX_LEARN_GAP (12) and cover 1..60.
 * Two moves at level 1 guarantees a legal opening moveset for every creature.
 */
const LEARN_LEVELS = [1, 1, 4, 7, 11, 15, 19, 23, 28, 33, 38, 43, 48, 53, 58] as const;

/** Move power ceiling as a function of the level it is learned at. */
function powerCeilingAt(level: number): number {
  if (level <= 1) return 45;
  if (level <= 7) return 60;
  if (level <= 15) return 75;
  if (level <= 28) return 90;
  if (level <= 43) return 105;
  return 120;
}

/** Exp yield scales off BST; apex forms are worth grinding. */
function expYieldFor(bst: number, legendary: boolean): number {
  return Math.max(30, Math.min(280, Math.round(bst / 3.1) + (legendary ? 40 : 0)));
}

/** Catch rate falls as the line advances. Legendaries are pinned at 3. */
const CATCH_RATE: Readonly<Record<Stage, number>> = { pup: 190, adult: 105, apex: 45 };

// ===========================================================================

/** FNV-1a. Stable across runs and platforms, unlike anything hash-order dependent. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic value in [-1, 1] from a species id and a salt. */
function jitter(id: string, salt: string): number {
  return (hash(`${id}:${salt}`) / 0xffffffff) * 2 - 1;
}

const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function makeStats(entry: RosterEntry): BaseStats {
  const stageBase = entry.legendary ? BST_LEGENDARY : BST[entry.stage];
  const total = Math.round(stageBase + jitter(entry.id, 'bst') * BST_JITTER);
  const w = WEIGHTS[entry.archetype];

  const raw: Record<StatKey, number> = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const k of STAT_KEYS) {
    const nominal = total * w[k];
    const wobble = 1 + jitter(entry.id, `s:${k}`) * STAT_JITTER;
    raw[k] = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(nominal * wobble)));
  }

  // Re-normalise so clamping and rounding do not drift the total out of band.
  const actual = STAT_KEYS.reduce((a, k) => a + raw[k], 0);
  const drift = total - actual;
  if (drift !== 0) {
    // Push the correction into the archetype's strongest stat, which is where a
    // few points read as "this thing is built for that" rather than as noise.
    let bestKey: StatKey = 'hp';
    for (const k of STAT_KEYS) if (w[k] > w[bestKey]) bestKey = k;
    raw[bestKey] = Math.max(STAT_MIN, Math.min(STAT_MAX, raw[bestKey] + drift));
  }

  return { hp: raw.hp, atk: raw.atk, def: raw.def, spa: raw.spa, spd: raw.spd, spe: raw.spe };
}

// ---------------------------------------------------------------------------
// Learnsets
// ---------------------------------------------------------------------------

const byType = new Map<FeralType, typeof MOVE_LIST>();
for (const mv of MOVE_LIST) {
  const list = byType.get(mv.type) ?? [];
  byType.set(mv.type, [...list, mv]);
}

/** Prefers the attacking stat the archetype actually invested in. */
function prefersSpecial(archetype: Archetype): boolean {
  return archetype === 'channeler' || archetype === 'warden';
}

function buildLearnset(entry: RosterEntry, base: BaseStats): LearnEntry[] {
  const pool = entry.types.flatMap((t) => byType.get(t) ?? []);
  if (pool.length === 0) {
    throw new Error(`no moves available for ${entry.id} (types ${entry.types.join('/')})`);
  }

  const special = prefersSpecial(entry.archetype) || base.spa > base.atk;
  const used = new Set<string>();
  const out: LearnEntry[] = [];

  // Rank candidates for a slot: right level band, right attack stat, unused,
  // and deterministically shuffled so two same-typed species differ.
  const candidateFor = (level: number, wantDamaging: boolean, idx: number): string | null => {
    const ceiling = powerCeilingAt(level);
    const scored = pool
      .filter((m) => !used.has(m.id))
      .filter((m) => (wantDamaging ? m.power > 0 : true))
      .filter((m) => m.power <= ceiling)
      .map((m) => {
        let score = 0;
        // Power should track the level it is learned at, not just fit under it.
        score += m.power > 0 ? 40 - Math.abs(m.power - ceiling * 0.82) : 22;
        if (m.category === 'special' && special) score += 14;
        if (m.category === 'physical' && !special) score += 14;
        if (m.category === 'status' && level <= 1) score -= 30;
        score += (hash(`${entry.id}:${m.id}:${idx}`) % 100) / 6;
        return { m, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0]?.m.id ?? null;
  };

  for (const [idx, level] of LEARN_LEVELS.entries()) {
    // The first two slots must be damaging so a level-1 creature can actually fight.
    const wantDamaging = idx < 2 || idx % 3 !== 2;
    const pick = candidateFor(level, wantDamaging, idx) ?? candidateFor(level, false, idx);
    if (pick === null) continue;
    used.add(pick);
    out.push({ level, move: pick });
  }

  // Guarantee a STAB damaging move by level 20 — a creature that cannot use its
  // own typing offensively reads as broken no matter what the numbers say.
  const hasEarlyStab = out.some((e) => {
    if (e.level > 20) return false;
    const mv = MOVE_LIST.find((m) => m.id === e.move);
    return mv !== undefined && mv.power > 0 && entry.types.includes(mv.type);
  });
  if (!hasEarlyStab) {
    const stabMove = pool
      .filter((m) => m.power > 0 && m.power <= powerCeilingAt(15) && !used.has(m.id))
      .sort((a, b) => b.power - a.power)[0];
    if (stabMove) {
      used.add(stabMove.id);
      out.push({ level: 15, move: stabMove.id });
    }
  }

  out.sort((a, b) => a.level - b.level || a.move.localeCompare(b.move));
  return out;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function build(): Species[] {
  const byId = new Map(ROSTER.map((e) => [e.id, e]));
  return ROSTER.map((entry) => {
    const base = makeStats(entry);
    const bst = STAT_KEYS.reduce((a, k) => a + base[k], 0);
    const evolvesTo =
      entry.evolvesTo !== undefined && entry.evolveLevel !== undefined
        ? { into: entry.evolvesTo, level: entry.evolveLevel }
        : undefined;

    if (entry.evolvesTo !== undefined && !byId.has(entry.evolvesTo)) {
      throw new Error(`${entry.id} evolves into unknown species ${entry.evolvesTo}`);
    }

    const species: Species = {
      id: entry.id,
      dex: entry.dex,
      name: entry.name,
      animal: entry.animal,
      family: entry.family,
      types: entry.types,
      stage: entry.stage,
      archetype: entry.archetype,
      base,
      learnset: buildLearnset(entry, base),
      ...(evolvesTo === undefined ? {} : { evolvesTo }),
      ...(entry.evolvesFrom === undefined ? {} : { evolvesFrom: entry.evolvesFrom }),
      expYield: expYieldFor(bst, entry.legendary ?? false),
      catchRate: entry.legendary ? 3 : CATCH_RATE[entry.stage],
      dexEntry: entry.dexEntry,
      spriteSeed: hash(`sprite:${entry.id}`),
      ...(entry.legendary === undefined ? {} : { legendary: entry.legendary }),
    };
    return species;
  });
}

function emit(list: readonly Species[]): string {
  const lines: string[] = [
    '/* GENERATED by scripts/gen/species.ts — do not edit by hand.',
    ' * Tune the knobs in that file and re-run `npm run gen:species`.',
    ' */',
    "import type { Species } from '../core/creature.ts';",
    '',
    'export const SPECIES_LIST: readonly Species[] = [',
  ];

  for (const s of list) {
    lines.push('  {');
    lines.push(`    id: ${JSON.stringify(s.id)},`);
    lines.push(`    dex: ${s.dex},`);
    lines.push(`    name: ${JSON.stringify(s.name)},`);
    lines.push(`    animal: ${JSON.stringify(s.animal)},`);
    lines.push(`    family: ${JSON.stringify(s.family)},`);
    lines.push(`    types: [${s.types.map((t) => JSON.stringify(t)).join(', ')}],`);
    lines.push(`    stage: ${JSON.stringify(s.stage)},`);
    lines.push(`    archetype: ${JSON.stringify(s.archetype)},`);
    lines.push(
      `    base: { hp: ${s.base.hp}, atk: ${s.base.atk}, def: ${s.base.def}, spa: ${s.base.spa}, spd: ${s.base.spd}, spe: ${s.base.spe} },`,
    );
    lines.push('    learnset: [');
    for (const l of s.learnset) {
      lines.push(`      { level: ${l.level}, move: ${JSON.stringify(l.move)} },`);
    }
    lines.push('    ],');
    if (s.evolvesTo) {
      lines.push(
        `    evolvesTo: { into: ${JSON.stringify(s.evolvesTo.into)}, level: ${s.evolvesTo.level} },`,
      );
    }
    if (s.evolvesFrom !== undefined) {
      lines.push(`    evolvesFrom: ${JSON.stringify(s.evolvesFrom)},`);
    }
    lines.push(`    expYield: ${s.expYield},`);
    lines.push(`    catchRate: ${s.catchRate},`);
    lines.push(`    dexEntry: ${JSON.stringify(s.dexEntry)},`);
    lines.push(`    spriteSeed: ${s.spriteSeed},`);
    if (s.legendary) lines.push('    legendary: true,');
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');
  lines.push('export const SPECIES: Readonly<Record<string, Species>> = Object.freeze(');
  lines.push('  Object.fromEntries(SPECIES_LIST.map((s) => [s.id, s])),');
  lines.push(');');
  lines.push('');
  lines.push('export function getSpecies(id: string): Species {');
  lines.push('  const s = SPECIES[id];');
  lines.push('  if (!s) throw new Error(`unknown species: ${id}`);');
  lines.push('  return s;');
  lines.push('}');
  lines.push('');
  lines.push('export function speciesByDex(dex: number): Species | undefined {');
  lines.push('  return SPECIES_LIST.find((s) => s.dex === dex);');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

const built = build();
const out = new URL('../../src/data/species.gen.ts', import.meta.url).pathname;
writeFileSync(out, emit(built));

// --- Report ---------------------------------------------------------------
const bandOf = (s: Species): string => (s.legendary ? 'legendary' : s.stage);
const bands = new Map<string, number[]>();
for (const s of built) {
  const bst = STAT_KEYS.reduce((a, k) => a + s.base[k], 0);
  bands.set(bandOf(s), [...(bands.get(bandOf(s)) ?? []), bst]);
}
console.log(`\ngenerated ${built.length} species -> src/data/species.gen.ts\n`);
console.log('BAND        N     MIN   MED   MAX');
for (const [band, vals] of bands) {
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(
    `${band.padEnd(12)}${String(vals.length).padEnd(6)}${String(sorted[0] ?? 0).padEnd(6)}${String(med).padEnd(6)}${sorted[sorted.length - 1] ?? 0}`,
  );
}

const starters = ['winter_apex', 'baloo_apex', 'plato_apex'];
const totals = starters.map((id) => {
  const s = built.find((x) => x.id === id);
  return s ? STAT_KEYS.reduce((a, k) => a + s.base[k], 0) : 0;
});
if (totals.every((t) => t > 0)) {
  const spread = ((Math.max(...totals) - Math.min(...totals)) / Math.min(...totals)) * 100;
  console.log(`\nstarter apex BSTs: ${totals.join(' / ')}  spread ${spread.toFixed(1)}%`);
}
console.log();
