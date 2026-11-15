# BLOCKERS.md

Anything that failed the same gauntlet three times, with a diagnosis, so the next
reader does not re-derive it. Spinning is how the budget dies.

---

## 1. Status moves sit below the 35% win-rate floor in `gauntlet:sim`

**Status: FIXED.** Every status move now lands between 44% and 61%.

The diagnosis recorded here before - a setup turn cannot repay its tempo in a
six-turn battle - was wrong, or at least was not what the numbers were showing.
Two things in the trainer AI were:

1. **It threw turns away.** `chooseAiAction` only asked whether the target already
   had a status condition. So it kept lowering a defence that was already on the
   floor, tried to burn animals that cannot be burned, and healed at full health.
   `statusMoveIsWasted` now rules those out.
2. **It valued a status move at a flat 18.** Against damage scores that scale with
   level, that meant status was the only thing a level-5 trainer wanted, was never
   chosen at level 60, and in between was chosen mostly when the user's attacks
   were being resisted - that is, in fights already being lost. The sim was not
   measuring weak moves; it was measuring moves used by the losing side. A status
   move is now worth three quarters of the best hit on offer against a fresh
   target, falling away as the target does.

The lesson: a win rate "when used" says as much about WHEN a move is chosen as
about the move. Before nudging a move's numbers, check who is choosing it.

---

## 2. Starter aggregate parity vs. a decisive triangle

**Status: FIXED.** Winter beats Plato 87%, Plato beats Baloo 91%, Baloo beats
Winter 81%; across both of its matchups each starter wins 45-53%.

- The three matchups are built identically by the type chart (hit the next one
  for double, take half back), so with equal stats the triangle is even by
  construction. All the lopsidedness came from giving the starters different stat
  spreads. They now share one (`STARTER_SPREAD` in `scripts/gen/species.ts`) and
  keep a sixth of their own archetype on top. No chart change was needed.
- `gauntlet:sim` asserts what attempt 1 below decided it should - every edge
  decisive, no starter better overall - instead of holding each pairing to 42-58%,
  which no triangle can satisfy. That edit had been lost; it is back, with the
  reasoning beside it.

---

## 6. Why some types and some animals were so far out of band

**Status: FIXED** - `gauntlet:sim` 27 problems to 0, `gauntlet:curve` 3 to 0. Kept
here because none of the three causes is visible from the data tables.

1. **Only seven of ninety-six moves are special** (four Tide, one each Frost, Ember,
   Gloom), but twenty species were built as special attackers and sixteen more
   around special DEFENCE. Cats, foxes and corvids attacked with their worst stat;
   nine of the ten weakest animals were these, and they dragged Hearth and Gloom to
   the bottom. `investInUsableAttack` now swaps the two attack weights when a
   creature's types cannot use special attack, and the warden build spends on the
   defence that is actually tested.
2. **The chart is even but the roster is not.** 47 species are Fang and 52 are Claw.
   Maw doubles against both; Crown doubles against Fang and Maw and resists both.
   `TYPE_HANDICAP` charges for that in raw stats (Maw -10%, Crown -10%, with small
   credits for Claw, Hearth and Gloom), the way Gen 1 charges Dragon.
3. **A handful of lines needed a hand** (`LINE_TUNING`, each with its reason), and
   the legendary wolf's Fang/Crown - one weakness, to the rarest type - became
   Maw/Crown, because no stat total inside the legendary band kept it under 75%.

Two consequences worth knowing. The champion's team got much harder once the
animals on it could attack properly, so its supporting five now step up to the ace
(56/56/56/58/58, ace 62) as Gen 1's do, rather than all sitting two under it. And
its ace is hardcoded to Baloo: the comment says the rival's ace "is always the
starter that counters yours", the data says Baloo for everyone. Making that true
needs a per-save trainer team, which is engine work (ROADMAP Phase 3).

---

## 5. Playthrough: no starter finished the game

**Status: FIXED.** All three starters reach the Champion — 8 badges, 9 save/reload
round trips, a full party of four, on four different seeds (12 of 12 runs).

Four separate causes, none of them balance:

1. **Creatures carried unusable movesets.** The moveset builder took the most
   recent four moves learned, so `plato_apex` at level 75 walked into the Elite
   Four with ONE damaging move that was 0x into Crown. `selectMoveset()` now
   picks for STAB and type coverage first. Plato vs Elite 4: 7% -> 56.5%.
2. **`pathTo` treated warp tiles as walkable floor.** Leaving gym 3 drops you
   directly below the gym door, so the route north ran back through that door
   and teleported the bot straight back inside, forever.
3. **The bot could not catch anything, and hid it by grinding.** The party-size
   goal kept the level grind running, so a bot that never caught a creature just
   levelled instead — Baloo hit 81 by gym 2 with a party of one, Plato finished
   at 100/100/100. A gauntlet that passes at level 100 is not testing difficulty.
