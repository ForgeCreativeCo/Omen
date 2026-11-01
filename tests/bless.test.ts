import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { blessed } from '../src/sim/world/structures';

function days(s: Sim, n: number): void {
  for (let i = 0; i < TICKS_PER_DAY * n; i++) s.step();
}

function setup(): Sim {
  const s = new Sim({ seed: 'omen', tribes: 1, mode: 'sandbox' });
  days(s, 4);
  s.miracles.unlimited = true;
  return s;
}

const bless = (s: Sim, x: number, z: number) => {
  s.enqueue({ type: 'blessPlace', x, z });
  s.step();
};

describe('Bless on fields and homes', () => {
  it('a blessed field grows faster, never withers, and blight and locusts pass it by', () => {
    const s = setup();
    const [a, b] = s.village.fields.filter((f) => f.tiles.length);
    expect(a && b).toBeTruthy();
    bless(s, a!.x0, a!.z0);
    expect(s.lastFailures).toEqual([]);
    expect(blessed(a!, s.tick)).toBe(true);
    expect(blessed(b!, s.tick)).toBe(false);
    expect(s.events.all().some((e) => e.type === 'blessPlace' && e.structureId === a!.id && e.kind === 'field')).toBe(true);
    // Sow both alike and let them grow a little.
    for (const f of [a!, b!])
      for (const t of f.tiles) {
        if (t.state === 0) s.village.till(t);
        s.village.plant(t);
      }
    for (const f of [a!, b!]) f.moisture = 0;
    for (let i = 0; i < 60; i++) s.step();
    const growth = (f: typeof a) => f!.tiles.reduce((n, t) => n + (t.state === 2 ? t.progress : 0), 0);
    expect(growth(a)).toBeGreaterThan(growth(b));
    // Blight over both: only the unblessed one withers.
    const growingA = a!.tiles.filter((t) => t.state === 2).length;
    s.enqueue({ type: 'cast', miracle: 'blight', x: a!.x0 + 2, z: a!.z0 + 2 });
    s.enqueue({ type: 'cast', miracle: 'blight', x: b!.x0 + 2, z: b!.z0 + 2 });
    s.step();
    expect(a!.tiles.filter((t) => t.state === 2).length).toBe(growingA);
    expect(b!.tiles.filter((t) => t.state === 2).length).toBe(0);
  });

  it('a blessed field yields more at harvest', () => {
    const s = setup();
    const f = s.village.fields.find((x) => x.tiles.length)!;
    const t = f.tiles[0]!;
    s.village.plant(t, 1);
    const plain = s.village.harvest(t);
    s.village.plant(t, 1);
    expect(s.village.harvest(t, true)).toBeCloseTo(plain * 1.5);
  });

  it('those in a blessed home wake rested; the blessing lasts a year', () => {
    const s = setup();
    const home = s.village.structures.find((h) => h.kind === 'hut' && h.complete && h.residents.length)!;
    expect(home).toBeDefined();
    bless(s, home.x0, home.z0);
    expect(blessed(home, s.tick)).toBe(true);
    for (const id of home.residents) s.villagers.byId(id)!.needs.energy = 0.1;
    days(s, 1);
    for (const id of home.residents) {
      const v = s.villagers.byId(id);
      if (v?.alive) expect(v.needs.energy).toBeGreaterThan(0.5);
    }
    // Those who saw it read it as a blessing.
    expect(s.belief.omens.some((o) => o.kind === 'blessHome')).toBe(true);
    for (let i = 0; i < TICKS_PER_YEAR; i++) s.step();
    expect(blessed(home, s.tick)).toBe(false);
  });

  it('bare ground is not a field or a home', () => {
    const s = setup();
    const c = s.village.center;
    for (let d = 20; d < 60; d++) {
      const x = c.x + d;
      if (!s.structureAt(x, c.z)) {
        bless(s, x, c.z);
        expect(s.lastFailures.length).toBeGreaterThan(0);
        return;
      }
    }
  });
});
