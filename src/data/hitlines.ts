/**
 * What a hit SOUNDS like, chosen by how much health it actually took.
 *
 * Hand-authored, not generated - these are jokes and jokes do not survive a
 * script. A single "It goes in deep." on every super-effective hit is the thing
 * that makes a battle system feel like a spreadsheet, so the line is picked from
 * the damage as a fraction of the target's maximum health. A scratch and a
 * near-kill should never read the same.
 *
 * Buckets, by fraction of max HP removed:
 *   graze   under 8%    - barely worth the animation
 *   light   8-18%       - a real hit, nothing more
 *   solid   18-32%      - that will be felt tomorrow
 *   heavy   32-50%      - a third of them, gone
 *   brutal  50-75%      - most of what they had
 *   ruinous over 75%    - the fight is effectively decided
 */

export const HIT_LINES: Readonly<Record<string, readonly string[]>> = {
  graze: [
    'It barely tells.',
    'Enough to annoy, not enough to matter.',
    'That one was mostly for the noise.',
    'A scratch. They have had worse from brambles.',
    'It lands like a rumour.',
    'Barely a tax on them.',
    'They will remember that in the way you remember weather.',
    'It connects. Nothing follows.',
  ],
  light: [
    'That one landed.',
    'A clean hit, nothing decisive.',
    'It hurts, and they let you know.',
    'Enough to change their mind about closing.',
    'A real blow, honestly earned.',
    'They take it and keep their feet.',
    'It costs them something.',
    'Not a mercy, but not a problem either.',
  ],
  solid: [
    'That will be felt in the morning.',
    'It goes in properly.',
    'Something gives.',
    'They come away smaller than they went in.',
    'A genuinely bad moment for them.',
    'That was not a warning.',
    'It lands with intent.',
    'They will be counting that one.',
  ],
  heavy: [
    'A third of them, gone in one go.',
    'That one rearranges the fight.',
    'They fold around it.',
    'Whatever plan they had is now a different plan.',
    'It takes a serious piece out of them.',
    'They are visibly worse off.',
    'That is the kind of hit that ends careers.',
    'The confidence goes out of them.',
  ],
  brutal: [
    'Most of what they had, taken at once.',
    'That is very nearly the whole argument.',
    'They are running on what is left, and it is not much.',
    'It goes through them.',
    'Half of them leaves the fight.',
    'They are still standing out of habit.',
    'That was not a fight, that was a decision.',
    'Whatever they were saving it for, they no longer have it.',
  ],
  ruinous: [
    'There is almost nothing left of them.',
    'That was the fight, in one movement.',
    'They are upright and that is all they are.',
    'It empties them.',
    'Nobody comes back from that in the same shape.',
    'The rest is paperwork.',
    'They have nothing left to lose but the last of it.',
    'That one was obscene.',
    'It takes nearly all of them and asks for the rest.',
    'They are finished and have not been told yet.',
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
