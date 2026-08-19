/**
 * Songs, and the clock that plays them.
 *
 * A song is DATA — text patterns, one token per sixteenth note — so the music
 * lives in `tracks.ts` as something a person can read and edit, not as a wall of
 * scheduling calls. This file turns that text into calls on the chip.
 *
 * THE SCHEDULER DOES NOT RUN ON THE GAME LOOP, deliberately. `requestAnimation-
 * Frame` jitters by several milliseconds and stops dead in a backgrounded tab;
 * music driven from it wobbles audibly and Latin music is exactly the wrong
 * genre to have wobble. Instead a timer wakes up every 25ms and schedules every
 * note that falls in the next 150ms directly on the audio clock, which is
 * sample-accurate and independent of rendering. The game can stutter; the clave
 * cannot.
 */

import { Apu, type Duty } from './apu.ts';

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const SEMITONES: Readonly<Record<string, number>> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/**
 * "A#3" or "Eb5" to hertz, equal temperament, A4 = 440.
 *
 * Returns 0 for anything unparseable, and every voice treats 0 as "play
 * nothing" — a typo in a pattern silences one note instead of throwing halfway
 * through a bar and killing the soundtrack for the rest of the session.
 */
export function noteHz(token: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(token);
  if (!m) return 0;
  const semi = SEMITONES[m[1] ?? ''];
  if (semi === undefined) return 0;
  const octave = Number(m[2]);
  // MIDI 69 is A4. C4 is 60, so C-1 is 0.
  const midi = (octave + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Song shape
// ---------------------------------------------------------------------------

export type ChannelKind = 'pulse1' | 'pulse2' | 'wave' | 'noise';

export interface Part {
  readonly kind: ChannelKind;
  /**
   * One string per bar, whitespace-separated, one token per step.
   *
   *   C4      strike this note
   *   .       rest
   *   ~       hold the previous note through this step
   *
   * On a noise part the tokens name drums instead — see `DRUMS`.
   */
  readonly bars: readonly string[];
  readonly duty?: Duty;
  /** Timbre name for a wave part; see `WAVES` in apu.ts. */
  readonly table?: string;
  readonly vol?: number;
  /** Seconds of decay. Omit to sustain for the note's full length. */
  readonly decay?: number;
  /** Cents of vibrato on held notes. A little makes a lead sing. */
  readonly vibrato?: number;
  /** Shift the whole part by this many semitones. */
  readonly transpose?: number;
  /** Skip this part until the song has looped this many times. */
  readonly enterAfter?: number;
}

export interface Song {
  readonly name: string;
  readonly bpm: number;
  /** Steps in one bar. 16 is sixteenths in 4/4, which everything here uses. */
  readonly stepsPerBar: number;
  readonly parts: readonly Part[];
  /**
   * Bars in the loop. Parts shorter than this repeat inside it, so a one-bar
   * clave can sit under a four-bar melody without being written out four times.
   */
  readonly bars: number;
  /** Play once and stop — fanfares and jingles rather than themes. */
  readonly once?: boolean;
}

// ---------------------------------------------------------------------------
// Percussion
// ---------------------------------------------------------------------------

interface Drum {
  readonly dur: number;
  readonly vol: number;
  readonly rate?: number;
  readonly filter?: number;
  readonly q?: number;
  readonly highpass?: number;
  readonly metallic?: boolean;
  /** Drums with a pitched body get a swept pulse under the noise. */
  readonly body?: { readonly from: number; readonly to: number; readonly vol: number };
}

/**
 * The kit, all of it one noise channel and a filter — which is exactly how it
 * was done on the hardware. The Latin percussion is the point of the whole
 * exercise, so the parts that carry a genre (clave, güira, tambora, surdo,
 * tamborim) get their own voicing rather than being approximated by a snare.
 */
export const DRUMS: Readonly<Record<string, Drum>> = {
  // k: kick. Mostly the swept body; the noise is just the beater.
  k: { dur: 0.16, vol: 0.5, rate: 0.35, filter: 110, q: 1.4, body: { from: 150, to: 45, vol: 0.42 } },
  // K: a deeper kick — the samba surdo, which is felt more than heard.
  K: { dur: 0.3, vol: 0.35, rate: 0.28, filter: 80, q: 1.6, body: { from: 120, to: 38, vol: 0.5 } },
  // s: snare.
  s: { dur: 0.15, vol: 0.4, rate: 1, filter: 1900, q: 0.8, highpass: 500 },
  // S: a fatter backbeat snare.
  S: { dur: 0.22, vol: 0.48, rate: 1, filter: 1500, q: 0.7, highpass: 400 },
  // h: closed hat. Very short, very high.
  h: { dur: 0.035, vol: 0.17, rate: 1.9, highpass: 6500 },
  // H: open hat.
  H: { dur: 0.16, vol: 0.16, rate: 1.9, highpass: 6000 },
  // c: clave. Metallic register, tight and pitched — the spine of salsa.
  c: { dur: 0.09, vol: 0.42, rate: 2.6, filter: 2400, q: 9, metallic: true },
  // r: rim / cascara stroke on the shell.
  r: { dur: 0.05, vol: 0.26, rate: 2.2, filter: 3200, q: 6, metallic: true },
  // g: güira / guacharaca scrape. Bachata and cumbia live on this.
  g: { dur: 0.045, vol: 0.13, rate: 1.4, highpass: 4200, filter: 7000, q: 0.6 },
  // G: the accented scrape on the beat.
  G: { dur: 0.08, vol: 0.22, rate: 1.5, highpass: 3800, filter: 6500, q: 0.5 },
  // t: tumbadora open tone — the conga you actually hear.
  t: { dur: 0.13, vol: 0.3, rate: 0.75, filter: 420, q: 4, body: { from: 260, to: 210, vol: 0.16 } },
  // T: the slap. Sharper and higher than the open tone.
  T: { dur: 0.09, vol: 0.34, rate: 1.3, filter: 1100, q: 3.5 },
  // b: bongo martillo, high and dry.
  b: { dur: 0.07, vol: 0.24, rate: 1.1, filter: 1600, q: 4 },
  // m: tamborim — the samba 16th, thin and cutting.
  m: { dur: 0.05, vol: 0.24, rate: 1.7, filter: 2800, q: 5, metallic: true },
  // a: agogô bell, low. A: agogô bell, high.
  a: { dur: 0.11, vol: 0.24, rate: 2.0, filter: 1300, q: 12, metallic: true },
  A: { dur: 0.11, vol: 0.24, rate: 2.4, filter: 2000, q: 12, metallic: true },
  // d: tambora, the merengue drum. Low, loose, and slightly rude.
  d: { dur: 0.12, vol: 0.4, rate: 0.5, filter: 300, q: 2, body: { from: 180, to: 90, vol: 0.24 } },
  // x: crash, for the top of a section.
  x: { dur: 0.5, vol: 0.22, rate: 1.6, highpass: 3000 },
};

// ---------------------------------------------------------------------------
// Pattern reading
// ---------------------------------------------------------------------------

/** Split a bar into exactly `steps` tokens, padding with rests. */
function tokens(bar: string, steps: number): string[] {
  const t = bar.trim().split(/\s+/).filter((s) => s.length > 0);
  while (t.length < steps) t.push('.');
  return t.slice(0, steps);
}

interface Hit {
  /** Step index within the bar. */
  readonly step: number;
  readonly token: string;
  /** Steps the note is held, counting the strike itself. */
  readonly length: number;
}

/**
 * Read one bar into strikes with durations, resolving `~` holds.
 *
 * Done once per bar per part and cached, because a four-minute session at 100bpm
 * would otherwise re-parse the same strings some forty thousand times.
 */
function readBar(bar: string, steps: number): Hit[] {
  const t = tokens(bar, steps);
  const hits: Hit[] = [];
  for (let i = 0; i < t.length; i++) {
    const tok = t[i] ?? '.';
    if (tok === '.' || tok === '~') continue;
    let len = 1;
    while (i + len < t.length && t[i + len] === '~') len++;
    hits.push({ step: i, token: tok, length: len });
  }
  return hits;
}

const barCache = new Map<string, Hit[]>();

function bar(part: Part, index: number, steps: number): Hit[] {
  const src = part.bars[index % part.bars.length] ?? '';
  const key = `${steps}|${src}`;
  const cached = barCache.get(key);
  if (cached) return cached;
  const parsed = readBar(src, steps);
  barCache.set(key, parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

/** How far ahead notes are placed on the audio clock. */
const LOOKAHEAD_S = 0.18;
/** How often the scheduler wakes. Must be well under LOOKAHEAD_S. */
const TICK_MS = 25;

export class Player {
  private readonly apu: Apu;
  private song: Song | null = null;
  private nextStepTime = 0;
  private step = 0;
  private loops = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Set while a song is fading out, so its remaining notes are not scheduled. */
  private stopping = false;
  /**
   * The theme waiting for a jingle to finish.
   *
   * A fanfare is asked for once, but the conductor asks for the overworld theme
   * on EVERY frame after it. Without somewhere to park that request the theme
   * would cut the fanfare off after a sixtieth of a second, every time.
   */
  private pending: Song | null = null;

  constructor(apu: Apu) {
    this.apu = apu;
  }

  get current(): string | null {
    return this.song === null ? null : this.song.name;
  }

  /**
   * Start a song, or do nothing if it is already the one playing.
   *
   * The guard matters more than it looks: `observe()` calls this every frame, so
   * without it the overworld theme would restart sixty times a second and the
   * game would emit a continuous buzz rather than music.
   */
  play(song: Song | null): void {
    if (song === null) {
      this.stop();
      return;
    }
    if (this.song !== null && this.song.name === song.name && !this.stopping) {
      this.pending = null;
      return;
    }
    // A jingle is never interrupted by a theme; the theme waits its turn.
    if (this.song !== null && this.song.once === true) {
      this.pending = song;
      return;
    }
    this.song = song;
    this.step = 0;
    this.loops = 0;
    this.stopping = false;
    this.nextStepTime = this.apu.ctx.currentTime + 0.06;
    if (this.timer === null) {
      this.timer = setInterval(() => this.schedule(), TICK_MS);
    }
    this.schedule();
  }

  /**
   * Play a jingle now, over whatever theme is running, and restore that theme
   * when it ends. Used for the catch, the fanfare and the blackout.
   */
  jingle(song: Song): void {
    if (this.song !== null && this.song.once === true && this.song.name === song.name) return;
    const resume = this.song !== null && this.song.once !== true ? this.song : this.pending;
    this.song = song;
    this.pending = resume;
    this.step = 0;
    this.loops = 0;
    this.stopping = false;
    this.nextStepTime = this.apu.ctx.currentTime + 0.04;
    if (this.timer === null) {
      this.timer = setInterval(() => this.schedule(), TICK_MS);
    }
    this.schedule();
  }

  stop(): void {
    this.song = null;
    this.pending = null;
    this.stopping = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Schedule `seconds` of a song in one go, starting now.
   *
   * The live path cannot do this — it must stay a moving window or a song
   * change would take minutes to take effect — but an offline render has no
   * clock to follow, so it needs every note placed up front. Same `emit`, same
   * `strike`, same everything below them: the gauntlet measures the code that
   * actually plays, not a copy of it.
   */
  renderAll(song: Song, seconds: number): void {
    const stepDur = 60 / song.bpm / (song.stepsPerBar / 4);
    const start = this.apu.ctx.currentTime;
    const songSteps = song.bars * song.stepsPerBar;
    const total = song.once === true ? songSteps : Math.ceil(seconds / stepDur);
    for (let i = 0; i < total; i++) {
      this.loops = Math.floor(i / songSteps);
      this.emit(song, Math.floor(i / song.stepsPerBar) % song.bars, i % song.stepsPerBar, start + i * stepDur, stepDur);
    }
  }

  private schedule(): void {
    const song = this.song;
    if (song === null) return;
    const stepDur = 60 / song.bpm / (song.stepsPerBar / 4);
    const horizon = this.apu.ctx.currentTime + LOOKAHEAD_S;

    while (this.nextStepTime < horizon) {
      const barIndex = Math.floor(this.step / song.stepsPerBar) % song.bars;
      const stepInBar = this.step % song.stepsPerBar;
      this.emit(song, barIndex, stepInBar, this.nextStepTime, stepDur);

      this.step++;
      this.nextStepTime += stepDur;

      if (this.step >= song.bars * song.stepsPerBar) {
        this.step = 0;
        this.loops++;
        if (song.once === true) {
          // A jingle owns the channel until its last note has rung out, then
          // hands it back to whatever was playing underneath.
          // Hand back and return rather than continuing the loop: `song` is
          // captured above and would otherwise keep scheduling the jingle's
          // bars against the new song's tempo. The next timer tick picks the
          // theme up, 25ms later, which nobody can hear.
          this.song = this.pending;
          this.pending = null;
          this.loops = 0;
          this.nextStepTime = Math.max(this.nextStepTime, this.apu.ctx.currentTime);
          return;
        }
      }
    }
  }

  private emit(song: Song, barIndex: number, stepInBar: number, when: number, stepDur: number): void {
    for (const part of song.parts) {
      if (part.enterAfter !== undefined && this.loops < part.enterAfter) continue;
      const hits = bar(part, barIndex, song.stepsPerBar);
      for (const hit of hits) {
        if (hit.step !== stepInBar) continue;
        this.strike(part, hit, when, stepDur);
      }
    }
  }

  private strike(part: Part, hit: Hit, when: number, stepDur: number): void {
    const bus = this.apu.musicBus;
    // A hair under the full length so consecutive notes articulate instead of
    // running into one another as a single smeared tone.
    const dur = hit.length * stepDur * 0.94;

    if (part.kind === 'noise') {
      const drum = DRUMS[hit.token];
      if (!drum) return;
      const opts: Parameters<Apu['noise']>[3] = {
        vol: drum.vol * (part.vol ?? 1),
        decay: drum.dur,
        ...(drum.rate === undefined ? {} : { rate: drum.rate }),
        ...(drum.filter === undefined ? {} : { filter: drum.filter }),
        ...(drum.q === undefined ? {} : { q: drum.q }),
        ...(drum.highpass === undefined ? {} : { highpass: drum.highpass }),
        ...(drum.metallic === undefined ? {} : { metallic: drum.metallic }),
      };
      this.apu.noise(bus, when, drum.dur, opts);
      if (drum.body) {
        this.apu.pulse(bus, drum.body.from, when, drum.dur, {
          duty: 2,
          vol: drum.body.vol * (part.vol ?? 1),
          decay: drum.dur * 0.8,
          sweepTo: drum.body.to,
          sweepTime: 0.5,
        });
      }
      return;
    }

    let hz = noteHz(hit.token);
    if (hz === 0) return;
    if (part.transpose !== undefined) hz *= Math.pow(2, part.transpose / 12);

    if (part.kind === 'wave') {
      this.apu.wave(bus, hz, when, dur, {
        table: part.table ?? 'bass',
        vol: part.vol ?? 0.3,
        ...(part.decay === undefined ? {} : { decay: part.decay }),
      });
      return;
    }

    this.apu.pulse(bus, hz, when, dur, {
      duty: part.duty ?? 2,
      vol: part.vol ?? 0.2,
      ...(part.decay === undefined ? {} : { decay: part.decay }),
      ...(part.vibrato === undefined ? {} : { vibrato: part.vibrato }),
    });
  }
}
