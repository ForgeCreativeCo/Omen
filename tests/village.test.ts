import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { Pathfinder } from '../src/sim/villagers/pathfinding';
import { M } from '../src/sim/world/materials';
import { NavGrid } from '../src/sim/world/nav';
import { VoxelWorld } from '../src/sim/world/VoxelWorld';

// Long acceptance run (SPEC M2: 30 real minutes at 16× ≈ 120 sim years). Opt in: LONG=1 npm test
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LONG = env.LONG === '1';

function flatWorld(): VoxelWorld {
  const w = new VoxelWorld(32, 16, 32, 16);
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) w.set(x, 0, z, M.GRASS);
  return w;
}

function snapshot(sim: Sim): string {
  const people = sim.villagers.all.map((v) => [v.id, v.alive, v.x.toFixed(3), v.z.toFixed(3), v.role, v.action?.kind ?? '-']);
  return JSON.stringify({ tick: sim.tick, people, store: sim.village.store, n: sim.village.structures.length });
}

function runYears(sim: Sim, years: number, onYear?: (y: number) => void): void {
  for (let y = 1; y <= years; y++) {
    for (let i = 0; i < TICKS_PER_YEAR; i++) sim.step();
    onYear?.(y);
  }
}

describe('nav + pathfinding', () => {
  it('walls block, steps of one are fine, and paths go around obstacles', () => {
    const w = flatWorld();
    const nav = new NavGrid(w);
    for (let z = 0; z < 30; z++) w.set(10, 1, z, M.STONE), w.set(10, 2, z, M.STONE);
    expect(nav.canStep(9, 5, 10, 5)).toBe(false); // wall top is two voxels up
    w.set(5, 1, 5, M.DIRT); // a one-voxel step
    expect(nav.at(5, 5)).toBe(1);
    expect(nav.canStep(4, 5, 5, 5)).toBe(true);
    const pf = new Pathfinder(nav);
    const p = pf.find(2, 2, 20, 2, { maxExpand: 5000 })!;
    expect(p).not.toBeNull();
    const zs = p.map((c) => (c / 32) | 0);
    expect(Math.max(...zs)).toBeGreaterThanOrEqual(30); // went round the end of the wall
  });

  it('returns null when the goal is walled off', () => {
    const w = flatWorld();
    const nav = new NavGrid(w);
    for (let z = 0; z < 32; z++) w.set(10, 1, z, M.STONE), w.set(10, 2, z, M.STONE);
    expect(new Pathfinder(nav).find(2, 2, 20, 2, { maxExpand: 5000 })).toBeNull();
  });

  it('nav updates when the world changes', () => {
    const w = flatWorld();
    const nav = new NavGrid(w);
    expect(nav.walkable(3, 3)).toBe(true);
    w.set(3, 1, 3, M.WOOD);
    expect(nav.walkable(3, 3)).toBe(false);
    w.set(3, 1, 3, M.AIR);
    expect(nav.walkable(3, 3)).toBe(true);
  });
});

describe('village', () => {
  it('founds a village of 20 with homes, fields and a fire pit', () => {
    const sim = new Sim({ seed: 'found' });
    expect(sim.villagers.alive.length).toBe(20);
    const kinds = sim.village.structures.map((s) => s.kind);
    expect(kinds).toContain('firePit');
    expect(kinds.filter((k) => k === 'hut').length).toBeGreaterThanOrEqual(4);
    expect(kinds.filter((k) => k === 'field').length).toBeGreaterThanOrEqual(3);
    expect(sim.villagers.alive.every((v) => v.homeId >= 0)).toBe(true);
    expect(sim.villagers.alive.filter((v) => v.role === 'priest').length).toBe(1);
  });

  it('follows the daily schedule: asleep at night, working by day, gathered at dusk', () => {
    const sim = new Sim({ seed: 'schedule' });
    const count = (pred: (k: string) => boolean) => sim.villagers.alive.filter((v) => pred(v.action?.kind ?? '')).length;
    const at = (frac: number) => {
      while (Math.abs(sim.calendar.dayFraction - frac) > 0.003) sim.step();
    };
    sim.step();
    at(0.5);
    const workers = count((k) => ['farm', 'chop', 'quarry', 'forage', 'build'].includes(k));
    at(0.82);
    const gathered = count((k) => k === 'gathering' || k === 'eat'); // supper at the fire counts
    at(0.05);
    const asleep = count((k) => k === 'sleep');
    const n = sim.villagers.alive.length;
    expect(workers).toBeGreaterThan(n * 0.3);
    expect(gathered).toBeGreaterThan(n * 0.5);
    expect(asleep).toBeGreaterThan(n * 0.8);
  });

  it('is deterministic for a seed', () => {
    const a = new Sim({ seed: 'det' });
    const b = new Sim({ seed: 'det' });
    for (let i = 0; i < TICKS_PER_DAY * 15; i++) a.step(), b.step();
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('weather happens on its own: rain, and over time storms and lightning', () => {
    const sim = new Sim({ seed: 'weather' });
    runYears(sim, 3);
    const types = new Set(sim.events.all().map((e) => e.type));
    expect(types.has('rainStart')).toBe(true);
    expect(types.has('lightning')).toBe(true);
  });

  it.each(['omen', 'b'])('seed %s survives and grows for 30 years', (seed) => {
    const sim = new Sim({ seed });
    let min = Infinity;
    runYears(sim, 30, () => (min = Math.min(min, sim.villagers.alive.length)));
    expect(min).toBeGreaterThan(10);
    expect(sim.villagers.alive.length).toBeGreaterThan(22);
    expect(sim.village.huts.length).toBeGreaterThan(5);
    expect(sim.events.all().some((e) => e.type === 'birth')).toBe(true);
  }, 120000);

  it.skipIf(!LONG).each(['omen', 'c', 'g'])('acceptance: seed %s survives and grows for 120 years untouched', (seed) => {
    const sim = new Sim({ seed });
    let min = Infinity;
    runYears(sim, 120, () => (min = Math.min(min, sim.villagers.alive.length)));
    expect(min).toBeGreaterThan(10);
    expect(sim.villagers.alive.length).toBeGreaterThan(30);
  }, 600000);
});
