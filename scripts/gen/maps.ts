/**
 * World generator: maps, warps, NPCs, trainers, gyms and the endgame.
 *
 * Emits src/data/maps.gen.ts and src/data/trainers.gen.ts.
 *
 * Encounter tables select species by FILTER (stage, type, non-legendary) rather
 * than by hardcoded id, so the roster can be re-tuned or re-ordered without
 * breaking every route in the game.
 *
 * The world is a chain: house -> town -> route -> gym town -> route -> ... with
 * eight gyms and a four-stage endgame. Linear is deliberate. Gen 1's world is a
 * chain with loops hung off it, and a chain is provably completable, which is
 * what gauntlet:playthrough needs.
 *
 * Run: npm run gen:maps
 */
import { writeFileSync } from 'node:fs';
import { ROSTER, type RosterEntry } from './roster.ts';
import { Tile } from '../../src/core/world.ts';
import { effectivenessAgainst, type FeralType } from '../../src/core/types.ts';

// ===========================================================================
// The spine of the game
// ===========================================================================

interface GymSpec {
  readonly n: number;
  readonly town: string;
  readonly townName: string;
  readonly house: string;
  readonly leader: string;
  readonly type: FeralType;
  readonly badge: string;
  readonly level: number;
}

/** Eight gyms, eight houses, eight types, a monotonic level curve. */
const GYMS: readonly GymSpec[] = [
  { n: 1, town: 'harrowfen', townName: 'Harrowfen', house: 'Vantry', leader: 'Dara Vantry', type: 'Fang', badge: 'fang', level: 12 },
  { n: 2, town: 'saltmere', townName: 'Saltmere', house: 'Calloway', leader: 'Ines Calloway', type: 'Tide', badge: 'tide', level: 18 },
  { n: 3, town: 'ashgrove', townName: 'Ashgrove', house: 'Ashgrove', leader: 'Leonore Ashgrove', type: 'Ember', badge: 'ember', level: 24 },
  { n: 4, town: 'briarhold', townName: 'Briarhold', house: 'Thistle', leader: 'Ottiline Thistle', type: 'Thorn', badge: 'thorn', level: 29 },
  { n: 5, town: 'kestrelbridge', townName: 'Kestrelbridge', house: 'Wren', leader: 'Corwin Wren', type: 'Wing', badge: 'wing', level: 34 },
  { n: 6, town: 'blackmourne', townName: 'Blackmourne', house: 'Mourne', leader: 'Sera Mourne', type: 'Gloom', badge: 'gloom', level: 39 },
  { n: 7, town: 'whitlow', townName: 'Whitlow', house: 'Sable', leader: 'Halvard Sable', type: 'Frost', badge: 'frost', level: 44 },
  { n: 8, town: 'brackhall', townName: 'Brackhall', house: 'Brack', leader: 'Ruen Brack', type: 'Maw', badge: 'maw', level: 49 },
];

const ELITE: readonly { readonly n: number; readonly name: string; readonly type: FeralType; readonly level: number }[] = [
  { n: 1, name: 'Ysolde Vane', type: 'Claw', level: 52 },
  { n: 2, name: 'Marek Auldwin', type: 'Feral', level: 54 },
  { n: 3, name: 'Perrin Vosk', type: 'Hearth', level: 56 },
  { n: 4, name: 'Alarice Dunn', type: 'Crown', level: 58 },
];

// ===========================================================================
// Species selection by filter
// ===========================================================================

const usable = ROSTER.filter(
  (r) => r.legendary !== true && !r.id.startsWith('winter_') && !r.id.startsWith('baloo_') && !r.id.startsWith('plato_'),
);

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable pick of n species matching a predicate, seeded by a key. */
function pick(n: number, key: string, pred: (r: RosterEntry) => boolean): RosterEntry[] {
  const pool = usable.filter(pred);
  const fallback = pool.length > 0 ? pool : usable;
  const sorted = [...fallback].sort(
    (a, b) => (hash(`${key}:${a.id}`) % 100000) - (hash(`${key}:${b.id}`) % 100000),
  );
  const out: RosterEntry[] = [];
  for (let i = 0; i < n; i++) {
    const e = sorted[i % sorted.length];
    if (e) out.push(e);
  }
  return out;
}

const isType = (t: FeralType) => (r: RosterEntry): boolean => r.types.includes(t);
const isStage = (s: RosterEntry['stage']) => (r: RosterEntry): boolean => r.stage === s;

