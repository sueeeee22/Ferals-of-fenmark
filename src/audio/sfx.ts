/**
 * Sound effects. Gen 1's whole vocabulary was one chip and an envelope, and so
 * is this — every sound below is two or three notes with a fast decay, which is
 * why they cost nothing and why they sound right.
 *
 * The design rule throughout: A SOUND EFFECT MUST NOT OUTLAST THE THING IT
 * DESCRIBES. Battle text advances as fast as the player can press A, so a hit
 * that rings for half a second stacks three deep during a flurry and turns into
 * mud. Nothing here runs past ~350ms except the deliberate flourishes.
 */

import { Apu } from './apu.ts';

export type SfxName =
  | 'cursor' | 'confirm' | 'cancel' | 'text'
  | 'hit_weak' | 'hit' | 'hit_hard' | 'hit_crit'
  | 'super' | 'resist' | 'immune' | 'miss'
  | 'faint' | 'heal' | 'stat_up' | 'stat_down' | 'status' | 'levelup'
  | 'snare_throw' | 'snare_land' | 'wobble' | 'snare_click' | 'snare_break'
  | 'encounter' | 'door' | 'ledge' | 'bump' | 'save' | 'badge' | 'flee' | 'menu';

export class Sfx {
  private readonly apu: Apu;
  /**
   * When each effect last played. Two identical hits scheduled a millisecond
   * apart are twice as loud and sound like a fault, so a repeat inside this
   * window is dropped.
   */
  private readonly lastAt = new Map<string, number>();

  constructor(apu: Apu) {
    this.apu = apu;
  }

  play(name: SfxName): void {
    const t = this.apu.ctx.currentTime;
    const last = this.lastAt.get(name) ?? -1;
    if (t - last < 0.035) return;
    this.lastAt.set(name, t);
    this.emit(name, t);
  }

