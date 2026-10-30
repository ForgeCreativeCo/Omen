import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import { M } from '../src/sim/world/materials';

const MT = TUNING.miracles;

function sim(seed = 'miracles'): Sim {
  const s = new Sim({ seed });
  s.miracles.grace = 500;
  return s;
}

function cast(s: Sim, cmd: Command): void {
  s.enqueue(cmd);
  s.step();
}

/** Step until the day fraction is in [from, to). */
function until(s: Sim, from: number, to: number): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= from && f < to) return;
    s.step();
  }
}

function groundAt(s: Sim, x: number, z: number): number {
  return s.miracles.groundY(x, z);
}

describe('grace and cooldowns', () => {
  it('casting costs grace; you cannot cast what you cannot afford', () => {
    const s = new Sim({ seed: 'grace' });
    s.miracles.grace = MT.lightning.cost + 1;
    const c = s.village.center;
    cast(s, { type: 'cast', miracle: 'lightning', x: c.x + 8, z: c.z });
    expect(s.lastFailures).toEqual([]);
    expect(s.miracles.grace).toBeLessThan(2);
    s.miracles.readyAt.lightning = 0;
    cast(s, { type: 'cast', miracle: 'lightning', x: c.x + 8, z: c.z });
    expect(s.lastFailures).toEqual(['grace']);
  });

  it('cooldowns block recasting until they run out', () => {
    const s = sim();
    const c = s.village.center;
    cast(s, { type: 'cast', miracle: 'bloom', x: c.x, z: c.z });
    cast(s, { type: 'cast', miracle: 'bloom', x: c.x, z: c.z });
    expect(s.lastFailures).toEqual(['cooldown']);
    for (let i = 0; i < MT.bloom.cooldown; i++) s.step();
    cast(s, { type: 'cast', miracle: 'bloom', x: c.x, z: c.z });
    expect(s.lastFailures).toEqual([]);
  });

  it('grace regenerates toward a cap that grows with believers', () => {
    const s = new Sim({ seed: 'regen' });
    s.miracles.grace = 0;
    for (let i = 0; i < TICKS_PER_DAY; i++) s.step();
    expect(s.miracles.grace).toBeGreaterThan(TUNING.grace.regenBasePerDay * 0.9);
    const cap0 = s.miracles.cap;
    for (const v of s.villagers.alive) v.faith.love = 0.6;
    expect(s.miracles.cap).toBeGreaterThanOrEqual(cap0);
    expect(s.miracles.regenPerDay).toBeGreaterThan(TUNING.grace.regenBasePerDay);
  });
});

