/**
 * Seeded, serializable RNG. The entire game is deterministic from a seed plus an
 * input log, which is what makes every bug reproducible and every gauntlet stable.
 *
 * `Math.random()` is banned inside src/core — gauntlet:types greps for it.
 *
 * xorshift128+ : fast, tiny, good enough distribution for a Game Boy RPG, and
 * trivially serializable into a save file (four 32-bit words).
 */

export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/** Mutable cursor over an RngState. Advancing is explicit; nothing advances by accident. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    this.a = state.a >>> 0;
    this.b = state.b >>> 0;
    this.c = state.c >>> 0;
    this.d = state.d >>> 0;
  }

  /** Build from any string or number. Uses splitmix32 to avalanche a weak seed. */
  static fromSeed(seed: number | string): Rng {
    let h = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    const next = (): number => {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    // A zero state is a fixed point for xorshift; reroll until at least one word is set.
    let a = next();
    let b = next();
    let c = next();
    let d = next();
    while ((a | b | c | d) === 0) {
      a = next();
      b = next();
      c = next();
      d = next();
    }
    return new Rng({ a, b, c, d });
  }

  /** Snapshot for the save file. */
  get state(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /** Raw 32-bit step. */
  next(): number {
    const t = this.a ^ (this.a << 11);
    this.a = this.b;
    this.b = this.c;
    this.c = this.d;
    this.d = ((this.d ^ (this.d >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return this.d;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next() / 0x1_0000_0000;
  }

  /** Integer in [0, n). Returns 0 for n <= 0 rather than NaN. */
  int(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.float() * n);
  }

  /** Integer in [min, max], inclusive both ends. */
  range(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.int(max - min + 1);
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /**
   * True with probability `num`/256 — the Game Boy's actual accuracy/effect idiom.
   * Gen 1's 1/256 miss bug came from a `>=` here; we use `<`, so 255/256 never misses.
   */
  chance256(num: number): boolean {
    return this.int(256) < num;
  }

  /** Uniform pick. Throws on empty rather than returning undefined into game logic. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(items.length)]!;
  }

  /**
   * Weighted pick. `weights` must align with `items` and sum to > 0.
   * Used for encounter tables and AI move choice.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new Error('Rng.weighted: empty array');
    if (items.length !== weights.length) {
      throw new Error('Rng.weighted: items and weights differ in length');
    }
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return items[0]!;
    let roll = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i]!);
      if (roll < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** In-place Fisher-Yates. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = items[i]!;
      const b = items[j]!;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  /** An independent stream derived from this one. Advances the parent exactly once. */
  fork(): Rng {
    return Rng.fromSeed(this.next());
  }
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
