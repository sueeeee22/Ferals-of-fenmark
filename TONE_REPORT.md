# TONE_REPORT.md — hostile read of `src/data/dialogue.gen.ts`

Read cold against `TONE.md`, key by key, 96 keys / 325 text boxes.
Graded as an enemy of the script, not a friend of the writer.
Machine-checkable findings are enforced by `npm run gauntlet:tone`; everything below
is the part a regex cannot decide.

---

## The three hard lines

**HARD-LINE 1 — every human is an adult. RESOLVED, no violations found.**
Swept every key for age markers near sex, romance, drinking or violence. Tabitha states
her age unprompted in the cold open ("I'm forty-four"). The Cass relationship is anchored
at "since we were nineteen" and the two of them are ~19 years past that. Dara's warden,
Margit's bargeman, Leonore's farrier, the Ashgrove/Mourne/Brack arrangement, Odile's
eleven-year-old grudge against Margit Kell — all named, all placed, all unambiguously
grown. There is no "young" anything anywhere in the file. Nothing to cut.

**HARD-LINE 2 — the creatures are never sexualized. RESOLVED, no violations found.**
This was the check I most expected to fail and it did not. Every horny line in the file is
pointed at a named adult human: the Warden of the Cross-Fen, Corwin-now-Dace the bargeman,
Osric Vale's hands, Sera's coat buttons, Wren's crossed-out fourth line. Every creature
line is character comedy with no sexual register at all — Plato refusing to fetch, Winter
screaming at a duck, Baloo thinking about doors, the champion's feral sitting down to groom
while Tabitha explicitly disclaims gloating. The two closest adjacencies are both clean on
inspection: `npc_gossip_5`'s bucket ("whose knee is in it") is a human knee in a surgeon's
back room, and `gym4_intro`'s bucket is the same warden's, from the same joke.

One **defensive rewrite**, not a violation, logged in full below: `starter_baloo`[0]
originally staged the husky as hitting you "at the knees" and *staying there, thrilled*.
Nothing in the sentence is sexual and the simile ("like a landslide with a tail") is one of
the better images in the file — but in a script this horny, a dog at knee height that stays
there and is thrilled is the one piece of blocking a bad-faith reader could work with.
Restaged so no reading exists. The image survives.

