/**
 * What a hit SOUNDS like, chosen by how much health it actually took.
 *
 * Hand-authored, not generated - these are jokes and jokes do not survive a
 * script. One line repeated on every good hit is what makes a battle system
 * feel like a spreadsheet.
 *
 * EVERY LINE FITS IN ONE TEXT BOX: two rows of eighteen characters, so 36 is the
 * hard ceiling. Longer lines get paged, and a sentence split across two button
 * presses reads as the game cutting itself off mid-thought - which is exactly
 * what it looked like.
 *
 * Buckets, by fraction of max HP removed:
 *   graze   under 8%    light   8-18%    solid   18-32%
 *   heavy   32-50%      brutal  50-75%   ruinous over 75%
 */

export const HIT_LINES: Readonly<Record<string, readonly string[]>> = {
  graze: [
    'It barely tells.',
    'Annoying. Not much else.',
    'That was mostly for the noise.',
    'A scratch. They have had worse.',
    'It lands like a rumour.',
    'Barely a tax on them.',
    'It connects. Nothing follows.',
    'They hardly break stride.',
  ],
  light: [
    'That one landed.',
    'Clean, but not decisive.',
    'It hurts, and they say so.',
    'Enough to change their mind.',
    'A real blow, honestly earned.',
    'They take it and keep their feet.',
    'It costs them something.',
    'Not a mercy. Not a problem.',
  ],
  solid: [
    'They will feel that tomorrow.',
    'It goes in properly.',
    'Something gives.',
    'They come away smaller.',
    'A genuinely bad moment.',
    'That was not a warning.',
    'It lands with intent.',
    'They will be counting that one.',
  ],
  heavy: [
    'A third of them, gone.',
    'That rearranges the fight.',
    'They fold around it.',
    'Their plan is now a new plan.',
    'A serious piece, taken.',
    'They are visibly worse off.',
    'That ends careers.',
    'The confidence goes out of them.',
  ],
  brutal: [
    'Most of what they had, at once.',
    'Very nearly the whole argument.',
    'They run on what is left.',
    'It goes through them.',
    'Half of them leaves the fight.',
    'Still standing out of habit.',
    'Not a fight. A decision.',
    'Whatever they saved, it is gone.',
  ],
  ruinous: [
    'There is almost nothing left.',
    'The fight, in one movement.',
    'Upright, and that is all.',
    'It empties them.',
    'Nobody comes back the same.',
    'The rest is paperwork.',
    'They have only the last of it.',
    'That one was obscene.',
    'It takes nearly all of them.',
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
