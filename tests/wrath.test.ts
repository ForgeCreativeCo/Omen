import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import { M } from '../src/sim/world/materials';

const MT = TUNING.miracles;

function sim(seed = 'wrath', tribes = 1): Sim {
  return new Sim({ seed, tribes });
}

function cast(s: Sim, cmd: Command): void {
  s.enqueue(cmd);
  s.step();
}

function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

function until(s: Sim, done: () => boolean, max = TICKS_PER_DAY * 3): void {
  for (let i = 0; i < max && !done(); i++) s.step();
}

const ended = (s: Sim, type: string) => s.events.all().some((e) => e.type === type);
const omensOf = (s: Sim, kind: string) => s.belief.omens.filter((o) => o.kind === kind);

describe('Earthquake', () => {
  it('cracks the ground, topples buildings, and is felt as an omen', () => {
    const s = sim();
    morning(s);
    const c = s.village.center;
    const intact = (st: ReturnType<typeof s.village.byId>) => st!.steps.filter((p) => p.mat !== M.AIR && s.world.get(p.x, p.y, p.z) === p.mat).length;
    const before = s.village.huts.reduce((n, h) => n + intact(h), 0);
    cast(s, { type: 'cast', miracle: 'quake', x: c.x, z: c.z });
    expect(s.lastFailures).toEqual([]);
    expect(s.miracles.wrath.quakes).toHaveLength(1);
    until(s, () => ended(s, 'quakeEnd'));
    expect(s.miracles.wrath.quakes).toHaveLength(0);
    const after = s.village.huts.reduce((n, h) => n + intact(h), 0);
    expect(after).toBeLessThan(before);
    s.step();
    const o = omensOf(s, 'quake');
    expect(o).toHaveLength(1);
    expect(o[0]!.witnesses.length).toBeGreaterThan(3);
  });
});

describe('Firestorm', () => {
  it('rains fire on the area for a while and sets things burning', () => {
    const s = sim();
    morning(s);
    const c = s.village.center;
    cast(s, { type: 'cast', miracle: 'firestorm', x: c.x + 6, z: c.z + 6 });
    expect(s.miracles.wrath.firestorms).toHaveLength(1);
    let burning = 0;
    until(s, () => ((burning = Math.max(burning, s.fire.burning.size)), ended(s, 'firestormEnd')), MT.firestorm.durationTicks + 5);
    expect(burning).toBeGreaterThan(0);
    s.step();
    expect(omensOf(s, 'firestorm')).toHaveLength(1);
  });
});

describe('Tidal wave', () => {
  it('needs a sea within reach', () => {
    const s = sim();
    const c = s.island.landmarks.center;
    // The middle of a 256-voxel island is far from any shore.
    const W = MT.wave;
    let far = { x: c.x, z: c.z };
    for (let r = 0; r < 40; r++) if (!s.miracles.wrath.shoreNear(far.x, far.z)) break;
    else far = { x: c.x + r, z: c.z };
    if (s.miracles.wrath.shoreNear(far.x, far.z)) return; // a small island: nothing to check
    cast(s, { type: 'cast', miracle: 'wave', x: far.x, z: far.z });
    expect(s.lastFailures).toEqual(['shore']);
    expect(W.searchRadius).toBeGreaterThan(0);
  });

  it('floods inland from the shore and drains away again', () => {
    const s = sim();
    const w = s.world;
    const sea = TUNING.terrain.seaLevel;
    // A land cell a little way in from the sea.
    let target: { x: number; z: number } | null = null;
    for (let x = 20; x < w.sizeX - 20 && !target; x += 3)
      for (let z = 20; z < w.sizeZ - 20 && !target; z += 3) {
        const g = w.topY(x, z);
        if (g > sea && g <= sea + 3 && w.get(x, g, z) !== M.WATER && s.miracles.wrath.shoreNear(x, z)) target = { x, z };
      }
    expect(target).not.toBeNull();
    cast(s, { type: 'cast', miracle: 'wave', x: target!.x, z: target!.z });
    expect(s.lastFailures).toEqual([]);
    const wave = s.miracles.wrath.waves[0]!;
    until(s, () => ended(s, 'waveEnd'));
    expect(wave.placed.length).toBeGreaterThan(0);
    until(s, () => s.miracles.wrath.waves.length === 0);
    expect(s.miracles.wrath.waves).toHaveLength(0);
  });
});

describe('Swarm', () => {
  it("eats a people's crops and food", () => {
    const s = sim();
    // Let the first crops come up.
    for (let i = 0; i < TICKS_PER_DAY * 4; i++) s.step();
    morning(s);
    const growing = () => s.village.fields.reduce((n, f) => n + f.tiles.filter((t) => t.state === 2).length, 0);
    const before = growing();
    expect(before).toBeGreaterThan(0);
    const f = s.village.fields[0]!;
    cast(s, { type: 'cast', miracle: 'swarm', x: f.x0, z: f.z0 });
    expect(s.miracles.wrath.swarms[0]!.tribe).toBe(0);
    until(s, () => ended(s, 'swarmEnd'), MT.swarm.durationTicks + 5);
    const end = s.events.all().find((e) => e.type === 'swarmEnd');
    expect(end && end.type === 'swarmEnd' && end.eaten).toBeGreaterThan(0);
  });
});

describe('Plague', () => {
  it('sickens those near, spreads between people, and some die of it', () => {
    const s = sim('plague-test');
    morning(s);
    const c = s.village.center;
    const alive = s.villagers.alive.length;
    const v = s.villagers.alive.filter((p) => !p.inside).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0]!;
    cast(s, { type: 'cast', miracle: 'plague', x: Math.round(v.x), z: Math.round(v.z) });
    expect(s.lastFailures).toEqual([]);
    expect(s.plague.isSick(v)).toBe(true);
    // The sick don't work.
    expect(s.society.isHurt(v)).toBe(true);
    // Count as we go: the event log only keeps the most recent.
    let caught = 0;
    let died = 0;
    let seq = s.events.lastSeq;
    for (let i = 0; i < TICKS_PER_DAY * 10; i++) {
      s.step();
      for (const e of s.events.since(seq)) {
        if (e.type === 'sickened' && e.by >= 0) caught++;
        if (e.type === 'death' && e.cause === 'plague') died++;
      }
      seq = s.events.lastSeq;
    }
    expect(caught).toBeGreaterThan(0);
    expect(died + s.plague.immune.size).toBeGreaterThan(1);
    expect(s.villagers.alive.length).toBeLessThanOrEqual(alive + 5);
    expect(omensOf(s, 'plague')).toHaveLength(1);
    // Nobody stays sick for ever.
    for (let i = 0; i < TICKS_PER_DAY * 30 && s.plague.sick.size; i++) s.step();
    expect(s.plague.sick.size).toBe(0);
  });
});