**HARD-LINE 3 — explicit acts fade to black. RESOLVED, no violations found.**
Every sexual beat in the script is either scheduling ("Tuesdays. Dace. He runs a barge"),
build-up (Wren's unsent line, Thistle's "ask me to dinner or challenge me to a duel"), or
debrief. The two morning-afters — Dara's warden with the broken collarbone and the
calligraphed apology, and "He cried. Twice. Once for a good reason." — are exactly the
shape TONE.md asks for: the comedy lives in the recounting to a hostage audience. No act is
on the page anywhere. `npc_gossip_4` ("face down in Vantry's herb garden. Smiling. In a
towel.") is aftermath, and is the funniest single box in the gossip pool.

---

## The verdict, stated plainly

**This is good. That is not the same as saying it passed.** The register is correct almost
everywhere: adults mid-agenda, jokes at the end of the line, specificity doing the work,
profanity used exactly twice in 325 boxes and both times load-bearing. Nothing in this file
could appear in an actual Pokemon game — not one line, including the shop and the signs.
The system lines are in voice, which is the hardest place to hold voice.

Three things I am hostile about:

**1. The best material in the game is the brief's material.** Nine of TONE.md's ten
reference lines appear in the shipped script, eight of them near-verbatim: Dara's bath
(`gym1_intro`), Cass's flinch (`rival_intro`), Sera on House Brack's doorways
(`gym7_intro`), Leonore's notary (`gym6_intro`), "He cried. Twice." (`gym1_after`), "I'd do
it again on a Tuesday" (`rival_3`), Plato grooming (`champion_defeat`), Brack before
dessert (`gym8_intro`). Only reference 4 (the soup) is absent, and it turns up as a running
gag at Ruth Ansell's table anyway.

I am not cutting these — TONE.md attributes its examples to these exact characters, so they
read as seed canon rather than plagiarism, and the writer's expansions are frequently better
than the seed. "Not by him. I hired a calligrapher, he does weddings" is the funniest line
in the game and it is not in the brief. The drainage letter counted to "one hundred and
forty-one times" is not in the brief. But the honest scoring note is this: strip the eight
transcribed reference lines and the average drops about half a point across the gym keys.
The writer cleared the bar on the material they invented; on six keys they typed out the
answer key and got graded on it.

**2. The script has four jokes and thirty excellent deliveries of them.** The drainage
letter is told three times (Thistle receives it, the town gossips it, Wren admits it) — that
one earns it, each telling escalates and the third adds "which is a real and serious issue".
The coat-half-on assassination is used five times across five speakers and also earns it: it
is set in the cold open, paid in `rival_3` when it kills Marlow, deepened in `gym4_after` as
a *technique somebody is teaching*, stated as doctrine by Sera, and admitted by Brack. That
is structure, not repetition, and it is the best thing in the file. The plum and the warden
are thinner. `npc_gossip_7` was the intro's best joke retyped with two words changed — cut,
see below.

**3. Number tics.** Before this pass the script contained seven "eleven"s, six "Tuesday"s,
three "since March"es and two separate thirty-year runners. Two collided outright: Odile
Harrow's eleven-year vow of silence sat directly on top of the Wren/Thistle eleven-year
silence, which is the game's central running joke, and Isolde **March** said "I haven't had
a hard day since March". Both cut.

**Did I laugh?** Yes. Out loud, three times, cold, before I had decided to be generous:

- **"Number twelve asked for eggs. In March. I found him eggs. I was late. He was very gracious."** (`elite_1`) — an executioner apologising for the catering delay on a beheading. Perfect shape: short, short, short, then the one that lands.
- **"Not by him. I hired a calligrapher, he does weddings."** (`gym1_intro`) — the freelancer detail is what does it.
- **"Not about her. About his forearms. There's a collected edition."** (`npc_gossip_9`).

Two more that got an audible exhale rather than a laugh: **"SERA: Noted. Amended. Filed."**
and **"Sera picked it, so it's a leash with buttons on."**

---

## Grade distribution

1-5 on each axis, per key. `horny` is scored as *appropriate horniness for the scene* —
a toll-road sign scoring 1 is not a failure, and I have not marked it as one.

| band | funny | modern | horny | dramatic |
|------|-------|--------|-------|----------|
| 5 | 12 | 62 | 4 | 26 |
| 4 | 45 | 30 | 9 | 32 |
| 3 | 24 | 4 | 12 | 20 |
| 2 | 12 | 0 | 8 | 14 |
| 1 | 3 | 0 | 63 | 4 |

Means: **funny 3.6 / modern 4.6 / horny 1.9 / dramatic 3.6.**

`modern` is the standout and it is not close — 96% of keys score 4 or 5. Nothing in this
script has the flat, tense-less, exclamation-marked cadence of a translated children's
menu. `funny` is the honest weak axis: the median key is amusing rather than funny, and the
laughs cluster in about a dozen keys (Ruth, Dara, Thistle, Pell, Leonore, the gossip pool).
`horny` is bottom-heavy by design — most keys are signs, system lines and beaten trainers —
but the keys that *should* be horny are, and none of them are horny at an animal.

Best-graded keys: `elite_1` (5/5/1/5), `gym1_intro` (5/5/5/4), `gym3_intro` (5/5/4/4),
`champion_intro` (5/5/1/5), `gym4_intro` (5/5/3/4), `npc_gossip_9` (5/5/4/1).
Worst-graded before rewrite: `npc_gossip_7` (2/3/1/1), `npc_gossip_10` (2/4/1/2),
`badge_get` (2/4/1/2), `gym8_defeat` (2/4/1/2).

---

## The three worst lines in the file (all cut)

1. **"Aldous choked on a plum. Nineteen years of war and it was fruit that finished him."**
   (`npc_gossip_7`) — the cold open's best joke, retold to a stranger with two words
   swapped. Not a callback; a copy-paste. Worse, the following box was
   **"There's a lesson in that and nobody at the Table has gone looking for it"** — vague,
   moralising, no want, no punchline anywhere, and a line that gestures at a joke instead
   of making one. This was the only key in the file with two failures in two boxes.

2. **"TABITHA: No heir. Eight houses. Vantry, Kell, Orrin, Pell, Halloway, Ashgrove, Mourne, Brack."**
   (`intro`) — a roll call. It exists purely to convey information, which TONE.md bans
   outright, and the speaker does not resent delivering it. It is a wiki entry with a
   character name in front. It is also the one line in the file that could survive being
   pasted into any fantasy game ever made.

3. **"Badge taken. One house down, and seven still think you're a rumour off the fen road."**
   (`badge_get`) — a generic line shown eight separate times that is factually correct on
   exactly one of them. By badge six the game is telling the player seven houses have not
   heard of her while she is wearing six of their badges.

Dishonourable mention: **"BRACK: Hah. Well. There it is."** — twenty-nine characters of
shrug from the most dangerous man in the county, in the payoff box of the eighth gym.

## The three best lines in the file (untouched)

1. **"Number twelve asked for eggs. In March. I found him eggs. I was late. He was very gracious."** (`elite_1`)
2. **"Not by him. I hired a calligrapher, he does weddings."** (`gym1_intro`)
3. **"Cass sent the good chair from the kennel, with no note at all."** (`hall_of_fame`) —
   pays off "Marlow. Save me the good chair" from `rival_intro`, forty hours of play
   earlier, and does it without a single word of explanation. The best structural joke in
   the script and nobody in it acknowledges the bit, exactly as TONE.md demands.

---

## Every line cut, and why

19 boxes rewritten in place. 15 keys / 20 boxes written from scratch (see next section).

| key | cut | reason |
|-----|-----|--------|
| `intro`[7] | "No heir. Eight houses. Vantry, Kell, Orrin, Pell, Halloway, Ashgrove, Mourne, Brack." | Exposition roll call. No want, no joke, could be a loading screen. Now: "Eight houses, forty claimants, and not one of them can prove it on paper." |
| `intro`[8] | "and a grudge apiece that is older than the both of us" | "a grudge apiece" is exactly the vagueness TONE.md names. Now: "eight grudges older than the war, the wine, and the both of us." |
| `starter_baloo`[0] | "hits you at the knees and stays there, thrilled" | Hard-line 2 hygiene. Not a violation; the only blocking in the file a hostile reader could work with. Restaged, simile kept. |
| `starter_baloo`[4] | "that's the most useful thing you've said since the war" | Third use of the "useful" runner in two consecutive keys. Flabby. Joke moved back onto Baloo, where it belongs. |
| `gym2_intro`[0] | "and I am not being funny" | A stage direction wearing a sentence's clothes. TONE.md: cut the stage directions that do the joke's job. Now the joke lands at the end instead: "Nobody has ever found that funny." |
| `gym2_intro`[3] | "Tuesdays. Corwin. He runs a barge." | `trainers.gen.ts` names gym5 **Corwin Wren**. As written, Margit Kell's Tuesday arrangement is with the head of another house, who "runs a barge". Renamed to Dace. |
| `gym8_defeat`[0] | "BRACK: Hah. Well. There it is." | A shrug in a payoff slot. Replaced with a callback to his own "sit down and eat something". |
| `gym8_after`[3] | "I'll take it on Tuesday" | Sixth Tuesday in the script. The day was doing comic work in six unrelated places and had stopped meaning anything. |
| `elite_3`[0] | "Eleven years I held a vow of silence" | Collides head-on with the Wren/Thistle eleven-year silence, the game's central running joke. Now sixteen. |
| `npc_gossip_6`[0] | "for eleven years" | Same fix, kept in sync. |
| `elite_3_defeat`[1] | "polishing that helmet since Tuesday" | Tuesday tic. |
| `champion_intro`[6] | "I haven't had a hard day since March" | Spoken by **Isolde March**. Reads as a typo, and it was the third "since March" in the file. |
| `champion_defeat`[2] | "Thirty years breeding these animals" | Echoes Marlow's "thirty years on this gate", and puts a 44-year-old in the kennel business at fourteen. |
| `blackout`[0] | "alone in the dark with a very expensive lesson" | Stock phrase. The only cliche in the file. Now: "face down in a ditch that House Kell owns by deed." |
| `badge_get`[0] | "One house down, and seven still think you're a rumour" | Wrong seven times out of eight. Rewritten count-agnostic. |
| `npc_gossip_7`[0-1] | the plum, retold; "There's a lesson in that" | Copy-paste of the intro joke, then a vague moral. Whole key rewritten to the plum's *bureaucratic aftermath* instead. |
| `npc_gossip_10`[0] | "Twelve thousand spears and one very flat face" | Limp punchline, and vague where the file is otherwise specific. Replaced with Boyd turning down a lordship twice because "the paperwork would interfere with the funerals". |
| `npc_gossip_12`[1] | "Whole fen wants a name, and the whole fen has already guessed it" | Stutter, and soft. Now ends on the cowardice: "Nobody wants to go first." |

---

## Keys written from scratch — a real, shipping bug

`interactWithNpc()` in `src/core/game.ts` says `` `${npc.dialogue}_after` `` once a battle
NPC's flag is set. **Fifteen of those keys did not exist.** Every beaten road trainer, every
gym guard, all four members of the Table and the champion rendered
`(no line written for ...)` on screen the second time you talked to them. That is the
single largest content bug I found and it is invisible to every other gauntlet.

Written: `elite_1_after`, `elite_2_after`, `elite_3_after`, `elite_4_after`,
`champion_after`, and `npc_gossip_{2,3,4,5,6,7,8,9,10,11}_after`.

The gossip ones are each written as an answer to the gossip they hang off, spoken by
someone who has just lost — so a defeated Fenwalker on Route 1 says something specific
rather than something generic. `npc_gossip_11_after` deliberately says "your animal" and
not "your cat": the key is reachable with any starter.

`gauntlet:tone` now enforces this class of bug permanently.

---

## Referred out — not my files

Flagged, not fixed, because `maps.gen.ts` and `trainers.gen.ts` belong to other agents.
The gauntlet reports these as advisory, not failures.

- **The cast does not match.** `trainers.gen.ts` names the eight leaders Dara Vantry, Ines
  Calloway, Leonore Ashgrove, Ottiline Thistle, Corwin Wren, Sera Mourne, Halvard Sable,
  Ruen Brack. The dialogue's eight are Dara Vantry, Margit Kell, Thistle Orrin, Augustine
  Pell, Wren Halloway, Leonore Ashgrove, Sera Mourne, Hollis Brack. Only gym 1 agrees. Gym 3
  currently introduces "Leonore Ashgrove" and then speaks Thistle Orrin's lines about being
  in love with Wren Halloway. Somebody has to lose this argument; the dialogue is the more
  interally consistent of the two tables and the plot depends on House Kell holding the
  debt, but that is a call for whoever owns the generators.
- **The champion is two people.** `maps.gen.ts` puts an NPC named **Cass**, rival sprite, on
  the `champion` team, but `champion_intro`/`champion_defeat` are Isolde March, and Cass is
  the *final rival* before her. Written `champion_after` as Isolde to stay consistent inside
  my own file.
- **The rival arc is unwired.** `rival_1` through `rival_final_defeat` — 12 keys, 44 boxes,
  the entire betrayal plot — are referenced by nothing in `maps.gen.ts` or
  `trainers.gen.ts`. Cass appears once, in the starting town, and never again. This is the
  best writing in the file and it is currently unreachable.

---

## Note on the short-box check

`gauntlet:tone` fails a key whose boxes are *all* under 15 characters (a stub) and merely
lists individual short boxes for a human to look at. Two exist, and both are deliberate:
`"TABITHA: Dara."` — a beat before Dara says her dead twin's name — and `"Sleep well."`,
the punchline of the Vantry Fen sign whose previous box is "every door bars from the
outside." A gate that deleted either of those to satisfy its own regex would be doing the
opposite of its job.
