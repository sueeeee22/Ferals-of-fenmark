/**
 * The Game Boy sound chip, rebuilt on Web Audio.
 *
 * The DMG had four voices and no samples, which is the whole reason Gen 1 sounds
 * the way it does. Rather than ship recordings — which would cost more bytes
 * than the entire rest of the game — this synthesises the same four voices the
 * hardware had, the same way `forge.ts` draws creatures instead of loading them:
 *
 *   PULSE 1   square wave, four selectable duty cycles, volume envelope, pitch
 *             sweep. The lead voice.
 *   PULSE 2   the same minus the sweep. Harmony, counter-melody, montuno.
 *   WAVE      one cycle of a 32-step, 4-bit waveform, freely shaped. Bass, and
 *             the only voice that can sound remotely like an instrument.
 *   NOISE     a shift register. Every drum in every Game Boy song is this
 *             channel plus an envelope, and nothing else.
 *
 * Everything is built from oscillators driving their own gain envelope, created
 * per note and discarded. That sounds wasteful and is not: Web Audio is designed
 * for exactly this, and a note that has finished is garbage collected without a
 * scheduler having to track it.
 *
 * NOTHING HERE KNOWS WHAT A NOTE IS. It takes frequencies and times. Music lives
 * in `song.ts`; what to play when lives in `index.ts`.
 */

/** 12.5%, 25%, 50%, 75% — the only four the hardware offered. */
export type Duty = 0 | 1 | 2 | 3;

const DUTY_FRACTION: readonly number[] = [0.125, 0.25, 0.5, 0.75];

/** How many harmonics to synthesise. Above this is mostly aliasing. */
const HARMONICS = 40;

export interface PulseOptions {
  readonly duty?: Duty;
  /** Peak gain, 0-1, before the master mix. */
  readonly vol?: number;
  /** Seconds of attack. Zero is correct for a chip; a hair helps avoid clicks. */
  readonly attack?: number;
  /** Seconds to fall silent. Shorter than `dur` gives the classic plucked decay. */
  readonly decay?: number;
  /** Frequency to glide to across the note. Gen 1's sirens and thuds are this. */
  readonly sweepTo?: number;
  /** Fraction of the note spent sweeping, 0-1. */
  readonly sweepTime?: number;
  /** Vibrato depth in cents, applied after a short delay like a real player. */
  readonly vibrato?: number;
}

export interface WaveOptions {
  /** Name of a timbre in `WAVES`. */
  readonly table?: string;
  readonly vol?: number;
  readonly attack?: number;
  readonly decay?: number;
  readonly sweepTo?: number;
}

export interface NoiseOptions {
  readonly vol?: number;
  readonly attack?: number;
  readonly decay?: number;
  /** Playback rate of the shift register. Higher is brighter. */
  readonly rate?: number;
  /** The 7-bit register, which repeats every 127 steps and rings like metal. */
  readonly metallic?: boolean;
  /** Bandpass centre in Hz. This is what turns one noise channel into a kit. */
  readonly filter?: number;
  /** Bandpass sharpness. High Q on noise is how you get a rimshot. */
  readonly q?: number;
  /** Highpass corner, for hats that should not thud. */
  readonly highpass?: number;
}

// ---------------------------------------------------------------------------
// Waveform construction
// ---------------------------------------------------------------------------

/**
 * A pulse wave of a given duty, as a Fourier series.
 *
 * For a wave that sits at +1 for a fraction `d` of its period and -1 for the
 * rest, the nth cosine coefficient is (2 / n*pi) * sin(n*pi*d). Building it this
 * way rather than from a sampled square is not fussiness: a sampled square
 * aliases horribly at the top of the range, and the game plays lead lines up
 * there constantly.
 */
function pulseWave(ctx: BaseAudioContext, duty: Duty): PeriodicWave {
  const d = DUTY_FRACTION[duty] ?? 0.5;
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let n = 1; n <= HARMONICS; n++) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * One cycle of the wave channel's 32-step table, as a Fourier series.
 *
 * The hardware stored 32 four-bit samples and looped them. Feeding those samples
 * through a DFT gives the same timbre without the aliasing a raw wavetable would
 * produce at high notes.
 */