/**
 * The earliest level at which a species can legally exist.
 *
 * A base-stage creature is available immediately; anything further along a line
 * cannot appear before the evolution that produces it, and never before its own
 * parent could exist. Walk the whole chain, because a three-stage line's apex is
 * gated by BOTH thresholds.
 *
 * This exists because gauntlet:curve caught trainers fielding evolved forms at
 * levels no player could match: gym 1 was running `shepherd_adult` (evolves at
 * 17) at level 10, roughly double the stat tier a legal level-12 team can build.
 * It made gyms 1, 2 and 7 and the Champion effectively unwinnable.
 */
const BY_ID = new Map(ROSTER.map((r) => [r.id, r]));
const minLevelCache = new Map<string, number>();

function minLevelFor(entry: RosterEntry): number {
  const cached = minLevelCache.get(entry.id);
  if (cached !== undefined) return cached;
  let level = 1;
  if (entry.evolvesFrom !== undefined) {
    const parent = BY_ID.get(entry.evolvesFrom);
    if (parent) {
      // The parent's own gate, plus the threshold into this stage.
      level = Math.max(minLevelFor(parent), parent.evolveLevel ?? 1);
    }
  }
  minLevelCache.set(entry.id, level);
  return level;
}

/** Trainers may only field what a player at that level could also have. */
const legalAt = (level: number) => (r: RosterEntry): boolean => minLevelFor(r) <= level;

/**
 * Cap the evolution TIER a trainer may field, separately from legality.
 *
 * Legality alone is not enough. A level-44 leader can legally field apex forms,
 * but a real player arriving at gym 7 is carrying a mix - a couple of fully
 * evolved creatures and several mid-tier ones caught along the way. gauntlet:curve
 * measured the gap: gyms 1 and 7 and the Champion sat at 0-15% win rate because
 * every enemy was top-tier while the player's team was not. Gen 1 does this too:
 * Brock has two basic Pokemon, not two fully evolved ones.
 */
function stageCapAt(level: number): (r: RosterEntry) => boolean {
  if (level < 22) return (r) => r.stage === 'pup';
  if (level < 40) return (r) => r.stage !== 'apex';
  return () => true;
}

/** Combine filters. */
const all =
  (...preds: ((r: RosterEntry) => boolean)[]) =>
  (r: RosterEntry): boolean =>
    preds.every((p) => p(r));

// ===========================================================================
// Tile painting
// ===========================================================================

interface Built {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: number[];
  warps: object[];
  npcs: object[];
  encounters: object | null;
  indoor: boolean;
  music: string;
}

function blank(w: number, h: number, fill: number): number[] {
  return new Array<number>(w * h).fill(fill);
}

function set(m: Built, x: number, y: number, t: number): void {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
  m.tiles[y * m.width + x] = t;
}

function rect(m: Built, x: number, y: number, w: number, h: number, t: number): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(m, i, j, t);
}

function border(m: Built, t: number): void {
  for (let x = 0; x < m.width; x++) {
    set(m, x, 0, t);
    set(m, x, m.height - 1, t);
  }
  for (let y = 0; y < m.height; y++) {
    set(m, 0, y, t);
    set(m, m.width - 1, y, t);
  }
}

// ===========================================================================
// Map builders
// ===========================================================================

const maps: Built[] = [];
const trainers: object[] = [];

function addMap(m: Built): Built {
  maps.push(m);
  return m;
}

