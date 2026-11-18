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
| 3 | `gauntlet:sim` | **PASS** | was 89+, then 38, then 27; see BLOCKERS.md items 1, 2 and 6 |
| 4 | `gauntlet:curve` | **PASS** | was 24, then 15, then 3 (gym 8) |
| 5 | `gauntlet:playthrough` | **PASS** | all three starters reach the Champion, on 3 seeds, buying, naming, boxing and reading the Dex on the way |
| 6 | `gauntlet:visual` | **PASS** | 20 rules read off the real screen, 34 checkpoints, ~80s |
| 7 | `gauntlet:tone` | **PASS** | 96 keys, 325 boxes, 1 warning |
| 8 | `gauntlet:ship` | **PASS** | real build, served from the Pages subpath, driven in a browser |

`gauntlet:sim` headline numbers, current run:
- median battle length **6 turns** (p10 4, p90 10)
- every type wins **46-55%** of its fights (was 34-68%); every build 48-52% (was 33-63%)
- every status move **44-61%** (four were under 25%)
- starter triangle decisive AND even: Winter > Plato 87%, Plato > Baloo 91%,
  Baloo > Winter 81%; each starter 45-53% across both its matchups

`gauntlet:curve`: gym 8 at intended level 68% / 88% / 96% (was 18 / 54 / 46);
Champion 86% / 84% / 76%.

`gauntlet:playthrough`, current run (~90s for all three):

| starter | result | badges | saves | shop trips | spent | Dex met/owned | party levels |
|---------|--------|--------|-------|-----------|-------|---------------|--------------|
| `winter_pup` | CHAMPION | 8 | 13 | 9 | 16700 | 94/9 | 69/71/71/71 |
| `baloo_pup`  | CHAMPION | 8 | 13 | 14 | 19400 | 92/8 | 72/75/76/76 |
| `plato_pup`  | CHAMPION | 8 | 13 | 13 | 24500 | 91/10 | 77/77/78/79 |

A run FAILS, even at the Champion, if the bot never bought anything, never named a
catch, never used the kennel box, never opened the Dex, or used only one walking pace.

The numbers on the two balance gates sit close to their limits in three places
(legendary wolf 74% against a 75% ceiling, Winter at gym 8 68% against a 65% floor,
squirrel pup 34% against 25%). They are deterministic, so they hold until the data
changes - but any balance edit should expect to re-tune those three first.

(Re-checked after Phase 3 on `PT_SEED=alpha` and `PT_SEED=beta` as well as the default:
9 of 9 runs, parties at levels 66-80.)

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

(This section used to be a list of things that had since been built. Rewritten at Phase 3.)

- Selling at shops; anything to buy besides snares and poultices; repels.
- A summary page for an animal (moves, stats, experience) outside a fight.
- Where-to-find information in the Dex.
- More than one box; healing on deposit.
- Typing a name from a real keyboard.
- Any in-game hint that B runs.
- A post-game, an options menu, authored pixel art for people (Phases 4 and 5).
- Firebase is not wired up, on purpose. See "Shipping".

---

## Shipping

The game is a static site: no server, no database, no login, **94KB gzipped**.

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

ROADMAP.md is the list. Phases 1-3 are done; Phase 4 (content and feel) is next.

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

## The screen (`gauntlet:visual`, `scripts/visual/`)

- **The gate READS the screen.** `scripts/visual/pixels.ts` finds boxes by their
  borders, bars by their outline and sprites by being the big shapes that are not boxes,
  and reads text by matching 8x8 cells against the game's own font (`FONT` in `gb.ts`).
  A failure says what the screen reads: `the enemy is called "Kelppup" but its box reads
  "Kelp / Lv3"`. Nothing asks the renderer where it put things.
- **`window.__fenmark` is the other half** (`src/observe.ts`): what the game BELIEVES it
  is showing, as facts - names, levels, health, the current line. Never display strings,
  or a truncation bug in shared code agrees with itself. Still no setter.
- **The page's clock belongs to the gate.** `context.clock.install()` then `pauseAt()`
  BEFORE the page exists; after that `clock.runFor(16)` paints exactly one frame. So the
  whole tour is deterministic (the game seeds from `Date.now()`, which is fixed) and
  "the frame the bar moved" is a thing you can ask for. Under a paused clock NOTHING in
  the page that waits will ever finish: no `waitForFunction`, `waitForSelector` or
  in-page `setTimeout` - poll from Node with `page.evaluate` instead.