function tableWave(ctx: BaseAudioContext, table: readonly number[]): PeriodicWave {
  const n = table.length;
  const count = Math.min(HARMONICS, Math.floor(n / 2));
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  for (let k = 1; k <= count; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < n; j++) {
      const angle = (2 * Math.PI * k * j) / n;
      const s = table[j] ?? 0;
      re += s * Math.cos(angle);
      im -= s * Math.sin(angle);
    }
    real[k] = (2 / n) * re;
    imag[k] = (2 / n) * im;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** Wave-channel timbres, as 32 samples in -1..1. */
export const WAVES: Readonly<Record<string, readonly number[]>> = {
  /** A soft triangle. The default bass: round, and it never fights the leads. */
  bass: Array.from({ length: 32 }, (_, i) => (i < 16 ? i / 8 - 1 : 3 - i / 8)),
  /** Sine-ish. Used where the bass should be felt rather than heard. */
  sub: Array.from({ length: 32 }, (_, i) => Math.sin((2 * Math.PI * i) / 32)),
  /**
   * A plucked, nasal shape — two stacked ramps. This is the closest four bits
   * gets to a nylon-string guitar, which is what bachata is made of.
   */
  pluck: Array.from({ length: 32 }, (_, i) => {
    const t = i / 32;
    return Math.sin(2 * Math.PI * t) * 0.6 + Math.sin(4 * Math.PI * t) * 0.3 + Math.sin(6 * Math.PI * t) * 0.1;
  }),
  /** A hollow, reedy shape for organ-ish montuno stabs. */
  organ: Array.from({ length: 32 }, (_, i) => {
    const t = i / 32;
    return Math.sin(2 * Math.PI * t) * 0.5 + Math.sin(6 * Math.PI * t) * 0.35 + Math.sin(10 * Math.PI * t) * 0.15;
  }),
  /** Sawtooth. Brassy — the horn section, such as it is. */
  brass: Array.from({ length: 32 }, (_, i) => 1 - (2 * i) / 32),
};

/**
 * The DMG's linear-feedback shift register, rendered once into a buffer.
 *
 * 15-bit mode is the broadband hiss every snare and hat is made of. 7-bit mode
 * repeats every 127 steps, which the ear hears as a pitched metallic ring —
 * that is where the clanks and the shell hits come from.
 */
function noiseBuffer(ctx: BaseAudioContext, metallic: boolean): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const out = buf.getChannelData(0);
  let reg = 0x7fff;
  for (let i = 0; i < length; i++) {
    const bit = (reg ^ (reg >> 1)) & 1;
    reg >>= 1;
    reg |= bit << 14;
    if (metallic) {
      reg &= ~(1 << 6);
      reg |= bit << 6;
    }
    out[i] = (reg & 1) === 0 ? 0.85 : -0.85;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

export class Apu {
  /**
   * `BaseAudioContext`, not `AudioContext`, so the whole chip can also be
   * rendered by an `OfflineAudioContext`. That is what lets `gauntlet:audio`
   * play every song and MEASURE it, rather than checking that the note data
   * parses and hoping. A soundtrack that is silent parses perfectly.
   */
  readonly ctx: BaseAudioContext;
  /** Everything mixes through here, so one gain node mutes the whole game. */
  readonly master: GainNode;
  /** Music and effects have their own buses so a loud fight cannot bury a hit. */
  readonly musicBus: GainNode;
  readonly sfxBus: GainNode;

  private readonly duties: PeriodicWave[];
  private readonly tables = new Map<string, PeriodicWave>();
  private readonly noiseWhite: AudioBuffer;
  private readonly noiseMetal: AudioBuffer;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;

    // A limiter across the whole mix. Four voices at full tilt clip, and a
    // clipped square is a very unpleasant thing to have happen to a player.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    this.master = ctx.createGain();
    this.master.gain.value = 0.5;

    // Effects sit ABOVE unity and music below it. Measured with
    // `gauntlet:audio`: at equal gain the music peaked around 0.4 while a menu
    // blip peaked at 0.013, so every sound effect in the game was inaudible
    // under its own soundtrack. The numbers below put the quietest effect
    // comfortably above the music's noise floor without letting a flurry of
    // hits drown the tune.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.7;

    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.duties = [0, 1, 2, 3].map((d) => pulseWave(ctx, d as Duty));
    this.noiseWhite = noiseBuffer(ctx, false);
    this.noiseMetal = noiseBuffer(ctx, true);
  }

  private table(name: string): PeriodicWave {
    const cached = this.tables.get(name);
    if (cached) return cached;
    const built = tableWave(this.ctx, WAVES[name] ?? WAVES['bass'] ?? [0]);
    this.tables.set(name, built);
    return built;
  }

  /**
   * The volume envelope every voice shares.
   *
   * `decay` shorter than the note gives a plucked chip sound; equal to the note
   * gives a sustained one. The final ramp to zero is never omitted — a voice cut
   * dead mid-cycle is an audible click, and at four voices a bar it becomes a
   * rattle underneath the music.
   */
  private envelope(when: number, dur: number, vol: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    const peak = Math.max(0.0001, vol);
    const a = Math.max(0.001, attack);
    const d = Math.max(0.02, decay);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + a);
    // Exponential decay reads as "plucked"; linear reads as "faded".
    g.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
    g.gain.setValueAtTime(0.0001, when + dur + 0.01);
    return g;
  }

  /** A square-wave note. */
  pulse(bus: GainNode, freq: number, when: number, dur: number, o: PulseOptions = {}): void {
    if (!(freq > 0)) return;
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.duties[o.duty ?? 2] ?? this.duties[2]!);
    osc.frequency.setValueAtTime(freq, when);

    if (o.sweepTo !== undefined && o.sweepTo > 0) {
      const span = Math.max(0.01, dur * (o.sweepTime ?? 1));
      // Exponential, because pitch is logarithmic — a linear sweep sounds like
      // it slows down as it falls, which is not what the hardware did.
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), when + span);
    }

    const decay = o.decay ?? dur;
    const g = this.envelope(when, dur, o.vol ?? 0.25, o.attack ?? 0.002, decay);
    osc.connect(g);
    g.connect(bus);

    if (o.vibrato !== undefined && o.vibrato > 0 && dur > 0.18) {
      // Delayed, like a player leaning into a held note. Applied to detune so
      // it is measured in cents and stays even across the register.
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 6.5;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, when);
      depth.gain.setValueAtTime(0, when + 0.12);
      depth.gain.linearRampToValueAtTime(o.vibrato, when + 0.28);
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(when);
      lfo.stop(when + dur + 0.05);
    }

    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  /** A wave-channel note — the only voice with a choosable timbre. */
  wave(bus: GainNode, freq: number, when: number, dur: number, o: WaveOptions = {}): void {
    if (!(freq > 0)) return;
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.table(o.table ?? 'bass'));
    osc.frequency.setValueAtTime(freq, when);
    if (o.sweepTo !== undefined && o.sweepTo > 0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), when + dur);
    }
    const g = this.envelope(when, dur, o.vol ?? 0.3, o.attack ?? 0.003, o.decay ?? dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  /**
   * A burst of shift-register noise, shaped into a drum.
   *
   * The whole percussion kit is this one call with different filters: a low
   * bandpass is a tom, a high one with a sharp Q is a rim, a highpass with a
   * very short decay is a closed hat.
   */
  noise(bus: GainNode, when: number, dur: number, o: NoiseOptions = {}): void {
    const src = this.ctx.createBufferSource();
    src.buffer = o.metallic === true ? this.noiseMetal : this.noiseWhite;
    src.playbackRate.value = o.rate ?? 1;
    src.loop = true;

    let node: AudioNode = src;
    if (o.highpass !== undefined) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = o.highpass;
      node.connect(hp);
      node = hp;
    }
    if (o.filter !== undefined) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = o.filter;
      bp.Q.value = o.q ?? 1;
      node.connect(bp);
      node = bp;
    }

    const g = this.envelope(when, dur, o.vol ?? 0.3, o.attack ?? 0.001, o.decay ?? dur);
    node.connect(g);
    g.connect(bus);
    src.start(when);
    src.stop(when + dur + 0.05);
  }
}