  private emit(name: SfxName, t: number): void {
    const bus = this.apu.sfxBus;
    const p = (freq: number, when: number, dur: number, o: Parameters<Apu['pulse']>[4] = {}): void =>
      this.apu.pulse(bus, freq, when, dur, o);
    const n = (when: number, dur: number, o: Parameters<Apu['noise']>[3] = {}): void =>
      this.apu.noise(bus, when, dur, o);

    switch (name) {
      // --- Interface ------------------------------------------------------
      case 'cursor':
        p(1180, t, 0.035, { duty: 1, vol: 0.1, decay: 0.03 });
        return;
      case 'confirm':
        p(880, t, 0.04, { duty: 1, vol: 0.12, decay: 0.035 });
        p(1320, t + 0.04, 0.06, { duty: 1, vol: 0.12, decay: 0.05 });
        return;
      case 'cancel':
        p(660, t, 0.05, { duty: 1, vol: 0.1, decay: 0.045, sweepTo: 380 });
        return;
      case 'menu':
        p(520, t, 0.05, { duty: 2, vol: 0.11, decay: 0.04 });
        p(780, t + 0.05, 0.06, { duty: 2, vol: 0.11, decay: 0.05 });
        return;
      /**
       * The text blip. Deliberately the quietest thing in the game: it fires on
       * every message in every conversation, so anything with presence becomes
       * a woodpecker within about four lines of dialogue.
       */
      case 'text':
        p(1560, t, 0.025, { duty: 0, vol: 0.105, decay: 0.022 });
        return;

      // --- Hits, sized by how much they took -------------------------------
      case 'hit_weak':
        n(t, 0.05, { vol: 0.16, decay: 0.045, rate: 1.5, highpass: 2200 });
        return;
      case 'hit':
        n(t, 0.09, { vol: 0.3, decay: 0.08, rate: 1.1, filter: 1400, q: 0.8 });
        p(300, t, 0.07, { duty: 2, vol: 0.12, decay: 0.06, sweepTo: 150 });
        return;
      case 'hit_hard':
        n(t, 0.16, { vol: 0.4, decay: 0.15, rate: 0.75, filter: 700, q: 0.7 });
        p(220, t, 0.14, { duty: 2, vol: 0.2, decay: 0.12, sweepTo: 70 });
        return;
      /** A critical is a hard hit with a bright metallic crack on top of it. */
      case 'hit_crit':
        n(t, 0.18, { vol: 0.42, decay: 0.17, rate: 0.7, filter: 600, q: 0.7 });
        p(240, t, 0.16, { duty: 2, vol: 0.22, decay: 0.14, sweepTo: 60 });
        n(t, 0.09, { vol: 0.3, decay: 0.08, rate: 3.2, metallic: true, filter: 4200, q: 6 });
        return;

      // --- Effectiveness tags ---------------------------------------------
      case 'super':
        // Upward, because it went well for whoever threw it.
        p(700, t, 0.06, { duty: 1, vol: 0.14, decay: 0.05 });
        p(1050, t + 0.05, 0.06, { duty: 1, vol: 0.14, decay: 0.05 });
        p(1400, t + 0.1, 0.09, { duty: 1, vol: 0.14, decay: 0.08 });
        return;
      case 'resist':
        p(420, t, 0.09, { duty: 2, vol: 0.11, decay: 0.08, sweepTo: 300 });
        return;
      case 'immune':
        p(300, t, 0.16, { duty: 2, vol: 0.1, decay: 0.14, sweepTo: 140 });
        return;
      case 'miss':
        // A whiff: noise sliding away from you, with nothing landing after it.
        n(t, 0.12, { vol: 0.16, decay: 0.11, rate: 2.6, highpass: 1800 });
        p(900, t, 0.1, { duty: 0, vol: 0.07, decay: 0.09, sweepTo: 1700 });
        return;

      // --- Fortunes --------------------------------------------------------
      case 'faint':
        // The long fall. This is the one sound allowed to take its time.
        p(560, t, 0.42, { duty: 2, vol: 0.17, decay: 0.4, sweepTo: 70 });
        n(t + 0.3, 0.12, { vol: 0.12, decay: 0.11, rate: 0.5, filter: 400 });
        return;
      case 'heal':
        p(660, t, 0.07, { duty: 1, vol: 0.12, decay: 0.06 });
        p(880, t + 0.06, 0.07, { duty: 1, vol: 0.12, decay: 0.06 });
        p(1100, t + 0.12, 0.14, { duty: 1, vol: 0.12, decay: 0.12 });
        return;
      case 'stat_up':
        p(500, t, 0.16, { duty: 1, vol: 0.11, decay: 0.14, sweepTo: 1100 });
        return;
      case 'stat_down':
        p(1100, t, 0.16, { duty: 1, vol: 0.11, decay: 0.14, sweepTo: 420 });
        return;
      case 'status':
        p(420, t, 0.1, { duty: 0, vol: 0.11, decay: 0.09 });
        p(360, t + 0.09, 0.14, { duty: 0, vol: 0.11, decay: 0.12 });
        return;
      case 'levelup':
        // Short enough to sit inside the battle music without stopping it.
        p(784, t, 0.06, { duty: 1, vol: 0.14, decay: 0.05 });
        p(988, t + 0.055, 0.06, { duty: 1, vol: 0.14, decay: 0.05 });
        p(1175, t + 0.11, 0.06, { duty: 1, vol: 0.14, decay: 0.05 });
        p(1568, t + 0.165, 0.18, { duty: 1, vol: 0.15, decay: 0.16 });
        return;

      // --- The snare -------------------------------------------------------
      case 'snare_throw':
        // Rising noise, following the arc up and over.
        n(t, 0.3, { vol: 0.13, decay: 0.28, rate: 0.8, highpass: 900 });
        p(320, t, 0.28, { duty: 0, vol: 0.08, decay: 0.26, sweepTo: 1250 });
        return;
      case 'snare_land':
        n(t, 0.1, { vol: 0.24, decay: 0.09, rate: 1.2, filter: 900, q: 1.4 });
        p(520, t, 0.12, { duty: 2, vol: 0.13, decay: 0.1, sweepTo: 190 });
        return;
      /** One knock per wobble. Dry, wooden, and slightly ominous. */
      case 'wobble':
        n(t, 0.07, { vol: 0.26, decay: 0.06, rate: 1.6, filter: 1500, q: 7, metallic: true });
        p(380, t, 0.06, { duty: 2, vol: 0.1, decay: 0.05, sweepTo: 300 });
        return;
      case 'snare_click':
        // The catch. Two bright notes and it is over — the jingle does the rest.
        n(t, 0.05, { vol: 0.3, decay: 0.04, rate: 3, metallic: true, filter: 5200, q: 8 });
        p(1320, t + 0.02, 0.07, { duty: 1, vol: 0.16, decay: 0.06 });
        p(1760, t + 0.08, 0.12, { duty: 1, vol: 0.16, decay: 0.1 });
        return;
      case 'snare_break':
        // It got out. A burst, then a downward scrape.
        n(t, 0.18, { vol: 0.32, decay: 0.16, rate: 1.4, highpass: 700 });
        p(1200, t, 0.2, { duty: 2, vol: 0.13, decay: 0.18, sweepTo: 260 });
        return;

      // --- The world -------------------------------------------------------
      case 'encounter':
        // Gen 1's two-note alarm, immediately before the screen goes to pieces.
        p(880, t, 0.09, { duty: 2, vol: 0.17, decay: 0.08 });
        p(1174, t + 0.09, 0.09, { duty: 2, vol: 0.17, decay: 0.08 });
        p(880, t + 0.18, 0.09, { duty: 2, vol: 0.17, decay: 0.08 });
        p(1174, t + 0.27, 0.14, { duty: 2, vol: 0.17, decay: 0.12 });
        return;
      case 'door':
        n(t, 0.13, { vol: 0.16, decay: 0.12, rate: 0.6, filter: 600, q: 1.2 });
        p(400, t, 0.1, { duty: 2, vol: 0.09, decay: 0.09, sweepTo: 240 });
        return;
      case 'ledge':
        p(420, t, 0.18, { duty: 1, vol: 0.12, decay: 0.16, sweepTo: 900 });
        return;
      case 'bump':
        n(t, 0.05, { vol: 0.13, decay: 0.045, rate: 0.5, filter: 350, q: 1 });
        return;
      case 'save':
        p(660, t, 0.08, { duty: 1, vol: 0.13, decay: 0.07 });
        p(990, t + 0.08, 0.16, { duty: 1, vol: 0.13, decay: 0.14 });
        return;
      case 'badge':
        p(784, t, 0.1, { duty: 2, vol: 0.16, decay: 0.09 });
        p(988, t + 0.1, 0.1, { duty: 2, vol: 0.16, decay: 0.09 });
        p(1319, t + 0.2, 0.28, { duty: 2, vol: 0.17, decay: 0.26 });
        return;
      case 'flee':
        n(t, 0.22, { vol: 0.14, decay: 0.2, rate: 1.8, highpass: 1200 });
        p(700, t, 0.2, { duty: 0, vol: 0.08, decay: 0.18, sweepTo: 1600 });
        return;
      default:
        return;
    }
  }
}