/** A town: grass, a path cross, buildings with doors, a lodge and a shop. */
function buildTown(
  id: string, name: string, opts: {
    gym?: GymSpec;
    lodge?: boolean;
    shop?: boolean;
    northTo?: string;
    southTo?: string;
    music?: string;
  },
): Built {
  const W = 20;
  const H = 18;
  const m = addMap({
    id, name, width: W, height: H, tiles: blank(W, H, Tile.Grass),
    warps: [], npcs: [], encounters: null, indoor: false, music: opts.music ?? 'town',
  });
  border(m, Tile.Tree);

  // A path cross so every door is reachable from every exit.
  rect(m, 9, 1, 2, H - 2, Tile.Path);
  rect(m, 1, 8, W - 2, 2, Tile.Path);

  // Exits punched through the tree border.
  if (opts.northTo !== undefined) {
    set(m, 9, 0, Tile.Path);
    set(m, 10, 0, Tile.Path);
    m.warps.push({ x: 9, y: 0, toMap: opts.northTo, toX: 9, toY: 22 });
    m.warps.push({ x: 10, y: 0, toMap: opts.northTo, toX: 10, toY: 22 });
  }
  if (opts.southTo !== undefined) {
    set(m, 9, H - 1, Tile.Path);
    set(m, 10, H - 1, Tile.Path);
    m.warps.push({ x: 9, y: H - 1, toMap: opts.southTo, toX: 9, toY: 1 });
    m.warps.push({ x: 10, y: H - 1, toMap: opts.southTo, toX: 10, toY: 1 });
  }

  // Lodge (healer) on the left of the cross.
  if (opts.lodge === true) {
    rect(m, 3, 4, 5, 4, Tile.House);
    set(m, 5, 7, Tile.Door);
    set(m, 5, 8, Tile.Path);
    rect(m, 5, 8, 1, 1, Tile.Path);
    const lodgeId = `${id}_lodge`;
    m.warps.push({ x: 5, y: 7, toMap: lodgeId, toX: 4, toY: 7 });
    buildIndoor(lodgeId, `${name} Lodge`, id, 5, 8, [
      { id: `${id}_healer`, kind: 'healer', x: 4, y: 3, facing: 'down', sprite: 'keeper', name: 'Lodgekeeper', sight: 0, dialogue: 'lodge_heal' },
    ]);
  }

  // Shop on the right.
  if (opts.shop === true) {
    rect(m, 12, 4, 5, 4, Tile.House);
    set(m, 14, 7, Tile.Door);
    set(m, 14, 8, Tile.Path);
    const shopId = `${id}_shop`;
    m.warps.push({ x: 14, y: 7, toMap: shopId, toX: 4, toY: 7 });
    buildIndoor(shopId, `${name} Supplies`, id, 14, 8, [
      { id: `${id}_clerk`, kind: 'shop', x: 4, y: 3, facing: 'down', sprite: 'clerk', name: 'Clerk', sight: 0, dialogue: 'shop_greet' },
    ]);
  }

  // The gym, south of the cross.
  if (opts.gym) {
    const g = opts.gym;
    rect(m, 7, 12, 6, 4, Tile.House);
    set(m, 9, 15, Tile.Door);
    set(m, 9, 16, Tile.Path);
    rect(m, 9, 10, 1, 7, Tile.Path);
    const gymId = `${id}_gym`;
    m.warps.push({ x: 9, y: 15, toMap: gymId, toX: 5, toY: 11 });
    buildGym(gymId, g, id, 9, 16);
  }

  // Two gossiping townsfolk, because a town with nobody in it is a diorama.
  m.npcs.push({
    id: `${id}_gossip_a`, kind: 'talker', x: 5, y: 11, facing: 'down',
    sprite: 'villager', name: 'Villager', sight: 0,
    dialogue: `npc_gossip_${(hash(id) % 12) + 1}`,
  });
  m.npcs.push({
    id: `${id}_gossip_b`, kind: 'talker', x: 14, y: 12, facing: 'left',
    sprite: 'villager', name: 'Villager', sight: 0,
    dialogue: `npc_gossip_${(hash(`${id}b`) % 12) + 1}`,
  });
  return m;
}

function buildIndoor(
  id: string, name: string, backTo: string, backX: number, backY: number,
  npcs: object[],
): Built {
  const W = 10;
  const H = 9;
  const m = addMap({
    id, name, width: W, height: H, tiles: blank(W, H, Tile.Floor),
    warps: [], npcs: [...npcs], encounters: null, indoor: true, music: 'indoor',
  });
  border(m, Tile.Wall);
  rect(m, 2, 2, 6, 1, Tile.Counter);
  rect(m, 3, 6, 4, 1, Tile.Carpet);
  set(m, 4, H - 1, Tile.Door);
  set(m, 5, H - 1, Tile.Door);
  m.warps.push({ x: 4, y: H - 1, toMap: backTo, toX: backX, toY: backY });
  m.warps.push({ x: 5, y: H - 1, toMap: backTo, toX: backX, toY: backY });
  return m;
}