- **Draw the fight from `scene.shown`, never from `scene.battle`.** The engine resolves a
  whole turn the instant a move is chosen. Bars were fixed first; the gate then found the
  LEVEL ticking up on the killing move and a trainer's next animal on the field while the
  text still described the last one falling. `shown` moves only in `showEvent`, as each
  event is told. Silent events (status, exp) are applied on the way to the next message,
  so what they change appears ON the frame of its explanation.
- **A turn's first message goes up on the frame the move is chosen** (`tellNext` at the
  end of `submitAction`). Waiting a beat left LAST turn's final line on screen for a
  tenth of a second every turn. The opening line of a fight is a real queued message for
  the same reason: written to `lastText` directly it was only ever seen as that flash.
- **Refusals are messages** (`refuse`). "No power left in that one." and four others were
  written to `lastText` while a list covered the text box - the button just did nothing.
- **Standing still, she is drawn at (x,y), not at `walk.from`.** After a doorway `from`
  was a tile on the map she had just LEFT, so she appeared on the wrong square, camera
  and all, until her first step. Found by the gate's "is the square bare?" check.
- **Never use the canvas's `ellipse()`, `arc()`, `rotate()` or `stroke()` on the DMG
  screen.** They anti-alias, which puts colours on screen the Game Boy does not have.
  Platforms and the snare are plotted in whole pixels. The gate counts off-palette pixels.
- **Names must fit: creatures 12, moves 17** (`CREATURE_NAME_COLS`, `MOVE_NAME_COLS` in
  `core/text.ts`; `gauntlet:schema` enforces both across all content, because the visual
  tour only meets a dozen animals). The move list draws names whole, with the type and
  PP of the highlighted move on a fifth row - the PP used to share the name's row, which
  cut 62 of 96 names short.
- **At 160x144 the SAVES and SOUND buttons sit on top of the game.** Nobody plays at that
  size, so the Game Boy pictures are read back from the canvas and the "is anything
  covering it" check is done on the composited page at phone size instead.
- **Debugging the gate:** `VISUAL_VERBOSE=1` lists every finding; `VISUAL_UNTIL=<checkpoint>`
  stops the tour early; `VISUAL_DUMP="battle 8:100-110"` writes those frames of that fight
  as enlarged PNGs. A failure message always names the recording and the frame.
- **`npm run gauntlet:visual:mutants`** puts six player-reported bugs back and requires
  the gate to fail on each. Run it after changing the gate itself.

## Menus, shops, the box and the Dex (Phase 3)

- **Each of these is its own scene kind** (`shop`, `box`, `naming`) or a `sub` of the
  pause menu (`party`, `bag`, `dex`), stepped in `game.ts` and drawn in `draw.ts`. None
  of them is saved: `restore` always resumes in the overworld, and the autosave only
  fires there.
- **A row of text is eighteen characters and the gate will find the nineteenth.** Every
  list is the text box's width (`PARTY_BOX`). Answers to a press ("Sold.", "Keep one
  walking.") are drawn where the heading goes and must be seventeen characters or fewer.
  "Keep one standing." was one over and `gauntlet:visual` caught it running into the
  border.
- **Item names come from `src/core/items.ts`**, twelve characters at most, because a
  count or a price shares the row. Never draw the raw item id.
- **A cursor drawn in the cell before a word reads as part of the word.** The gate's
  reader joins glyphs that sit on the same 8px grid, so "▶Winter" is one run. Checks
  strip the cursor; they do not look for the name as a run of its own.
- **`WalkState.span` is the length of the step in progress** (16 walking, 8 running, set
  when the step starts from whether B is held). The renderer divides by `span`, never by
  `WALK_FRAMES`. A ledge hop is always 16.
- **The Dex lists (`player.seen`, `player.caught`) are missing from saves made before
  Phase 3.** `restore` → `withDefaults` fills them from the party and box. Any new field
  on `PlayerState` needs the same treatment or old saves crash on load.
- **`Content.speciesIds`** is every species in Dex order. Both content builders
  (`src/game/content.ts`, `scripts/gauntlet/content-loader.ts`) must provide it.
