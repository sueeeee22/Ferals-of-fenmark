/**
 * Regenerates `screenshots/`.
 *
 * This used to be a driver of its own: it pressed keys, slept, and saved
 * whatever was on screen when it woke up. Nothing looked at the results, and
 * one of them - filed as "battle-midturn" - was the blackout screen, because
 * the fight had ended during a sleep.
 *
 * The pictures are now taken by `gauntlet:visual` itself, one painted frame at
 * a time, so the pictures that get saved are exactly the pictures that were
 * checked. This file just runs it.
 *
 * Run: npx tsx scripts/shots.ts   (or: npm run gauntlet:visual)
 */
await import('./gauntlet/visual.ts');