/** A gym: two flunkies with line of sight, then the leader at the back. */
function buildGym(id: string, g: GymSpec, backTo: string, backX: number, backY: number): Built {
  const W = 11;
  const H = 13;
  const m = addMap({
    id, name: `House ${g.house}`, width: W, height: H, tiles: blank(W, H, Tile.Floor),
    warps: [], npcs: [], encounters: null, indoor: true, music: 'gym',
  });
  border(m, Tile.Wall);
  rect(m, 3, 2, 5, 1, Tile.Carpet);
  set(m, 5, H - 1, Tile.Door);
  m.warps.push({ x: 5, y: H - 1, toMap: backTo, toX: backX, toY: backY });

  // Two guards, facing down the room so the player has to fight through them.
  for (const [i, gx] of [3, 7].entries()) {
    const tid = `gym${g.n}_guard${i + 1}`;
    trainers.push({
      id: tid,
      name: i === 0 ? 'Sworn Blade' : 'House Second',
      title: `of House ${g.house}`,
      team: pick(2, `${tid}`, all(isType(g.type), legalAt(Math.max(2, g.level - 4)), stageCapAt(Math.max(2, g.level - 4)))).map((r, k) => ({
        species: r.id, level: Math.max(2, g.level - 4 + k),
      })),
      aiLevel: 2,
      prize: 400 + g.n * 120,
      introKey: `npc_gossip_${((g.n + i) % 12) + 1}`,
      defeatKey: `npc_gossip_${((g.n + i + 5) % 12) + 1}`,
    });
    m.npcs.push({
      id: `${id}_guard${i + 1}`, kind: 'trainer', x: gx, y: 8, facing: 'down',
      sprite: 'guard', name: 'Sworn Blade', sight: 4,
      dialogue: `npc_gossip_${((g.n + i) % 12) + 1}`,
      team: tid, flag: `beat_${tid}`,
    });
  }

  // The leader. Full team of their type, top-level AI, and the badge.
  const leaderId = `gym${g.n}`;
  trainers.push({
    id: leaderId,
    name: g.leader,
    title: `Head of House ${g.house}`,
    team: [
      // The supporting cast is capped a tier below what the level would allow.
      ...pick(
        g.n <= 2 ? 2 : 3,
        leaderId,
        all(isType(g.type), legalAt(g.level - 2), stageCapAt(g.level - 2)),
      ).map((r) => ({ species: r.id, level: g.level - 2 })),
      // The ace is the fight. It may be a full tier up, and it is the only one.
      ...pick(1, `${leaderId}_ace`, all(isType(g.type), legalAt(g.level))).map((r) => ({
        species: r.id,
        level: g.level,
      })),
    ],
    aiLevel: 3,
    prize: 1200 + g.n * 500,
    badge: g.badge,
    introKey: `gym${g.n}_intro`,
    defeatKey: `gym${g.n}_defeat`,
  });
  m.npcs.push({
    id: `${id}_leader`, kind: 'leader', x: 5, y: 3, facing: 'down',
    sprite: 'leader', name: g.leader, sight: 0,
    dialogue: `gym${g.n}`, team: leaderId, flag: `beat_${leaderId}`,
  });
  return m;
}

/**
 * A route: tall grass, trees, a couple of trainers with sightlines, and a ledge
 * so the walk back south is quicker than the walk north.
 */
