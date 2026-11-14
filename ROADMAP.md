# Roadmap

Each phase is one session-sized brief. "Done" means: gauntlets no worse than before, the change verified in a real browser (Playwright, `tests/browser.ts`), committed, and deployed.
Gates failing before Phase 2: `sim` (type balance) and `curve` (gym 8 too hard). Everything else passes, including `visual`.

## Phase 1 — See the screen — DONE
`npm run gauntlet:visual` plays the real build in a browser from the title to the second town and reads the pixels: 20 rules, 23 checkpoints, about 75 seconds. How it works and how to debug it: STATE.md, "The screen".

Its first run failed on thirteen things that every other gate had passed, all real, all fixed in the same change:
- After any doorway Tabitha was drawn on the wrong square until she took a step.
- The level ticked up, and a trainer's next animal appeared, before the text got there.
- Level-ups, learned moves, switches and poultices had no words at all. Refusals ("No power left in that one.") and the line that opens a fight were never displayed.
- Last turn's final line flashed back up every time a move was chosen.
- All three starters were introduced by a sentence cut off half way.
- 62 of 96 move names were cut short in the move list; two creature names in battle.
- Cass and other villagers were hollow outlines the colour of the grass.
- RUN sat on its box's border; platforms and the snare were anti-aliased; the party and bag lists left slivers of the fight showing round them; a newly sent-in animal flickered; the place-name banner covered Tabitha on entering a town from the north, and printed the map's internal id.

`npm run gauntlet:visual:mutants` puts six bugs a player reported back, one at a time, and checks the gate goes red. Five are caught: invisible sprite, cut-off text, HP bars ahead of the text, wrong scene label, blank screen.

**Open, not chased:** the sixth, *identical starter sprites*, came back NOT CAUGHT. Probable cause, from reading the test and not from investigating: the trial stops the tour at the third starter's checkpoint (`until: 'starter-plato'`), and the comparison of the three sprites only runs after that checkpoint returns - so the trial ends before the check it is testing. If so the fix is one word in `scripts/gauntlet/visual-mutants.ts` (stop at `overworld-house` instead). Until someone confirms that, treat "the three starters look different" as unproven by mutation.

Seen along the way, left for the phase they belong to:
- (Phase 3) The party list shows a name and a bar: no level, no numbers. `strong_poultice` would overlap its own count in the bag list if it could be obtained. `item` NPCs set a flag but hand nothing over. A locked door leaves you standing on its tile.
- (Phase 5) The SAVES and SOUND buttons sit on top of the game when the window is almost exactly the game's shape. On a 414px-wide phone at 3x the game's pixels come out uneven (7 and 8 device pixels alternately).

## Phase 2 — Fix the balance the tests already flag (effort: extra high)
`gauntlet:sim` reports Hearth winning 34% and Crown 67% (target 35–65%), plus other problems. `gauntlet:curve` shows gym 8 too hard (3 failures). Fix through `scripts/gen/*`, not hand-edited `.gen.ts`. Early game was calibrated to Gen 1 and must stay that way: gym 1 should stay winnable. Done = sim and curve green, playthrough still 3/3 champion with party levels nowhere near the cap.

## Phase 3 — Gen 1 features that are missing (effort: high)
Check STATE.md "What does NOT exist yet" first. Likely: shops you can actually buy from (the bot restocks snares by cheating), a PC box you can use, the Dex screen, nicknaming, held-B to run, a fishing or surfing equivalent if the maps need it. One feature per commit; extend the playthrough bot so it uses each feature legitimately.

## Phase 4 — Content and feel (effort: high, medium for pure writing)
More NPC dialogue in TONE.md's register (the hard rules in CLAUDE.md apply), a post-game, sprite polish on the weakest families (sea otters are the worst), overworld animation (water, grass rustle), and audio tuning from user feedback.

## Phase 5 — Playability polish (effort: medium)
Phone controls feel, options menu (text speed, music/sfx volume), clearer first ten minutes for a new player. Ask the user to playtest; their reports have found every bug the gates missed.
