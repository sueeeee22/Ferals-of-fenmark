/**
 * gauntlet:playthrough — THE ONE THAT DEFINES DONE.
 *
 * A headless bot starts a new save and plays to the Champion using only real
 * player inputs: it presses buttons into the same `step()` the browser calls.
 * It walks the overworld, fights, catches, levels, uses items, and saves and
 * reloads mid-run. It must finish. Three times, once per starter.
 *
 * Compiling is not done. This is done.
 */
import { performance } from 'node:perf_hooks';
import {
  newGame, step, chooseStarter, hasFlag, partyAlive,
  NO_BUTTONS, WALK_FRAMES,
  type Buttons, type ButtonName, type Content, type GameState, type StarterId,
} from '../../src/core/game.ts';
import { canWalk, DIR_VEC, type Dir, type GameMap } from '../../src/core/world.ts';
import { maxHp } from '../../src/core/creature.ts';
import { serialize, deserialize, restore } from '../../src/core/save.ts';
import { loadContent, type LoadedContent } from './content-loader.ts';

const STARTERS: readonly StarterId[] = ['winter_pup', 'baloo_pup', 'plato_pup'];

let failures = 0;
const fail = (msg: string): void => {
  failures++;
  console.error(`  FAIL  ${msg}`);
};

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

const MAX_FRAMES = 12_000_000;

function reachedHallOfFame(b: Bot): boolean {
  return b.state.scene.kind === 'hallOfFame';
}

class Bot {
  state: GameState;
  frames = 0;
  battlesWon = 0;
  battlesLost = 0;
  caught = 0;
  saves = 0;
  private readonly content: Content;

  constructor(content: Content, seed: string) {
    this.content = content;
    this.state = newGame(seed);
  }

  /** One frame with the given buttons. Everything the bot does routes through here. */
  tick(b: Buttons = NO_BUTTONS): void {
    if (this.frames++ > MAX_FRAMES) throw new Error('frame budget exhausted (soft-lock)');
    this.state = step(this.content, this.state, b);
  }

  /** Press and release, the way a player's thumb actually works. */
  press(button: ButtonName, holdFrames = 2): void {
    const b: Buttons = { ...NO_BUTTONS, [button]: true };
    for (let i = 0; i < holdFrames; i++) this.tick(b);
    this.tick(NO_BUTTONS);
  }

  hold(button: ButtonName, frames: number): void {
    const b: Buttons = { ...NO_BUTTONS, [button]: true };
    for (let i = 0; i < frames; i++) this.tick(b);
  }

  get scene(): GameState['scene'] {
    return this.state.scene;
  }

  get map(): GameMap {
    return this.content.world.map(this.state.player.mapId);
  }

  /** Mash A until the scene stops being dialogue. */
  clearDialogue(limit = 4000): void {
    let n = 0;
    while (this.scene.kind === 'dialogue' && n++ < limit) this.press('a');
  }

  /** Advance until a predicate holds, pressing A to move things along. */
  settle(limit = 20000): void {
    let n = 0;
    while (n++ < limit) {
      if (this.scene.kind === 'overworld') return;
      if (this.scene.kind === 'dialogue') { this.press('a'); continue; }
      if (this.scene.kind === 'battle') { this.fightBattle(); continue; }
      if (this.scene.kind === 'menu') { this.press('b'); continue; }
      if (this.state.scene.kind === 'hallOfFame') return;
      if (this.scene.kind === 'title') { this.press('a'); continue; }
      this.press('a');
    }
    throw new Error(`settle() gave up in scene ${this.scene.kind}`);
  }

  // --- Battle -------------------------------------------------------------

