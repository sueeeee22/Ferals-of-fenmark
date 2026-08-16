/**
 * The Fenmark type chart.
 *
 * Twelve types on three axes, which is why dual-typing falls out naturally instead of
 * being bolted on:
 *
 *   WEAPON      how it kills      Fang  Claw  Maw   Wing
 *   HABITAT     where it lives    Tide  Frost Ember Thorn Gloom
 *   TEMPERAMENT what it is        Hearth Feral Crown
 *
 * A creature is (usually) one weapon crossed with one habitat or temperament.
 * Winter is Fang/Frost. Baloo is Fang/Ember. Plato is Claw/Hearth.
 *
 * The matrix is not vibes. `scripts/analyze-types.ts` proves every type has 2-4
 * weaknesses and 2-4 resistances, and `gauntlet:sim` fails the build if any type's
 * roster wins above 65% or below 35%. Gen 1 shipped Ice, Bug and Poison as dead
 * weight; that is the specific failure this chart is engineered against.
 */

export const TYPES = [
  'Fang',
  'Claw',
  'Maw',
  'Wing',
  'Tide',
  'Frost',
  'Ember',
  'Thorn',
  'Hearth',
  'Feral',
  'Crown',
  'Gloom',
] as const;

export type FeralType = (typeof TYPES)[number];

export const TYPE_COUNT = TYPES.length;

/** Index of a type in TYPES, for the packed matrix. */
export const TYPE_INDEX: Readonly<Record<FeralType, number>> = Object.freeze(
  Object.fromEntries(TYPES.map((t, i) => [t, i])) as Record<FeralType, number>,
);

interface Matchup {
  /** Deals 2x to these. */
  readonly strong: readonly FeralType[];
  /** Deals 0.5x to these. */
  readonly weak: readonly FeralType[];
  /** Deals 0x to these. Exactly two exist in the whole chart, both flavour-load-bearing. */
  readonly nil?: readonly FeralType[];
}

/**
 * Attacking-type rows. Every type gets exactly three strong and three weak targets,
 * so no type is born with more reach than another — the differences come from what
 * they hit, not how much.
 *
 * The reasoning, per row, because "why does Thorn beat Tide" should survive contact
 * with a future reader:
 */
const MATCHUPS: Readonly<Record<FeralType, Matchup>> = Object.freeze({
  // The pack. Runs things down, takes them at the tendon, never stops coming.
  // Beats fliers on the ground, flushes night things out of cover, and works the
  // waterline the way every hunting dog ever bred was built to.
  // Bigger jaws beat it, rank beats it, and frenzy simply does not care about it.
  Fang: { strong: ['Wing', 'Gloom', 'Tide'], weak: ['Maw', 'Crown', 'Feral'] },

  // The ambush. Precision, shredding, the swipe that takes a fish out of a river.
  // Frenzy has no answer to a thing that waits. Quills and blubber do.
  Claw: { strong: ['Tide', 'Feral', 'Gloom'], weak: ['Thorn', 'Frost', 'Maw'] },

  // Crushing jaws. Breaks bone, breaks armour, cracks a seal through the ice.
  // Cannot bite what is not there: Wing is a full immunity, not a resistance.
  Maw: { strong: ['Fang', 'Claw', 'Frost'], weak: ['Crown', 'Gloom', 'Tide'], nil: ['Wing'] },

  // Altitude. Nothing on the ground gets a vote. Takes crushers apart from above
  // and stays out of reach of anything rabid. Ice on the wings ends the argument.
  Wing: { strong: ['Maw', 'Feral', 'Thorn'], weak: ['Frost', 'Crown', 'Wing'] },

  // Water. Drowns the heat out of things, drags crushers under, and reduces a
  // house cat to a wet and deeply unserious animal.
  Tide: { strong: ['Ember', 'Maw', 'Hearth'], weak: ['Frost', 'Thorn', 'Tide'] },

  // The cold. Freezes the water, grounds the birds, and numbs the paw of anything
  // that was relying on precision. Fire beats it. So does anything big enough to
  // sleep through a winter and wake up annoyed about it.
  Frost: { strong: ['Wing', 'Tide', 'Claw'], weak: ['Ember', 'Maw', 'Frost'] },

  // Heat, sun, drought. Burns the undergrowth, melts the ice, and puts light
  // where something nocturnal was relying on there not being any.
  // Cannot do a thing to a hearth: that room was built around a fire on purpose.
  Ember: { strong: ['Thorn', 'Frost', 'Gloom'], weak: ['Tide', 'Ember', 'Hearth'] },

  // Bramble, quills, spines. Drinks the river dry, wrecks a home from the inside,
  // and punishes anything that tries to solve it by clawing at it.
  // A pack just walks through a thicket, so Fang barely notices.
  Thorn: { strong: ['Tide', 'Hearth', 'Claw'], weak: ['Ember', 'Frost', 'Fang'] },

  // Domestication. Warmth, the bond, fire put in a box and told to behave —
  // which is why it beats wildfire outright. It tamed the feral and it makes the
  // dark ordinary. Against an apex predator it is worth precisely nothing.
  Hearth: { strong: ['Ember', 'Feral', 'Gloom'], weak: ['Claw', 'Thorn'], nil: ['Crown'] },

  // Rabid, unpredictable, no self-preservation. The mob pulls down the king —
  // which is the entire politics of this game in one matchup. Breaks pack
  // discipline. Cannot beat patience, altitude, or a warm room.
  Feral: { strong: ['Crown', 'Fang', 'Maw'], weak: ['Claw', 'Wing', 'Hearth'] },

  // Apex. Dominance as a stat. Scatters packs, out-masses the crushers, and finds
  // domestic loyalty beneath comment. Falls to the mob and to the knife in the
  // dark, every single time — which is the other half of this game's politics.
  Crown: { strong: ['Fang', 'Maw', 'Hearth'], weak: ['Feral', 'Gloom', 'Crown'] },

  // Night, carrion, the thing under the floor. Kings die in the dark; so do
  // ambush hunters, who are only dangerous when they can see. Daylight, a pack
  // on your trail, and a lit house are all bad news.
  Gloom: { strong: ['Crown', 'Claw', 'Ember'], weak: ['Fang', 'Hearth', 'Thorn'] },
});

