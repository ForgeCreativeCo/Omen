/**
 * Seeded, serializable PRNG (sfc32). All simulation randomness must go through this.
 *
 * Use `fork(label)` to give each system its own stream, so adding a random call in
 * one system doesn't shift the sequence every other system sees.
 */

export type RngState = readonly [number, number, number, number];

/** FNV-1a-style 32-bit string hash, used to turn seeds and labels into numbers. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32: expands one 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  /** The numeric seed this stream was created from; forks derive from it. */
  readonly seed: number;

  constructor(seed: number | string) {
    const n = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.seed = n;
    const mix = splitmix32(n);
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    // Warm up so nearby seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.nextUint();
  }

  static fromState(state: RngState, seed = 0): Rng {
    const r = new Rng(seed);
    r.setState(state);
    return r;
  }

  /** Raw 32-bit unsigned integer. */
  nextUint(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Symmetric noise in [-amount, amount). */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** Approximately normal (Irwin–Hall, 4 samples), mean 0, std ~1. */
  gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Pick an index with probability proportional to its weight. Returns -1 if all weights are 0. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i] as number);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fisher–Yates shuffle in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Derive an independent child stream from this stream's seed and a label.
   * Consumes nothing and ignores the current position, so `fork('weather')`
   * always yields the same stream for a given seed.
   */
  fork(label: string): Rng {
    return new Rng((this.seed ^ Math.imul(hashString(label), 0x9e3779b1)) >>> 0);
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: RngState): void {
    [this.a, this.b, this.c, this.d] = state;
  }
}
