/**
 * Move table generator.
 *
 * MOVE_LIST below is the source of truth — 96 moves, 8 per type, real-animal
 * names only (see TONE.md's "if it could be a Pokemon move, delete it" test,
 * applied here to move names instead of dialogue). This script validates the
 * table against the design spec (PLAN.md-adjacent, see the checks below) and
 * writes the standalone, hand-editable-looking module at src/data/moves.gen.ts.
 *
 * Run: npm run gen:moves
 */
import { writeFileSync } from 'node:fs';
import type { StatKey } from '../../src/core/creature.ts';
import { fileURLToPath } from 'node:url';
import { TYPES } from '../../src/core/types.ts';
import type { Move, MoveEffect } from '../../src/core/creature.ts';

const OUT_FILE = fileURLToPath(new URL('../../src/data/moves.gen.ts', import.meta.url));

// ---------------------------------------------------------------------------
// Source data — 8 moves per type: 2 cheap (<=45 power, level-1 usable), a mid
// (60-75), a strong pick (85-110), a drawback-gated ceiling move, one status
// infliction move (the type's thematic status, chance 1, acc 75-90), and one
// buff/debuff/heal utility move. Recoil, drain, multiHit, highCrit and
// priority are seeded across the table rather than duplicated on every type.
// ---------------------------------------------------------------------------