/**
 * Packed effectiveness matrix, [attacker * TYPE_COUNT + defender] -> multiplier.
 * Built once at module load; battle code reads it with two array indexes and no
 * allocation, because this runs a few thousand times a second in the sim.
 */
const MATRIX: Float64Array = buildMatrix();

function buildMatrix(): Float64Array {
  const m = new Float64Array(TYPE_COUNT * TYPE_COUNT).fill(1);
  for (const atk of TYPES) {
    const row = MATCHUPS[atk];
    const a = TYPE_INDEX[atk];
    for (const d of row.strong) m[a * TYPE_COUNT + TYPE_INDEX[d]] = 2;
    for (const d of row.weak) m[a * TYPE_COUNT + TYPE_INDEX[d]] = 0.5;
    for (const d of row.nil ?? []) m[a * TYPE_COUNT + TYPE_INDEX[d]] = 0;
  }
  return m;
}

/** Single-type effectiveness lookup. */
export function effectivenessAgainst(attack: FeralType, defend: FeralType): number {
  return MATRIX[TYPE_INDEX[attack] * TYPE_COUNT + TYPE_INDEX[defend]]!;
}

/**
 * Effectiveness against a creature's full typing. Dual types multiply, so the
 * spread is 0x / 0.25x / 0.5x / 1x / 2x / 4x exactly as Gen 1's was.
 */
export function effectiveness(
  attack: FeralType,
  defenders: readonly [FeralType] | readonly [FeralType, FeralType],
): number {
  let mult = effectivenessAgainst(attack, defenders[0]);
  if (defenders.length === 2) mult *= effectivenessAgainst(attack, defenders[1]);
  return mult;
}

/** Same-Type Attack Bonus. Gen 1's 1.5x, kept — it is a good rule. */
export function stab(moveType: FeralType, userTypes: readonly FeralType[]): number {
  return userTypes.includes(moveType) ? 1.5 : 1;
}

/** The battle-log line for a multiplier, in the Game Boy's own phrasing. */
export function effectivenessMessage(mult: number): string | null {
  if (mult === 0) return "It doesn't affect them at all.";
  if (mult >= 2) return "It's brutally effective.";
  if (mult < 1) return "It barely lands.";
  return null;
}

/** Every type that hits `defenders` for more than 1x. Used by trainer AI and the dex. */
export function weaknessesOf(
  defenders: readonly [FeralType] | readonly [FeralType, FeralType],
): FeralType[] {
  return TYPES.filter((t) => effectiveness(t, defenders) > 1);
}

/** Every type that `defenders` takes less than 1x from. */
export function resistancesOf(
  defenders: readonly [FeralType] | readonly [FeralType, FeralType],
): FeralType[] {
  return TYPES.filter((t) => effectiveness(t, defenders) < 1);
}

/** Exposed for the analyzer and the schema gauntlet. */
export const TYPE_MATCHUPS = MATCHUPS;