- **`trainerTeamFor(def, rivalStarter)`** is the team a save actually meets. Only the
  Champion's differs. Anything that simulates the Champion must go through it, or it is
  measuring a fight nobody has.
- **The bot must not be handed what the game sells.** `restockSnares()` wrote items
  into the bag and hid for two phases that shops sold nothing. If the bot needs
  something, it gets it the way a player does, and the run fails if it never did.

## The world, the cast and the post-game (Phase 4)

- **Hand-drawn animals live in `POSES` in `src/render/forge.ts`**, keyed by evolution line. A
  pose draws in design units (x from the middle, y UP from the ground, facing left) through a
  `Brush`, returns the function that inks the inside, and skips the family skeleton and the
  generic coat shading entirely. Only the front view: `view === 'back'` returns before poses
  are looked at. Judge them with a sheet, not by reading (`npm run forge:sheet`).
- **A sprite must be ONE connected shape.** The screen gate counts anything else on the field
  as debris. That is why the sea otter's water line touches its body, and why the adder has
  no tongue.
- **Scenery is a pass over finished maps** (`dress` in `scripts/gen/maps.ts`), run after every
  builder has finished. It only replaces plain Grass, never a tile an NPC stands on, and it
  flood-fills before and after: if a tile that could be walked to no longer can, the generator
  throws. Add scenery there, not inside `buildTown`/`buildRoute`.
- **Water is solid until the tide badge.** It existed as a tile for three phases and was on no
  map. Ponds are small on purpose.
- **Overworld life is render-only** (`drawGrassRoundFeet`, `drawAir`, `idleFacing` in
  `src/render/draw.ts`). It reads the frame counter and where the player was drawn. Nothing in
  `src/core` knows about it, and nothing should.
- **The cast table is `GYMS` and `ELITE` in `scripts/gen/maps.ts`**; leader n speaks
  `gym<n>_intro`. `town` is the map id (in saves, never changes); `townName` is what is shown.
  `badge` is the id the engine keys off (`tide` swims); `badgeName` is what the house calls it.
- **Cass's teams hold Baloo's line as a stand-in.** `trainerTeamFor` swaps it for the line this
  save's rival took, for any trainer id starting `rival_` (and for `champion`, for history).
- **A road trainer's `defeatKey` is its own `<line>_after`**, and lines are handed out in order
  by `takeGossip()`. Adding a trainer shifts every later trainer's line.
- **Signposts are `map.signs`**, a Sign tile plus the dialogue key written on it.
- **`beast` is an NPC kind**: one animal, drawn as itself, fought by walking up to it. Its flag
  is set when it is beaten OR caught; run, or lose, and it is still there. Three flags starting
  `beast_` set `beasts_done`.
- **`rematch` on an NPC** is a second team that is fought once, after the `champion` flag.
- **The ending is three steps**: the Champion's defeat lines, then the `hallOfFame` scene (which
  ignores A for `HALL_HOLD_TICKS`), then the `hall_of_fame` block and `goHome`, which puts the
  player outside her own door, healed, and asks the shell to save.
- **The playthrough bot stops at the Hall**, exactly as before. It has never seen the post-game.

## Playtest fixes (after Phase 4)

- **The battle menu is one column, so it navigates as one.** It used to step by two on up/down
  as if it were Gen 1's 2x2 grid. Left/right also step one row. Every other menu was checked: the
  starter picker is the only side-by-side one.
- **People are drawn by LOOK id, not sprite id** (`lookIdFor` in `draw.ts`, `variantFor` in
  `gb.ts`). Named people (sprite `rival`/`leader`/`elite`, or the Warden) are keyed by name so they
  match on every map; everyone else by NPC id. White hair is value `WHITE` (4) in the actor grid,
  because 0 there means "no pixel". Hair is never the light shade - that is skin. The ponytail
  (`tail`) is Tabitha's alone; Cass is fixed to a brown bob in `FIXED_LOOKS`.