4. **Softening always killed the target.** The bot softens a wild before throwing
   a snare, but once it out-levels a route its weakest move one-shots everything,
   so it never once got to throw. Fixed by measuring it (`softenKos`) rather than
   predicting it, plus a per-battle snare cap so one stubborn creature cannot eat
   the whole bag.

**The lesson worth keeping:** a bot that can grind its way past a problem will
CONCEAL that problem behind a passing result. Both of the last two bugs were
invisible while the bot was allowed to over-level. Party levels near the cap are
a failure signal even when the gauntlet prints PASS.

---

## 3. Concurrent agents clobbering shared files

**Status:** process issue, worth knowing about.

Two separate times, edits were silently lost because a background builder still
owned the file and rewrote it: `scripts/gauntlet/sim.ts` lost a 3v3 team change
and a stage-matched pairing change, and `scripts/gen/roster.ts` was rewritten
underneath an agent that had been asked to author it.

**Rule going forward.** One writer per file, always. Before editing a file a
builder was given, confirm that builder has reported back. If it has not, either
wait or send it the change as an instruction rather than making it directly.

---

## 4. Sprite forge: 153 variations on one dog

**Status: FIXED.** Each family now has its own drawing routine, and the contact
sheet shows eight genuinely different body plans instead of one. Bears are
humped, low-headed and stocky; cats are long and low with a curled whip tail;
birds are upright with a real beak, folded wing and tail behind; rodents sit
back on heavy haunches; ungulates are tall and leggy with long necks; mustelids
and reptiles run long and horizontal. A bear no longer reads as a dog.

**Within-family variety: also FIXED.** Each species now draws a signature
FEATURE from a family-plausible pool - mane, antlers, horns, quills, shell,
crest, ear tufts, neck frill, shoulder hump - assigned by seed and drawn into
the silhouette before outlining, so it picks up the border and coat shading like
the body does. Proportion jitter was widened at the same time (bulk 0.17 -> 0.26,
muzzle 0.18 -> 0.28, head 0.10 -> 0.17, ears 0.22 -> 0.30), because at the old
amounts two same-family species differed by a couple of pixels.

The distribution across the roster: canids run 20 plain / 9 maned / 5 humped /
5 tufted; ungulates 7 antlered / 3 horned; birds 11 crested / 5 frilled; ursids
mostly humped. Antlers versus horns now separates deer from goats at a glance,
and a lynx is distinguishable from a house cat by its ear tufts.

Features that grow upward shrink the fitted body slightly (`featureHeadroom`)
so antlers do not clip the top margin. The nine starter sprites have their
feature pinned deliberately rather than rolled: Winter and Baloo gain a mane as
they evolve, Plato gains ear tufts.

**What is still weaker than Gen 1:** rodents are the weakest family - several
still read as a rounded lump with an eye. And a fully dark coat loses interior
detail, because shade 3 is reserved for the outline so a dark animal has only
one shade left to model with.

The original diagnosis is kept below because it is still the right way to think
about the problem.

---

**(original diagnosis, resolved)** Judged against Red/Blue, we lost.

**The honest comparison.** Gen 1's sprites are crude, but Pidgey, Onix, Gengar and
Machop have wildly different *silhouettes* — you identify them from the outline alone
at thumbnail size. Looking at our full 153-sprite contact sheet, the overwhelming
majority read as the same generic quadruped. A Maine Coon, a German Shepherd, a
wolverine and a muskox are near-indistinguishable.

**What the forge already gets right** (do not rewrite these): DMG palette, clean
1px outline, ordered Bayer dithering for the underside shadow, a readable eye with a
catchlight, coat patterns that survive the shading pass, and a size ramp across an
evolution line.

**The specific gap: family silhouettes are barely differentiated.** All eight families
run through one quadruped skeleton with slightly different numbers. Named failures
from the sheet:
- **ursids** have no bulk, no shoulder hump, and ears at the wrong scale — they read as dogs
- **birds** read as blobs on two legs; the beak does not survive at 56px and the folded wing barely registers
- **reptiles** read as quadrupeds; nothing says low-slung, long-tailed or splayed-legged
- **rodents/mustelids** are indistinguishable from small canids
- **leg-length variation is too subtle** — you cannot tell a corgi from a wolfhound

**The fix, and it is not more parameter tuning.** Each family needs its own *drawing
routine*, not shared numbers: a distinct body-axis angle, limb attachment, head-to-body
ratio and posture per family. Ursids plantigrade and hump-shouldered; mustelids long and
low with a horizontal spine; birds with a real head-on-shoulders profile and an oversized
beak; reptiles with a horizontal spine, splayed limbs and a tail as long as the body.
Then re-render the sheet and look again. This is the highest-variance remaining work in
the project and it should be done before any more balance passes.
