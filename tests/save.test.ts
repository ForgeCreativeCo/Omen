import { describe, expect, it } from 'vitest';
import { decodeGraph, encodeGraph, readHeader, restoreGame, saveGame } from '../src/sim/save';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

/** Everything the sim holds, as one comparable string. */
const fingerprint = (sim: Sim) => JSON.stringify(encodeGraph(sim));

describe('save / load', () => {
  it('round-trips Maps, Sets, typed arrays, shared references and odd numbers', () => {
    const shared = { n: 1 };
    const src = { a: [shared, shared], m: new Map([['k', shared]]), s: new Set([1, 2]), t: new Int16Array([5, 5, 5, -1, 7]), inf: Infinity, u: undefined, f: () => 1 };
    const out = decodeGraph(JSON.parse(JSON.stringify(encodeGraph(src))), {}) as typeof src;
    expect(out.a[0]).toBe(out.a[1]);
    expect(out.m.get('k')).toBe(out.a[0]);
    expect([...out.s]).toEqual([1, 2]);
    expect(out.t).toBeInstanceOf(Int16Array);
    expect([...out.t]).toEqual([5, 5, 5, -1, 7]);
    expect(out.inf).toBe(Infinity);
    expect('u' in out && out.u === undefined).toBe(true);
    expect(out.f).toBeUndefined();
  });

  it('a loaded game carries on exactly as the original would have', () => {
    const play = (sim: Sim, from: number, to: number) => {
      const hill = sim.island.landmarks.eastHill;
      for (let t = from; t < to; t++) {
        if (t % (TICKS_PER_DAY * 3) === 80) {
          sim.miracles.grace = Math.max(sim.miracles.grace, 60);
          sim.enqueue({ type: 'cast', miracle: t % 2 ? 'lightning' : 'bloom', x: hill.x, z: hill.z });
        }
        sim.step();
      }
    };
    const a = new Sim({ seed: 'save', mode: 'warning', floodInYears: 3 });
    play(a, 0, TICKS_PER_YEAR);
    const text = saveGame(a, { seed: 'save', mode: 'warning', floodInYears: 3, label: 'Year 2' });
    expect(readHeader(text)).toMatchObject({ seed: 'save', mode: 'warning', tick: a.tick });

    const b = new Sim({ seed: 'save', mode: 'warning', floodInYears: 3 });
    restoreGame(b, text);
    expect(b.tick).toBe(a.tick);
    const fa = fingerprint(a);
    const fb = fingerprint(b);
    if (fa !== fb) throw new Error(firstDiff(fa, fb));

    // Through the flood and the verdict, both stay identical.
    play(a, a.tick, TICKS_PER_YEAR * 3 + TICKS_PER_DAY * 6);
    play(b, b.tick, TICKS_PER_YEAR * 3 + TICKS_PER_DAY * 6);
    expect(b.warning!.outcome).toEqual(a.warning!.outcome);
    expect(b.myth.book.verses().map((v) => v.text)).toEqual(a.myth.book.verses().map((v) => v.text));
    expect(fingerprint(b)).toBe(fingerprint(a));
  }, 120_000);

  it('the wiring survives: world edits still reach the nav grid, hooks still see live beliefs', () => {
    const a = new Sim({ seed: 'wired' });
    run(a, TICKS_PER_DAY * 2);
    const b = new Sim({ seed: 'wired' });
    restoreGame(b, saveGame(a, { seed: 'wired', mode: 'sandbox', label: '' }));
    const c = b.village.center;
    const before = b.nav.at(c.x + 6, c.z + 6);
    b.world.set(c.x + 6, before + 1, c.z + 6, 3);
    expect(b.nav.at(c.x + 6, c.z + 6)).toBe(before + 1);
    b.belief.hold(b.villagers.alive[0]!, 'CURSED_PLACE', 'place:eastHill', 'wrath', 1, null);
    for (const v of b.villagers.alive) b.belief.hold(v, 'CURSED_PLACE', 'place:eastHill', 'wrath', 1, null);
    b.belief.refreshStrengths();
    run(b, TICKS_PER_DAY);
    const hill = b.island.landmarks.eastHill;
    expect(b.village.forbidden(hill.x, hill.z)).toBe(true);
  });

  it('a save is small enough for localStorage', () => {
    const sim = new Sim({ seed: 'size' });
    run(sim, TICKS_PER_YEAR * 2);
    const text = saveGame(sim, { seed: 'size', mode: 'sandbox', label: '' });
    expect(text.length).toBeLessThan(2_500_000);
  });
});

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: …${a.slice(Math.max(0, i - 300), i + 80)}\n vs …${b.slice(Math.max(0, i - 300), i + 80)}`;
}
