/**
 * The creature roster: 150 real animals plus 3 legendaries.
 *
 * Authored as evolution LINES rather than 153 loose rows, because a line is the
 * unit a player actually experiences and it is the unit that has to make sense.
 * The expander at the bottom flattens lines into `RosterEntry[]`, assigning dex
 * numbers so a line is always contiguous.
 *
 * Every creature is a real animal. If you cannot name the breed or species it is
 * based on, it does not belong in this file.
 *
 * Statlines, learnsets, exp yields and catch rates are NOT here — they come from
 * scripts/gen/species.ts, which derives them from `stage` and `archetype`.
 */
import type { FeralType } from '../../src/core/types.ts';
import type { Archetype, Family, Stage } from '../../src/core/creature.ts';

export interface RosterEntry {
  readonly id: string;
  readonly dex: number;
  readonly name: string;
  readonly animal: string;
  readonly family: Family;
  readonly types: readonly [FeralType] | readonly [FeralType, FeralType];
  readonly stage: Stage;
  readonly archetype: Archetype;
  readonly evolvesTo?: string;
  readonly evolvesFrom?: string;
  readonly evolveLevel?: number;
  readonly legendary?: boolean;
  readonly dexEntry: string;
}

type Types = readonly [FeralType] | readonly [FeralType, FeralType];

interface StageSpec {
  readonly name: string;
  readonly animal: string;
  readonly archetype: Archetype;
  readonly entry: string;
  /** Optional second type gained on evolving. Never replaces the first. */
  readonly types?: Types;
}

interface LineSpec {
  readonly key: string;
  readonly family: Family;
  readonly types: Types;
  readonly stages: readonly StageSpec[];
  /** Evolution levels between consecutive stages. */
  readonly at?: readonly number[];
  readonly legendary?: boolean;
}

const S = (name: string, animal: string, archetype: Archetype, entry: string, types?: Types): StageSpec =>
  types === undefined ? { name, animal, archetype, entry } : { name, animal, archetype, entry, types };

// ===========================================================================
// The three starter lines. Non-negotiable: ids, types and thresholds are fixed.
// ===========================================================================

const STARTERS: readonly LineSpec[] = [
  {
    key: 'winter', family: 'canid', types: ['Fang', 'Frost'], at: [16, 36],
    stages: [
      S('Winter', 'Siberian Husky (black and white)', 'skirmisher',
        'Does not bark. Screams. Has never once been wrong about how bad a situation is.'),
      S('Winterhowl', 'Siberian Husky (black and white)', 'skirmisher',
        'Holds a grudge across a whole winter. Will remind you of it in front of guests.'),
      S('Winterend', 'Siberian Husky (black and white)', 'skirmisher',
        'The cold arrives when it does. Still refuses to walk on wet grass. Still screams.'),
    ],
  },
  {
    key: 'baloo', family: 'canid', types: ['Fang', 'Ember'], at: [16, 36],
    stages: [
      S('Baloo', 'Siberian Husky (orange and white)', 'bruiser',
        'Has never had a second thought. Would follow you into a burning house, cheerfully.'),
      S('Balooka', 'Siberian Husky (orange and white)', 'bruiser',
        'Now large enough to knock a grown man down by being pleased to see him.'),
      S('Baloomane', 'Siberian Husky (orange and white)', 'bruiser',
        'Radiates heat like a banked fire and joy like a much stupider animal. Both are load-bearing.'),
    ],
  },
  {
    key: 'plato', family: 'felid', types: ['Claw', 'Hearth'], at: [16, 36],
    stages: [
      S('Plato', 'Grey and white tabby cat', 'allrounder',
        'Correct about everything. Will not fetch. Has never been asked twice.'),
      S('Platonic', 'Grey and white tabby cat', 'allrounder',
        'Has opinions about your friends and has begun expressing them by sitting on people.'),
      S('Platarch', 'Grey and white tabby cat', 'allrounder',
        'A small emperor, unimpressed by the empire. Sits above the throne, never on it.'),
    ],
  },
];

// ===========================================================================
// The rest of the roster
// ===========================================================================