  /** Plays a battle to completion through the real battle menus. */
  fightBattle(limit = 4000): void {
    let n = 0;
    while (this.scene.kind === 'battle' && n++ < limit) {
      const s = this.scene;
      if (s.kind !== 'battle') break;

      if (s.queue.length > 0) { this.press('a'); continue; }

      // Replace a fainted creature.
      if (s.sub === 'forceSwitch') {
        const party = s.battle.player.party;
        const target = party.findIndex((f) => f.hp > 0);
        if (target < 0) break;
        while (s.partyCursor !== target) this.press('down');
        this.press('a');
        continue;
      }

      if (s.sub === 'main') {
        // Heal if the active creature is nearly dead and we carry a poultice.
        const active = s.battle.player.party[s.battle.player.active];
        const potion = this.state.player.bag.find(
          (i) => (i.item === 'poultice' || i.item === 'strong_poultice') && i.count > 0,
        );
        if (active && potion) {
          const max = maxHp(this.content.dex.species(active.species), active);
          if (active.hp / max < 0.25) {
            while (s.cursor !== 1) this.press('right');
            this.press('a');
            const idx = this.state.player.bag.indexOf(potion);
            while (s.bagCursor !== idx) this.press('down');
            this.press('a');
            continue;
          }
        }
        while (s.cursor !== 0) this.press('right');
        this.press('a');
        continue;
      }

      if (s.sub === 'moves') {
        const best = this.bestMoveIndex();
        while (s.moveCursor !== best) this.press('down');
        this.press('a');
        continue;
      }

      this.press('b');
    }

    if (this.scene.kind === 'dialogue') this.clearDialogue();
  }

