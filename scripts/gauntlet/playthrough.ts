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
  NO_BUTTONS, WALK_FRAMES, NAME_ROWS,
  type Buttons, type ButtonName, type Content, type GameState, type StarterId,
} from '../../src/core/game.ts';
import { canWalk, DIR_VEC, propsOf, tileAt, warpAt, type Dir, type GameMap, type NpcKind } from '../../src/core/world.ts';
import { maxHp } from '../../src/core/creature.ts';
import { shopStock } from '../../src/core/items.ts';
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

const MAX_FRAMES = 60_000_000;

/** PT_TRACE=1 narrates the run. Failures are otherwise very hard to localise. */
const TRACE = process.env['PT_TRACE'] === '1';
function trace(msg: string): void {
  if (TRACE) console.log(`      · ${msg}`);
}

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
  /** Trips to a shop counter that ended with something bought, and what they cost. */
  shopVisits = 0;
  spent = 0;
  /** Catches given a name at the letter grid, and party reorders made from the menu. */
  named = 0;
  reorders = 0;
  /** Animals left with a kennelhand and collected again. */
  boxTrips = 0;
  /** Times the Dex was opened and an owned animal's page read. */
  dexLooks = 0;
  /** Tiles crossed at a run (B held) and at a walk. */
  ranTiles = 0;
  walkedTiles = 0;
  /**
   * How many times softening has killed the thing we were trying to catch.
   * Once an over-levelled bot's WEAKEST move one-shots every wild it meets,
   * softening is not a tactic, it is a guaranteed miss - so after two of these
   * the bot stops softening and throws on turn one, exactly like a human player
   * who has out-grown the route. This is measured rather than predicted from
   * the damage formula on purpose: it stays correct if the formula changes.
   */
  private softenKos = 0;
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
  press(button: ButtonName, holdFrames = 1): void {
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

  /** Cheap fingerprint of the parts of state the bot can move. */
  private stateSignature(): string {
    const sc = this.state.scene;
    const p = this.state.player;
    let extra = '';
    if (sc.kind === 'battle') {
      extra = `${sc.sub}:${sc.cursor}:${sc.queue.length}:${sc.battle.outcome}:${sc.battle.turn}:` +
        sc.battle.player.party.map((f) => f.hp).join(',') + '|' +
        sc.battle.enemy.party.map((f) => f.hp).join(',');
    } else if (sc.kind === 'dialogue') {
      extra = `${sc.index}:${sc.chars}`;
    }
    return `${sc.kind}:${p.mapId}:${p.x},${p.y}:${extra}`;
  }

  /** Mash A until the scene stops being dialogue. */
  clearDialogue(limit = 4000): void {
    let n = 0;
    while (this.scene.kind === 'dialogue' && n++ < limit) this.press('a');
  }

  /** Advance until a predicate holds, pressing A to move things along. */
  settle(limit = 20000): void {
    let n = 0;
    // Soft-lock detector. fightBattle can return with the scene STILL 'battle'
    // (for example every party member is fainted but the outcome was never set),
    // and settle would then call it forever and die thousands of frames later as
    // an unattributable "frame budget exhausted". Detecting no-progress here
    // turns a silent hang into a located, reportable failure - which is the
    // whole point of this gauntlet.
    let lastSignature = '';
    let stalled = 0;
    while (n++ < limit) {
      const sig = this.stateSignature();
      if (sig === lastSignature) {
        if (++stalled > 40) {
          throw new Error(
            `soft-lock in scene '${this.state.scene.kind}' at ${this.state.player.mapId} ` +
              `${this.state.player.x},${this.state.player.y} - state unchanged for 40 iterations ` +
              `(last text: "${this.state.lastText.slice(0, 60)}")`,
          );
        }
      } else {
        stalled = 0;
        lastSignature = sig;
      }
      if (this.scene.kind === 'overworld') return;
      if (this.scene.kind === 'dialogue') { this.press('a'); continue; }
      if (this.scene.kind === 'battle') { this.fightBattle(); continue; }
      if (this.scene.kind === 'menu') { this.press('b'); continue; }
      if (this.scene.kind === 'shop') { this.press('b'); continue; }
      if (this.scene.kind === 'naming') { this.nameIt(); continue; }
      if (this.scene.kind === 'box') { this.press('b'); continue; }
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
    let softenTurns = 0;
    let snareThrown = false;
    let snaresThrown = 0;
    /**
     * A stubborn wild will eat the whole bag if you let it. Throw a few, then
     * go back to fighting so the battle ENDS and the next encounter rolls a
     * fresh, possibly easier target - twenty throws at one creature is strictly
     * worse than four throws at five creatures.
     */
    const MAX_SNARES_PER_BATTLE = 4;
    while (this.scene.kind === 'battle' && n++ < limit) {
      const s = this.scene;
      if (s.kind !== 'battle') break;

      // Dismiss anything holding the screen before touching the menu. The
      // reducer ignores input during the pre-battle wipe and while a message is
      // waiting to be acknowledged, so a cursor loop below would spin forever
      // against a menu that cannot move yet - which is exactly how this
      // soft-locked when battle text stopped auto-advancing.
      // The snare throw is on the same footing: input is ignored while it flies.
      if (s.intro > 0 || s.queue.length > 0 || s.awaitingAck || s.snare !== null) {
        this.press('a');
        continue;
      }

      // Replace a fainted creature.
      if (s.sub === 'forceSwitch') {
        const party = s.battle.player.party;
        const target = party.findIndex((f) => f.hp > 0);
        if (target < 0) break;
        for (let g = 0; s.partyCursor !== target && g < 12; g++) this.press('down');
        this.press('a');
        continue;
      }

      if (s.sub === 'main') {
        // Catch things. A real player arrives at gym 1 with a party, not a lone
        // starter, and the bot was losing every gym fighting 1-against-3 because
        // it walked past every wild creature it ever met.
        if (
          s.battle.kind === 'wild' &&
          this.state.player.party.length < 4 &&
          snaresThrown < MAX_SNARES_PER_BATTLE &&
          this.snareIndex() >= 0
        ) {
          const foe = s.battle.enemy.party[s.battle.enemy.active];
          if (foe && foe.hp > 0) {
            const foeMax = maxHp(this.content.dex.species(foe.species), foe);
            // Soften it first; a full-health target almost never stays in. The
            // bot's normal policy picks maximum damage, which one-shot every
            // wild creature it met, so it never once got to throw a snare -
            // it reached gym 1 with a lone starter every single run.
            if (this.softenKos < 2 && foe.hp / foeMax > 0.45 && softenTurns < 6) {
              softenTurns++;
              const weak = this.weakestMoveIndex();
              if (weak >= 0) {
                for (let g = 0; s.cursor !== 0 && g < 8; g++) this.press('up');
                this.press('a');
                let g = 0;
                while (s.moveCursor !== weak && g++ < 8) this.press('down');
                this.press('a');
                continue;
              }
            }
            if (this.softenKos >= 2 || foe.hp / foeMax <= 0.45 || softenTurns >= 3) {
              const idx = this.snareIndex();
              for (let g = 0; s.cursor !== 1 && g < 8; g++) this.press('down');
              this.press('a');
              let guard = 0;
              while (s.bagCursor !== idx && guard++ < 24) this.press('down');
              this.press('a');
              this.caught++;
              snareThrown = true;
              snaresThrown++;
              continue;
            }
          }
        }

        // Heal if the active creature is nearly dead and we carry a poultice.
        const active = s.battle.player.party[s.battle.player.active];
        const potion = this.state.player.bag.find(
          (i) => (i.item === 'poultice' || i.item === 'strong_poultice') && i.count > 0,
        );
        if (active && potion) {
          const max = maxHp(this.content.dex.species(active.species), active);
          if (active.hp / max < 0.25) {
            for (let g = 0; s.cursor !== 1 && g < 8; g++) this.press('down');
            this.press('a');
            const idx = this.state.player.bag.indexOf(potion);
            for (let g = 0; s.bagCursor !== idx && g < 24; g++) this.press('down');
            this.press('a');
            continue;
          }
        }
        for (let g = 0; s.cursor !== 0 && g < 8; g++) this.press('up');
        this.press('a');
        continue;
      }

      if (s.sub === 'moves') {
        const best = this.bestMoveIndex();
        const target = best < 0 ? 0 : best;
        let g = 0;
        while (s.moveCursor !== target && g++ < 8) this.press('down');
        this.press('a');
        continue;
      }

      this.press('b');
    }

    // We meant to soften and catch, and the battle is over without a snare ever
    // leaving the bag: the "weak" move killed it. Record that, so the policy
    // above flips to throwing on turn one.
    if (softenTurns > 0 && !snareThrown) this.softenKos++;

    if (this.scene.kind === 'naming') this.nameIt();
    if (this.scene.kind === 'dialogue') this.clearDialogue();
  }

  /**
   * The question after a catch. The first few get a name, typed on the grid a
   * letter at a time and checked afterwards; the rest are declined, the way a
   * player stops bothering by the fourth hare.
   */
  private nameIt(): void {
    const sc = this.scene;
    if (sc.kind !== 'naming') return;
    if (this.named >= 3) {
      this.press('b');
      return;
    }
    const where = sc.where;
    const index = sc.index;
    const want = ['Ace', 'Bo', 'Cub'][this.named] ?? 'Ace';
    this.press('a'); // YES
    for (const ch of want) {
      const upper = ch.toUpperCase();
      const lower = ch !== upper;
      if (sc.lower !== lower) {
        this.nameCursor(3, 0);
        this.press('a');
      }
      const row = NAME_ROWS.findIndex((r) => r.includes(upper));
      this.nameCursor(row, (NAME_ROWS[row] ?? '').indexOf(upper));
      this.press('a');
    }
    this.nameCursor(3, 3); // END
    this.press('a');
    const p = this.state.player;
    const got = (where === 'party' ? p.party[index] : p.box[index])?.nickname;
    if (got !== want) throw new Error(`typed the name "${want}" on the grid and the animal is called "${got ?? '(nobody)'}"`);
    this.named++;
  }

  private nameCursor(row: number, col: number): void {
    const sc = this.scene;
    if (sc.kind !== 'naming') return;
    for (let g = 0; sc.row !== row && g < 8; g++) this.press('down');
    for (let g = 0; sc.col !== col && g < 12; g++) this.press('right');
  }

  /**
   * Put the highest-level animal at the front, through the party list, the way
   * a player does before a gym. Does nothing if it is already there.
   */
  leadWithStrongest(): void {
    const party = this.state.player.party;
    let best = 0;
    for (let i = 1; i < party.length; i++) {
      if ((party[i]?.level ?? 0) > (party[best]?.level ?? 0)) best = i;
    }
    if (best === 0 || party.length < 2) return;
    const mover = party[best];
    if (this.scene.kind !== 'overworld') this.settle();
    this.press('start');
    this.press('a'); // PARTY is the first entry
    const sc = this.scene;
    if (sc.kind !== 'menu' || sc.sub !== 'party') { this.settle(); return; }
    for (let g = 0; sc.subCursor !== best && g < 8; g++) this.press('down');
    this.press('a'); // the row of actions, on MOVE
    this.press('a'); // pick it up
    for (let g = 0; sc.subCursor !== 0 && g < 8; g++) this.press('up');
    this.press('a'); // put it down in front
    if (this.state.player.party[0] !== mover) throw new Error('moved an animal to the front of the party and it is not there');
    this.reorders++;
    this.press('b');
    this.press('b');
    this.settle();
  }

  /** Bag index of a usable snare, or -1. */
  private snareIndex(): number {
    return this.state.player.bag.findIndex(
      (i) => (i.item === 'snare' || i.item === 'good_snare' || i.item === 'great_snare') && i.count > 0,
    );
  }

  private count(item: string): number {
    return this.state.player.bag.find((i) => i.item === item)?.count ?? 0;
  }

  /**
   * Walk to the nearest shop and buy snares and poultices at the counter, with
   * the same presses and the same purse a player has.
   *
   * This used to be `restockSnares()`, which reached into the bag and wrote
   * "20" in it, because the shops sold nothing. That hid two things: whether
   * the prize money is enough to keep a party supplied, and whether the shop
   * can actually be operated. Both are now part of what "the bot finished"
   * means. Returns true if anything was bought.
   */
  shop(): boolean {
    const p = this.state.player;
    // Snares matter while there is still a party to build; after that a few
    // spares will do, and the rest of the purse is better spent on poultices.
    const wantSnares = p.party.length < 4 ? 15 : 5;
    const wantPoultices = 10;
    const needs = this.count('snare') < wantSnares || this.count('poultice') < wantPoultices;
    if (!needs || p.money < 200) return false;

    if (this.scene.kind !== 'overworld') this.settle();
    const shopMap = this.findNpcMap('shop');
    if (shopMap === null || !this.travelTo(shopMap)) return false;
    const clerk = this.map.npcs.find((n) => n.kind === 'shop');
    if (!clerk || !this.goTo(clerk.x, clerk.y + 1)) return false;
    this.press('up');
    this.press('a');
    for (let n = 0; this.scene.kind === 'dialogue' && n < 400; n++) this.press('a');
    if (this.scene.kind !== 'shop') {
      this.settle();
      return false;
    }

    const before = p.money;
    this.buy('snare', wantSnares);
    this.buy('poultice', wantPoultices);
    this.press('b');
    this.clearDialogue();
    this.settle();
    const paid = before - this.state.player.money;
    if (paid <= 0) return false;
    this.shopVisits++;
    this.spent += paid;
    trace(`shop: paid ${paid}, now ${this.count('snare')} snares, ${this.count('poultice')} poultices, purse ${this.state.player.money}`);
    return true;
  }

  /** Bring one item up to `want`, or as near as the purse allows. */
  private buy(item: string, want: number): void {
    const sc = this.scene;
    if (sc.kind !== 'shop') return;
    const stock = shopStock(this.state.player.badges.length);
    const row = stock.findIndex((i) => i.id === item);
    const def = stock[row];
    if (!def) return;
    const n = Math.min(want - this.count(item), Math.floor(this.state.player.money / def.price));
    if (n <= 0) return;
    for (let g = 0; sc.cursor !== row && g < 12; g++) this.press('down');
    for (let g = 0; sc.qty < n && g < 120; g++) this.press('right');
    this.press('a');
  }

  /** Lowest-damage move that still does SOMETHING, for softening a catch target. */
  private weakestMoveIndex(): number {
    const sc = this.state.scene;
    if (sc.kind !== 'battle') return -1;
    const me = sc.battle.player.party[sc.battle.player.active];
    if (!me) return -1;
    let best = -1;
    let bestPower = Infinity;
    for (let i = 0; i < me.moves.length; i++) {
      const slot = me.moves[i];
      if (!slot || slot.pp <= 0) continue;
      const mv = this.content.dex.move(slot.move);
      if (mv.power <= 0) continue;
      if (mv.power < bestPower) {
        bestPower = mv.power;
        best = i;
      }
    }
    return best;
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

    // -1 when nothing has PP, so the caller submits anyway and Struggle fires.
    let best = -1;
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
          // A warp tile is a one-way trip, not floor. Routing THROUGH one
          // teleports the bot somewhere the rest of the path does not apply to.
          // This is what trapped it in gym 3 forever: leaving the gym drops you
          // directly below the gym door, and the path north to the route ran
          // back up through that same door, straight back inside.
          if (!(nx === tx && ny === ty) && warpAt(map, nx, ny) !== null) continue;
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

  /** True while a tile transition is in flight. */
  private get midStep(): boolean {
    const sc = this.state.scene;
    return sc.kind === 'overworld' && sc.walk.progress > 0;
  }

  /**
   * Walk exactly ONE tile in `dir`. Returns false if blocked or interrupted.
   *
   * Holding a direction for a fixed number of frames does not work: the reducer
   * commits the move on the frame the button is read and then runs WALK_FRAMES
   * frames of animation, so a hold of WALK_FRAMES+4 starts a SECOND tile as soon
   * as the first finishes. The bot then silently walks two tiles per intended
   * step and desyncs from its BFS path. So: hold only until the move commits,
   * release immediately, then coast out the animation with no buttons held.
   */
  private stepOneTile(dir: Dir, run = false): boolean {
    // Let any in-flight tile transition finish FIRST. The reducer ignores input
    // while walk.progress > 0, so calling this mid-animation burned the six
    // wait-frames on someone else's step, saw no position change, and reported
    // "blocked". goTo then counted three of those as stuck and gave up - which
    // is why the bot sat inside gym 5 unable to walk out of a clear corridor.
    for (let i = 0; i < WALK_FRAMES + 4 && this.midStep; i++) this.tick(NO_BUTTONS);

    const startX = this.state.player.x;
    const startY = this.state.player.y;
    const startMap = this.state.player.mapId;
    // B held is a run. The bot runs when it is going somewhere and walks when
    // it is pacing the grass, which is what a player does with the same button.
    const held: Buttons = { ...NO_BUTTONS, [dir]: true, b: run };

    // Turning in place costs a frame, so give it a few before giving up.
    for (let i = 0; i < 6; i++) {
      this.tick(held);
      if (this.state.player.x !== startX || this.state.player.y !== startY) break;
      if (this.state.scene.kind !== 'overworld') break;
    }
    this.tick(NO_BUTTONS);

    // Coast out the animation with the button released so no second tile starts.
    for (let i = 0; i < WALK_FRAMES + 4 && this.midStep; i++) this.tick(NO_BUTTONS);

    if (this.state.scene.kind !== 'overworld') return false;
    // A warp counts as movement even though the coordinates may coincide.
    const moved =
      this.state.player.mapId !== startMap ||
      this.state.player.x !== startX || this.state.player.y !== startY;
    if (moved && run) this.ranTiles++;
    else if (moved) this.walkedTiles++;
    return moved;
  }

  /** Walk a path, handling anything that interrupts (battles, trainers, signs). */
  walkPath(path: readonly Dir[]): void {
    const startMap = this.state.player.mapId;
    for (const dir of path) {
      const moved = this.stepOneTile(dir, true);
      if (this.scene.kind !== 'overworld') {
        this.settle();
        return; // path is stale after an interruption; caller re-plans
      }
      // A warp invalidates every remaining direction: they were computed for the
      // old map's grid. Walking them anyway can march straight back through the
      // warp and ping-pong forever.
      if (this.state.player.mapId !== startMap) return;
      if (!moved) return;
    }
  }

  /** Walk to a tile on the current map, re-planning after every interruption. */
  goTo(tx: number, ty: number, attempts = 60): boolean {
    // No-progress detection is what keeps a stuck bot from eating the whole
    // frame budget. Without it, a goTo that can never arrive spins ~300 times
    // through a full path walk, travelTo does that 60 times per hop, and the run
    // dies with "frame budget exhausted" thousands of frames from anything real.
    let stuck = 0;
    let lastKey = '';
    const startMap = this.state.player.mapId;

    for (let i = 0; i < attempts; i++) {
      if (this.state.player.x === tx && this.state.player.y === ty) return true;
      if (this.scene.kind !== 'overworld') this.settle();
      if (this.state.scene.kind === 'hallOfFame') return true;
      // Warped (or blacked out) somewhere else: this target is no longer ours.
      if (this.state.player.mapId !== startMap) return false;

      const path = this.pathTo(tx, ty);
      if (path === null) return false;
      if (path.length === 0) return true;
      this.walkPath(path);

      const key = `${this.state.player.mapId}:${this.state.player.x},${this.state.player.y}`;
      if (key === lastKey) {
        if (++stuck >= 3) return false;
      } else {
        stuck = 0;
        lastKey = key;
      }
    }
    return false;
  }

  /** Cross-map navigation: BFS the warp graph, then walk warp to warp. */
  travelTo(targetMap: string, maxHops = 40): boolean {
    let noProgress = 0;
    let lastMap = '';
    for (let hop = 0; hop < maxHops; hop++) {
      const here = this.state.player.mapId;
      if (here === lastMap) {
        if (++noProgress >= 4) return false;
      } else {
        noProgress = 0;
        lastMap = here;
      }
      if (this.state.player.mapId === targetMap) return true;
      if (this.scene.kind !== 'overworld') this.settle();
      if (this.state.scene.kind === 'hallOfFame') return true;

      const route = this.warpRoute(this.state.player.mapId, targetMap);
      if (!route) {
        trace(`travelTo(${targetMap}): NO ROUTE from ${this.state.player.mapId}`);
        return false;
      }
      const before = this.state.player.mapId;
      // A lost battle blacks out and relocates the player to a lodge mid-journey.
      // That is a re-plan, not a failure - goTo returning false just means the
      // path it had is stale, so loop and route again from wherever we now are.
      if (!this.goTo(route.x, route.y)) {
        if (this.state.player.mapId !== before) continue;
        trace(
          `travelTo(${targetMap}): goTo(${route.x},${route.y}) FAILED on ${before} ` +
            `from ${this.state.player.x},${this.state.player.y} ` +
            `path=${this.pathTo(route.x, route.y) === null ? 'null' : 'exists'}`,
        );
        return false;
      }
      // Stepping onto a warp tile triggers it; if we are still here, nudge.
      if (this.state.player.mapId === before) {
        this.stepOneTile('down');
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

  /** The nearest reachable map that actually has a wild encounter table. */
  private findEncounterMap(): string | null {
    const seen = new Set<string>([this.state.player.mapId]);
    let frontier = [this.state.player.mapId];
    const flags = new Set(this.state.player.flags);
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        let map: GameMap;
        try {
          map = this.content.world.map(id);
        } catch {
          continue;
        }
        if (map.encounters !== null && map.encounters.slots.length > 0) return id;
        for (const w of map.warps) {
          if (w.requiresFlag !== undefined && !flags.has(w.requiresFlag)) continue;
          if (seen.has(w.toMap)) continue;
          seen.add(w.toMap);
          next.push(w.toMap);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** A tile on the current map that rolls wild encounters. */
  private findGrassTile(): readonly [number, number] | null {
    const map = this.map;
    let best: readonly [number, number] | null = null;
    let bestLen = Infinity;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!propsOf(tileAt(map, x, y)).encounter) continue;
        const path = this.pathTo(x, y);
        if (path === null) continue;
        if (path.length < bestLen) {
          bestLen = path.length;
          best = [x, y];
        }
      }
    }
    return best;
  }

  /**
   * Walk in tall grass until the lead creature reaches `target` level.
   *
   * Must actually STAND IN GRASS to work. The first version paced left and right
   * wherever it happened to be standing, which was usually a town, so it burned
   * its whole frame budget without a single encounter and then walked into a gym
   * underlevelled.
   */
  grindTo(target: number, budget = 600000, minParty = 1): void {
    // Exp requirement is cubic in level, so grinding budget must grow with it.
    budget = Math.round(budget * (1 + target / 20));
    const start = this.frames;
    const lead = (): number =>
      this.state.player.party.reduce((best, f) => Math.max(best, f.level), 0);
    /*
     * Level and party size are SEPARATE goals, and the level one must be able to
     * finish. Gating `done` on both meant a bot that could not catch anything
     * kept grinding levels while it waited: Baloo reached level 81 by gym 2,
     * still carrying one creature, target 26. Levelling is cubic, so that also
     * made the run take an hour.
     *
     * So: grind to the level target, then allow a small fixed extra budget to
     * try to fill the party, then move on whatever happened.
     *
     * Keep the grace SMALL. Every frame spent here is a frame spent winning
     * battles, so a long grace is just a level overshoot with extra steps: at
     * 60k frames Plato arrived at gym 1 twenty levels over, and finished the
     * game at 100/100/100, which made this gauntlet prove nothing about the
     * difficulty curve. Catching is snare-limited, not time-limited.
     */
    const CATCH_GRACE = 9000;
    let shopless = false;
    let levelMetAt = -1;
    const done = (): boolean => {
      if (lead() < target) return false;
      if (levelMetAt < 0) levelMetAt = this.frames;
      if (this.state.player.party.length >= minParty) return true;
      return this.frames - levelMetAt > CATCH_GRACE;
    };
    if (done()) return;

    const grassMap = this.findEncounterMap();
    trace(`grindTo(${target}) from ${this.state.player.mapId}: encounterMap=${grassMap ?? 'NONE'}`);
    if (grassMap !== null && grassMap !== this.state.player.mapId) {
      const ok = this.travelTo(grassMap);
      trace(`  travelTo(${grassMap}) -> ${ok} (now ${this.state.player.mapId})`);
    }

    while (this.frames - start < budget && !done()) {
      if (this.state.scene.kind !== 'overworld') this.settle();
      if (this.state.scene.kind === 'hallOfFame') return;

      if (!partyAlive(this.state.player)) {
        this.settle();
        this.healUp();
        continue;
      }

      // Out of snares with a party still to build: walk back to a shop, as a
      // player would. If the shop cannot help (no money, no road) stop asking,
      // or the bot spends the whole budget commuting.
      if (this.state.player.party.length < minParty && this.snareIndex() < 0 && !shopless) {
        if (this.shop()) continue;
        shopless = true;
      }

      const spot = this.findGrassTile();
      trace(
        `grind: map=${this.state.player.mapId} pos=${this.state.player.x},${this.state.player.y} ` +
          `lead=${lead()}/${target} party=${this.state.player.party.length} ` +
          `grass=${spot === null ? 'NONE' : `${spot[0]},${spot[1]}`} frames=${this.frames - start}`,
      );
      if (spot === null) {
        // Nothing to grind on here; try to relocate once, else give up quietly
        // rather than burning the budget standing still.
        const alt = this.findEncounterMap();
        if (alt === null || alt === this.state.player.mapId) return;
        this.travelTo(alt);
        continue;
      }

      const path = this.pathTo(spot[0], spot[1]);
      if (path !== null && path.length > 0) this.walkPath(path);

      // Pace on the spot. Every step on an encounter tile rolls the dice.
      for (const dir of ['left', 'right', 'up', 'down'] as const) {
        if (done()) break;
        this.stepOneTile(dir);
        if (this.state.scene.kind !== 'overworld') this.settle();
        if (!partyAlive(this.state.player)) break;
      }

      const hurt = this.state.player.party.some((f) => {
        if (f.hp <= 0) return true;
        const max = maxHp(this.content.dex.species(f.species), f);
        return f.hp / max < 0.35;
      });
      if (hurt) this.healUp();
    }
  }

  /** The nearest map with a healer in it. */
  private findLodge(): string | null {
    return this.findNpcMap('healer');
  }

  /** The nearest map with someone of this kind in it. */
  private findNpcMap(kind: NpcKind): string | null {
    const seen = new Set<string>([this.state.player.mapId]);
    let frontier = [this.state.player.mapId];
    const flags = new Set(this.state.player.flags);
    for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
      const next: string[] = [];
      // Two towns are often equally near - the one behind and the one ahead.
      // Take the one ahead (maps list their north exit first, so: last first).
      // Taking the one behind walked the bot a town north every time it stopped
      // to heal, until it was "grinding" at level 57 on Route 1.
      for (const id of [...frontier].reverse()) {
        let map: GameMap;
        try {
          map = this.content.world.map(id);
        } catch {
          continue;
        }
        if (map.npcs.some((n) => n.kind === kind)) return id;
        for (const w of map.warps) {
          if (w.requiresFlag !== undefined && !flags.has(w.requiresFlag)) continue;
          if (seen.has(w.toMap)) continue;
          seen.add(w.toMap);
          next.push(w.toMap);
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * Walk to the NEAREST lodge and heal. The first version always fell back to
   * `fenmark_lodge` - the starting town - so a bot standing outside gym 6 walked
   * the entire map to heal and burned its frame budget doing it.
   */
  healUp(): void {
    const lodge = this.findLodge();
    if (lodge === null) return;
    if (!this.travelTo(lodge)) return;
    const map = this.map;
    const healer = map.npcs.find((n) => n.kind === 'healer');
    if (!healer) return;
    // Stand below the keeper and talk up.
    if (this.goTo(healer.x, healer.y + 1)) {
      this.press('up');
      this.press('a');
      this.clearDialogue();
    }
    this.settle();
  }

  /**
   * Leave the last animal in the party with the nearest kennelhand, save and
   * reload with it in the box, and collect it again. The box has to hold an
   * animal across a save for it to be a box at all.
   */
  boxRoundTrip(): void {
    if (this.state.player.party.length < 2) return;
    const lodge = this.findNpcMap('box');
    if (lodge === null || !this.travelTo(lodge)) return;
    const hand = this.map.npcs.find((n) => n.kind === 'box');
    if (!hand) return;

    const open = (): boolean => {
      if (!this.goTo(hand.x - 1, hand.y)) return false;
      this.press('right');
      this.press('a');
      for (let n = 0; this.scene.kind === 'dialogue' && n < 400; n++) this.press('a');
      return this.scene.kind === 'box';
    };
    const close = (): void => {
      this.press('b');
      this.clearDialogue();
      this.settle();
    };

    if (!open()) { this.settle(); return; }
    const sc = this.scene;
    if (sc.kind !== 'box') return;
    const party = this.state.player.party;
    const last = party.length - 1;
    const who = party[last];
    for (let g = 0; sc.cursor !== last && g < 8; g++) this.press('down');
    this.press('a');
    if (this.state.player.box[this.state.player.box.length - 1] !== who) {
      throw new Error('left an animal with the kennelhand and it is not in the box');
    }
    const name = who?.nickname ?? '';
    const level = who?.level ?? 0;
    close();
    this.saveAndReload();

    if (!open()) throw new Error('could not get back to the kennelhand to collect an animal');
    const again = this.scene;
    if (again.kind !== 'box') return;
    this.press('right');
    const box = this.state.player.box;
    const at = box.findIndex((f) => f.nickname === name && f.level === level);
    if (at < 0) throw new Error(`${name} was left in the box and is gone after a save and reload`);
    for (let g = 0; again.cursor !== at && g < 40; g++) this.press('down');
    this.press('a');
    const back = this.state.player.party[this.state.player.party.length - 1];
    if (back?.nickname !== name || back.level !== level) throw new Error(`collected ${name} from the box and it did not come back`);
    close();
    this.boxTrips++;
  }

  /**
   * Open the Dex from the pause menu, find the lead animal in the list and open
   * its page. Along the way, check the Dex against what the bot knows it has
   * done: it owns everything it is carrying, and has met everything it owns.
   */
  checkDex(): void {
    const p = this.state.player;
    const carried = [...p.party, ...p.box].map((f) => f.species);
    for (const id of carried) {
      if (!p.caught.includes(id)) throw new Error(`carrying a ${id} that the Dex does not list as owned`);
    }
    for (const id of p.caught) {
      if (!p.seen.includes(id)) throw new Error(`the Dex lists ${id} as owned but not as met`);
    }
    const lead = p.party[0];
    if (!lead) return;
    if (this.scene.kind !== 'overworld') this.settle();
    this.press('start');
    this.press('down');
    this.press('down'); // DEX is the third entry
    this.press('a');
    const sc = this.scene;
    if (sc.kind !== 'menu' || sc.sub !== 'dex') { this.settle(); return; }
    const at = this.content.speciesIds.indexOf(lead.species);
    for (let g = 0; sc.subCursor !== at && g < 200; g++) {
      this.press(at - sc.subCursor >= 8 ? 'right' : at > sc.subCursor ? 'down' : 'up');
    }
    this.press('a');
    if (!sc.entry) throw new Error(`the Dex would not open the page of ${lead.species}, which is leading the party`);
    this.dexLooks++;
    this.press('b');
    this.press('b');
    this.press('b');
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
  shopVisits: number;
  spent: number;
  named: number;
  reorders: number;
  boxTrips: number;
  dex: string;
  seconds: number;
}

function playthrough(loaded: LoadedContent, starter: StarterId): RunResult {
  const t0 = performance.now();
  // Fixed seed by default so the gate is reproducible. PT_SEED re-rolls it, so
  // "it passes" can be checked against more than one lucky run - a gauntlet that
  // only passes on one seed is not a gate, it is a coincidence.
  const seed = process.env['PT_SEED'];
  const bot = new Bot(loaded.content, `run-${starter}${seed === undefined ? '' : `-${seed}`}`);
  const gyms = loaded.gymOrder;
  const elite = loaded.eliteOrder;

  const bail = (reason: string): RunResult => ({
    starter,
    ok: false,
    reason: `${reason} [at ${bot.state.player.mapId} ${bot.state.player.x},${bot.state.player.y} scene=${bot.state.scene.kind}]`,
    frames: bot.frames,
    badges: bot.state.player.badges.length,
    partyLevels: bot.state.player.party.map((f) => f.level),
    saves: bot.saves,
    shopVisits: bot.shopVisits,
    spent: bot.spent,
    named: bot.named,
    reorders: bot.reorders,
    boxTrips: bot.boxTrips,
    dex: `${bot.state.player.seen.length}/${bot.state.player.caught.length}`,
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

      // Arrive with a party at or slightly above the leader's level, the way a
      // player who walked the route and caught things along the way would.
      bot.shop();
      bot.grindTo(Math.max(5, targetLevel + 2), 600000, Math.min(4, i + 2));
      bot.healUp();

      if (!bot.travelTo(spec.town)) return bail(`could not reach ${spec.town} (gym ${i + 1})`);
      bot.healUp();
      bot.leadWithStrongest();
      if (!bot.travelTo(spec.gymMap)) return bail(`could not enter ${spec.gymMap}`);
      trace(`entered ${spec.gymMap} at ${bot.state.player.x},${bot.state.player.y}`);

      // Walk to the leader and talk. Guards will intercept on the way.
      for (let attempt = 0; attempt < 12; attempt++) {
        if (hasFlag(bot.state.player, `beat_${gymId}`)) break;
        if (!bot.goTo(5, 4)) {
          bot.settle();
          continue;
        }
        bot.press('up');
        bot.press('a');
        bot.settle();
        trace(
          `gym${i + 1} attempt ${attempt}: map=${bot.state.player.mapId} ` +
            `pos=${bot.state.player.x},${bot.state.player.y} ` +
            `party=${bot.state.player.party.map((f) => f.level).join('/')} ` +
            `beat=${hasFlag(bot.state.player, `beat_${gymId}`)} ` +
            `last="${bot.state.lastText.slice(0, 48)}"`,
        );
        if (hasFlag(bot.state.player, `beat_${gymId}`)) break;

        // Losing and retrying at the SAME level just loses the same fight again.
        // Each failed attempt escalates the target, the way a player who got
        // beaten would go away and train rather than walking straight back in.
        const lead = bot.state.player.party.reduce((b, f) => Math.max(b, f.level), targetLevel);
        bot.shop();
        bot.grindTo(
          Math.min(targetLevel + 12, Math.max(targetLevel + 2, lead + 3)),
          600000,
          Math.min(4, attempt + 2),
        );
        bot.healUp();
        if (!bot.travelTo(spec.gymMap)) return bail(`could not re-enter ${spec.gymMap}`);
      }

      if (!hasFlag(bot.state.player, `beat_${gymId}`)) {
        return bail(`failed to beat gym ${i + 1} (${gymId})`);
      }

      // Save and reload mid-run, at every gym, as a real player would.
      bot.healUp();
      bot.saveAndReload();
      // Every other gym, with an animal left in the kennel box across the save.
      if (i % 2 === 0) bot.boxRoundTrip();
      else bot.checkDex();
    }

    if (bot.state.player.badges.length < gyms.length) {
      return bail(`only ${bot.state.player.badges.length} badges after all gyms`);
    }

    // The endgame.
    bot.grindTo(58);
    bot.healUp();
    bot.saveAndReload();

    trace(
      `ENDGAME: badges=${bot.state.player.badges.length} ` +
        `party=${bot.state.player.party.map((f) => f.level).join('/')} ` +
        `at ${bot.state.player.mapId}`,
    );
    for (const [i, id] of elite.entries()) {
      const mapId = id === 'champion' ? 'champion_hall' : `elite_${i + 1}`;
      // Cass is on the road and on the step, and she does not move for being
      // asked. Losing to her is not the end of a run any more than losing to
      // the Table is: do what a player does, and come back stronger.
      let arrived = bot.travelTo(mapId);
      for (let tries = 0; !arrived && tries < 6; tries++) {
        const lead = bot.state.player.party.reduce((b, f) => Math.max(b, f.level), 58);
        trace(`  road to ${mapId} is held; lead=${lead}, going away to get better`);
        bot.shop();
        bot.grindTo(Math.min(80, lead + 3), 600000, 4);
        bot.healUp();
        arrived = bot.travelTo(mapId);
      }
      if (!arrived) {
        return bail(
          `could not reach ${mapId} from ${bot.state.player.mapId} ` +
            `(flags: ${bot.state.player.flags.filter((f) => f.startsWith('beat_')).join(',')})`,
        );
      }
      trace(`entered ${mapId} at ${bot.state.player.x},${bot.state.player.y}`);
      for (let attempt = 0; attempt < 12; attempt++) {
        if (hasFlag(bot.state.player, `beat_${id}`) || reachedHallOfFame(bot)) break;
        if (!bot.goTo(5, 4)) { bot.settle(); continue; }
        bot.press('up');
        bot.press('a');
        bot.settle();
        trace(
          `  ${id} attempt ${attempt}: map=${bot.state.player.mapId} ` +
            `pos=${bot.state.player.x},${bot.state.player.y} ` +
            `party=${bot.state.player.party.map((f) => f.level).join('/')} ` +
            `beat=${hasFlag(bot.state.player, `beat_${id}`)} ` +
            `last="${bot.state.lastText.slice(0, 44)}"`,
        );
        if (reachedHallOfFame(bot)) break;
        const lead = bot.state.player.party.reduce((b, f) => Math.max(b, f.level), 58);
        bot.shop();
        bot.grindTo(Math.min(80, Math.max(60, lead + 3)), 600000, 4);
        bot.healUp();
        if (!bot.travelTo(mapId)) return bail(`could not re-enter ${mapId}`);
      }
      if (reachedHallOfFame(bot)) break;
      if (!hasFlag(bot.state.player, `beat_${id}`)) return bail(`failed to beat ${id}`);
    }

    const won = reachedHallOfFame(bot) || hasFlag(bot.state.player, 'champion');
    // A run that never bought anything did not test the shops, whatever else
    // it proved - and it would mean the bot is being supplied some other way.
    if (won && bot.shopVisits === 0) return bail('reached the Champion without ever buying anything');
    if (won && bot.named === 0) return bail('reached the Champion without ever naming a catch');
    if (won && bot.boxTrips === 0) return bail('reached the Champion without ever using the kennel box');
    if (won && bot.dexLooks === 0) return bail('reached the Champion without ever opening the Dex');
    {
      // Fights against trainers show animals that cannot be caught, so by the
      // end far more has been met than owned. If not, nothing is being recorded.
      const p = bot.state.player;
      if (won && p.seen.length <= p.caught.length) {
        return bail(`the Dex ends with ${p.seen.length} met and ${p.caught.length} owned; trainers alone should have shown more`);
      }
    }
    if (won && (bot.ranTiles === 0 || bot.walkedTiles === 0)) {
      return bail(`ran ${bot.ranTiles} tiles and walked ${bot.walkedTiles}: both paces should have been used`);
    }
    return {
      starter,
      ok: won,
      reason: won ? 'CHAMPION' : 'reached the end without the champion flag',
      frames: bot.frames,
      badges: bot.state.player.badges.length,
      partyLevels: bot.state.player.party.map((f) => f.level),
      saves: bot.saves,
      shopVisits: bot.shopVisits,
      spent: bot.spent,
      named: bot.named,
      reorders: bot.reorders,
      boxTrips: bot.boxTrips,
      dex: `${bot.state.player.seen.length}/${bot.state.player.caught.length}`,
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
const only = process.env['PT_ONLY'];
for (const starter of STARTERS) {
  if (only !== undefined && only !== '' && starter !== only) continue;
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

console.log('\n  STARTER       RESULT     BADGES  SAVES  SHOPS  SPENT   NAMED  MOVES  BOX  DEX seen/own  PARTY LEVELS');
for (const r of results) {
  console.log(
    `  ${r.starter.padEnd(14)}${(r.ok ? 'CHAMPION' : 'FAILED').padEnd(11)}${String(r.badges).padEnd(8)}${String(r.saves).padEnd(7)}${String(r.shopVisits).padEnd(7)}${String(r.spent).padEnd(8)}${String(r.named).padEnd(7)}${String(r.reorders).padEnd(7)}${String(r.boxTrips).padEnd(5)}${r.dex.padEnd(14)}${r.partyLevels.join('/')}`,
  );
}

console.log(
  failures === 0
    ? '\nGAUNTLET 5 PASS — all three starters reached the Champion.\n'
    : `\nGAUNTLET 5 FAIL — ${failures} run(s) did not finish\n`,
);
process.exit(failures === 0 ? 0 : 1);
