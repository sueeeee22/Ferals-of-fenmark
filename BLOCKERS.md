# BLOCKERS.md

Anything that failed the same gauntlet three times, with a diagnosis, so the next
reader does not re-derive it. Spinning is how the budget dies.

---

## 1. Status moves sit below the 35% win-rate floor in `gauntlet:sim`

**Status:** open, diagnosed, not fixed. ~16 moves affected.

**Symptom.** Pure stat-stage and status-infliction moves land at 24-34% win rate
under matched conditions, below the gauntlet's 35% floor.

**Attempts (3).**
1. Assumed a measurement artifact — the harness drove the player greedily
   (damage only) while the engine AI drove the enemy (damage and status), so
   every status move's number reported one policy against the other. Fixed by
   generalising `chooseAiAction` to either side and adding `mirrorPolicy` to
   `autoBattle`. Real fix, but the cluster survived it.
2. Doubled stat-stage magnitude from ±1 to ±2 in the move balance pass. Moved
   the cluster from ~21% to ~28%. Not enough.
3. Lengthened battles (weights, power ceiling, crit cap): median 1 → 6 turns.
   Helped, still short of the floor.

**Diagnosis.** This is structural, not a numbers bug. A setup turn costs one
turn of damage and buys a multiplier on future turns. When the median battle is
six turns and a creature dies in two to three hits, there are not enough future
turns for the multiplier to repay the tempo. Gen 1 has exactly the same problem —
Swords Dance is bad in a fast metagame — so this is arguably *faithful*, but the
gauntlet is right that it means a chunk of the movepool is dead weight.

**The real fix, when someone picks this up.** Do not keep nudging magnitudes.
Either:
- give status moves immediate value as well as ongoing value (chip damage or a
  guaranteed secondary), so the turn is never purely an investment; or
- lengthen battles further (raise the HP weight band), which costs pace; or
- accept it and narrow the gauntlet's band for `category === 'status'`, with the
  reasoning written down — but only after one of the above has been tried, or it
  is just moving the goalposts.

---

## 2. Starter aggregate parity vs. a decisive triangle

**Status:** open, materially improved, not inside the band.

**Symptom.** The triangle is correct and decisive — Winter > Plato (90%),
Plato > Baloo (80%), Baloo > Winter (59%) — but the *edges are uneven*, so
aggregate win rates come out near Winter 66% / Plato 45% / Baloo 39% rather than
50/50/50. Winter is the strongest pick.

**Attempts (3).**
1. Corrected the assertion: demanding 42-58% on every *pairing* would require
   deleting the triangle the brief explicitly asks for. Replaced with two honest
   assertions — each edge must be decisive (≥60%), and each starter's aggregate
   across both pairings must be 42-58%.
2. Forced identical starter stage totals with no jitter (542 BST at apex). Plato
   38% → 45%.
3. Blended starter archetype weights halfway to flat, because Winter's
   skirmisher speed meant it acted first regardless of typing. Helped Plato,
   pushed Baloo down.

**Diagnosis.** Speed dominates a six-turn battle more than the type chart does.
Winter's edge over Plato (90%) is far larger than Baloo's over Winter (59%), so
the cycle is lopsided even at equal stats. The lever that actually matters is
the *size* of each type edge, not the stat spread: Frost→Claw and Hearth→Ember
are both 2x, but Winter's other STAB (Fang) is neutral into Plato while Baloo's
other STAB (Fang) is also neutral into Winter — the difference comes from
defensive typing, where Fang/Frost resists more of what Plato throws.

**The real fix.** Adjust the *defensive* side of the starter matchups rather than
their stats — the honest options are giving Plato's line a resistance to Frost,
or making Baloo's Ember edge over Winter a 4x by way of its second type. Both are
chart changes and must be re-run through `scripts/analyze-types.ts`, which
enforces that no type becomes dead weight or a sweeper.

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

**What is still weaker than Gen 1:** variety *within* a family. All the cats
look like the same cat. Gen 1 gets Gengar, Machop and Onix out of one "biped"
bucket; we get one silhouette per family plus size and coat. The next lever is
per-species proportion jitter that is large enough to actually read - and a few
signature features (a mane, a shell, antlers, a ruff) distributed across the
roster rather than reserved for apex forms.

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