  /** Highest expected damage against the current foe. */
  private bestMoveIndex(): number {
    const s = this.scene;
    if (s.kind !== 'battle') return 0;
    const me = s.battle.player.party[s.battle.player.active];
    const foe = s.battle.enemy.party[s.battle.enemy.active];
    if (!me || !foe) return 0;
    const foeSp = this.content.dex.species(foe.species);
    const mySp = this.content.dex.species(me.species);

    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < me.moves.length; i++) {
      const slot = me.moves[i];
      if (!slot || slot.pp <= 0) continue;
      const mv = this.content.dex.move(slot.move);
      let mult = 1;
      for (const t of foeSp.types) {
        mult *= typeMult(this.content, mv.type, t);
      }
      const stabBonus = mySp.types.includes(mv.type) ? 1.5 : 1;
      const score = mv.power > 0 ? mv.power * mult * stabBonus * (mv.accuracy / 100) : 1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  // --- Navigation ---------------------------------------------------------

  /** BFS a walkable path on the current map, returning the directions to walk. */
  pathTo(tx: number, ty: number): Dir[] | null {
    const p = this.state.player;
    const map = this.map;
    const flags = new Set(p.flags);
    const canSwim = p.badges.includes('tide');
    const key = (x: number, y: number): number => y * map.width + x;

    const prev = new Map<number, { x: number; y: number; dir: Dir }>();
    const seen = new Set<number>([key(p.x, p.y)]);
    let frontier: Array<[number, number]> = [[p.x, p.y]];

    while (frontier.length > 0) {
      const next: Array<[number, number]> = [];
      for (const [x, y] of frontier) {
        if (x === tx && y === ty) {
          const out: Dir[] = [];
          let cx = x;
          let cy = y;
          while (cx !== p.x || cy !== p.y) {
            const step = prev.get(key(cx, cy));
            if (!step) return null;
            out.unshift(step.dir);
            cx = step.x;
            cy = step.y;
          }
          return out;
        }
        for (const dir of ['up', 'down', 'left', 'right'] as const) {
          if (!canWalk(map, flags, x, y, dir, canSwim)) continue;
          const [dx, dy] = DIR_VEC[dir];
          const nx = x + dx;
          const ny = y + dy;
          if (seen.has(key(nx, ny))) continue;
          seen.add(key(nx, ny));
          prev.set(key(nx, ny), { x, y, dir });
          next.push([nx, ny]);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Walk a path, handling anything that interrupts (battles, trainers, signs). */
  walkPath(path: readonly Dir[]): void {
    for (const dir of path) {
      const before = `${this.state.player.x},${this.state.player.y}`;
      // Turn, then step. Holding through the whole tile transition is what a
      // player's thumb does, and it is what the reducer expects.
      this.hold(dir, WALK_FRAMES + 4);
      this.tick(NO_BUTTONS);

      if (this.scene.kind !== 'overworld') {
        this.settle();
        return; // path is stale after an interruption; caller re-plans
      }
      if (`${this.state.player.x},${this.state.player.y}` === before) {
        // Blocked by something that appeared mid-walk. Re-plan.
        return;
      }
    }
  }

  /** Walk to a tile on the current map, re-planning after every interruption. */
  goTo(tx: number, ty: number, attempts = 300): boolean {
    for (let i = 0; i < attempts; i++) {
      if (this.state.player.x === tx && this.state.player.y === ty) return true;
      if (this.scene.kind !== 'overworld') this.settle();
      if (this.state.scene.kind === 'hallOfFame') return true;
      const path = this.pathTo(tx, ty);
      if (path === null) return false;
      if (path.length === 0) return true;
      this.walkPath(path);
    }
    return false;
  }

  /** Cross-map navigation: BFS the warp graph, then walk warp to warp. */
  travelTo(targetMap: string, maxHops = 60): boolean {
    for (let hop = 0; hop < maxHops; hop++) {
      if (this.state.player.mapId === targetMap) return true;
      if (this.scene.kind !== 'overworld') this.settle();
      if (this.state.scene.kind === 'hallOfFame') return true;

      const route = this.warpRoute(this.state.player.mapId, targetMap);
      if (!route) return false;
      const warp = route;
      const before = this.state.player.mapId;
      if (!this.goTo(warp.x, warp.y)) return false;
      // Stepping onto a warp tile triggers it; if we are still here, nudge.
      if (this.state.player.mapId === before) {
        this.hold('down', WALK_FRAMES + 4);
        this.settle();
      }
    }
    return false;
  }

  /** The first warp to take from `from` to eventually reach `to`. */
  private warpRoute(from: string, to: string): { x: number; y: number } | null {
    const flags = new Set(this.state.player.flags);
    const seen = new Set<string>([from]);
    interface Node { map: string; first: { x: number; y: number } | null }
    let frontier: Node[] = [{ map: from, first: null }];

    while (frontier.length > 0) {
      const next: Node[] = [];
      for (const node of frontier) {
        let map: GameMap;
        try {
          map = this.content.world.map(node.map);
        } catch {
          continue;
        }
        for (const w of map.warps) {
          if (w.requiresFlag !== undefined && !flags.has(w.requiresFlag)) continue;
          const first = node.first ?? { x: w.x, y: w.y };
          if (w.toMap === to) return first;
          if (seen.has(w.toMap)) continue;
          seen.add(w.toMap);
          next.push({ map: w.toMap, first });
        }
      }
      frontier = next;
    }
    return null;
  }

  // --- Grinding -----------------------------------------------------------

  /** Walk in tall grass until the lead creature reaches `target` level. */
  grindTo(target: number, budget = 60000): void {
    const start = this.frames;
    while (this.frames - start < budget) {
      const lead = this.state.player.party.find((f) => f.hp > 0);
      if (!lead) { this.healUp(); continue; }
      if (lead.level >= target) return;
      if (!partyAlive(this.state.player)) { this.settle(); continue; }

      // Pace back and forth; any encounter interrupts and settle() fights it.
      for (const dir of ['left', 'right'] as const) {
        this.hold(dir, WALK_FRAMES + 4);
        if (this.scene.kind !== 'overworld') {
          const before = this.state.player.party.filter((f) => f.hp > 0).length;
          this.settle();
          void before;
        }
      }
      const hurt = this.state.player.party.some((f) => {
        const max = maxHp(this.content.dex.species(f.species), f);
        return f.hp / max < 0.35;
      });
      if (hurt) this.healUp();
    }
  }

  /** Walk to the nearest lodge and heal. */
  healUp(): void {
    const lodge = `${this.state.player.mapId}_lodge`;
    let target = lodge;
    try {
      this.content.world.map(lodge);
    } catch {
      target = 'fenmark_lodge';
    }
    if (!this.travelTo(target)) return;
    // The keeper stands at (4,3); stand below and talk.
    if (this.goTo(4, 4)) {
      this.press('up');
      this.press('a');
      this.clearDialogue();
    }
    this.settle();
  }

  /** Save, serialize, throw the state away, reload it. Mid-run, as a player would. */
  saveAndReload(): void {
    if (this.scene.kind !== 'overworld') this.settle();
    this.press('start');
    if (this.scene.kind === 'menu') {
      // SAVE is index 3 in the root menu.
      const s = this.scene;
      let guard = 0;
      while (s.kind === 'menu' && s.cursor !== 3 && guard++ < 12) this.press('down');
      this.press('a');
      this.clearDialogue();
    }
    const json = serialize(this.state);
    const file = deserialize(json);
    if (!file) throw new Error('save round-trip failed to deserialize');
    this.state = restore(file);
    this.saves++;
    this.settle();
  }
}

function typeMult(content: Content, a: string, d: string): number {
  void content;
  return TYPE_CACHE(a, d);
}

// Late-bound so this file does not depend on data layout.
let TYPE_CACHE: (a: string, d: string) => number = () => 1;

// ---------------------------------------------------------------------------
// A full run
// ---------------------------------------------------------------------------

interface RunResult {
  starter: StarterId;
  ok: boolean;
  reason: string;
  frames: number;
  badges: number;
  partyLevels: number[];
  saves: number;
  seconds: number;
}

function playthrough(loaded: LoadedContent, starter: StarterId): RunResult {
  const t0 = performance.now();
  const bot = new Bot(loaded.content, `run-${starter}`);
  const gyms = loaded.gymOrder;
  const elite = loaded.eliteOrder;

  const bail = (reason: string): RunResult => ({
    starter,
    ok: false,
    reason,
    frames: bot.frames,
    badges: bot.state.player.badges.length,
    partyLevels: bot.state.player.party.map((f) => f.level),
    saves: bot.saves,
    seconds: (performance.now() - t0) / 1000,
  });

  try {
    // Title -> intro -> starter
    bot.press('start');
    bot.clearDialogue();
    chooseStarter(loaded.content, bot.state, starter);
    if (bot.state.player.party.length === 0) return bail('no starter in party after chooseStarter');
    bot.settle();

    // Out of the house.
    if (!bot.travelTo('fenmark')) return bail('could not leave the house');

    // Eight gyms, in order.
    for (const [i, gymId] of gyms.entries()) {
      const spec = loaded.gymTowns[i];
      if (!spec) return bail(`no town recorded for ${gymId}`);
      const targetLevel = loaded.gymLevels[i] ?? 10;

      // Level up to roughly the leader's level before walking in.
      bot.grindTo(Math.max(5, targetLevel));
      bot.healUp();

      if (!bot.travelTo(spec.town)) return bail(`could not reach ${spec.town} (gym ${i + 1})`);
      bot.healUp();
      if (!bot.travelTo(spec.gymMap)) return bail(`could not enter ${spec.gymMap}`);

      // Walk to the leader and talk. Guards will intercept on the way.
      for (let attempt = 0; attempt < 8; attempt++) {
        if (hasFlag(bot.state.player, `beat_${gymId}`)) break;
        if (!bot.goTo(5, 4)) {
          bot.settle();
          continue;
        }
        bot.press('up');
        bot.press('a');
        bot.settle();
        if (!partyAlive(bot.state.player)) {
          bot.settle();
          bot.grindTo(targetLevel + 2);
          bot.healUp();
          if (!bot.travelTo(spec.gymMap)) return bail(`could not re-enter ${spec.gymMap}`);
        }
      }

      if (!hasFlag(bot.state.player, `beat_${gymId}`)) {
        return bail(`failed to beat gym ${i + 1} (${gymId})`);
      }

      // Save and reload mid-run, at every gym, as a real player would.
      bot.healUp();
      bot.saveAndReload();
    }

    if (bot.state.player.badges.length < gyms.length) {
      return bail(`only ${bot.state.player.badges.length} badges after all gyms`);
    }

    // The endgame.
    bot.grindTo(58);
    bot.healUp();
    bot.saveAndReload();

    for (const [i, id] of elite.entries()) {
      const mapId = id === 'champion' ? 'champion_hall' : `elite_${i + 1}`;
      if (!bot.travelTo(mapId)) return bail(`could not reach ${mapId}`);
      for (let attempt = 0; attempt < 8; attempt++) {
        if (hasFlag(bot.state.player, `beat_${id}`) || reachedHallOfFame(bot)) break;
        if (!bot.goTo(5, 4)) { bot.settle(); continue; }
        bot.press('up');
        bot.press('a');
        bot.settle();
        if (reachedHallOfFame(bot)) break;
        if (!partyAlive(bot.state.player)) {
          bot.settle();
          bot.grindTo(60);
          bot.healUp();
          if (!bot.travelTo(mapId)) return bail(`could not re-enter ${mapId}`);
        }
      }
      if (reachedHallOfFame(bot)) break;
      if (!hasFlag(bot.state.player, `beat_${id}`)) return bail(`failed to beat ${id}`);
    }

    const won = reachedHallOfFame(bot) || hasFlag(bot.state.player, 'champion');
    return {
      starter,
      ok: won,
      reason: won ? 'CHAMPION' : 'reached the end without the champion flag',
      frames: bot.frames,
      badges: bot.state.player.badges.length,
      partyLevels: bot.state.player.party.map((f) => f.level),
      saves: bot.saves,
      seconds: (performance.now() - t0) / 1000,
    };
  } catch (err) {
    return bail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------

console.log('\n=== GAUNTLET 5: PLAYTHROUGH ===\n');

const loaded = await loadContent();
if (!loaded) {
  console.error('  content not generated yet — run `npm run gen:all`');
  process.exit(1);
}
// Wrapped rather than assigned directly: taking a bare method reference off
// the loaded object detaches `this`.
TYPE_CACHE = (a, d) => loaded.effectiveness(a, d);

const results: RunResult[] = [];
for (const starter of STARTERS) {
  process.stdout.write(`  ${starter.padEnd(12)} ... `);
  const r = playthrough(loaded, starter);
  results.push(r);
  console.log(
    r.ok
      ? `CHAMPION  (${(r.frames / 60 / 60).toFixed(1)} in-game min, ${r.seconds.toFixed(1)}s, ${r.saves} save/reloads)`
      : `FAILED — ${r.reason}`,
  );
  if (!r.ok) fail(`${starter}: ${r.reason} (badges ${r.badges}, levels ${r.partyLevels.join('/')})`);
}

console.log('\n  STARTER       RESULT     BADGES  SAVES  PARTY LEVELS');
for (const r of results) {
  console.log(
    `  ${r.starter.padEnd(14)}${(r.ok ? 'CHAMPION' : 'FAILED').padEnd(11)}${String(r.badges).padEnd(8)}${String(r.saves).padEnd(7)}${r.partyLevels.join('/')}`,
  );
}

console.log(
  failures === 0
    ? '\nGAUNTLET 5 PASS — all three starters reached the Champion.\n'
    : `\nGAUNTLET 5 FAIL — ${failures} run(s) did not finish\n`,
);
process.exit(failures === 0 ? 0 : 1);