const AUTHORED: readonly Move[] = [
  // --- Fang: the pack. Tendons, throats, never stops coming. ---------------
  {
    id: 'hamstring',
    name: 'Hamstring',
    type: 'Fang',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "Goes for the tendon. Unsporting, effective.",
  },
  {
    id: 'quick_snap',
    name: 'Quick Snap',
    type: 'Fang',
    category: 'physical',
    power: 40,
    accuracy: 100,
    pp: 30,
    priority: 1,
    description: "Bites before the sentence finishes.",
  },
  {
    id: 'takedown',
    name: 'Takedown',
    type: 'Fang',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "Full weight, aimed at the knees.",
  },
  {
    id: 'frenzied_bites',
    name: 'Frenzied Bites',
    type: 'Fang',
    category: 'physical',
    power: 18,
    accuracy: 90,
    pp: 15,
    priority: 0,
    effect: { chance: 1, multiHit: [2, 5] },
    description: "Doesn't stop at one bite. Rarely stops at three.",
  },
  {
    id: 'full_pack_charge',
    name: 'Full Pack Charge',
    type: 'Fang',
    category: 'physical',
    power: 90,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Everyone commits at once. Nobody sidesteps a wall.",
  },
  {
    id: 'run_it_down',
    name: 'Run It Down',
    type: 'Fang',
    category: 'physical',
    power: 110,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, recoil: 0.33 },
    description: "Chases until one of you stops moving.",
  },
  {
    id: 'scruff_shake',
    name: 'Scruff Shake',
    type: 'Fang',
    category: 'status',
    power: 0,
    accuracy: 80,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'stun' },
    description: "Grabs the loose skin at the neck and shakes hard.",
  },
  {
    id: 'hackles_up',
    name: 'Hackles Up',
    type: 'Fang',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { atk: 1 }, targetsSelf: true },
    description: "Every hair on end. Looks bigger, hits harder.",
  },

  // --- Claw: the ambush. Precision, shredding, the swipe from hiding. ------
  {
    id: 'swipe',
    name: 'Swipe',
    type: 'Claw',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "A warning, mostly. Mostly.",
  },
  {
    id: 'pounce',
    name: 'Pounce',
    type: 'Claw',
    category: 'physical',
    power: 45,
    accuracy: 95,
    pp: 25,
    priority: 0,
    description: "Stillness to full weight in one step.",
  },
  {
    id: 'vein_strike',
    name: 'Vein Strike',
    type: 'Claw',
    category: 'physical',
    power: 60,
    accuracy: 100,
    pp: 15,
    priority: 0,
    effect: { chance: 1, drain: 0.5 },
    description: "Finds the vein. Takes back some of what it spends.",
  },
  {
    id: 'flurry_rake',
    name: 'Flurry Rake',
    type: 'Claw',
    category: 'physical',
    power: 16,
    accuracy: 90,
    pp: 15,
    priority: 0,
    effect: { chance: 1, multiHit: [2, 5] },
    description: "Four claws, one idea, very little mercy.",
  },
  {
    id: 'precision_gouge',
    name: 'Precision Gouge',
    type: 'Claw',
    category: 'physical',
    power: 80,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, highCrit: true },
    description: "Aimed, not swung. That's the whole technique.",
  },
  {
    id: 'gut_hook',
    name: 'Gut Hook',
    type: 'Claw',
    category: 'physical',
    power: 105,
    accuracy: 85,
    pp: 10,
    priority: 0,
    description: "Claws in, then up. Not a clean finish.",
  },
  {
    id: 'deep_rake',
    name: 'Deep Rake',
    type: 'Claw',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'burn' },
    description: "Doesn't just cut. Leaves something that keeps stinging.",
  },
  {
    id: 'shred_hide',
    name: 'Shred Hide',
    type: 'Claw',
    category: 'status',
    power: 0,
    accuracy: 100,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { def: -1 } },
    description: "Tears at the hide until it stops meaning anything.",
  },

  // --- Maw: crushing jaws. Breaks bone, breaks armor. -----------------------
  {
    id: 'jaw_press',
    name: 'Jaw Press',
    type: 'Maw',
    category: 'physical',
    power: 40,
    accuracy: 100,
    pp: 30,
    priority: 0,
    description: "Doesn't need to bite hard yet. Just needs you to notice.",
  },
  {
    id: 'skull_knock',
    name: 'Skull Knock',
    type: 'Maw',
    category: 'physical',
    power: 45,
    accuracy: 95,
    pp: 25,
    priority: 0,
    description: "Headbutt with enough weight behind it to matter.",
  },
  {
    id: 'bone_crush',
    name: 'Bone Crush',
    type: 'Maw',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "The sound is worse than the damage. Not by much.",
  },
  {
    id: 'iron_grip',
    name: 'Iron Grip',
    type: 'Maw',
    category: 'physical',
    power: 70,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Locks the jaw and leans back. Physics does the rest.",
  },
  {
    id: 'crack_the_shell',
    name: 'Crack The Shell',
    type: 'Maw',
    category: 'physical',
    power: 85,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, highCrit: true },
    description: "Finds the seam in the armor. Every time.",
  },
  {
    id: 'full_bite_down',
    name: 'Full Bite Down',
    type: 'Maw',
    category: 'physical',
    power: 110,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, recoil: 0.3 },
    description: "Commits the whole jaw. The jaw notices too.",
  },
  {
    id: 'nerve_pin',
    name: 'Nerve Pin',
    type: 'Maw',
    category: 'status',
    power: 0,
    accuracy: 80,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'stun' },
    description: "Finds the exact spot that stops a limb working.",
  },
  {
    id: 'crush_guard',
    name: 'Crush Guard',
    type: 'Maw',
    category: 'status',
    power: 0,
    accuracy: 100,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { def: -1 } },
    description: "Tests the armor with its teeth. Finds the weak point.",
  },

  // --- Wing: altitude. Nothing on the ground gets a vote. -------------------
  {
    id: 'peck',
    name: 'Peck',
    type: 'Wing',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "The first thing every hatchling learns.",
  },
  {
    id: 'snap_dive',
    name: 'Snap Dive',
    type: 'Wing',
    category: 'physical',
    power: 40,
    accuracy: 100,
    pp: 25,
    priority: 1,
    description: "Down before the shadow gives any warning.",
  },
  {
    id: 'talon_strike',
    name: 'Talon Strike',
    type: 'Wing',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "Feet first, the old-fashioned way.",
  },
  {
    id: 'wing_battery',
    name: 'Wing Battery',
    type: 'Wing',
    category: 'physical',
    power: 18,
    accuracy: 90,
    pp: 15,
    priority: 0,
    effect: { chance: 1, multiHit: [2, 5] },
    description: "Beats the air, then beats you, same motion.",
  },
  {
    id: 'stoop_dive',
    name: 'Stoop Dive',
    type: 'Wing',
    category: 'physical',
    power: 90,
    accuracy: 90,
    pp: 15,
    priority: 0,
    description: "Terminal velocity, aimed. No bracing for it.",
  },
  {
    id: 'skyfall_talons',
    name: 'Skyfall Talons',
    type: 'Wing',
    category: 'physical',
    power: 115,
    accuracy: 80,
    pp: 10,
    priority: 0,
    description: "All the altitude, spent at once. Sometimes it lands.",
  },
  {
    id: 'shriek_dive',
    name: 'Shriek Dive',
    type: 'Wing',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'panic' },
    description: "The scream arrives a half-second before the bird.",
  },
  {
    id: 'ride_the_thermal',
    name: 'Ride The Thermal',
    type: 'Wing',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { spe: 1 }, targetsSelf: true },
    description: "Finds the rising air and stops working so hard.",
  },

  // --- Tide: water. Drowns the heat out of things. ---------------------------
  {
    id: 'splash_strike',
    name: 'Splash Strike',
    type: 'Tide',
    category: 'special',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "Mostly water. All of it aimed at your face.",
  },
  {
    id: 'undertow_nip',
    name: 'Undertow Nip',
    type: 'Tide',
    category: 'special',
    power: 40,
    accuracy: 100,
    pp: 30,
    priority: 0,
    description: "A small bite. The current does the rest.",
  },
  {
    id: 'leech_grip',
    name: 'Leech Grip',
    type: 'Tide',
    category: 'physical',
    power: 60,
    accuracy: 100,
    pp: 15,
    priority: 0,
    effect: { chance: 1, drain: 0.5 },
    description: "Latches on below the surface and doesn't hurry.",
  },
  {
    id: 'drag_under',
    name: 'Drag Under',
    type: 'Tide',
    category: 'physical',
    power: 70,
    accuracy: 90,
    pp: 15,
    priority: 0,
    description: "Down goes easier than up.",
  },
  {
    id: 'river_slam',
    name: 'River Slam',
    type: 'Tide',
    category: 'special',
    power: 90,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "A wall of current with a body behind it.",
  },
  {
    id: 'flood_surge',
    name: 'Flood Surge',
    type: 'Tide',
    category: 'special',
    power: 110,
    accuracy: 85,
    pp: 10,
    priority: 0,
    description: "Everything the river was holding back, at once.",
  },
  {
    id: 'cold_current',
    name: 'Cold Current',
    type: 'Tide',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'chill' },
    description: "Drags the warmth out before the fight gets close.",
  },
  {
    id: 'float_and_recover',
    name: 'Float And Recover',
    type: 'Tide',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 10,
    priority: 0,
    effect: { chance: 1, heal: 0.5 },
    description: "Belly-up in calm water. Old trick, still works.",
  },

  // --- Frost: the cold. Numbs the paw of anything relying on precision. -----
  {
    id: 'paw_numb',
    name: 'Paw Numb',
    type: 'Frost',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "Cold enough that the next hit lands a beat slower.",
  },
  {
    id: 'frost_nip',
    name: 'Frost Nip',
    type: 'Frost',
    category: 'physical',
    power: 40,
    accuracy: 100,
    pp: 30,
    priority: 1,
    description: "Quick, small, and slow to warm back up.",
  },
  {
    id: 'ice_crust_charge',
    name: 'Ice-Crust Charge',
    type: 'Frost',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "Runs it down over ground nothing else can cross.",
  },
  {
    id: 'snowdrift_slam',
    name: 'Snowdrift Slam',
    type: 'Frost',
    category: 'physical',
    power: 70,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Buries the impact under a season's worth of snow.",
  },
  {
    id: 'white_out_charge',
    name: 'White-Out Charge',
    type: 'Frost',
    category: 'special',
    power: 90,
    accuracy: 90,
    pp: 15,
    priority: 0,
    description: "Runs straight into the whiteout. Doesn't flinch first.",
  },
  {
    id: 'ice_locked_slam',
    name: 'Ice-Locked Slam',
    type: 'Frost',
    category: 'physical',
    power: 112,
    accuracy: 82,
    pp: 10,
    priority: 0,
    description: "Ground gives way to ice mid-charge. No time to plant.",
  },
  {
    id: 'frostbite_nip',
    name: 'Frostbite Nip',
    type: 'Frost',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'chill' },
    description: "Small bite. The numbness that follows is the real bite.",
  },
  {
    id: 'cold_shoulder',
    name: 'Cold Shoulder',
    type: 'Frost',
    category: 'status',
    power: 0,
    accuracy: 100,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { spe: -1 } },
    description: "Ignores it until it stops moving quite so fast.",
  },

  // --- Ember: heat, sun, drought. Puts light where dark was doing work. -----
  {
    id: 'dust_kick',
    name: 'Dust Kick',
    type: 'Ember',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "Kicks grit into the eyes. Cheap and it works.",
  },
  {
    id: 'sun_baked_snap',
    name: 'Sun-Baked Snap',
    type: 'Ember',
    category: 'physical',
    power: 45,
    accuracy: 95,
    pp: 25,
    priority: 0,
    description: "The ground is hot enough to help.",
  },
  {
    id: 'scorched_charge',
    name: 'Scorched Charge',
    type: 'Ember',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "Crosses ground nothing else wants to stand on.",
  },
  {
    id: 'heat_cracked_kick',
    name: 'Heat-Cracked Kick',
    type: 'Ember',
    category: 'physical',
    power: 70,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "The ground splits first. The opponent, eventually.",
  },
  {
    id: 'drought_charge',
    name: 'Drought Charge',
    type: 'Ember',
    category: 'special',
    power: 90,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Runs on reserves the rest of the pack used up days ago.",
  },
  {
    id: 'wildfire_sprint',
    name: 'Wildfire Sprint',
    type: 'Ember',
    category: 'physical',
    power: 115,
    accuracy: 80,
    pp: 10,
    priority: 0,
    description: "Runs the line the fire hasn't reached yet. Barely.",
  },
  {
    id: 'sunscald_bite',
    name: 'Sunscald Bite',
    type: 'Ember',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'burn' },
    description: "The bite's nothing. The blistering after is the point.",
  },
  {
    id: 'bask_in_it',
    name: 'Bask In It',
    type: 'Ember',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { atk: 1 }, targetsSelf: true },
    description: "Stretches out in full sun and gets meaner for it.",
  },

  // --- Thorn: bramble, quills, spines. Wrecks a home from the inside. -------
  {
    id: 'quill_jab',
    name: 'Quill Jab',
    type: 'Thorn',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "One quill. A promise there are more.",
  },
  {
    id: 'bramble_snag',
    name: 'Bramble Snag',
    type: 'Thorn',
    category: 'physical',
    power: 45,
    accuracy: 95,
    pp: 25,
    priority: 0,
    description: "Catches on everything. Especially skin.",
  },
  {
    id: 'barbed_latch',
    name: 'Barbed Latch',
    type: 'Thorn',
    category: 'physical',
    power: 60,
    accuracy: 100,
    pp: 15,
    priority: 0,
    effect: { chance: 1, drain: 0.5 },
    description: "The barb goes in easy. Coming out costs more.",
  },
  {
    id: 'quill_volley',
    name: 'Quill Volley',
    type: 'Thorn',
    category: 'physical',
    power: 16,
    accuracy: 90,
    pp: 15,
    priority: 0,
    effect: { chance: 1, multiHit: [2, 5] },
    description: "Doesn't aim. At this range it doesn't need to.",
  },
  {
    id: 'thicket_slam',
    name: 'Thicket Slam',
    type: 'Thorn',
    category: 'physical',
    power: 90,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Brings half the undergrowth down with it.",
  },
  {
    id: 'root_and_ruin',
    name: 'Root And Ruin',
    type: 'Thorn',
    category: 'physical',
    power: 112,
    accuracy: 82,
    pp: 10,
    priority: 0,
    description: "Pulls the whole thicket down on top of you.",
  },
  {
    id: 'dirty_barb',
    name: 'Dirty Barb',
    type: 'Thorn',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 20,
    priority: 0,
    effect: { chance: 1, status: 'venom' },
    description: "Never cleans a quill before it's used.",
  },
  {
    id: 'strip_the_bark',
    name: 'Strip The Bark',
    type: 'Thorn',
    category: 'status',
    power: 0,
    accuracy: 100,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { def: -1 } },
    description: "Wears through whatever's protecting you, given time.",
  },

  // --- Hearth: domestication. The bond, warmth, fire kept in a box. ---------
  {
    id: 'nudge',
    name: 'Nudge',
    type: 'Hearth',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "Barely a hit. Mostly a suggestion.",
  },
  {
    id: 'play_bow',
    name: 'Play Bow',
    type: 'Hearth',
    category: 'physical',
    power: 40,
    accuracy: 100,
    pp: 30,
    priority: 0,
    description: "Looks friendly right up until it isn't.",
  },
  {
    id: 'loyal_tackle',
    name: 'Loyal Tackle',
    type: 'Hearth',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "Puts its whole self into it. Always has.",
  },
  {
    id: 'fetch_and_return',
    name: 'Fetch And Return',
    type: 'Hearth',
    category: 'physical',
    power: 70,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Comes back at you faster than it left.",
  },
  {
    id: 'guard_the_house',
    name: 'Guard The House',
    type: 'Hearth',
    category: 'physical',
    power: 90,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "This is its territory now, and it means that.",
  },
  {
    id: 'all_in_devotion',
    name: 'All-In Devotion',
    type: 'Hearth',
    category: 'physical',
    power: 112,
    accuracy: 82,
    pp: 10,
    priority: 0,
    description: "Gives everything it has for the people it loves.",
  },
  {
    id: 'lap_nap_ambush',
    name: 'Lap-Nap Ambush',
    type: 'Hearth',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 15,
    priority: 0,
    effect: { chance: 1, status: 'sleep' },
    description: "Curls up right on top of you. You're napping too now.",
  },
  {
    id: 'sun_warm_sprawl',
    name: 'Sun-Warm Sprawl',
    type: 'Hearth',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 10,
    priority: 0,
    effect: { chance: 1, heal: 0.5 },
    description: "Finds the warmest patch of floor and commits fully.",
  },

  // --- Feral: rabid, unpredictable, no self-preservation. -------------------
  {
    id: 'snap_and_snarl',
    name: 'Snap And Snarl',
    type: 'Feral',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "No warning growl. Straight to the snapping.",
  },
  {
    id: 'lunge',
    name: 'Lunge',
    type: 'Feral',
    category: 'physical',
    power: 40,
    accuracy: 95,
    pp: 25,
    priority: 1,
    description: "No windup. Rarely a second chance to dodge it.",
  },
  {
    id: 'frenzy_bite',
    name: 'Frenzy Bite',
    type: 'Feral',
    category: 'physical',
    power: 65,
    accuracy: 95,
    pp: 20,
    priority: 0,
    description: "Doesn't pick a spot. Picks all of them.",
  },
  {
    id: 'foaming_charge',
    name: 'Foaming Charge',
    type: 'Feral',
    category: 'physical',
    power: 70,
    accuracy: 90,
    pp: 15,
    priority: 0,
    description: "Doesn't feel this yet. Will, tomorrow.",
  },
  {
    id: 'blind_rampage',
    name: 'Blind Rampage',
    type: 'Feral',
    category: 'physical',
    power: 95,
    accuracy: 85,
    pp: 10,
    priority: 0,
    description: "No plan. No brakes. Alarmingly effective anyway.",
  },
  {
    id: 'total_frenzy',
    name: 'Total Frenzy',
    type: 'Feral',
    category: 'physical',
    power: 115,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, recoil: 0.33 },
    description: "Throws everything it has, pays for all of it.",
  },
  {
    id: 'rabid_bite',
    name: 'Rabid Bite',
    type: 'Feral',
    category: 'status',
    power: 0,
    accuracy: 80,
    pp: 15,
    priority: 0,
    effect: { chance: 1, status: 'venom' },
    description: "The bite heals. Whatever it left behind doesn't.",
  },
  {
    id: 'no_self_preservation',
    name: 'No Self-Preservation',
    type: 'Feral',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 20,
    priority: 0,
    effect: { chance: 1, stages: { atk: 1 }, targetsSelf: true },
    description: "Stops considering the downside entirely.",
  },

  // --- Crown: apex. Dominance as a stat. -------------------------------------
  {
    id: 'assert_rank',
    name: 'Assert Rank',
    type: 'Crown',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "A shove. Everyone present understands it.",
  },
  {
    id: 'cuff',
    name: 'Cuff',
    type: 'Crown',
    category: 'physical',
    power: 45,
    accuracy: 100,
    pp: 30,
    priority: 0,
    description: "An open-pawed strike. Restraint, mostly.",
  },
  {
    id: 'dominance_charge',
    name: 'Dominance Charge',
    type: 'Crown',
    category: 'physical',
    power: 65,
    accuracy: 100,
    pp: 20,
    priority: 0,
    description: "Doesn't ask for the ground. Takes it.",
  },
  {
    id: 'pin_and_hold',
    name: 'Pin And Hold',
    type: 'Crown',
    category: 'physical',
    power: 70,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Ends the argument by making it physically impossible.",
  },
  {
    id: 'crown_strike',
    name: 'Crown Strike',
    type: 'Crown',
    category: 'physical',
    power: 90,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, highCrit: true },
    description: "Goes for the one spot that ends a challenge outright.",
  },
  {
    id: 'full_dominance',
    name: 'Full Dominance',
    type: 'Crown',
    category: 'physical',
    power: 112,
    accuracy: 100,
    pp: 10,
    priority: 0,
    effect: { chance: 1, recoil: 0.3 },
    description: "Settles it completely. That costs something too.",
  },
  {
    id: 'crushing_presence',
    name: 'Crushing Presence',
    type: 'Crown',
    category: 'status',
    power: 0,
    accuracy: 80,
    pp: 15,
    priority: 0,
    effect: { chance: 1, status: 'sleep' },
    description: "Some animals stop fighting once they see who's bigger.",
  },
  {
    id: 'regal_rest',
    name: 'Regal Rest',
    type: 'Crown',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 10,
    priority: 0,
    effect: { chance: 1, heal: 0.5 },
    description: "Takes a moment. Nobody here is going to interrupt it.",
  },

  // --- Gloom: night, carrion, the thing under the floor. --------------------
  {
    id: 'skulk',
    name: 'Skulk',
    type: 'Gloom',
    category: 'physical',
    power: 35,
    accuracy: 100,
    pp: 35,
    priority: 0,
    description: "Closes the distance while you're still deciding it's there.",
  },
  {
    id: 'night_nip',
    name: 'Night Nip',
    type: 'Gloom',
    category: 'special',
    power: 45,
    accuracy: 95,
    pp: 25,
    priority: 0,
    description: "You won't see this one coming. That's the idea.",
  },
  {
    id: 'carrion_feed',
    name: 'Carrion Feed',
    type: 'Gloom',
    category: 'physical',
    power: 60,
    accuracy: 100,
    pp: 15,
    priority: 0,
    effect: { chance: 1, drain: 0.5 },
    description: "Doesn't care if you're finished yet.",
  },
  {
    id: 'play_dead_ambush',
    name: 'Play Dead Ambush',
    type: 'Gloom',
    category: 'physical',
    power: 70,
    accuracy: 95,
    pp: 15,
    priority: 0,
    description: "Wasn't dead. Was never going to be dead.",
  },
  {
    id: 'under_the_floorboards',
    name: 'Under The Floorboards',
    type: 'Gloom',
    category: 'physical',
    power: 90,
    accuracy: 90,
    pp: 15,
    priority: 0,
    description: "Comes from a direction that isn't supposed to exist.",
  },
  {
    id: 'feeding_frenzy',
    name: 'Feeding Frenzy',
    type: 'Gloom',
    category: 'physical',
    power: 112,
    accuracy: 82,
    pp: 10,
    priority: 0,
    description: "Everything at once, before something bigger arrives.",
  },
  {
    id: 'shriek_from_the_dark',
    name: 'Shriek From The Dark',
    type: 'Gloom',
    category: 'status',
    power: 0,
    accuracy: 85,
    pp: 15,
    priority: 0,
    effect: { chance: 1, status: 'panic' },
    description: "The sound alone empties the clearing.",
  },
  {
    id: 'scavengers_patience',
    name: "Scavenger's Patience",
    type: 'Gloom',
    category: 'status',
    power: 0,
    accuracy: 101,
    pp: 10,
    priority: 0,
    effect: { chance: 1, heal: 0.5 },
    description: "Waits it out. There's always more carrion later.",
  },
];

