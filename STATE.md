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
| 3 | `gauntlet:sim` | **FAIL — 27** | was 89+, then 38; all structural failures fixed |
| 4 | `gauntlet:curve` | **FAIL — 8** | was 24, then 15 |
| 5 | `gauntlet:playthrough` | **PASS** | all three starters reach the Champion, on 4 seeds |
| 6 | `gauntlet:visual` | not written | but `scripts/shots.ts` EXISTS: 17/18 checkpoints |
| 7 | `gauntlet:tone` | **PASS** | 96 keys, 325 boxes, 1 warning |
| 8 | `gauntlet:ship` | **PASS** | real build, served from the Pages subpath, driven in a browser |

`gauntlet:sim` headline numbers, current run:
- median battle length **6 turns** (p10 3, p90 12) — was **1**
- **0/10000** battles hit the turn cap — was 1
- max `resolveTurn` time under the 5ms ceiling
- starter triangle correct and decisive: Winter > Plato > Baloo > Winter
- remaining 27 failures are balance, not structure — see `BLOCKERS.md`

`gauntlet:playthrough`, current run (~4 min for all three):

| starter | result | badges | saves | party levels |
|---------|--------|--------|-------|--------------|
| `winter_pup` | CHAMPION | 8 | 9 | 77/78/79/79 |
| `baloo_pup`  | CHAMPION | 8 | 9 | 77/79/79/79 |
| `plato_pup`  | CHAMPION | 8 | 9 | 76/78/80/80 |

Re-checked on three further seeds via `PT_SEED=alpha npm run gauntlet:playthrough`
(and `beta`, `gamma`): **12 of 12 runs reach the Champion**, finishing at levels
66-83 with a full party of four every time. The default seed is fixed so the gate
is reproducible; `PT_SEED` exists so a pass can be distinguished from a lucky run.

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
- **All three starters complete the game**, on real button presses through the real
  reducer, from a new save to the Hall of Fame - 8 badges and 9 save/reload round
  trips each. Verified on four seeds. This is the gauntlet the brief called the
  definition of finished for gameplay, and it is green.
- **Sprite forge rebuilt with per-family drawing routines** - eight visibly different
  body plans. See `BLOCKERS.md` item 4 (now FIXED) for what is still weaker than Gen 1.
- **Battle screen matches Gen 1's layout**, verified by looking at screenshots: real
  back sprite for the player's creature, full-length names, readable command panel.
- **Starter selection exists in the browser.** It did not: the pending action dropped
  straight into the overworld and a player began with an empty party.
- **`scripts/shots.ts` captures 17/18 checkpoints** at 160x144 and phone width, with
  a `screenshots/index.json` manifest. `gauntlet:visual` (the automated grader) is
  still unwritten - the capture half exists, the assertion half does not.
- **Remaining renderer gap:** overworld player and NPC sprites are still procedural
  humanoids, not authored pixel art.
- No audio yet.
- `DEPLOY.md` and `npm run ship` are unwritten. Firebase config, rules and
  `src/firebase.ts` already exist and are good.

---

## Shipping

The game is a static site: no server, no database, no login, **77KB gzipped**.

- **The link:** `https://sueeeee22.github.io/Ferals-of-fenmark/`
- **One-time setup, and only a human can do it:** Settings → Pages → Source:
  **GitHub Actions**. Until that is switched on the link 404s. After it, every
  push redeploys. Full instructions and troubleshooting live in `DEPLOY.md`.
  Do NOT spend time trying to automate this - `enablement: true` on
  `actions/configure-pages` was tried and fails with "Create Pages site failed:
  Resource not accessible by integration". The workflow token cannot create the
  site. Also note the repo is PRIVATE, and Pages on a private repo needs a paid
  plan; making it public is the free way out.
- **CI status:** the build and the full `gauntlet:ship` verification pass green on
  a clean runner (run 2 and run 3). The only failing step is `configure-pages`,
  which is the human step above, not a build problem.
- `npm run ship` builds and then *proves the build is publishable* — it serves
  the real `dist/` over HTTP from the `/Ferals-of-fenmark/` subpath, drives it in
  a real browser, and checks every request 200s, the loop runs, the canvas draws
  more than one colour, input reaches the reducer, and **a save survives a real
  page reload**. CI runs the same thing and refuses to publish if it fails.
