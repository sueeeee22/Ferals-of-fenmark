/**
 * The conductor. Reads `GameState` once a frame and decides what should be
 * coming out of the speakers.
 *
 * This is the renderer's design applied to sound: the game state is the single
 * source of truth, audio is a pure function of it, and nothing in `src/core`
 * knows this file exists. Where the reducer genuinely cannot be read after the
 * fact — a critical hit is over by the time we see the state — `BattleScene`
 * records the sound at the moment of the event, exactly as it records `flash`
 * for the screen.
 *
 * Everything else is EDGE DETECTION against the previous frame: the map id
 * changed, so a door opened; the cursor moved, so blip; a snare appeared, so
 * throw it. `draw.ts` already does this for the location banner and documents
 * why — `GameState` has no "something just happened" flag and does not want one.
 *
 * TWO BROWSER FACTS THIS FILE EXISTS TO HANDLE:
 *
 *  - Audio cannot start before the player has interacted with the page. Every
 *    browser enforces it. The context is therefore created on the first
 *    keypress or tap, not at load, and everything before that is a silent no-op
 *    rather than an error in the console.
 *  - A backgrounded tab suspends the audio clock. Coming back has to resume it,
 *    or the game returns from a phone call permanently silent.
 */

import type { Content, GameState } from '../core/game.ts';
import { SNARE_THROW_FRAMES, SNARE_PULL_FRAMES, SNARE_WOBBLE_FRAMES } from '../core/game.ts';
import { Apu } from './apu.ts';
import { Player, type Song } from './song.ts';
import { Sfx, type SfxName } from './sfx.ts';
import { SALSA, BACHATA, REGGAETON, SAMBA, CUMBIA, MERENGUE, HOME, INDOOR } from './latin.ts';
import {
  BATTLE_WILD, BATTLE_TRAINER, BATTLE_GYM, BATTLE_CHAMPION,
  FANFARE_VICTORY, FANFARE_CHAMPION, TITLE,
  JINGLE_CAUGHT, JINGLE_EVOLVE, JINGLE_DEFEAT,
} from './battle.ts';

const STORAGE_KEY = 'fenmark.sound.v1';

/**
 * Which Latin style plays where.
 *
 * Towns and routes each draw from their own pool, chosen by hashing the map id,
 * so a given place always sounds the same but the world does not play one loop
 * for six hours. Players navigate by music more than they realise; a route that
 * changed its theme between visits would be quietly disorienting.
 */
const TOWN_POOL: readonly Song[] = [SALSA, MERENGUE, CUMBIA];
const ROUTE_POOL: readonly Song[] = [SAMBA, REGGAETON, BACHATA, CUMBIA];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(pool: readonly Song[], key: string): Song {
  return pool[hash(key) % pool.length] ?? pool[0] ?? SALSA;
}

function overworldSong(musicTag: string, mapId: string): Song {
  switch (musicTag) {
    case 'home': return HOME;
    case 'indoor': return INDOOR;
    case 'gym': return REGGAETON;
    case 'elite': return SALSA;
    case 'champion': return SAMBA;
    case 'route': return pick(ROUTE_POOL, mapId);
    default: return pick(TOWN_POOL, mapId);
  }
}

/** Snapshot of everything the conductor compares between frames. */
interface Frame {
  scene: string;
  mapId: string;
  lastText: string;
  cursor: number;
  sub: string;
  flash: number;
  sfxSeq: number;
  snareFrames: number;
  snaring: boolean;
  outcome: string;
  badges: number;
  party: number;
  /**
   * The party's species ids, joined.
   *
   * Evolution does NOT change the party's LENGTH - it rewrites a species in
   * place - so watching the count for it fired the evolution jingle every time
   * you caught something instead, on top of the catch jingle. The list is what
   * actually changes.
   */
  species: string;
  hop: boolean;
}

const BLANK: Frame = {
  scene: '', mapId: '', lastText: '', cursor: -1, sub: '', flash: 0, sfxSeq: 0,
  snareFrames: -1, snaring: false, outcome: '', badges: 0, party: 0, species: '', hop: false,
};