/**
 * BALANCE PASS — applied on top of the authored table above, so the original
 * design intent stays readable and every adjustment is auditable in one place.
 *
 * Both adjustments come from gauntlet:sim measurements under matched conditions
 * (3v3, equal level, equal evolution stage, both sides driven by the same AI):
 *
 * 1. Pure stat-stage moves were landing at 21-34% win rate across the board.
 *    A single stage is a 50% swing; in a battle whose median length is five
 *    turns, spending a whole turn to get it never pays the tempo back. Doubling
 *    to two stages is what makes a setup turn a real decision instead of a trap.
 *
 * 2. `crack_the_shell` (77%) and `crown_strike` (75%) paired high power with
 *    perfect accuracy AND an elevated crit rate, which is strictly better than
 *    every neighbour in their power band. Gen 1 charges for a crit boost; so do
 *    we now. High-power high-crit moves trade away perfect accuracy.
 */
function balancePass(moves: readonly Move[]): Move[] {
  return moves.map((m): Move => {
    let next: Move = m;

    if (m.category === 'status' && m.effect?.stages !== undefined) {
      const scaled: Partial<Record<StatKey, number>> = {};
      for (const [k, v] of Object.entries(m.effect.stages)) {
        if (typeof v !== 'number' || v === 0) continue;
        scaled[k as StatKey] = v > 0 ? Math.min(6, v * 2) : Math.max(-6, v * 2);
      }
      next = { ...next, effect: { ...m.effect, stages: scaled } };
    }

    if (next.effect?.highCrit === true && next.power >= 80 && next.accuracy >= 100) {
      next = { ...next, accuracy: 90 };
    }

    return next;
  });
}