- **Saves:** three slots in `localStorage`, an autosave every 30s and on tab
  hide/close (own key, can never clobber a manual save), backup-on-write with
  automatic recovery from a corrupt primary, and **transfer codes** — the whole
  save as one line of text, so a player can move devices or survive a site-data
  wipe. The SAVES button is top-right, outside the DMG screen deliberately.
- Firebase is NOT wired up. It was not needed for a link, and it costs an
  account and a login this project otherwise does not require. The groundwork
  (rules, config, `src/firebase.ts`, the rules-deploy workflow) is committed and
  still valid — see the end of `DEPLOY.md` for what turning it on would take.

---

## Next steps, in order

1. **Write `gauntlet:visual`.** `scripts/shots.ts` already captures and writes
   `screenshots/index.json`; what is missing is the grader: assert every checkpoint
   present, no blank/near-blank frames, and every pixel in a `gb` shot on the 4-colour
   DMG palette (off-palette means the renderer smoothed or fractionally scaled).
   This is the largest remaining hole - it is the only gauntlet with no assertions
   at all, so nothing currently stops a rendering regression.
2. **Fix the 8 `gauntlet:curve` failures.** Most are the OPPOSITE of too hard - gyms
   beatable while well under level, because the guaranteed type counters make an
   underlevelled team viable. Elite Four #2 and #4 are the remaining "too hard" ones.
3. **Audio.** Nothing exists. The brief asks for chiptune via WebAudio.
4. Overworld player/NPC sprites: authored pixel art instead of procedural humanoids.
5. `BLOCKERS.md` items 1 and 2 (status moves, starter parity).

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
- **Battle text needs a reading beat; animation beats do not.** Every battle event
  used to dwell 6 ticks - 100ms - so a whole turn of messages was over before you
  could look at it, and the opponent's attacks were literally unreadable. Only
  `text` events carry words (nothing else touches `lastText`), so those hold for
  50 ticks and the rest stay at 6. A/B still skips instantly, which is also why
  the playthrough bot is unaffected: it presses A and never waits.
- **The healer was always usable whenever, like a Gen 1 centre.** Nothing gated it
  on fainting - it just never confirmed it had done anything, so there was no
  feedback and no reason to believe it worked. It now says so.
- **WALK_FRAMES is the tap threshold, not just an animation length.** A step only
  auto-repeats while the direction is still held when the tile completes, so the
  tile duration decides whether a human tap means one tile or two. At 8 ticks
  (133ms) it sat in the middle of a real tap (120-180ms) and the same press gave
  one tile or two at random - lining up on a doorway was a coin flip. 16 ticks
  is 267ms, which is also Gen 1's real speed, and 16 divides a 16px tile so every
  tick moves exactly ONE pixel. Do not "speed walking up" without re-measuring
  taps: `/tmp` scratch aside, the check is holds of 60-220ms all yielding 1 tile.
- **Movement smoothness has three separate causes; fixing one hides the others.**
  In order of discovery: (1) the fixed timestep and the browser paint schedule
  drift, so a painted frame can run 0 or 2 simulation ticks - fixed by
  interpolating with the leftover accumulator (`setFrameAlpha`); (2) on the frame
  a step completed, `walk.fromX/fromY` still pointed at the tile just left, so
  the renderer drew the player a WHOLE TILE BACKWARDS for one frame, once per
  tile; (3) 2px per tick is visibly coarser than 1px. Measure per-tick rendered
  offset in Node before believing any of it is fixed - the browser is too noisy.
- **`__fenmark` publishes `px`, `py` and `ticks`** (drawn pixel position and how
  many simulation ticks that painted frame consumed) precisely so smoothness can
  be measured from outside. Tile coordinates change once per tile and cannot show
  a stutter.
- **The base path is how you ship a blank page.** GitHub Pages serves a project site
  from `/Ferals-of-fenmark/`, so any asset URL starting with `/` resolves to the domain
  root and 404s. `BASE_PATH` drives `vite.config.ts`; CI sets it from the repo name.
  `gauntlet:ship` checks it twice - once by reading the built HTML, once by actually
  serving `dist/` from that subpath and watching for a non-200.
- **`src/core` may not touch `localStorage`** (gauntlet:types bans DOM globals there),
  which is why the save slots, autosave and recovery live in `src/saves.ts` and the
  panel in `src/save-ui.ts`. The reducer only raises `saveRequested`; the shell decides
  where bytes land. That separation is also why none of the save work could regress
  `gauntlet:playthrough` - it never touches `step()`.