export interface Audio {
  /** Called once per simulation frame from the game loop. */
  observe(state: GameState): void;
  /** Called on the first real user input; browsers refuse to start audio before one. */
  unlock(): void;
  enabled: boolean;
  setEnabled(on: boolean): void;
}

export function createAudio(content: Content): Audio {
  let apu: Apu | null = null;
  /**
   * The live context, kept separately from `apu.ctx`.
   *
   * The chip is typed against `BaseAudioContext` so it can also be driven by an
   * offline renderer, but suspend/resume only exist on the live one — and
   * resuming is not optional: a tab that has been backgrounded comes back with
   * its audio clock stopped.
   */
  let live: AudioContext | null = null;
  let player: Player | null = null;
  let sfx: Sfx | null = null;
  let enabled = readPreference();
  let prev: Frame = { ...BLANK };

  function readPreference(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      // A browser refusing storage should still make noise.
      return true;
    }
  }

  function unlock(): void {
    if (live !== null) {
      // Returning from a backgrounded tab or a phone call leaves the clock
      // suspended; without this the game comes back permanently silent.
      if (live.state === 'suspended') void live.resume();
      return;
    }
    if (!enabled) return;
    try {
      const ctx = new AudioContext();
      live = ctx;
      apu = new Apu(ctx);
      player = new Player(apu);
      sfx = new Sfx(apu);
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      // No Web Audio, or the browser refused. The game is entirely playable
      // without sound and must never fail to boot because of it.
      apu = null;
      live = null;
    }
  }

  function setEnabled(on: boolean): void {
    enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // Not being able to remember the setting is not a reason to ignore it.
    }
    if (!on) {
      player?.stop();
      if (apu) apu.master.gain.value = 0;
      return;
    }
    unlock();
    if (apu) apu.master.gain.value = 0.5;
  }

  function play(name: SfxName): void {
    sfx?.play(name);
  }

  /** Which theme the current scene wants. */
  function wantedSong(state: GameState): Song | null {
    const scene = state.scene;
    if (scene.kind === 'title' || scene.kind === 'starterPick') return TITLE;
    if (scene.kind === 'hallOfFame') return FANFARE_CHAMPION;
    if (scene.kind === 'battle') {
      if (scene.trainerId === null) return BATTLE_WILD;
      if (scene.trainerId === 'champion') return BATTLE_CHAMPION;
      let badge: string | undefined;
      try {
        badge = content.trainer(scene.trainerId).badge;
      } catch {
        badge = undefined;
      }
      return badge === undefined ? BATTLE_TRAINER : BATTLE_GYM;
    }
    let tag: string;
    try {
      tag = content.world.map(state.player.mapId).music;
    } catch {
      tag = 'town';
    }
    return overworldSong(tag, state.player.mapId);
  }

  /** Read the frame's comparable shape out of the state. */
  function snapshot(state: GameState): Frame {
    const scene = state.scene;
    const f: Frame = {
      scene: scene.kind,
      mapId: state.player.mapId,
      lastText: state.lastText,
      cursor: -1,
      sub: '',
      flash: 0,
      sfxSeq: 0,
      snareFrames: -1,
      snaring: false,
      outcome: '',
      badges: state.player.badges.length,
      party: state.player.party.length,
      species: state.player.party.map((f) => f.species).join(','),
      hop: false,
    };
    if (scene.kind === 'battle') {
      // One number that changes whenever ANY of the four cursors moves; the
      // sound is the same blip whichever menu the player is in.
      f.cursor = scene.cursor * 1000 + scene.moveCursor * 100 + scene.bagCursor * 10 + scene.partyCursor;
      f.sub = scene.sub;
      f.flash = scene.flash;
      f.sfxSeq = scene.sfxSeq;
      f.outcome = scene.battle.outcome;
      f.snaring = scene.snare !== null;
      f.snareFrames = scene.snare === null ? -1 : scene.snare.frames;
    } else if (scene.kind === 'menu') {
      f.cursor = scene.cursor * 100 + scene.subCursor;
      f.sub = scene.sub;
    } else if (scene.kind === 'overworld') {
      f.hop = scene.walk.hop;
    }
    return f;
  }

  /**
   * The snare's soundtrack, keyed off the animation's own frame counter so the
   * knocks land exactly on the wobbles the player is watching rather than on a
   * second timer that would slowly drift out of step with them.
   */
  function snareSounds(state: GameState, now: Frame): void {
    if (state.scene.kind !== 'battle') return;
    const snare = state.scene.snare;
    if (snare === null) return;
    if (!prev.snaring) {
      play('snare_throw');
      return;
    }
    const f = now.snareFrames;
    const p = prev.snareFrames;
    const crossed = (mark: number): boolean => p < mark && f >= mark;

    // Every mark below is read off the SAME constants the renderer draws with,
    // so a sound can never drift away from the frame it belongs to.
    const wobbleStart = SNARE_THROW_FRAMES + SNARE_PULL_FRAMES;
    if (crossed(wobbleStart)) {
      play('snare_land');
      return;
    }
    const wobbles = snare.caught ? 3 : Math.max(0, Math.min(3, snare.shakes));
    for (let i = 0; i < wobbles; i++) {
      if (crossed(wobbleStart + i * SNARE_WOBBLE_FRAMES + 2)) {
        play('wobble');
        return;
      }
    }
    // The verdict is the START of the settle beat - the frame the renderer
    // paints the click flash or the burst - not the end of the animation.
    if (crossed(wobbleStart + wobbles * SNARE_WOBBLE_FRAMES)) {
      play(snare.caught ? 'snare_click' : 'snare_break');
    }
  }

  function observe(state: GameState): void {
    if (!enabled || apu === null || player === null) {
      prev = snapshot(state);
      return;
    }
    const now = snapshot(state);

    // --- Music ------------------------------------------------------------
    if (now.scene === 'battle' && prev.scene !== 'battle') play('encounter');
    player.play(wantedSong(state));

    // A battle that just ended gets the last word before the map theme returns.
    if (now.outcome !== prev.outcome && prev.scene === 'battle') {
      if (now.outcome === 'caught') player.jingle(JINGLE_CAUGHT);
      else if (now.outcome === 'won' && state.scene.kind === 'battle' && state.scene.trainerId !== null) {
        player.jingle(FANFARE_VICTORY);
      } else if (now.outcome === 'lost') player.jingle(JINGLE_DEFEAT);
      else if (now.outcome === 'fled') play('flee');
    }
    // Same party size, different species: something changed into something else.
    if (now.party === prev.party && now.species !== prev.species && prev.species !== '') {
      player.jingle(JINGLE_EVOLVE);
    }
    if (now.badges > prev.badges) play('badge');

    // --- Effects ----------------------------------------------------------
    if (now.sfxSeq !== prev.sfxSeq && state.scene.kind === 'battle') {
      // Space-separated: the impact, then the effectiveness tag just behind it.
      const parts = state.scene.sfx.split(' ').filter((s) => s.length > 0);
      for (const [i, part] of parts.entries()) {
        if (i === 0) play(part as SfxName);
        else setTimeout(() => play(part as SfxName), 90 * i);
      }
    } else if (now.lastText !== prev.lastText && now.lastText !== '') {
      // Only when nothing louder already spoke for this message.
      play('text');
    }

    if (now.cursor !== prev.cursor && prev.cursor >= 0 && now.scene === prev.scene) play('cursor');
    if (now.sub !== prev.sub && now.scene === prev.scene && prev.scene !== '') {
      const backedOut = now.sub === 'main' || now.sub === 'root';
      // Choosing a move also returns you to the main menu, so the plain
      // "sub changed back" test made COMMITTING to an attack sound exactly like
      // backing out of one. If the turn produced events, you committed.
      const committed = state.scene.kind === 'battle' && state.scene.queue.length > 0;
      if (!(backedOut && committed)) play(backedOut ? 'cancel' : 'confirm');
    }
    if (now.scene === 'menu' && prev.scene !== 'menu') play('menu');
    if (now.mapId !== prev.mapId && prev.mapId !== '') play('door');
    if (now.hop && !prev.hop) play('ledge');
    if (state.saveRequested) play('save');

    snareSounds(state, now);
    prev = now;
  }

  return {
    observe,
    unlock,
    get enabled(): boolean {
      return enabled;
    },
    set enabled(on: boolean) {
      setEnabled(on);
    },
    setEnabled,
  };
}