function buildRoute(
  id: string, name: string, n: number,
  northTo: string, southTo: string,
  levels: readonly [number, number],
  gate?: { flag: string; text: string },
): Built {
  const W = 20;
  const H = 24;
  const m = addMap({
    id, name, width: W, height: H, tiles: blank(W, H, Tile.Grass),
    warps: [], npcs: [], encounters: null, indoor: false, music: 'route',
  });
  border(m, Tile.Tree);

  // A clear path north-south, always walkable, so the route is never a maze.
  rect(m, 9, 0, 2, H, Tile.Path);
  set(m, 9, 0, Tile.Path);

  // Tall grass either side of the path.
  rect(m, 2, 4, 6, 6, Tile.TallGrass);
  rect(m, 12, 8, 6, 7, Tile.TallGrass);
  rect(m, 3, 16, 5, 5, Tile.TallGrass);

  // Scenery that also blocks trainer sightlines in useful places.
  for (const [tx, ty] of [[4, 12], [15, 5], [6, 21], [16, 19], [13, 3]] as const) {
    set(m, tx, ty, Tile.Rock);
  }

  // A one-way ledge back toward the previous town.
  rect(m, 11, 18, 6, 1, Tile.LedgeDown);

  m.warps.push(
    { x: 9, y: 0, toMap: northTo, toX: 9, toY: 16 },
    { x: 10, y: 0, toMap: northTo, toX: 10, toY: 16 },
  );
  const southWarp: Record<string, unknown> = { x: 9, y: H - 1, toMap: southTo, toX: 9, toY: 1 };
  const southWarp2: Record<string, unknown> = { x: 10, y: H - 1, toMap: southTo, toX: 10, toY: 1 };
  if (gate) {
    southWarp['requiresFlag'] = gate.flag;
    southWarp['blockedText'] = gate.text;
    southWarp2['requiresFlag'] = gate.flag;
    southWarp2['blockedText'] = gate.text;
  }
  m.warps.push(southWarp, southWarp2);

  // Two route trainers, positioned so their sightlines cross the path.
  for (let i = 0; i < 2; i++) {
    const tid = `route${n}_trainer${i + 1}`;
    const lvl = Math.max(2, Math.round((levels[0] + levels[1]) / 2) + 1);
    trainers.push({
      id: tid,
      name: i === 0 ? 'Fenwalker' : 'Houseless Sword',
      title: 'of the road',
      team: pick(i === 0 ? 1 : 2, tid, all((r) => r.stage !== 'apex', legalAt(lvl))).map((r, k) => ({
        species: r.id, level: Math.max(2, lvl + k),
      })),
      aiLevel: 1,
      prize: 120 + n * 90,
      introKey: `npc_gossip_${((n + i) % 12) + 1}`,
      defeatKey: `npc_gossip_${((n + i + 7) % 12) + 1}`,
    });
    m.npcs.push({
      id: `${id}_t${i + 1}`,
      kind: 'trainer',
      x: i === 0 ? 7 : 12,
      y: i === 0 ? 7 : 14,
      facing: i === 0 ? 'right' : 'left',
      sprite: 'trainer',
      name: i === 0 ? 'Fenwalker' : 'Houseless Sword',
      sight: 3,
      dialogue: `npc_gossip_${((n + i) % 12) + 1}`,
      team: tid,
      flag: `beat_${tid}`,
    });
  }

  /*
   * Encounters scale with the route number and skew toward local flavour - but
   * the route MUST also offer an answer to the gym it leads to.
   *
   * Without this, route 1 was almost entirely Fang creatures feeding into a Fang
   * gym, so the team a player naturally builds walking there was exactly the team
   * that gym resists. gauntlet:curve measured 8-16% win rates; swapping two of the
   * three team members for off-type ones took the same fight to 89%. Gen 1 always
   * puts a counter within reach before a badge, and so do we: two guaranteed slots
   * go to species that hit the coming gym's type for super-effective damage.
   */
  const stagePref = n <= 3 ? 'pup' : 'adult';
  const base = all(isStage(stagePref), legalAt(levels[1]));

  const nextGym = GYMS[n - 1];
  const counters = nextGym
    ? pick(2, `counter_${id}`, all(base, (r) =>
        r.types.some((t) => effectivenessAgainst(t, nextGym.type) > 1),
      ))
    : [];

  const filler = pick(6, `enc_${id}`, base).filter(
    (r) => !counters.some((c) => c.id === r.id),
  );

  const chosen = [...counters, ...filler].slice(0, 6);
  const slots = chosen.map((r, i) => ({
    species: r.id,
    min: levels[0],
    max: levels[1],
    // Counters lead the table so they are the likeliest thing a player meets.
    weight: [28, 24, 18, 13, 10, 7][i] ?? 5,
  }));
  m.encounters = { rate: 0.11, slots };
  return m;
}

// ===========================================================================
// Assemble the world
// ===========================================================================

// Tabitha's house, where the game opens.
const house = addMap({
  id: 'fenmark_house', name: 'Astacio House', width: 9, height: 9,
  tiles: blank(9, 9, Tile.Floor), warps: [], npcs: [], encounters: null,
  indoor: true, music: 'home',
});
border(house, Tile.Wall);
rect(house, 2, 2, 2, 1, Tile.Bed);
rect(house, 5, 2, 2, 1, Tile.Table);
set(house, 4, 8, Tile.Door);
house.warps.push({ x: 4, y: 8, toMap: 'fenmark', toX: 9, toY: 5 });

// The home town: no gym, but a lodge, a shop, and the starter scene.
const home = buildTown('fenmark', 'Fenmark', { lodge: true, shop: true, southTo: 'route_1', music: 'home' });
home.warps.push({ x: 9, y: 4, toMap: 'fenmark_house', toX: 4, toY: 7 });
set(home, 9, 4, Tile.Door);
home.npcs.push({
  id: 'fenmark_rival', kind: 'talker', x: 11, y: 6, facing: 'left',
  sprite: 'rival', name: 'Cass', sight: 0, dialogue: 'rival_intro',
});