- **Driving the intro in a browser: `z` is A, `x` is B.** And press A a BLIND fixed
  number of times, not "until the scene stops being dialogue" - the intro runs several
  dialogue segments with overworld frames between them, so a state-driven loop exits
  on the first gap and stops half way through.
- **A playthrough bot that can out-grind a problem will hide it.** Two separate bugs
  were masked this way. The bot could not catch anything, so it padded the party gate
  with levels and arrived at gym 1 twenty levels over and finished at 100/100/100 -
  which meant the gauntlet was proving the game is beatable at level 100, i.e. nothing.
  If party levels come back near the cap, treat it as a FAILURE even when it says PASS.
- **Do not soften a wild you are going to one-shot.** The bot picks its weakest move
  to bring a catch target low, but once it out-levels a route even that move kills in
  one hit, so a snare never left the bag. It now COUNTS how often softening ended the
  battle (`softenKos`) and flips to throwing on turn one - measured, not predicted from
  the damage formula, so it stays right if the formula changes.
- **Cap snares per battle.** Throwing until the bag is empty spends twenty snares on
  one stubborn creature; four throws at five creatures is strictly better, because
  losing the battle re-rolls the encounter.
- `PT_SEED=alpha` re-rolls the playthrough seed. The default is fixed so the gate is
  reproducible - use `PT_SEED` to check a pass is not one lucky run.
- `PT_TRACE=1` narrates a playthrough run. `settle()` carries a soft-lock detector that
  throws a LOCATED error after 40 no-progress iterations - that is how the Struggle
  soft-lock was found. Trust it; a "frame budget exhausted" failure means the detector
  did not fire and something is spinning while still changing state.
- Trainers and encounter tables may only use species whose evolution chain is legal at
  that level (`minLevelFor` in `scripts/gen/maps.ts`). Breaking this makes gyms
  unwinnable in a way that looks like a balance problem but is not.
- Each pre-gym route guarantees two encounter slots that are super-effective against
  the gym it leads to (`scripts/gen/maps.ts`). Without it, route 1 was all Fang feeding
  into a Fang gym and the natural team lost 90% of the time on typing alone.
- In the BROWSER, a key press shorter than ~2 frames is invisible: buttons are sampled
  once per frame. Playwright's `keyboard.press()` is too fast. Hold ~70ms.
- A long key hold does NOT walk one tile - the reducer commits on the frame it reads
  the button, then animates for WALK_FRAMES, so a 260ms hold walks three tiles.
- `src/main.ts` exposes a READ-ONLY `window.__fenmark` (scene, map, x, y, frame) for
  the screenshot driver. It has no setter, deliberately: a driver that can arrange
  scenes proves nothing about the game.
- **The catch roll is ONE roll, not four.** `catchShakes` used to require four
  consecutive successes at `rate/256`, which makes the true odds `(rate/256)^4`: a boar
  at one hit point came out at 27% and twenty throws could all reasonably miss. Gen 1
  decides with a single roll and then wobbles as theatre. Anything that reads "the
  wobbles are the check" is the bug coming back.
- **The HP bars must trail the narration, not lead it.** `scene.battle` is replaced with
  the END-OF-TURN state the instant a move is chosen, so drawing `activeOf(...).hp`
  empties both bars before a single word appears. `BattleScene.shownPlayerHp` /
  `shownEnemyHp` advance only as `damage`/`heal` events drain, and `afterEvents`
  resyncs them. Every "the text and the attacks are out of order" report traced here,
  never to the message order, which was correct all along.
- **One box per hit.** An attack costs exactly two presses: "X used Y." and one hit
  line with the effectiveness tag appended. Hit lines are capped at 24 characters
  precisely so the tag fits the same two rows - see the rules at the top of
  `src/data/hitlines.ts`. Queueing the tag as its own event puts fights back at six
  presses per exchange.
- **Animations that stop the reducer live in the scene, not the renderer.** The snare
  throw (`BattleScene.snare`) and the hit flinch (`BattleScene.flash`) are counted in
  `stepBattle`; the renderer only reads them. `flash` is decremented BEFORE the early
  returns, or a message waiting on a button press freezes the blink on one frame.
