/**
 * What the game believes it is showing, as plain read-only data.
 *
 * `gauntlet:visual` reads the pixels off the real screen and needs something to
 * compare them with: "the box says Wint" is only a bug if the creature is called
 * Winter. This is that other half. It is published on `window.__fenmark` once
 * per simulation tick and nothing in the game ever reads it back.
 *
 * Two rules keep it honest:
 *
 *  - It reports FACTS, never display strings. If it handed over the already
 *    shortened name the renderer drew, a truncation bug in shared code would
 *    agree with itself and pass. The gate is given "Winter" and has to find
 *    all six letters on the screen on its own.
 *  - It offers no way to SET anything. A screenshot suite that can stage its
 *    own scenes proves nothing about the game.
 */
import type { Content, GameState, ShownSide } from './core/game.ts';
import { activeOf } from './core/battle.ts';
import { maxHp } from './core/creature.ts';
import type { Feral } from './core/creature.ts';

export interface SeenFeral {
  readonly name: string;
  readonly species: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly status: string;
}

export interface SeenMove {
  readonly name: string;
  readonly type: string;
  readonly pp: number;
  readonly maxPp: number;
}

export interface SeenBattle {
  readonly kind: 'wild' | 'trainer';
  readonly sub: string;
  readonly cursor: number;
  readonly moveCursor: number;
  readonly partyCursor: number;
  readonly bagCursor: number;
  /** Frames left of the opening wipe. Nothing else is drawn until it is 0. */
  readonly intro: number;
  /** A message is up and the game is waiting for a press. */
  readonly awaiting: boolean;
  /** Events still to be shown this turn. */
  readonly queued: number;
  readonly snare: boolean;
  /** Frames left of the hit blink, during which a sprite is legitimately absent. */
  readonly flash: number;
  readonly flashSide: 'player' | 'enemy';
  readonly outcome: string;
  /**
   * The creature each side is SHOWING. Mid-turn this trails the engine, which
   * resolved the whole turn at once - see `BattleScene.shown`.
   */
  readonly player: SeenFeral;
  readonly enemy: SeenFeral;
  /** That side's animal has gone down and been taken off the field. */
  readonly playerGone: boolean;
  readonly enemyGone: boolean;
  /** Health as drawn, which trails the real health until it has been narrated. */
  readonly shownPlayerHp: number;
  readonly shownEnemyHp: number;
  readonly moves: readonly SeenMove[];
}

export interface Observation {
  readonly scene: string;
  readonly map: string;
  readonly x: number;
  readonly y: number;
  readonly frame: number;
  readonly facing: string;
  readonly walking: boolean;
  /** Ticks the step in progress takes: 16 walking, 8 running. 0 standing still. */
  readonly stride: number;
  readonly starter: string;
  /** The line the text box is working through (dialogue), or the battle message. */
  readonly text: string;
  /** Dialogue only: which box of the line is up, and how much of it is typed. */
  readonly page: number;
  readonly chars: number;
  /** Menu / starter-picker cursors. */
  readonly sub: string;
  readonly cursor: number;
  readonly subCursor: number;
  readonly party: readonly SeenFeral[];
  readonly bag: readonly { readonly item: string; readonly count: number }[];
  readonly flags: readonly string[];
  readonly money: number;
  readonly badges: number;
  /** Shop only: how many A would buy, and the shop's answer to the last press. */
  readonly qty: number;
  readonly note: string;
  /** Party list: the action highlighted (-1 none), the animal being moved, the item in hand. */
  readonly act: number;
  readonly moving: number;
  readonly using: string;
  /** The naming screen, when it is up. */
  readonly naming: SeenNaming | null;
  readonly battle: SeenBattle | null;
}

export interface SeenNaming {
  readonly asking: boolean;
  readonly choice: number;
  /** What has been typed so far. */
  readonly typed: string;
  readonly row: number;
  readonly col: number;
  readonly lower: boolean;
  /** The species being named - not its current nickname. */
  readonly species: string;
}

