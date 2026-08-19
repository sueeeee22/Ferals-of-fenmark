/**
 * What a hit SOUNDS like, chosen by how much health it actually took.
 *
 * THREE HARD RULES, all learned by getting them wrong:
 *
 *  1. SHORT. 24 characters is the ceiling, not 36. The effectiveness tag
 *     ("Critical.", "Resisted.") is appended to the line and shown in the SAME
 *     box, so the pair has to fit two rows of eighteen between them. Every hit
 *     is therefore one line of narration and one button press, like Gen 1,
 *     instead of the three presses this used to cost.
 *
 *  2. NO LINE NAMES THE VICTIM, and in particular none of them says "they" or
 *     "them". The line follows "X used Y", so the target is already known - but
 *     when the OPPONENT landed the hit, "they come away smaller" reads as the
 *     opponent being hurt when it was actually your own animal. Every line is
 *     therefore about the BLOW, and works whichever way it is pointing.
 *
 *  3. NO LINE REPEATS ACROSS BUCKETS, or a graze and a near-kill can narrate
 *     identically and the words stop carrying information.
 *
 * Buckets, by fraction of max HP removed:
 *   graze   under 8%    light   8-18%    solid   18-32%
 *   heavy   32-50%      brutal  50-75%   ruinous over 75%
 */

export const HIT_LINES: Readonly<Record<string, readonly string[]>> = {
  graze: [
    'Barely tells.',
    'Annoying. Nothing more.',
    'Mostly for the noise.',
    'A scratch. Shallow.',
    'It lands like a rumour.',
    'Barely a tax.',
    'Connects. Then nothing.',
    'Hardly worth the swing.',
  ],
  light: [
    'That one landed.',
    'Clean, not decisive.',
    'It stings.',
    'Worth the effort.',
    'A real blow, earned.',
    'Solid contact.',
    'It costs something.',
    'Not a mercy.',
  ],
  solid: [
    'Felt tomorrow, that.',
    'It goes in properly.',
    'Something gives.',
    'A serious dent.',
    'A genuinely bad time.',
    'That was no warning.',
    'It lands with intent.',
    'Worth counting.',
  ],
  heavy: [
    'A third of a bar, gone.',
    'That rearranges things.',
    'Bones move. Wrongly.',
    'New plan required.',
    'A serious piece, taken.',
    'Lasting damage.',
    'That ends careers.',
    'The confidence goes.',
  ],
  brutal: [
    'Most of a bar, at once.',
    'Nearly the whole thing.',
    'Almost nothing left.',
    'It goes straight in.',
    'Half a fight, one blow.',
    'Standing out of habit.',
    'Not a hit. A verdict.',
    'The savings are gone.',
  ],
  ruinous: [
    'Scraps left. Barely.',
    'The fight, in one go.',
    'Upright, and that is it.',
    'That empties the tank.',
    'Nobody walks that off.',
    'The rest is paperwork.',
    'Only the last remains.',
    'That one was obscene.',
    'It takes nearly all.',
    'Finished, not yet told.',
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
