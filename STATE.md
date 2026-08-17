# STATE.md

**Rewritten every phase, for a fresh context with no memory of this project.**
If you are that reader: read this, then `PLAN.md` §0 (the reducer decision), then
`MANIFEST.md`. Do not re-read source that `MANIFEST.md` already summarises.
`BLOCKERS.md` has the two open balance problems already diagnosed — read it before
touching balance, or you will re-derive them.

---

## Resume

```bash
cd /home/user/Ferals-of-fenmark
npm install            # node_modules is not committed
npm run gen:all        # regenerate content tables from the roster
npm run gauntlet       # see exactly where you are
```

Branch: `claude/ferals-fenmark-rpg-ga42yt`. Push there, never elsewhere.

---

## Gauntlet status

| # | Gauntlet | Status | Notes |
|---|----------|--------|-------|
| 1 | `gauntlet:types` | **PASS** | strict tsc, eslint, zero `any`, core purity invariants |
| 2 | `gauntlet:schema` | **PASS** | 153 species, 96 moves, 0 orphan moves, starter spread 0.0% |
| 3 | `gauntlet:sim` | **FAIL — 38** | was 89+; all structural failures fixed |
| 4 | `gauntlet:curve` | **FAIL — 12** | written and working; found the trainer-legality bug |
| 5 | `gauntlet:playthrough` | **FAIL — 2 of 3** | Baloo reaches CHAMPION; Winter and Plato stall at gym 6 |
| 6 | `gauntlet:visual` | not written | `scripts/shots.ts` also missing |
| 7 | `gauntlet:tone` | **PASS** | 96 keys, 325 boxes, 1 warning |
| 8 | `gauntlet:ship` | not written | needs `DEPLOY.md` + `npm run ship` too |

`gauntlet:sim` headline numbers, current run:
- median battle length **6 turns** (p10 3, p90 12) — was **1**
- **0/10000** battles hit the turn cap — was 1
- max `resolveTurn` time under the 5ms ceiling
- starter triangle correct and decisive: Winter > Plato > Baloo > Winter
- remaining 38 failures: 17 move, 15 species, 2 starter, 3 type — see `BLOCKERS.md`

---

## What exists and works

- **Type chart** — 12 types on three axes (weapon / habitat / temperament), so dual
  typing falls out naturally. Verified numerically by `npm run analyze:types`: no dead
  types, no sweeper, 3.8-point offensive spread, clean starter triangle.
- **Battle engine** — full turn resolution, status, stat stages, crits, accuracy,
  catching, fleeing, trainer AI at four skill levels, Struggle. Emits a typed event
  stream the UI animates and the sim asserts on.
- **Overworld + reducer** — tile grid, collision, one-way ledges, flag-gated warps,
  encounter tables, trainer line-of-sight. `step(content, state, buttons)` = one frame.
- **Content** — 153 creatures (150 real animals + 3 legendaries), 96 moves, 52 maps,
  47 trainers, 8 gyms on a monotonic curve, 4-stage endgame, 81 dialogue keys.
- **Sprite forge** — deterministic pixel sprites; `npm run forge:sheet` renders
  `public/forge-sheet.png` and `forge.html`.
- **Save/load** — the save file *is* the game state, because the reducer is pure.

## What does NOT exist yet

- **The renderer has landed and the game boots.** `src/render/gb.ts` (8x8 font, 26
  hand-authored tile patterns, animated water and tall grass), `src/render/draw.ts`,
  `src/game/content.ts`, and a real `src/main.ts` with a 60fps fixed-timestep loop,
  keyboard and touch input. `npm run build` succeeds. Screenshots in `screenshots/`.
- **A full playthrough is possible.** `baloo_pup` starts a new save and plays to the
  Champion on real button presses: 8 badges, 9 save/reload round trips, party at level
  ~80. That is the first end-to-end proof the game is completable.
- **Known renderer gaps, in priority order:**
  1. The player's creature in battle is the front-facing sprite flipped and scaled -
     there is no true back sprite. Gen 1 has one; this is a visible fidelity gap.
  2. Creature names are over-truncated in battle boxes ("Cinderkit" -> "Cinder",
     "Winter" -> "Wint"). Widen the boxes or shorten the level suffix.
  3. Overworld player and NPC sprites are procedural humanoids, not authored pixel art.
- Gauntlets 4, 6, 7, 8 are unwritten.
- `screenshots/` predates the battle-layout fix and is stale. There is no screenshot
  script yet; writing one is step 2 below.
- No audio yet.
- `DEPLOY.md` and `npm run ship` are unwritten. Firebase config, rules and
  `src/firebase.ts` already exist and are good.

---

## Next steps, in order

1. **Winter and Plato stall at gym 6 (`blackmourne`, Gloom, level 39) with 5 badges.**
   Both produce IDENTICAL party levels across runs (30/34/37/39 and 25/28/31/36), so
   `grindTo` is making zero progress there - a specific stall, not slowness. Raising the
   grind budget changed nothing, which rules out "too slow". Start by running
   `PT_TRACE=1 npx tsx scripts/gauntlet/playthrough.ts` and instrumenting `grindTo`
   around `findEncounterMap` / `findGrassTile` at that point in the map graph. Baloo
   clears the same code path to level 80, so the machinery works; something about the
   Blackmourne region specifically defeats it.
2. **Fix the 12 `gauntlet:curve` failures.** Gym 1, Gym 7 and the Champion are below the
   65% floor for most starters, and Elite Four #1 is a starter lockout (Winter clears it,
   Baloo and Plato do not). Run `npx tsx scripts/gauntlet/curve.ts` for the table.
3. **Write `scripts/shots.ts` + `gauntlet:visual`.** Neither exists. `screenshots/` is
   stale - it predates the battle-layout fix.
4. **Write `gauntlet:ship` + `DEPLOY.md` + `npm run ship`.** Firebase config and rules
   already exist and are good; the deploy script and docs do not.
5. Renderer gaps above (back sprite, name truncation, overworld sprites).
6. `BLOCKERS.md` items 1, 2 and 4 - item 4 (sprite silhouettes) is the biggest
   remaining quality gap against Red/Blue.

---

## Hard-won facts, so you do not rediscover them

- **One writer per file.** Twice, edits were silently lost to a background builder that
  still owned the file. Confirm a builder has reported back before editing its files.
- Playwright must launch via `tests/browser.ts` `launchBrowser()` (points at the
  preinstalled `/opt/pw-browsers/chromium`). Never run `playwright install`.
- `noUncheckedIndexedAccess` is ON — every indexed read is `T | undefined`.
- `gauntlet:types` greps for `any`, `@ts-ignore` and `eslint-disable` and fails on them,
  including in comments unless stripped — it strips comments and string literals first.
- Generated tables (`src/data/*.gen.ts`) are committed. Never hand-edit them; edit the
  generator in `scripts/gen/` and re-run.
- The reducer is pure and `resolveTurn` **mutates the state it is given**. Build a fresh
  state per battle and fresh `Feral` objects, or HP and status leak between battles.
- `PT_TRACE=1` narrates a playthrough run. `settle()` carries a soft-lock detector that
  throws a LOCATED error after 40 no-progress iterations - that is how the Struggle
  soft-lock was found. Trust it; a "frame budget exhausted" failure means the detector
  did not fire and something is spinning while still changing state.
- Trainers and encounter tables may only use species whose evolution chain is legal at
  that level (`minLevelFor` in `scripts/gen/maps.ts`). Breaking this makes gyms
  unwinnable in a way that looks like a balance problem but is not.
