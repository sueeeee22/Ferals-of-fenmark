/**
 * What a hit SOUNDS like, chosen by how much health it actually took.
 *
 * TWO HARD RULES, both learned by getting them wrong:
 *
 *  1. EVERY LINE FITS ONE TEXT BOX - two rows of eighteen characters, so 36 is
 *     the ceiling. Longer lines get paged, and a sentence split across two
 *     button presses reads as the game interrupting itself.
 *
 *  2. NO LINE NAMES THE VICTIM, and in particular none of them says "they" or
 *     "them". The line follows "X used Y", so the target is already known - but
 *     when the OPPONENT landed the hit, "they come away smaller" reads as the
 *     opponent being hurt when it was actually your own animal. Every line is
 *     therefore about the BLOW, and works whichever way it is pointing.
 *
 * Buckets, by fraction of max HP removed:
 *   graze   under 8%    light   8-18%    solid   18-32%
 *   heavy   32-50%      brutal  50-75%   ruinous over 75%
 */

export const HIT_LINES: Readonly<Record<string, readonly string[]>> = {
  graze: [
    'Barely tells.',
    'Annoying. Not much else.',
    'Mostly for the noise.',
    'A scratch, and not a deep one.',
    'It lands like a rumour.',
    'Barely a tax.',
    'Connects. Nothing follows.',
    'Hardly worth the animation.',
  ],
  light: [
    'That one landed.',
    'Clean, but not decisive.',
    'It stings.',
    'Enough to be worth doing.',
    'A real blow, honestly earned.',
    'Solid contact.',
    'It costs something.',
    'Not a mercy. Not a problem.',
  ],
  solid: [
    'That will be felt tomorrow.',
    'It goes in properly.',
    'Something gives.',
    'A serious dent.',
    'A genuinely bad moment.',
    'That was not a warning.',
    'It lands with intent.',
    'Worth counting, that one.',
  ],
  heavy: [
    'A third of a health bar, gone.',
    'That rearranges the fight.',
    'Bones move that should not.',
    'The plan is now a new plan.',
    'A serious piece, taken.',
    'Visible, lasting damage.',
    'That ends careers.',
    'The confidence goes out of it.',
  ],
  brutal: [
    'Most of a health bar, at once.',
    'Very nearly the whole argument.',
    'Almost nothing left to spend.',
    'It goes straight through.',
    'Half the fight, in one blow.',
    'Standing out of habit now.',
    'Not a hit. A decision.',
    'Whatever was saved, it is gone.',
  ],
  ruinous: [
    'There is almost nothing left.',
    'The fight, in one movement.',
    'Upright, and that is all.',
    'That empties the tank.',
    'Nobody walks that off.',
    'The rest is paperwork.',
    'Only the last of it remains.',
    'That one was obscene.',
    'It takes very nearly everything.',
    'Finished, and not yet told.',
  ],
};

/** Bucket name for a hit that removed `amount` from a pool of `maxHp`. */
export function hitBucket(amount: number, maxHp: number): string {
  const frac = maxHp > 0 ? amount / maxHp : 0;
  if (frac < 0.08) return 'graze';
  if (frac < 0.18) return 'light';
  if (frac < 0.32) return 'solid';
  if (frac < 0.5) return 'heavy';
  if (frac < 0.75) return 'brutal';
  return 'ruinous';
}