// The spine: route -> gym town -> route -> gym town ...
const towns = ['fenmark', ...GYMS.map((g) => g.town), 'cross_fen'];
const routeLevels: ReadonlyArray<readonly [number, number]> = [
  [3, 6], [8, 12], [14, 18], [20, 24], [25, 29], [30, 34], [35, 39], [40, 45], [46, 52],
];

for (let i = 0; i < GYMS.length; i++) {
  const g = GYMS[i]!;
  const routeId = `route_${i + 1}`;
  const prevTown = towns[i]!;
  const gate =
    i === 0
      ? undefined
      : { flag: `beat_gym${i}`, text: `House ${GYMS[i - 1]!.house} holds this road. Beat them first.` };
  buildRoute(routeId, `Route ${i + 1}`, i + 1, prevTown, g.town, routeLevels[i] ?? [5, 9], gate);
  buildTown(g.town, g.townName, {
    gym: g,
    lodge: true,
    shop: true,
    northTo: routeId,
    southTo: `route_${i + 2}`,
  });
}

// The last road, gated on the eighth badge, into the endgame.
buildRoute('route_9', 'The Cross-Fen Road', 9, 'brackhall', 'cross_fen', routeLevels[8] ?? [46, 52], {
  flag: 'beat_gym8',
  text: 'The Cross-Fen takes eight badges or it takes nothing.',
});

// The endgame: four consecutive chambers, then the Champion. No healing between.
const crossFen = buildTown('cross_fen', 'The Cross-Fen', { lodge: true, northTo: 'route_9' });
rect(crossFen, 7, 12, 6, 4, Tile.House);
set(crossFen, 9, 15, Tile.Door);
rect(crossFen, 9, 10, 1, 7, Tile.Path);
crossFen.warps.push({ x: 9, y: 15, toMap: 'elite_1', toX: 5, toY: 11 });

for (const e of ELITE) {
  const id = `elite_${e.n}`;
  const next = e.n < 4 ? `elite_${e.n + 1}` : 'champion_hall';
  const m = addMap({
    id, name: 'The Cross-Fen', width: 11, height: 13,
    tiles: blank(11, 13, Tile.Floor), warps: [], npcs: [],
    encounters: null, indoor: true, music: 'elite',
  });
  border(m, Tile.Wall);
  rect(m, 3, 2, 5, 1, Tile.Carpet);
  set(m, 5, 0, Tile.Door);
  set(m, 5, 12, Tile.Door);
  m.warps.push(
    { x: 5, y: 0, toMap: next, toX: 5, toY: 11, requiresFlag: `beat_${id}`, blockedText: 'They are still standing. Deal with that first.' },
    { x: 5, y: 12, toMap: e.n === 1 ? 'cross_fen' : `elite_${e.n - 1}`, toX: 5, toY: 1 },
  );
  trainers.push({
    id,
    name: e.name,
    title: 'of the Cross-Fen',
    team: [
      ...pick(4, id, all(isType(e.type), legalAt(e.level), stageCapAt(e.level - 6))).map((r) => ({
        species: r.id,
        level: e.level,
      })),
      ...pick(1, `${id}_ace`, all(isType(e.type), legalAt(e.level))).map((r) => ({
        species: r.id,
        level: e.level + 2,
      })),
    ],
    aiLevel: 3,
    prize: 6000 + e.n * 1000,
    introKey: `elite_${e.n}`,
    defeatKey: `elite_${e.n}_defeat`,
  });
  m.npcs.push({
    id: `${id}_boss`, kind: 'leader', x: 5, y: 3, facing: 'down',
    sprite: 'elite', name: e.name, sight: 0,
    dialogue: `elite_${e.n}`, team: id, flag: `beat_${id}`,
  });
}