describe('miracles change the world', () => {
  it('rain waters fields under the cloud and puts out fires', () => {
    const s = sim();
    const f = s.village.fields[0]!;
    f.moisture = 0;
    f.nearWater = false;
    const fx = f.x0 + 2;
    const fz = f.z0 + 2;
    // A small fire next to the field.
    const tx = f.x0 - 3;
    const tz = f.z0;
    const ty = s.world.topY(tx, tz);
    s.world.set(tx, ty + 1, tz, M.PLANK);
    s.fire.ignite(tx, ty + 1, tz);
    cast(s, { type: 'cast', miracle: 'rain', x: fx, z: fz });
    for (let i = 0; i < 30; i++) s.step();
    expect(f.moisture).toBeGreaterThan(0.3);
    expect(s.fire.burning.size).toBe(0);
    expect(s.miracles.clouds.length).toBe(1);
    // The cloud can be dragged.
    const cloud = s.miracles.clouds[0]!;
    cast(s, { type: 'moveCloud', cloudId: cloud.id, x: fx + 10, z: fz });
    expect(cloud.x).toBe(fx + 10);
  });

  it('lightning lands near the aim, scorches the ground, and kills whoever it hits', () => {
    const s = sim('bolt');
    const c = s.village.center;
    const victim = s.villagers.alive[0]!;
    const misses: number[] = [];
    for (let i = 0; i < 12; i++) {
      s.miracles.readyAt.lightning = 0;
      const ax = c.x + 10 + (i % 4) * 3;
      const az = c.z + 6;
      cast(s, { type: 'cast', miracle: 'lightning', x: ax, z: az });
      const e = [...s.events.all()].reverse().find((ev) => ev.type === 'lightning')!;
      if (e.type === 'lightning') {
        expect(e.divine).toBe(true);
        misses.push(Math.hypot(e.x - ax, e.z - az));
      }
    }
    // Usually close, never absurdly far, and not always dead on.
    expect(Math.max(...misses)).toBeLessThan(MT.lightning.wildMissDistance + MT.lightning.spread * 4 + 1);
    expect(misses.some((d) => d >= 1)).toBe(true);

    // Strike the victim directly (bypassing aim error) to check the outcome.
    const vx = Math.floor(victim.x);
    const vz = Math.floor(victim.z);
    victim.inside = false;
    s.strikeLightning(vx, vz, true, vx, vz);
    expect(victim.alive).toBe(false);
    expect(victim.deathCause).toBe('lightning');
  });

  it('shape earth raises and lowers ground, and shakes buildings it touches', () => {
    const s = sim('shape');
    const c = s.village.center;
    // Find open ground away from buildings.
    let px = c.x + 14;
    let pz = c.z;
    for (let i = 0; i < 40 && s.village.structureAt(px, pz); i++) px++;
    const before = groundAt(s, px, pz);
    for (let i = 0; i < 3; i++) {
      cast(s, { type: 'stroke', x: px, z: pz, raise: true });
      for (let k = 0; k < MT.shapeEarth.strokeInterval; k++) s.step();
    }
    expect(groundAt(s, px, pz)).toBe(before + 3);
    expect(s.nav.at(px, pz)).toBe(before + 3);
    for (let i = 0; i < 5; i++) {
      cast(s, { type: 'stroke', x: px, z: pz, raise: false });
      for (let k = 0; k < MT.shapeEarth.strokeInterval; k++) s.step();
    }
    expect(groundAt(s, px, pz)).toBe(before - 2);

    // Too-fast strokes are ignored rather than double-charged.
    cast(s, { type: 'stroke', x: px, z: pz, raise: true });
    cast(s, { type: 'stroke', x: px, z: pz, raise: true });
    expect(s.lastFailures).toEqual(['interval']);

    // Painting over a hut shakes blocks loose.
    const hut = s.village.huts[0]!;
    const intact = hut.steps.filter((st) => st.mat !== M.AIR && s.world.get(st.x, st.y, st.z) === st.mat).length;
    for (let i = 0; i < 4; i++) {
      cast(s, { type: 'stroke', x: hut.x0 + 2, z: hut.z0 + 2, raise: true });
      for (let k = 0; k < MT.shapeEarth.strokeInterval; k++) s.step();
    }
    const after = hut.steps.filter((st) => st.mat !== M.AIR && s.world.get(st.x, st.y, st.z) === st.mat).length;
    expect(after).toBeLessThan(intact);
  });

  it('bloom ripens crops and opens flowers', () => {
    const s = sim('bloom');
    const f = s.village.fields[0]!;
    for (const t of f.tiles) if (t.state === 2) t.progress = 0;
    cast(s, { type: 'cast', miracle: 'bloom', x: f.x0 + 2, z: f.z0 + 2 });
    const ripe = f.tiles.filter((t) => t.state === 2 && t.progress >= 1).length;
    expect(ripe).toBeGreaterThan(f.tiles.length * 0.7);
    const e = [...s.events.all()].reverse().find((ev) => ev.type === 'bloom');
    expect(e && e.type === 'bloom' && e.crops > 0).toBe(true);
  });

  it('dream only works at night, on someone asleep, with three symbols', () => {
    const s = sim('dream');
    until(s, 0.4, 0.5);
    const v = s.villagers.alive.find((p) => p.lifeStage === 'adult')!;
    cast(s, { type: 'dream', villagerId: v.id, symbols: ['mountain', 'child', 'house'] });
    expect(s.lastFailures).toEqual(['night']);
    until(s, 0.02, 0.1);
    const sleeper = s.villagers.alive.find((p) => p.action?.kind === 'sleep' && p.action.phase === 'work')!;
    expect(sleeper).toBeDefined();
    cast(s, { type: 'dream', villagerId: sleeper.id, symbols: ['mountain', 'child'] as never });
    expect(s.lastFailures).toEqual(['target']);
    cast(s, { type: 'dream', villagerId: sleeper.id, symbols: ['mountain', 'child', 'house'] });
    expect(s.lastFailures).toEqual([]);
    expect(sleeper.dreams.at(-1)?.symbols).toEqual(['mountain', 'child', 'house']);
    cast(s, { type: 'dream', villagerId: sleeper.id, symbols: ['water', 'boat', 'sun'] });
    expect(s.lastFailures).toEqual(['cooldown']);
  });
});

describe('determinism', () => {
  it('the same seed and input log reproduce the same world', () => {
    const run = () => {
      const s = sim('replay');
      const c = s.village.center;
      const script: [number, Command][] = [
        [10, { type: 'cast', miracle: 'lightning', x: c.x + 9, z: c.z + 3 }],
        [40, { type: 'cast', miracle: 'rain', x: c.x, z: c.z }],
        [45, { type: 'stroke', x: c.x + 12, z: c.z - 5, raise: true }],
        [60, { type: 'cast', miracle: 'bloom', x: c.x - 6, z: c.z }],
      ];
      for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
        for (const [at, cmd] of script) if (at === t) s.enqueue(cmd);
        s.step();
      }
      let h = 0;
      for (let y = 0; y < 48; y++)
        for (let z = c.z - 20; z < c.z + 20; z++)
          for (let x = c.x - 20; x < c.x + 20; x++) h = (Math.imul(h, 31) + s.world.get(x, y, z)) >>> 0;
      return JSON.stringify({ h, log: s.inputLog, grace: s.miracles.grace.toFixed(4), pop: s.villagers.alive.map((v) => [v.id, v.x.toFixed(3)]) });
    };
    expect(run()).toBe(run());
  });
});