const MOVE_LIST: readonly Move[] = balancePass(AUTHORED);


// ---------------------------------------------------------------------------
// Validation — every rule from the move-table spec, checked before a single
// byte is written. A bad table should fail loudly here, not ship silently.
// ---------------------------------------------------------------------------

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

const seenIds = new Set<string>();
for (const m of MOVE_LIST) {
  if (seenIds.has(m.id)) fail(`duplicate move id: ${m.id}`);
  seenIds.add(m.id);

  if (m.description.length > 60) {
    fail(`${m.id}: description is ${m.description.length} chars, over the 60 cap`);
  }
  if (m.power > 120) fail(`${m.id}: power ${m.power} exceeds the 120 ceiling`);
  if (m.power < 0) fail(`${m.id}: negative power`);
  if (m.accuracy > 101 || m.accuracy < 0) fail(`${m.id}: accuracy ${m.accuracy} out of range`);
  if (m.effect && (m.effect.chance < 0 || m.effect.chance > 1)) {
    fail(`${m.id}: effect.chance ${m.effect.chance} out of 0..1`);
  }

  if (m.category === 'status') {
    if (m.power !== 0) fail(`${m.id}: status move has nonzero power`);
    const statusOnly =
      m.effect?.status !== undefined &&
      m.effect.stages === undefined &&
      m.effect.heal === undefined &&
      m.effect.drain === undefined;
    if (statusOnly) {
      if (m.effect?.chance !== 1) fail(`${m.id}: status-infliction move must use chance 1`);
      if (m.accuracy < 75 || m.accuracy > 90) {
        fail(`${m.id}: status-infliction move accuracy ${m.accuracy} outside 75-90`);
      }
    } else if (m.accuracy !== 100 && m.accuracy !== 101) {
      fail(`${m.id}: utility status move accuracy must be 100 or 101, got ${m.accuracy}`);
    }
  }

  if (m.power >= 100) {
    const drawback = m.accuracy <= 85 || (m.effect?.recoil ?? 0) > 0 || m.pp <= 10;
    if (!drawback) {
      fail(`${m.id}: power ${m.power} with no accuracy<=85, recoil, or pp<=10 drawback`);
    }
  }
}