const LINES: readonly LineSpec[] = [
  // --- Dogs -------------------------------------------------------------
  { key: 'corgi', family: 'canid', types: ['Fang', 'Hearth'], at: [18, 34], stages: [
    S('Stubbin', 'Pembroke Welsh Corgi', 'bulwark', 'Bred to bite cattle on the ankle and survive the kick. Both halves still apply.'),
    S('Cattlenip', 'Pembroke Welsh Corgi', 'bulwark', 'Herds anything that moves, including guests, including the guests it likes.'),
    S('Lowlord', 'Pembroke Welsh Corgi', 'bulwark', 'Nine inches tall and in charge of the room. Nobody has successfully argued.'),
  ] },
  { key: 'shepherd', family: 'canid', types: ['Fang', 'Crown'], at: [17, 36], stages: [
    S('Wardling', 'German Shepherd', 'allrounder', 'Learns your routine in a week and gets visibly annoyed when you break it.'),
    S('Wardhound', 'German Shepherd', 'allrounder', 'Places itself between you and the door. Every time. Without being asked.'),
    S('Wardmarshal', 'German Shepherd', 'allrounder', 'Takes the job more seriously than anyone it has ever worked for.'),
  ] },
  { key: 'collie', family: 'canid', types: ['Fang', 'Thorn'], at: [16, 33], stages: [
    S('Quickeye', 'Border Collie', 'skirmisher', 'Bored within nine seconds. Solves the problem, then invents a worse one.'),
    S('Sheepstare', 'Border Collie', 'skirmisher', 'Can move forty animals with a look. Uses it on people. It works on people.'),
    S('Longstare', 'Border Collie', 'skirmisher', 'Has understood the plan since before you had one. Waiting for you to catch up.'),
  ] },
  { key: 'mastiff', family: 'canid', types: ['Fang', 'Maw'], at: [20, 38], stages: [
    S('Lumpling', 'English Mastiff', 'bulwark', 'Enormous and apologetic about it. Sits on things and then looks guilty.'),
    S('Boarbane', 'English Mastiff', 'bulwark', 'Two hundred pounds of animal that would still rather be asleep on you.'),
    S('Gatelord', 'English Mastiff', 'bulwark', 'Fills a doorway. Nothing has ever come through the doorway. These facts are related.'),
  ] },
  { key: 'wolf', family: 'canid', types: ['Fang', 'Feral'], at: [19, 37], stages: [
    S('Yearling', 'Grey Wolf', 'skirmisher', 'Too young for the hunt and furious about being told so.'),
    S('Packblade', 'Grey Wolf', 'bruiser', 'Does not fight you. Fights you and four others, from three directions.'),
    S('Packcrown', 'Grey Wolf', 'bruiser', 'Leads by being the last one still walking. That is the entire selection process.'),
  ] },
  { key: 'arcticfox', family: 'canid', types: ['Fang', 'Frost'], at: [18, 35], stages: [
    S('Snowkit', 'Arctic Fox', 'skirmisher', 'Turns white in autumn and insufferable in winter. Hears mice under a foot of snow.'),
    S('Driftfox', 'Arctic Fox', 'skirmisher', 'Dives headfirst into snowbanks to catch what it heard. Correct nine times in ten.'),
    S('Blizzarn', 'Arctic Fox', 'channeler', 'Vanishes in weather that would kill you and comes back fed.'),
  ] },
  { key: 'fennec', family: 'canid', types: ['Fang', 'Ember'], at: [17, 34], stages: [
    S('Earkin', 'Fennec Fox', 'skirmisher', 'Ears bigger than its face. Hears you deciding to lie before you say it.'),
    S('Duneflit', 'Fennec Fox', 'channeler', 'Sleeps through the heat, works the dark, judges you for doing it the other way round.'),
    S('Sunlisten', 'Fennec Fox', 'channeler', 'Knows where the water is. Will not tell you. Enjoys this.'),
  ] },
  { key: 'redfox', family: 'canid', types: ['Fang', 'Gloom'], at: [18, 36], stages: [
    S('Cinderkit', 'Red Fox', 'skirmisher', 'Small, red, and already stealing. Has a stash you have not found.'),
    S('Hedgerow', 'Red Fox', 'skirmisher', 'Lives on the edge of everything. Owes nobody. Owns three of your gloves.'),
    S('Nightreynard', 'Red Fox', 'channeler', 'Has robbed every house on this road and been thanked by two of them.'),
  ] },
  { key: 'husky_sled', family: 'canid', types: ['Fang', 'Frost'], at: [24, 0], stages: [
    S('Traceling', 'Alaskan Malamute', 'bruiser', 'Built to pull. Will pull. Will pull whether or not it is attached to anything.'),
    S('Haulmane', 'Alaskan Malamute', 'bulwark', 'Moves a loaded sled through weather that stops horses. Then wants breakfast.'),
  ] },
  { key: 'terrier', family: 'canid', types: ['Fang', 'Thorn'], at: [21, 0], stages: [
    S('Ratter', 'Jack Russell Terrier', 'skirmisher', 'Six pounds of unreasonable. Has decided about the badger and cannot be talked round.'),
    S('Digfury', 'Jack Russell Terrier', 'skirmisher', 'Goes down the hole. Comes back up. Something else does not.'),
  ] },
  { key: 'retriever', family: 'canid', types: ['Fang', 'Tide'], at: [23, 0], stages: [
    S('Softmouth', 'Golden Retriever', 'warden', 'Carries an egg across a field without breaking it, then eats your dinner.'),
    S('Fetchlord', 'Golden Retriever', 'warden', 'Swims out into water it should not, comes back pleased, does it again.'),
  ] },

  // --- Cats -------------------------------------------------------------
  { key: 'mainecoon', family: 'felid', types: ['Claw', 'Frost'], at: [18, 36], stages: [
    S('Tufting', 'Maine Coon', 'bulwark', 'Already the size of a normal adult cat. Not finished. Not close to finished.'),
    S('Barnking', 'Maine Coon', 'bulwark', 'Twenty pounds of fur with an ice-proof coat and a small polite voice.'),
    S('Coonmarl', 'Maine Coon', 'bulwark', 'Walks on snow that swallows dogs. Sleeps in the warmest chair regardless.'),
  ] },
  { key: 'lynx', family: 'felid', types: ['Claw', 'Frost'], at: [19, 37], stages: [
    S('Tuftear', 'Eurasian Lynx', 'skirmisher', 'Ear tufts twice too long. They are not decoration and you will learn that.'),
    S('Snowstalk', 'Eurasian Lynx', 'skirmisher', 'Crosses a clearing without a sound in snow that crunches under a bird.'),
    S('Lynxroyal', 'Eurasian Lynx', 'skirmisher', 'Watched you set up camp. Watched you go to sleep. Was never going to do anything.'),
  ] },
  { key: 'siamese', family: 'felid', types: ['Claw', 'Hearth'], at: [17, 35], stages: [
    S('Yowler', 'Siamese cat', 'channeler', 'Talks constantly. Loudly. About nothing. At four in the morning.'),
    S('Templemouth', 'Siamese cat', 'channeler', 'Has opinions on the guest list and expresses them at volume during dinner.'),
    S('Courtvoice', 'Siamese cat', 'channeler', 'Has talked three houses into an alliance and one out of a marriage.'),
  ] },
  { key: 'blackcat', family: 'felid', types: ['Claw', 'Gloom'], at: [18, 34], stages: [
    S('Sootpaw', 'Black domestic shorthair', 'skirmisher', 'Invisible after dusk and knows it. Has been under your chair for an hour.'),
    S('Illomen', 'Black domestic shorthair', 'channeler', 'Crosses your path deliberately, then checks whether you noticed.'),
    S('Nightaugur', 'Black domestic shorthair', 'channeler', 'Sits where somebody is about to die. Has been right enough times to be a problem.'),
  ] },
  { key: 'snowleopard', family: 'felid', types: ['Claw', 'Frost'], at: [20, 38], stages: [
    S('Cragkit', 'Snow Leopard', 'skirmisher', 'Falls off things constantly and lands correctly every single time.'),
    S('Ghostpelt', 'Snow Leopard', 'skirmisher', 'Wraps its own tail round itself like a scarf and vanishes into grey rock.'),
    S('Peakwraith', 'Snow Leopard', 'skirmisher', 'Jumps fifty feet across a gorge. Has never once needed to explain itself.'),
  ] },
  { key: 'caracal', family: 'felid', types: ['Claw', 'Ember'], at: [19, 36], stages: [
    S('Reedear', 'Caracal', 'skirmisher', 'Takes birds out of the air on the way up. Considers this unremarkable.'),
    S('Dunespring', 'Caracal', 'skirmisher', 'Jumps ten feet standing. Does it to reach a shelf it was told not to.'),
    S('Sunleaper', 'Caracal', 'skirmisher', 'Clears a wall you would need a ladder for and lands in complete silence.'),
  ] },
  { key: 'lion', family: 'felid', types: ['Claw', 'Crown'], at: [21, 39], stages: [
    S('Manecub', 'Lion', 'bruiser', 'Practising the roar. It is not going well. It is very pleased with itself.'),
    S('Pridebrand', 'Lion', 'bruiser', 'Does very little, extremely visibly. The others do the work and it takes the credit.'),
    S('Sunmarshal', 'Lion', 'bruiser', 'The whole pride eats after it does. Nobody has ever formally agreed to this.'),
  ] },
  { key: 'tiger', family: 'felid', types: ['Claw', 'Thorn'], at: [20, 38], stages: [
    S('Reedstripe', 'Bengal Tiger', 'bruiser', 'Already striped, already hiding, already better at it than you are at looking.'),
    S('Grassghost', 'Bengal Tiger', 'bruiser', 'Six hundred pounds standing eight feet away in grass you can see through.'),
    S('Junglecrown', 'Bengal Tiger', 'bruiser', 'Swims, climbs, and kills things twice its size. Has no natural predator and knows.'),
  ] },

  // --- Bears ------------------------------------------------------------
  { key: 'kodiak', family: 'ursid', types: ['Maw', 'Tide'], at: [20, 38], stages: [
    S('Cubbern', 'Kodiak Bear', 'bruiser', 'Already stronger than you. Currently using it to turn over rocks.'),
    S('Salmonjaw', 'Kodiak Bear', 'bruiser', 'Stands in a river and takes fish out of the air. Bored of doing it. Still doing it.'),
    S('Kodiaroth', 'Kodiak Bear', 'bruiser', 'Ten feet standing. The river belongs to it. So does the bank. So does the wood.'),
  ] },
  { key: 'polarbear', family: 'ursid', types: ['Maw', 'Frost'], at: [21, 39], stages: [
    S('Floeling', 'Polar Bear', 'bulwark', 'Swims before it can properly walk. Has no concept of cold as a problem.'),
    S('Icejaw', 'Polar Bear', 'bulwark', 'Smells a seal through three feet of ice, then goes through the three feet of ice.'),
    S('Hoarmaw', 'Polar Bear', 'bulwark', 'Walks a hundred miles across floes for one meal and considers it a fair trade.'),
  ] },
  { key: 'blackbear', family: 'ursid', types: ['Maw', 'Thorn'], at: [19, 36], stages: [
    S('Berrypaw', 'American Black Bear', 'warden', 'Eats two hundred berries an hour and remains extremely dangerous throughout.'),
    S('Thornhide', 'American Black Bear', 'warden', 'Walks through a bramble thicket like a curtain. Comes out the other side unbothered.'),
    S('Bramblemaw', 'American Black Bear', 'warden', 'Has been in the bins. Has been in the bins of a fortified house.'),
  ] },
  { key: 'sunbear', family: 'ursid', types: ['Maw', 'Ember'], at: [24, 0], stages: [
    S('Honeytongue', 'Sun Bear', 'bruiser', 'Tongue longer than its own forearm. Uses it exactly how you are imagining.'),
    S('Goldchest', 'Sun Bear', 'bruiser', 'Smallest bear alive and still the thing everything else in the tree leaves for.'),
  ] },
  { key: 'wolverine', family: 'mustelid', types: ['Maw', 'Feral'], at: [20, 37], stages: [
    S('Glutkit', 'Wolverine', 'bruiser', 'Thirty pounds. Has already tried to take food off something eight times its size.'),
    S('Skulleater', 'Wolverine', 'bruiser', 'Cracks frozen bone. Drives bears off kills. Weighs less than a large dog.'),
    S('Gluttonjaw', 'Wolverine', 'bruiser', 'Fears nothing, wins often, and has never once assessed a situation first.'),
  ] },

  // --- Mustelids and otters ---------------------------------------------
  { key: 'seaotter', family: 'mustelid', types: ['Claw', 'Tide'], at: [18, 35], stages: [
    S('Kelppup', 'Sea Otter', 'warden', 'Sleeps holding a paw so it does not drift off. This is not a metaphor. It just does that.'),
    S('Stoneknock', 'Sea Otter', 'warden', 'Keeps a favourite rock in a pocket of loose skin. Loses its mind if you move it.'),
    S('Kelpwarden', 'Sea Otter', 'warden', 'Holds the whole kelp forest together by eating urchins all day. Nobody thanks it.'),
  ] },
  { key: 'riverotter', family: 'mustelid', types: ['Claw', 'Tide'], at: [22, 0], stages: [
    S('Slipling', 'River Otter', 'skirmisher', 'Built a mudslide. Uses the mudslide. Has no other plans this week.'),
    S('Bankslide', 'River Otter', 'skirmisher', 'Fast enough underwater to make fish look like they are standing still.'),
  ] },
  { key: 'badger', family: 'mustelid', types: ['Maw', 'Thorn'], at: [19, 36], stages: [
    S('Settling', 'European Badger', 'bulwark', 'Born underground in a tunnel system older than the house above it.'),
    S('Diggard', 'European Badger', 'bulwark', 'Loose skin, thick skull, no reverse gear. Digs toward the problem.'),
    S('Settlelord', 'European Badger', 'bulwark', 'The sett has eighty entrances and four hundred years of previous tenants.'),
  ] },
  { key: 'honeybadger', family: 'mustelid', types: ['Maw', 'Feral'], at: [23, 0], stages: [
    S('Ratelkit', 'Honey Badger', 'bruiser', 'Has already picked a fight it cannot win and is winning it anyway.'),
    S('Ratelmaw', 'Honey Badger', 'bruiser', 'Skin loose enough to turn inside its own hide and bite whatever grabbed it.'),
  ] },
  { key: 'stoat', family: 'mustelid', types: ['Fang', 'Frost'], at: [21, 0], stages: [
    S('Ermkit', 'Stoat', 'skirmisher', 'Turns white for winter. Kills things five times its weight in either colour.'),
    S('Ermine', 'Stoat', 'skirmisher', 'Its winter coat trims a king robe. It remains entirely unmanageable.'),
  ] },

  // --- Birds ------------------------------------------------------------
  { key: 'harpy', family: 'bird', types: ['Wing', 'Crown'], at: [20, 38], stages: [
    S('Talonet', 'Harpy Eagle', 'skirmisher', 'Feet already the size of a mans hand. Still learning what they are for.'),
    S('Canopyclaw', 'Harpy Eagle', 'bruiser', 'Takes monkeys out of the canopy. Talons longer than a bear claw.'),
    S('Harpyrex', 'Harpy Eagle', 'bruiser', 'Lands on a branch and the whole forest goes quiet. Grip crushes bone.'),
  ] },
  { key: 'raven', family: 'bird', types: ['Wing', 'Gloom'], at: [18, 35], stages: [
    S('Cawling', 'Common Raven', 'channeler', 'Already knows three of your words and has picked the two rudest.'),
    S('Gallowsbird', 'Common Raven', 'channeler', 'Remembers a face for five years. Tells other ravens about your face.'),
    S('Corvaugur', 'Common Raven', 'channeler', 'Uses tools, holds funerals, and follows the wolves because it knows what follows.'),
  ] },
  { key: 'owl', family: 'bird', types: ['Wing', 'Gloom'], at: [19, 36], stages: [
    S('Downeye', 'Snowy Owl', 'channeler', 'All eyes and disapproval. Head rotates further than is really necessary.'),
    S('Silentwing', 'Snowy Owl', 'channeler', 'Feather edges break the air so it makes no sound at all. Nothing hears it coming.'),
    S('Palejudge', 'Snowy Owl', 'channeler', 'Hunts in full daylight, which owls do not do, because nothing can stop it.'),
  ] },
  { key: 'falcon', family: 'bird', types: ['Wing', 'Feral'], at: [19, 37], stages: [
    S('Stooplet', 'Peregrine Falcon', 'skirmisher', 'Falls out of the sky on purpose and has not yet worked out how to stop.'),
    S('Divewhistle', 'Peregrine Falcon', 'skirmisher', 'Two hundred miles an hour downward. The fastest thing with a pulse.'),
    S('Skylance', 'Peregrine Falcon', 'skirmisher', 'Hits a pigeon so hard mid-air that the pigeon simply stops existing.'),
  ] },
  { key: 'seaeagle', family: 'bird', types: ['Wing', 'Tide'], at: [21, 0], stages: [
    S('Brinewing', 'White-tailed Sea Eagle', 'bruiser', 'Eight-foot span. Takes fish off the water without landing.'),
    S('Stormpinion', 'White-tailed Sea Eagle', 'bruiser', 'Rides a gale that grounds every other bird on the coast. Barely notices.'),
  ] },
  { key: 'goose', family: 'bird', types: ['Wing', 'Feral'], at: [23, 0], stages: [
    S('Gosling', 'Canada Goose', 'warden', 'Small, yellow, and already the most aggressive thing on the water.'),
    S('Hissewing', 'Canada Goose', 'warden', 'Has driven off a dog, a horse, and a man with a rake. In one afternoon.'),
  ] },
  { key: 'magpie', family: 'bird', types: ['Wing', 'Hearth'], at: [22, 0], stages: [
    S('Pieling', 'Eurasian Magpie', 'channeler', 'Recognises itself in a mirror, which is more than most of this roster.'),
    S('Silverthief', 'Eurasian Magpie', 'channeler', 'Your ring is in a nest forty feet up and it is not coming back down.'),
  ] },

  // --- Rodents ----------------------------------------------------------
  { key: 'porcupine', family: 'rodent', types: ['Thorn', 'Feral'], at: [19, 36], stages: [
    S('Quillet', 'North American Porcupine', 'bulwark', 'Thirty thousand quills and absolutely no urgency about anything.'),
    S('Barbcoat', 'North American Porcupine', 'bulwark', 'Backs into problems. The quills are barbed and they do not come out.'),
    S('Thornbristle', 'North American Porcupine', 'bulwark', 'Has been left alone by every predator in the wood, each exactly once.'),
  ] },
  { key: 'beaver', family: 'rodent', types: ['Maw', 'Tide'], at: [20, 37], stages: [
    S('Gnawkit', 'North American Beaver', 'bulwark', 'Teeth grow forever. Chewing is maintenance, not a hobby. It is also a hobby.'),
    S('Damwright', 'North American Beaver', 'bulwark', 'Has rerouted a river because the sound of running water annoyed it.'),
    S('Floodwright', 'North American Beaver', 'bulwark', 'Built a dam visible from a hill. Has flooded two fields and one argument.'),
  ] },
  { key: 'hedgehog', family: 'rodent', types: ['Thorn', 'Hearth'], at: [22, 0], stages: [
    S('Pricklet', 'European Hedgehog', 'warden', 'Rolls into a ball at any provocation, including compliments.'),
    S('Spineball', 'European Hedgehog', 'warden', 'Eats slugs all night, snores audibly, and is beloved for both.'),
  ] },
  { key: 'capybara', family: 'rodent', types: ['Tide', 'Hearth'], at: [23, 0], stages: [
    S('Sitling', 'Capybara', 'warden', 'Has never been stressed. Birds sit on it. It has no notes.'),
    S('Calmcapy', 'Capybara', 'warden', 'The only thing in the fen that everything else agrees not to fight.'),
  ] },
  { key: 'squirrel', family: 'rodent', types: ['Claw', 'Thorn'], at: [21, 0], stages: [
    S('Nutkin', 'Red Squirrel', 'skirmisher', 'Buried four hundred acorns. Remembers eleven. Plants a forest by being bad at this.'),
    S('Boughrunner', 'Red Squirrel', 'skirmisher', 'Crosses a wood without touching ground and screams at you the whole way.'),
  ] },
  { key: 'rat', family: 'rodent', types: ['Fang', 'Gloom'], at: [20, 0], stages: [
    S('Gutterkin', 'Brown Rat', 'skirmisher', 'Lives under the granary. Knows the house better than the family does.'),
    S('Cellarlord', 'Brown Rat', 'skirmisher', 'Fits through a hole the width of its skull, which is most holes.'),
  ] },

  // --- Ungulates --------------------------------------------------------
  { key: 'stag', family: 'ungulate', types: ['Crown', 'Thorn'], at: [20, 38], stages: [
    S('Spikehorn', 'Red Deer', 'allrounder', 'First antlers, straight and useless. Extremely proud of them.'),
    S('Rutbrow', 'Red Deer', 'bruiser', 'Roars for three weeks straight in autumn and loses a fifth of its body weight.'),
    S('Crownantler', 'Red Deer', 'bruiser', 'Sixteen points. Has never lost the clash. Everything about it is a threat display.'),
  ] },
  { key: 'moose', family: 'ungulate', types: ['Crown', 'Tide'], at: [21, 39], stages: [
    S('Legling', 'Moose', 'bulwark', 'All legs, no coordination, already taller than a man at the shoulder.'),
    S('Bogwader', 'Moose', 'bulwark', 'Eats underwater. Comes up with weed on its head. Is not embarrassed.'),
    S('Palmcrown', 'Moose', 'bulwark', 'Antlers six feet across. Kills more people annually than the bears do.'),
  ] },
  { key: 'boar', family: 'ungulate', types: ['Maw', 'Thorn'], at: [19, 36], stages: [
    S('Stripeling', 'Wild Boar', 'bruiser', 'Striped like sun through bracken. Already impossible to catch.'),
    S('Tuskrooter', 'Wild Boar', 'bruiser', 'Turns over an acre of ground a night looking for something it will not name.'),
    S('Tuskfury', 'Wild Boar', 'bruiser', 'Three hundred pounds at a dead run in a straight line through anything.'),
  ] },
  { key: 'ibex', family: 'ungulate', types: ['Crown', 'Frost'], at: [24, 0], stages: [
    S('Ledgeling', 'Alpine Ibex', 'skirmisher', 'Stands on a ledge four inches wide because it wanted the salt.'),
    S('Cliffhorn', 'Alpine Ibex', 'skirmisher', 'Walks up a dam wall. Vertically. Has been photographed doing it and nobody believes it.'),
  ] },
  { key: 'muskox', family: 'ungulate', types: ['Crown', 'Frost'], at: [23, 0], stages: [
    S('Woolkin', 'Muskox', 'bulwark', 'Undercoat warmer than anything humans have managed to weave.'),
    S('Stormring', 'Muskox', 'bulwark', 'The herd forms a ring facing outward. It has worked for ten thousand years.'),
  ] },

  // --- Reptiles ---------------------------------------------------------
  { key: 'komodo', family: 'reptile', types: ['Maw', 'Gloom'], at: [20, 38], stages: [
    S('Hatchbite', 'Komodo Dragon', 'skirmisher', 'Lives in a tree until it is big enough that nothing wants to eat it. Two years.'),
    S('Venomtongue', 'Komodo Dragon', 'bruiser', 'Bites once, then follows for three days. There is no second bite.'),
    S('Dragonmaw', 'Komodo Dragon', 'bruiser', 'Ten feet of patience. Has eaten things that thought they were the predator.'),
  ] },
  { key: 'tortoise', family: 'reptile', types: ['Thorn', 'Crown'], at: [24, 0], stages: [
    S('Shellet', 'Galapagos Tortoise', 'bulwark', 'Will outlive you, your children, and the house. Currently eating a flower.'),
    S('Ageshell', 'Galapagos Tortoise', 'bulwark', 'Was alive before the current war and will be alive after the next one.'),
  ] },
  { key: 'adder', family: 'reptile', types: ['Thorn', 'Gloom'], at: [21, 0], stages: [
    S('Zigling', 'European Adder', 'channeler', 'Zigzag down its back like a warning label. It is a warning label.'),
    S('Fangzag', 'European Adder', 'channeler', 'The only venomous thing on this island and quietly proud of the distinction.'),
  ] },

  // --- Standalones ------------------------------------------------------
  { key: 'housecat', family: 'felid', types: ['Claw', 'Hearth'], stages: [
    S('Barncat', 'Domestic shorthair', 'allrounder', 'Not yours. Lives here. Accepts food. Owes you nothing and has said so.'),
  ] },
  { key: 'pug', family: 'canid', types: ['Fang', 'Hearth'], stages: [
    S('Snorter', 'Pug', 'warden', 'Breathes like a broken bellows. Utterly convinced it is a wolf.'),
  ] },
  { key: 'greyhound', family: 'canid', types: ['Fang', 'Feral'], stages: [
    S('Coursing', 'Greyhound', 'skirmisher', 'Forty miles an hour for thirty seconds, then asleep for eleven hours.'),
  ] },
  { key: 'raccoon', family: 'mustelid', types: ['Claw', 'Gloom'], stages: [
    S('Maskhand', 'Raccoon', 'skirmisher', 'Has hands. Understands latches. This combination has cost you a lot of food.'),
  ] },
  { key: 'skunk', family: 'mustelid', types: ['Gloom', 'Feral'], stages: [
    S('Sprayback', 'Striped Skunk', 'warden', 'Stamps twice as a courtesy. Nobody has ever waited for the third.'),
  ] },
  { key: 'platypus', family: 'reptile', types: ['Tide', 'Thorn'], stages: [
    S('Billpaddle', 'Platypus', 'channeler', 'Lays eggs, has a bill, and carries venom. Assembled from spare parts and thriving.'),
  ] },
  { key: 'pangolin', family: 'reptile', types: ['Thorn', 'Gloom'], stages: [
    S('Scalecurl', 'Pangolin', 'bulwark', 'Rolls into a ball a lion cannot open. A lion has tried. The lion left.'),
  ] },
  { key: 'wombat', family: 'rodent', types: ['Maw', 'Crown'], stages: [
    S('Blockrump', 'Wombat', 'bulwark', 'Backside made of cartilage plate. Crushes things against the tunnel roof with it.'),
  ] },
  { key: 'meerkat', family: 'mustelid', types: ['Claw', 'Ember'], stages: [
    S('Sentrykit', 'Meerkat', 'skirmisher', 'Somebody is always on watch. Right now it is this one and it is taking it seriously.'),
  ] },
];