// The Champion: Cass. Of course it is.
const hall = addMap({
  id: 'champion_hall', name: 'The High Seat', width: 11, height: 13,
  tiles: blank(11, 13, Tile.Floor), warps: [], npcs: [],
  encounters: null, indoor: true, music: 'champion',
});
border(hall, Tile.Wall);
rect(hall, 3, 2, 5, 1, Tile.Carpet);
set(hall, 5, 12, Tile.Door);
hall.warps.push({ x: 5, y: 12, toMap: 'elite_4', toX: 5, toY: 1 });
trainers.push({
  id: 'champion',
  name: 'Cass',
  title: 'who took the crown first',
  team: [
    ...pick(3, 'champion', all((r) => r.stage === 'adult', legalAt(60))).map((r) => ({ species: r.id, level: 60 })),
    ...pick(2, 'champion_apex', all((r) => r.stage === 'apex', legalAt(60))).map((r) => ({ species: r.id, level: 60 })),
    // The rival's ace is always the starter that counters yours.
    { species: 'baloo_apex', level: 62 },
  ],
  aiLevel: 3,
  prize: 20000,
  introKey: 'champion_intro',
  defeatKey: 'champion_defeat',
});
hall.npcs.push({
  id: 'champion_cass', kind: 'rival', x: 5, y: 3, facing: 'down',
  sprite: 'rival', name: 'Cass', sight: 0,
  dialogue: 'champion', team: 'champion', flag: 'beat_champion',
});

// ===========================================================================
// Emit
// ===========================================================================

function emitMaps(): string {
  const parts: string[] = [
    '/* GENERATED by scripts/gen/maps.ts — do not edit by hand. */',
    "import type { GameMap } from '../core/world.ts';",
    '',
    'export const MAPS: Readonly<Record<string, GameMap>> = {',
  ];
  for (const m of maps) {
    parts.push(`  ${JSON.stringify(m.id)}: {`);
    parts.push(`    id: ${JSON.stringify(m.id)},`);
    parts.push(`    name: ${JSON.stringify(m.name)},`);
    parts.push(`    width: ${m.width},`);
    parts.push(`    height: ${m.height},`);
    parts.push(`    tiles: new Uint8Array([${m.tiles.join(',')}]),`);
    parts.push(`    warps: ${JSON.stringify(m.warps)},`);
    parts.push(`    npcs: ${JSON.stringify(m.npcs)},`);
    parts.push(`    encounters: ${JSON.stringify(m.encounters)},`);
    parts.push(`    indoor: ${String(m.indoor)},`);
    parts.push(`    music: ${JSON.stringify(m.music)},`);
    parts.push('  },');
  }
  parts.push('};');
  parts.push('');
  parts.push('export function getMap(id: string): GameMap {');
  parts.push('  const m = MAPS[id];');
  parts.push('  if (!m) throw new Error(`unknown map: ${id}`);');
  parts.push('  return m;');
  parts.push('}');
  parts.push('');
  parts.push('export const WORLD = { map: getMap };');
  parts.push('');
  return parts.join('\n');
}

function emitTrainers(): string {
  return [
    '/* GENERATED by scripts/gen/maps.ts — do not edit by hand. */',
    "import type { TrainerDef } from '../core/game.ts';",
    '',
    `export const TRAINERS: Readonly<Record<string, TrainerDef>> = ${JSON.stringify(
      Object.fromEntries(trainers.map((t) => [(t as { id: string }).id, t])),
      null,
      2,
    )};`,
    '',
    'export function getTrainer(id: string): TrainerDef {',
    '  const t = TRAINERS[id];',
    '  if (!t) throw new Error(`unknown trainer: ${id}`);',
    '  return t;',
    '}',
    '',
    `export const GYM_ORDER: readonly string[] = ${JSON.stringify(GYMS.map((g) => `gym${g.n}`))};`,
    `export const BADGE_ORDER: readonly string[] = ${JSON.stringify(GYMS.map((g) => g.badge))};`,
    `export const ELITE_ORDER: readonly string[] = ${JSON.stringify([...ELITE.map((e) => `elite_${e.n}`), 'champion'])};`,
    '',
  ].join('\n');
}

writeFileSync(new URL('../../src/data/maps.gen.ts', import.meta.url).pathname, emitMaps());
writeFileSync(new URL('../../src/data/trainers.gen.ts', import.meta.url).pathname, emitTrainers());

console.log(`\ngenerated ${maps.length} maps, ${trainers.length} trainers`);
console.log('\nGYM   TOWN              HOUSE      TYPE    LVL  BADGE');
for (const g of GYMS) {
  console.log(
    `${String(g.n).padEnd(6)}${g.townName.padEnd(18)}${g.house.padEnd(11)}${g.type.padEnd(8)}${String(g.level).padEnd(5)}${g.badge}`,
  );
}
console.log();