for (const t of TYPES) {
  const forType = MOVE_LIST.filter((m) => m.type === t);
  if (forType.length < 7) fail(`${t}: only ${forType.length} moves (need >= 7)`);

  const cheap = forType.filter((m) => m.power <= 45).length;
  if (cheap < 2) fail(`${t}: only ${cheap} moves with power <= 45 (need >= 2)`);

  if (!forType.some((m) => m.power >= 35 && m.power <= 45)) {
    fail(`${t}: missing a weak early move (35-45 power)`);
  }
  if (!forType.some((m) => m.power >= 60 && m.power <= 75)) {
    fail(`${t}: missing a mid move (60-75 power)`);
  }
  if (!forType.some((m) => m.power >= 85 && m.power <= 110)) {
    fail(`${t}: missing a strong move (85-110 power)`);
  }
  if (!forType.some((m) => m.category === 'status')) {
    fail(`${t}: missing a status/utility move`);
  }

  const statusInfliction = forType.filter(
    (m) =>
      m.effect?.status !== undefined &&
      m.effect.stages === undefined &&
      m.effect.heal === undefined &&
      m.effect.drain === undefined,
  );
  if (statusInfliction.length !== 1) {
    fail(`${t}: expected exactly 1 status-infliction move, found ${statusInfliction.length}`);
  }
}