const LEGENDARIES: readonly LineSpec[] = [
  { key: 'legend_wolf', family: 'canid', types: ['Fang', 'Crown'], legendary: true, stages: [
    S('Fenrisarn', 'Dire Wolf', 'bruiser', 'The wolf the first houses swore their oaths to. Every treaty since has been a footnote.'),
  ] },
  { key: 'legend_bear', family: 'ursid', types: ['Maw', 'Frost'], legendary: true, stages: [
    S('Hoargrendel', 'Cave Bear', 'bulwark', 'Woke once, took a season, and went back to sleep. The Sable line dates itself from that.'),
  ] },
  { key: 'legend_bird', family: 'bird', types: ['Wing', 'Gloom'], legendary: true, stages: [
    S('Mournwing', 'Haast Eagle', 'skirmisher', 'Hunted people, once, and has not forgotten how. Casts a shadow the size of a cart.'),
  ] },
];

// ===========================================================================
// Expansion
// ===========================================================================

const STAGE_ORDER: readonly Stage[] = ['pup', 'adult', 'apex'];

function stagesFor(count: number, legendary: boolean): readonly Stage[] {
  if (legendary) return ['apex'];
  if (count === 3) return STAGE_ORDER;
  if (count === 2) return ['pup', 'adult'];
  return ['adult'];
}

