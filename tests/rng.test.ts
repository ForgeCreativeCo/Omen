import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';

const take = (r: Rng, n: number) => Array.from({ length: n }, () => r.next());

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    expect(take(new Rng('omen'), 50)).toEqual(take(new Rng('omen'), 50));
    expect(take(new Rng(42), 50)).toEqual(take(new Rng(42), 50));
  });

  it('differs across seeds', () => {
    expect(take(new Rng(1), 10)).not.toEqual(take(new Rng(2), 10));
  });

  it('stays in range and is roughly uniform', () => {
    const r = new Rng(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 2000)).toBeLessThan(250);
  });

  it('int() is inclusive on both ends', () => {
    const r = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('round-trips state', () => {
    const r = new Rng('save');
    take(r, 17);
    const copy = Rng.fromState(r.getState(), r.seed);
    expect(take(copy, 20)).toEqual(take(r, 20));
  });

  it('forks are stable regardless of parent usage', () => {
    const a = new Rng('world');
    const b = new Rng('world');
    take(b, 100);
    expect(take(a.fork('weather'), 10)).toEqual(take(b.fork('weather'), 10));
    expect(take(a.fork('weather'), 10)).not.toEqual(take(a.fork('fire'), 10));
  });

  it('weightedIndex respects weights', () => {
    const r = new Rng(9);
    const counts = [0, 0, 0];
    for (let i = 0; i < 9000; i++) counts[r.weightedIndex([1, 0, 2])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(1.7);
    expect(r.weightedIndex([0, 0])).toBe(-1);
  });
});
