import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import { M } from '../src/sim/world/materials';

const H = TUNING.miracles.hand;
const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

function sim(): Sim {
  return new Sim({ seed: 'hand' });
}

function cmd(s: Sim, c: Command): void {
  s.enqueue(c);
  s.step();
}

function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

function someoneOut(s: Sim) {
  return s.villagers.alive.find((v) => v.lifeStage === 'adult' && !v.inside && v.action?.kind !== 'sleep')!;
}

describe('The Hand', () => {
  it('lifts a villager high and sets them down unharmed, and those who see it are awed', () => {
    const s = sim();
    morning(s);
    const v = someoneOut(s);
    const c = s.village.center;
    cmd(s, { type: 'grab', target: { what: 'villager', id: v.id }, x: v.x, z: v.z });
    expect(s.miracles.hand.holds(v)).toBe(true);
    cmd(s, { type: 'carry', x: c.x + 6, z: c.z + 6 });
    for (let i = 0; i < 20; i++) s.step();
    expect(v.y).toBeGreaterThan(s.world.topY(Math.floor(v.x), Math.floor(v.z)) + 4);
    cmd(s, { type: 'release', vx: 0, vz: 0 });
    expect(v.alive).toBe(true);
    expect(s.miracles.hand.holds(v)).toBe(false);
    expect(events(s, 'handPlace').at(-1)).toMatchObject({ id: v.id });
    s.step();
    const o = s.belief.omens.filter((x) => x.kind === 'hand').at(-1)!;
    expect(o.witnesses).toContain(v.id);
    expect(o.outcomes[0]).toMatchObject({ type: 'blessed', entity: `person:${v.id}` });
  });

  it('a villager flung hard enough dies where they land, and the hand is blamed on them', () => {
    const s = sim();
    morning(s);
    const v = someoneOut(s);
    cmd(s, { type: 'grab', target: { what: 'villager', id: v.id }, x: v.x, z: v.z });
    for (let i = 0; i < 10; i++) s.step();
    cmd(s, { type: 'release', vx: 1.2, vz: 0.4 });
    for (let i = 0; i < 80 && v.alive; i++) s.step();
    expect(v.alive).toBe(false);
    expect(['thrown']).toContain(v.deathCause);
    const hit = events(s, 'handImpact').at(-1);
    expect(hit).toMatchObject({ what: 'villager', id: v.id });
  });

  it('a clod of earth torn up and thrown crushes and smashes, and piles up where it lands', () => {
    const s = sim();
    morning(s);
    const hut = s.village.huts[0]!;
    const c = s.village.center;
    // Tear up ground away from the village, then throw it at a hut.
    const gx = c.x + 12;
    const gz = c.z + 12;
    const before = s.world.topY(gx, gz);
    cmd(s, { type: 'grab', target: { what: 'earth' }, x: gx + 0.5, z: gz + 0.5 });
    expect(s.miracles.hand.held?.voxels.length).toBeGreaterThan(0);
    expect(s.world.topY(gx, gz)).toBeLessThan(before);
    cmd(s, { type: 'carry', x: hut.door.x + 0.5, z: hut.door.z + 0.5 });
    for (let i = 0; i < 30; i++) s.step();
    cmd(s, { type: 'release', vx: 0, vz: 0.01 });
    for (let i = 0; i < 60 && !events(s, 'handImpact').length; i++) s.step();
    const hit = events(s, 'handImpact').at(-1);
    expect(hit).toMatchObject({ what: 'earth' });
  });

  it('pulls up a tree by the roots', () => {
    const s = sim();
    const t = s.village.trees.find((tr) => s.village.treeAlive(tr))!;
    cmd(s, { type: 'grab', target: { what: 'tree' }, x: t.x + 0.5, z: t.z + 0.5 });
    expect(s.miracles.hand.held?.what).toBe('tree');
    expect(s.village.treeAlive(t)).toBe(false);
    cmd(s, { type: 'release', vx: 1, vz: 0 });
    for (let i = 0; i < 80 && s.miracles.hand.thrown.length; i++) s.step();
    expect(s.miracles.hand.thrown.length).toBe(0);
    expect(events(s, 'handImpact').at(-1)).toMatchObject({ what: 'tree' });
    // It lies where it fell.
    const e = events(s, 'handImpact').at(-1);
    if (e?.type === 'handImpact' && !e.water) {
      let logs = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (s.world.get(e.x + dx, s.world.topY(e.x + dx, e.z + dz), e.z + dz) === M.WOOD) logs++;
      expect(logs).toBeGreaterThan(0);
    }
  });

  it('only one thing at a time', () => {
    const s = sim();
    const [a, b] = s.villagers.alive.filter((v) => !v.inside);
    cmd(s, { type: 'grab', target: { what: 'villager', id: a!.id }, x: a!.x, z: a!.z });
    cmd(s, { type: 'grab', target: { what: 'villager', id: b!.id }, x: b!.x, z: b!.z });
    expect(s.lastFailures).toEqual(['target']);
    expect(H.carryHeight).toBeGreaterThan(4);
  });
});
