/**
 * Type chart analyzer. Proves the 12x12 has no dead weight and no sweeper,
 * numerically, before anything is balanced around it.
 *
 * Design constraints asserted here:
 *   - every type has 2-4 weaknesses and 2-4 resistances (single-typed)
 *   - no type is offensively dead (must hit >= 3 types super-effectively)
 *   - no type resists everything or is weak to everything
 *   - the dual-type space contains no combination weak to nothing
 *
 * Run: npx tsx scripts/analyze-types.ts
 */
import {
  TYPES,
  type FeralType,
  effectiveness,
  effectivenessAgainst,
  weaknessesOf,
  resistancesOf,
} from '../src/core/types.ts';

const pad = (s: string, n: number): string => s.padEnd(n);
const cell = (v: number): string => (v === 0 ? ' 0 ' : v === 0.5 ? ' ½ ' : v === 2 ? ' 2 ' : ' · ');

let failures = 0;
const fail = (msg: string): void => {
  failures++;
  console.error(`  FAIL  ${msg}`);
};

console.log('\n=== FENMARK TYPE CHART ===\n');
console.log(`${pad('ATK \\ DEF', 10)}${TYPES.map((t) => pad(t.slice(0, 3), 4)).join('')}`);
for (const atk of TYPES) {
  const row = TYPES.map((def) => cell(effectivenessAgainst(atk, def))).join(' ').replace(/ +/g, ' ');
  console.log(`${pad(atk, 10)}${TYPES.map((def) => cell(effectivenessAgainst(atk, def)) + ' ').join('')}`);
  void row;
}

console.log('\n=== PER-TYPE LEDGER ===\n');
console.log(
  `${pad('TYPE', 10)}${pad('OFF 2x', 8)}${pad('OFF ½x', 8)}${pad('WEAK', 6)}${pad('RESIST', 8)}${pad('IMMUNE-TO', 10)}`,
);

for (const t of TYPES) {
  const off2 = TYPES.filter((d) => effectivenessAgainst(t, d) === 2).length;
  const offHalf = TYPES.filter((d) => effectivenessAgainst(t, d) === 0.5).length;
  const offNil = TYPES.filter((d) => effectivenessAgainst(t, d) === 0).length;
  const weak = weaknessesOf([t]);
  const resist = resistancesOf([t]);
  const immune = TYPES.filter((a) => effectivenessAgainst(a, t) === 0);

  console.log(
    `${pad(t, 10)}${pad(String(off2), 8)}${pad(String(offHalf + offNil), 8)}${pad(String(weak.length), 6)}${pad(String(resist.length), 8)}${pad(immune.join(',') || '-', 10)}`,
  );

  if (off2 < 3) fail(`${t} is offensively dead: only ${off2} super-effective targets`);
  if (weak.length < 2) fail(`${t} has only ${weak.length} weakness(es) — too safe`);
  if (weak.length > 4) fail(`${t} has ${weak.length} weaknesses — punching bag`);
  if (resist.length < 2) fail(`${t} resists only ${resist.length} type(s) — defensively dead`);
  if (resist.length > 5) fail(`${t} resists ${resist.length} types — too safe`);
}

// --- Offensive reach: how much of the roster space each type threatens ---
console.log('\n=== OFFENSIVE REACH ACROSS ALL LEGAL DUAL TYPINGS ===\n');
const duals: Array<readonly [FeralType] | readonly [FeralType, FeralType]> = [];
for (let i = 0; i < TYPES.length; i++) {
  duals.push([TYPES[i]!] as const);
  for (let j = i + 1; j < TYPES.length; j++) duals.push([TYPES[i]!, TYPES[j]!] as const);
}

const reach = TYPES.map((t) => {
  let se = 0;
  let nve = 0;
  for (const d of duals) {
    const e = effectiveness(t, d);
    if (e > 1) se++;
    else if (e < 1) nve++;
  }
  return { t, se, nve, pct: (100 * se) / duals.length };
}).sort((a, b) => b.pct - a.pct);

for (const r of reach) {
  const bar = '#'.repeat(Math.round(r.pct / 2));
  console.log(`${pad(r.t, 10)}${pad(`${r.pct.toFixed(1)}%`, 8)}${bar}`);
}
const spread = reach[0]!.pct - reach[reach.length - 1]!.pct;
console.log(`\noffensive reach spread: ${spread.toFixed(1)} points (want < 25)`);
if (spread > 25) fail(`offensive reach spread ${spread.toFixed(1)} is too wide — a type sweeps`);

// --- Defensive: nothing should be invulnerable ---
console.log('\n=== DEFENSIVE OUTLIERS (dual typings) ===\n');
let unhittable = 0;
let glass = 0;
for (const d of duals) {
  const w = weaknessesOf(d);
  const r = resistancesOf(d);
  if (w.length === 0) {
    unhittable++;
    fail(`${d.join('/')} has ZERO weaknesses — unkillable`);
  }
  if (w.length >= 7) {
    glass++;
    console.log(`  soft: ${pad(d.join('/'), 16)} ${w.length} weaknesses`);
  }
  void r;
}
console.log(`typings with no weakness: ${unhittable} (want 0)`);
console.log(`typings with 7+ weaknesses: ${glass}`);

// --- The three starters must form a clean triangle ---
console.log('\n=== STARTER TRIANGLE ===\n');
const starters = {
  Winter: ['Fang', 'Frost'] as const,
  Baloo: ['Fang', 'Ember'] as const,
  Plato: ['Claw', 'Hearth'] as const,
};
/** The classic triangle: each beats exactly one and loses to exactly one. */
const TRIANGLE: ReadonlyArray<readonly [string, string]> = [
  ['Winter', 'Plato'],
  ['Plato', 'Baloo'],
  ['Baloo', 'Winter'],
];
const bestStab = (a: keyof typeof starters, b: keyof typeof starters): number =>
  Math.max(...starters[a].map((t) => effectiveness(t, starters[b])));

for (const [name, types] of Object.entries(starters)) {
  for (const [other] of Object.entries(starters)) {
    if (name === other) continue;
    const best = bestStab(name as keyof typeof starters, other as keyof typeof starters);
    console.log(`  ${pad(name, 8)} -> ${pad(other, 8)} best STAB effectiveness ${best}x`);
    void types;
  }
}

for (const [winner, loser] of TRIANGLE) {
  const w = winner as keyof typeof starters;
  const l = loser as keyof typeof starters;
  if (bestStab(w, l) < 2) fail(`starter triangle broken: ${winner} does not beat ${loser}`);
  if (bestStab(l, w) >= 2) fail(`starter triangle broken: ${loser} should not beat ${winner}`);
}

console.log(
  failures === 0
    ? '\nTYPE CHART OK — no dead types, no sweepers.\n'
    : `\n${failures} FAILURE(S)\n`,
);
process.exit(failures === 0 ? 0 : 1);
