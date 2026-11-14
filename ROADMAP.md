# Roadmap

Each phase is one session-sized brief. "Done" means: gauntlets no worse than before, the change verified in a real browser (Playwright, `tests/browser.ts`), committed, and deployed.
Gates currently failing before any of this work: `sim` (type balance), `curve` (gym 8 too hard), `visual` (not written). Everything else passes.

## Phase 1 — See the screen (effort: extra high)
Write `scripts/gauntlet/visual.ts`. `scripts/shots.ts` already drives the real build to 17 checkpoints and saves PNGs, but nothing inspects them, and the last capture labelled "battle-midturn" was really the blackout screen. Check each shot: is it the scene its label claims (read `window.__fenmark.scene`)? Enough distinct colours (no blank sprites)? Does text reach a box's last column (truncation)? Do the three starters' sprites differ? Then fold in motion checks: record per-frame draw positions to catch stutter and HP bars running ahead of the text. Done = gate 6 green, and it fails if you deliberately reintroduce one of those old bugs.

## Phase 2 — Fix the balance the tests already flag (effort: extra high)
`gauntlet:sim` reports Hearth winning 34% and Crown 67% (target 35–65%), plus other problems. `gauntlet:curve` shows gym 8 too hard (3 failures). Fix through `scripts/gen/*`, not hand-edited `.gen.ts`. Early game was calibrated to Gen 1 and must stay that way: gym 1 should stay winnable. Done = sim and curve green, playthrough still 3/3 champion with party levels nowhere near the cap.

## Phase 3 — Gen 1 features that are missing (effort: high)
Check STATE.md "What does NOT exist yet" first. Likely: shops you can actually buy from (the bot restocks snares by cheating), a PC box you can use, the Dex screen, nicknaming, held-B to run, a fishing or surfing equivalent if the maps need it. One feature per commit; extend the playthrough bot so it uses each feature legitimately.

## Phase 4 — Content and feel (effort: high, medium for pure writing)
More NPC dialogue in TONE.md's register (the hard rules in CLAUDE.md apply), a post-game, sprite polish on the weakest families (sea otters are the worst), overworld animation (water, grass rustle), and audio tuning from user feedback.

## Phase 5 — Playability polish (effort: medium)
Phone controls feel, options menu (text speed, music/sfx volume), clearer first ten minutes for a new player. Ask the user to playtest; their reports have found every bug the gates missed.