function expand(lines: readonly LineSpec[], startDex: number): RosterEntry[] {
  const out: RosterEntry[] = [];
  let dex = startDex;
  for (const line of lines) {
    const legendary = line.legendary ?? false;
    const stageNames = stagesFor(line.stages.length, legendary);
    for (let i = 0; i < line.stages.length; i++) {
      const s = line.stages[i]!;
      const id = line.stages.length === 1 ? line.key : `${line.key}_${stageNames[i]}`;
      const nextId = i + 1 < line.stages.length ? `${line.key}_${stageNames[i + 1]}` : undefined;
      const prevId = i > 0 ? `${line.key}_${stageNames[i - 1]}` : undefined;
      const level = nextId !== undefined ? line.at?.[i] : undefined;

      out.push({
        id,
        dex: dex++,
        name: s.name,
        animal: s.animal,
        family: line.family,
        types: s.types ?? line.types,
        stage: stageNames[i] ?? 'adult',
        archetype: s.archetype,
        ...(nextId === undefined ? {} : { evolvesTo: nextId }),
        ...(prevId === undefined ? {} : { evolvesFrom: prevId }),
        ...(level === undefined || level === 0 ? {} : { evolveLevel: level }),
        ...(legendary ? { legendary: true } : {}),
        dexEntry: s.entry,
      });
    }
  }
  return out;
}

// Starters occupy dex 1-9 so they are the first thing in the book, like Gen 1.
const starterEntries = expand(STARTERS, 1);
const restEntries = expand(LINES, starterEntries.length + 1);
const legendaryEntries = expand(LEGENDARIES, starterEntries.length + restEntries.length + 1);

export const ROSTER: readonly RosterEntry[] = [
  ...starterEntries,
  ...restEntries,
  ...legendaryEntries,
];