function seenShown(sh: ShownSide): SeenFeral {
  return {
    name: sh.name,
    species: sh.species,
    level: sh.level,
    hp: sh.hp,
    maxHp: sh.maxHp,
    status: sh.status ?? '',
  };
}

function seen(content: Content, f: Feral): SeenFeral {
  return {
    name: f.nickname,
    species: f.species,
    level: f.level,
    hp: f.hp,
    maxHp: maxHp(content.dex.species(f.species), f),
    status: f.status ?? '',
  };
}

export function observe(content: Content, s: GameState): Observation {
  const p = s.player;
  const sc = s.scene;

  let text = s.lastText;
  let page = 0;
  let chars = 0;
  let sub = '';
  let cursor = 0;
  let subCursor = 0;
  let walking = false;
  let stride = 0;
  let qty = 0;
  let note = '';
  let act = -1;
  let moving = -1;
  let using = '';
  let naming: SeenNaming | null = null;
  let battle: SeenBattle | null = null;

  switch (sc.kind) {
    case 'dialogue':
      text = sc.lines[sc.index] ?? '';
      page = sc.page;
      chars = sc.chars;
      break;
    case 'overworld':
      walking = sc.walk.progress > 0;
      stride = walking ? sc.walk.span : 0;
      break;
    case 'menu':
      sub = sc.sub;
      cursor = sc.cursor;
      subCursor = sc.subCursor;
      act = sc.act;
      moving = sc.moving;
      using = sc.using;
      note = sc.note;
      break;
    case 'naming': {
      const who = sc.where === 'party' ? p.party[sc.index] : p.box[sc.index];
      naming = {
        asking: sc.asking,
        choice: sc.choice,
        typed: sc.text,
        row: sc.row,
        col: sc.col,
        lower: sc.lower,
        species: who ? content.dex.species(who.species).name : '',
      };
      break;
    }
    case 'shop':
      cursor = sc.cursor;
      qty = sc.qty;
      note = sc.note;
      break;
    case 'starterPick':
    case 'title':
      cursor = sc.cursor;
      break;
    case 'battle': {
      const b = sc.battle;
      const mine = activeOf(b.player);
      sub = sc.sub;
      cursor = sc.cursor;
      battle = {
        kind: b.kind,
        sub: sc.sub,
        cursor: sc.cursor,
        moveCursor: sc.moveCursor,
        partyCursor: sc.partyCursor,
        bagCursor: sc.bagCursor,
        intro: sc.intro,
        awaiting: sc.awaitingAck,
        queued: sc.queue.length,
        snare: sc.snare !== null,
        flash: sc.flash,
        flashSide: sc.flashSide,
        outcome: b.outcome,
        player: seenShown(sc.shown.player),
        enemy: seenShown(sc.shown.enemy),
        playerGone: sc.shown.player.gone,
        enemyGone: sc.shown.enemy.gone,
        shownPlayerHp: sc.shown.player.hp,
        shownEnemyHp: sc.shown.enemy.hp,
        moves: mine.moves.map((m) => {
          const mv = content.dex.move(m.move);
          return { name: mv.name, type: mv.type, pp: m.pp, maxPp: m.maxPp };
        }),
      };
      break;
    }
    default:
      break;
  }

  return {
    scene: sc.kind,
    map: p.mapId,
    x: p.x,
    y: p.y,
    frame: s.frame,
    facing: p.facing,
    walking,
    stride,
    starter: p.starter,
    text,
    page,
    chars,
    sub,
    cursor,
    subCursor,
    party: p.party.map((f) => seen(content, f)),
    bag: p.bag.map((b) => ({ item: b.item, count: b.count })),
    flags: p.flags.slice(),
    money: p.money,
    badges: p.badges.length,
    qty,
    note,
    act,
    moving,
    using,
    naming,
    battle,
  };
}