- **The snare is a closed trap, and a caught animal stays in it.** `ShownSide.trapped` is set
  when a throw that holds is launched; the battle screen then draws the locked trap (with the
  animal's shape inside) instead of the animal, so "X is yours now." is never said over an animal
  standing on the field. `SNARE_PULL_FRAMES` grew to 34 to fit open / suck in / snap shut / drop;
  the audio's land sound is still the end of that beat because it reads the same constant.
- **First-time explanations are `teach_*` dialogue keys, gated by `taught_*` flags**
  (`teachOnce` in `game.ts`). Kinds and snares after the starter is picked, a one-box hint in the
  first wild fight, and one block each at the first lodge, shop and kennel. Old saves will hear the
  lodge/shop/kennel ones once on their next visit, which is harmless.

- **The pause menu is `MENU_ROOT` in `game.ts`, exported**: `draw.ts` and the playthrough bot read
  it, so inserting an entry no longer silently moves SAVE under a bot pressing "down three times".
  `scripts/visual/checks.ts` keeps its own copy on purpose (the gate does not trust the game's
  list) and `visual.ts` presses down four times to reach SAVE.
- **The kinds chart (`kindsPage` in `draw.ts`, `kindSheet` in `core/types.ts`)** is drawn in two
  columns on the 8px grid. The screen gate's reader ends a run at three empty cells, so anything that
  is not one phrase is kept three spaces apart, or the gate reads "FANG" as part of "◀ FANG ▶".
- **The move list's bottom row** is kind + hit mark on the left, power on the right
  (`moveInfoRow`). "PP" is dropped when the mark needs the room. `observe.ts` reports each move's
  multiplier against the SHOWN enemy (`mult`), and the gate rebuilds the row from that.

## Sound (`src/audio/`)

- **Nothing is a recording.** Four voices are synthesised on Web Audio — two pulse
  channels with GB duty cycles, a 32-sample wave channel, an LFSR noise channel — the
  same way `forge.ts` draws creatures instead of loading them. The entire soundtrack,
  19 songs and 31 effects, costs about 7KB gzipped. Adding an audio FILE would cost
  more than the rest of the game.
- **Songs are text.** One string per bar, one token per sixteenth: `C4` strikes, `.`
  rests, `~` holds; on a noise part the tokens name drums. `gauntlet:audio` fails on a
  bar that is not exactly `stepsPerBar` tokens, so a miscounted pattern is caught
  rather than silently truncated.
- **The clave is load-bearing.** Son clave spans TWO bars and everything in a salsa
  arrangement is written against it. The tumbao bass deliberately never plays on beat
  one — it plays the "and" of 2 and beat 4, and beat 4 belongs to the NEXT bar's chord.
  Putting the bass on the downbeat turns salsa into a polka instantly.
- **The music clock is NOT the game loop.** `requestAnimationFrame` jitters and stops
  in a background tab; music driven from it wobbles. A 25ms timer schedules notes up to
  180ms ahead directly on the audio clock instead. The game may stutter; the beat cannot.
- **Audio cannot start before a user gesture.** Every browser enforces it. The context
  is built in `unlock()` on the first keypress or tap, and a backgrounded tab comes back
  suspended, so `unlock()` also resumes. Skipping the resume gives a game that goes
  permanently silent after a phone call.
- **A tap's PRESS is not permission to start sound; its release is.** Browsers only let audio start
  inside keydown, mousedown, click, touchend, or a touch pointerup. The on-screen pad called `unlock()` on
  pointerdown only. Chrome keeps a too-early `resume()` and honours it on the release, so desktop and
  every gate were fine; iPhone Safari refuses it, so a phone player heard nothing until they clicked
  SOUND off and on (the only real click). `main.ts` now calls `unlock()` on every release, click and
  key in the capture phase, and `wake()` plays a one-sample blip inside the gesture, which iOS wants.
  `gauntlet:audio` taps the pad at phone size with `resume()` refused outside those events.
- **`BattleScene.sfx`/`sfxSeq` exist because events are gone by the time audio sees the
  state.** A hit flash cannot tell a critical from a graze. The sound is recorded at the
  moment of the drain, exactly as `flash` is, and nothing in the game reads it back.
- **`gauntlet:audio` LISTENS.** It renders every song and effect through an
  `OfflineAudioContext` and measures the samples — audible, not clipping, has dynamics,
  has both bass and treble — then loads the real game, presses real keys, and counts the
  oscillators it creates. Note data that parses perfectly renders total silence if an
  envelope is wrong or a bus is unconnected, and every data-level check still passes.
  Its first run found the effects bus 30dB under the music: technically sound, in
  practice inaudible. This is the pattern `gauntlet:visual` still needs to close for
  the screen.
