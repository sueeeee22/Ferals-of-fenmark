# Roadmap

Each phase is one session-sized brief. "Done" means: gauntlets no worse than before, the change verified in a real browser (Playwright, `tests/browser.ts`), committed, and deployed.
All nine gates pass as of Phase 3.

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

## Phase 2 — Fix the balance the tests already flag — DONE
`gauntlet:sim` 27 problems to 0, `gauntlet:curve` 3 to 0, playthrough still 3/3 Champion with parties at levels 66-80. All nine gates pass. The causes, which were not what the old notes guessed, are written up in BLOCKERS.md items 1, 2 and 6; in short:
- Only 7 of 96 moves are special, but 36 species were built around special attack or special defence, so cats, foxes and ravens were hitting with their worst stat. Their stats now go where their moves are.
- The type chart is even but the roster is not (a third of all animals are Fang or Claw), so Maw and Crown were winning far too much. They now pay for it with slightly lower stats.
- The trainer AI wasted turns: lowering a defence already at the floor, burning the unburnable, healing at full health. Fixed, which is also what made status moves look useless.
- The three starters now share one stat spread, so the rock-paper-scissors between them is even: none is the "right" pick.
- The champion's supporting team steps up to its ace instead of all sitting two levels under it.

Left open, deliberately:
- The balance gates pass with thin margins in three places (STATE.md lists them). Re-tune those first after any balance edit.
- The playthrough has only been re-run on the default seed since the rebalance.
- The champion's ace is Baloo for every player; the script says it should be the starter that beats yours. Needs a per-save trainer team (Phase 3).
- (Phase 5) Seen by the visual tour: taking only your starter down Route 1 at level 9 loses to the second trainer there about seven times in eight. The playthrough bot never notices because it catches a party first. Worth a look when tuning the first ten minutes.

## Phase 3 — Gen 1 features that are missing — DONE
Five features, one commit each (naming and the party list share one - they rewrite the same menu), each used by the playthrough bot through real button presses and each read off the real screen by `gauntlet:visual`. How each works and what to know before touching it: STATE.md, "Menus, shops, the box and the Dex".

- **Shops.** Every town's clerk sells: up/down to choose, left/right to count, A to buy, B to leave. Gen 1 prices (snare 200, poultice 300); good snares from 2 badges, big poultices from 3, great snares from 5. The bot used to write "20 snares" into its own bag; it now walks to a shop and pays out of prize money (9-14 trips and 17-25k a run), and a run that never buys fails.
- **Hold B to run.** Twice walking pace. Walking is unchanged, so a tap is still one tile.
- **Naming, and a party list worth opening.** A catch asks "Give it a name?" and opens a letter grid. The party list shows level, health in numbers and status; A on an animal offers MOVE / NAME / BACK. A poultice from the bag asks who gets it.
- **The kennel box.** A kennelhand in every lodge: PARTY and BOX lists, A sends an animal across. 30 in the box, and the last animal that can stand cannot be left.
- **The Dex.** Every species met in a fight and every one owned is remembered. A list of all 153, and a page for each one met; owning one fills the page in.

Also fixed, from the "left for Phase 3" notes:
- A locked door no longer leaves you standing on its tile.
- The Champion's ace is the starter that beats yours (it was Baloo for everybody). `gauntlet:curve` fights each starter against the team it really meets: 85.6 / 89.2 / 92.4%.
- `strong_poultice` overlapping its count: item names now come from a table that holds them to twelve characters.
- The sixth visual mutant (*identical starter sprites*) is now caught. The guess in the Phase 1 notes was right; it was the one-word fix. All six planted bugs fail the gate.
- The playthrough was re-run on two more seeds after all of the above: 9 of 9 runs reach the Champion, parties at levels 66-80.

**Known issues and things not built, for whoever is next:**
- Shops only sell. There is no selling back, and nothing else to spend on (no status cures, no repels - `repelSteps` exists in the save and nothing sets it).
- No summary page for an animal: its moves, stats and experience can only be seen in a fight. The party list's action row (`PARTY_ACTIONS`) is where a fourth action would go.
- The Dex does not say where an animal lives.
- One box of thirty. Leaving an animal in it does not heal it.
- Names are typed on the grid with the d-pad. A keyboard player cannot just type.
- Nothing in the game tells you B runs. (Phase 5: the first ten minutes.)
- While running, a tap can carry you two tiles. That is the price of the speed, and why walking is the default; do not "fix" it by slowing the run without re-reading the WALK_FRAMES note in STATE.md.
- `item` NPCs still set a flag and hand nothing over, but no map has one, so nothing is broken by it yet.
- No fishing. Water is crossed with the Tide badge and has its own encounters, which is the surfing equivalent; the maps do not need more.
- In the browser tour the box, the Dex and naming are only reached because a second animal gets caught on Route 1. The tour's clock is fixed so this is the same every run, but if the early encounter tables change and the catch stops happening, the gate will fail on "the tour never reached name-ask" - that means re-check the catch, not the feature.

## Phase 4 — Content and feel (effort: high, medium for pure writing)
More NPC dialogue in TONE.md's register (the hard rules in CLAUDE.md apply), a post-game, sprite polish on the weakest families (sea otters are the worst), overworld animation (water, grass rustle), and audio tuning from user feedback.

## Phase 5 — Playability polish (effort: medium)
Phone controls feel, options menu (text speed, music/sfx volume), clearer first ten minutes for a new player. Ask the user to playtest; their reports have found every bug the gates missed.