const hasRecoil = MOVE_LIST.some((m) => (m.effect?.recoil ?? 0) > 0);
const hasDrain = MOVE_LIST.some((m) => (m.effect?.drain ?? 0) > 0);
const hasMultiHit = MOVE_LIST.some((m) => m.effect?.multiHit !== undefined);
const hasHighCrit = MOVE_LIST.some((m) => m.effect?.highCrit === true);
const hasPriority = MOVE_LIST.some((m) => m.priority > 0);
const hasHeal = MOVE_LIST.some((m) => (m.effect?.heal ?? 0) > 0);
const hasBuff = MOVE_LIST.some(
  (m) => m.effect?.targetsSelf === true && Object.values(m.effect.stages ?? {}).some((v) => (v ?? 0) > 0),
);
const hasDebuff = MOVE_LIST.some(
  (m) =>
    !m.effect?.targetsSelf &&
    Object.values(m.effect?.stages ?? {}).some((v) => (v ?? 0) < 0),
);
if (!hasRecoil) fail('no recoil move in the table');
if (!hasDrain) fail('no drain move in the table');
if (!hasMultiHit) fail('no multiHit move in the table');
if (!hasHighCrit) fail('no highCrit move in the table');
if (!hasPriority) fail('no priority move in the table');
if (!hasHeal) fail('no heal move in the table');
if (!hasBuff) fail('no self-targeted stat buff in the table');
if (!hasDebuff) fail('no stat debuff in the table');

if (failures > 0) {
  console.error(`\ngen:moves FAILED — ${failures} problem(s). Nothing written.\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit src/data/moves.gen.ts
// ---------------------------------------------------------------------------

function q(s: string): string {
  return JSON.stringify(s);
}

function serializeEffect(e: MoveEffect): string {
  const parts: string[] = [`chance: ${e.chance}`];
  if (e.status !== undefined) parts.push(`status: ${q(e.status)}`);
  if (e.stages !== undefined) {
    const stageParts = Object.entries(e.stages)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    parts.push(`stages: { ${stageParts} }`);
  }
  if (e.targetsSelf) parts.push('targetsSelf: true');
  if (e.recoil !== undefined) parts.push(`recoil: ${e.recoil}`);
  if (e.drain !== undefined) parts.push(`drain: ${e.drain}`);
  if (e.heal !== undefined) parts.push(`heal: ${e.heal}`);
  if (e.multiHit !== undefined) parts.push(`multiHit: [${e.multiHit[0]}, ${e.multiHit[1]}]`);
  if (e.alwaysHits) parts.push('alwaysHits: true');
  if (e.highCrit) parts.push('highCrit: true');
  return `{ ${parts.join(', ')} }`;
}

function serializeMove(m: Move): string {
  const lines = [
    '  {',
    `    id: ${q(m.id)},`,
    `    name: ${q(m.name)},`,
    `    type: ${q(m.type)},`,
    `    category: ${q(m.category)},`,
    `    power: ${m.power},`,
    `    accuracy: ${m.accuracy},`,
    `    pp: ${m.pp},`,
    `    priority: ${m.priority},`,
  ];
  if (m.effect) lines.push(`    effect: ${serializeEffect(m.effect)},`);
  lines.push(`    description: ${q(m.description)},`);
  lines.push('  },');
  return lines.join('\n');
}

const out: string[] = [];
out.push('/**');
out.push(' * Move table — GENERATED by scripts/gen/moves.ts. Do not hand-edit.');
out.push(' * Run `npm run gen:moves` to regenerate after changing the source table.');
out.push(` * ${MOVE_LIST.length} moves across the twelve Fenmark types, >= 7 per type.`);
out.push(' */');
out.push('');
out.push("import type { Move } from '../core/creature.ts';");
out.push('');
out.push('export const MOVE_LIST: readonly Move[] = [');
for (const m of MOVE_LIST) out.push(serializeMove(m));
out.push('];');
out.push('');
out.push('export const MOVES: Readonly<Record<string, Move>> = Object.freeze(');
out.push('  Object.fromEntries(MOVE_LIST.map((m) => [m.id, m] as const)),');
out.push(');');
out.push('');
out.push('export function getMove(id: string): Move {');
out.push('  const move = MOVES[id];');
out.push('  if (!move) throw new Error(`Unknown move id: ${id}`);');
out.push('  return move;');
out.push('}');
out.push('');

writeFileSync(OUT_FILE, out.join('\n'));

console.log(`gen:moves — wrote ${MOVE_LIST.length} moves to ${OUT_FILE}\n`);
console.log('  moves per type:');
for (const t of TYPES) {
  const n = MOVE_LIST.filter((m) => m.type === t).length;
  console.log(`    ${t.padEnd(8)} ${n}`);
}
