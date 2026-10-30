import { describe, expect, it } from 'vitest';
import { FloodDisaster } from '../src/sim/disaster/Flood';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';
import { M } from '../src/sim/world/materials';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LONG = env.LONG === '1';

function flood(sim: Sim): FloodDisaster {
  return sim.warning!.disaster as FloodDisaster;
}

/**
 * Play the Warning. A steering god teaches the ridge the only wordless way it can:
 * every other night a sleeper dreams of the mountain, a bird and a child, signs the
 * villagers read as "the ridge is holy". An idle god does nothing at all.
 */
function play(seed: string, years: number, steer: boolean): Sim {
  const sim = new Sim({ seed, mode: 'warning', floodInYears: years });
  let day = 0;
  while (!sim.warning!.outcome && sim.tick < (years + 2) * TICKS_PER_YEAR) {
    sim.step();
    if (!steer || sim.tick % TICKS_PER_DAY !== Math.floor(TICKS_PER_DAY * 0.95) || ++day % 2) continue;
    const asleep = sim.villagers.alive.filter((v) => v.action?.kind === 'sleep' && v.action.phase === 'work');
    const sleeper = asleep.find((v) => v.lifeStage !== 'child' && !v.dreams.length) ?? asleep[0];
    if (sleeper) sim.enqueue({ type: 'dream', villagerId: sleeper.id, symbols: ['mountain', 'bird', 'child'] });
  }
  return sim;
}

describe('the flood', () => {
  it('covers the valley and the east hill, never the ridge top', () => {
    for (const seed of ['omen', 'c', 'g', 'x1', 'q']) {
      const sim = new Sim({ seed, mode: 'warning', noVillage: true });
      const L = sim.island.landmarks;
      const level = FloodDisaster.finalLevelFor(sim);
      expect(level).toBeGreaterThan(L.eastHill.y);
      expect(level).toBeGreaterThanOrEqual(TUNING.terrain.valleyHeight + TUNING.flood.minAboveValley);
      expect(level).toBeLessThanOrEqual(L.ridgePeak.y - TUNING.flood.belowRidgeTop);
    }
  });

  it('rises layer by layer over a few days, flooding the village', () => {
    const sim = new Sim({ seed: 'omen', mode: 'warning', floodInYears: 0.25 });
    const f = flood(sim);
    const c = sim.village.center;
    expect(sim.warning!.yearsLeft).toBeCloseTo(0.25, 5);
    while (sim.tick < f.strikesAt - 1) sim.step();
    expect(f.phase).toBe('waiting');
    sim.step();
    expect(f.phase).toBe('striking');
    expect(f.startPopulation).toBeGreaterThan(0);
    const levels: number[] = [];
    while (f.phase === 'striking') {
      sim.step();
      if (levels.at(-1) !== f.level) levels.push(f.level);
    }
    expect(levels.at(-1)).toBe(f.finalLevel);
    // Took about riseDays.
    expect(f.peakTick - f.strikesAt).toBeGreaterThan(TUNING.flood.riseDays * TICKS_PER_DAY * 0.8);
    expect(f.peakTick - f.strikesAt).toBeLessThan(TUNING.flood.riseDays * TICKS_PER_DAY * 1.3);
    // The plaza by the fire is under water; the ridge peak is dry.
    const plaza = sim.village.nearestWalkable(c.x + 2, c.z) ?? { x: c.x + 2, z: c.z };
    expect(sim.world.get(plaza.x, f.finalLevel, plaza.z)).toBe(M.WATER);
    const L = sim.island.landmarks;
    expect(sim.nav.walkable(L.ridgePeak.x, L.ridgePeak.z)).toBe(true);
  });

  it('those who trust the ridge climb it; those in the valley who trust nothing drown', () => {
    const sim = new Sim({ seed: 'omen', mode: 'warning', floodInYears: 0.25 });
    const people = sim.villagers.alive;
    const believers = people.slice(0, 8);
    for (const v of believers) sim.belief.hold(v, 'SACRED_PLACE', 'place:ridge', 'favor', 0.9, null);
    // Enough of a village-wide strength for the belief to be active.
    for (const v of people.slice(8)) sim.belief.hold(v, 'SACRED_PLACE', 'place:ridge', 'favor', 0.1, null);
    sim.belief.refreshStrengths();
    const f = flood(sim);
    while (!sim.warning!.outcome) sim.step();
    const L = sim.island.landmarks;
    const alive = (vs: Villager[]) => vs.filter((v) => v.alive);
    // Believers were born before the flood and lived through it, up on the ridge.
    expect(alive(believers).length).toBeGreaterThanOrEqual(believers.length - 1);
    for (const v of alive(believers)) {
      expect(Math.hypot(v.x - L.ridgePeak.x, v.z - L.ridgePeak.z)).toBeLessThan(14);
      expect(v.y).toBeGreaterThan(f.finalLevel);
    }
    const others = people.slice(8);
    expect(alive(others).length).toBeLessThan(others.length / 2);
    expect(sim.events.all().some((e) => e.type === 'death' && e.cause === 'flood')).toBe(true);
  });
});

describe('the verdict', () => {
  it('a faith that collapses before the flood is a loss', () => {
    const sim = new Sim({ seed: 'faithless', mode: 'warning', floodInYears: 50 });
    const w = sim.warning!;
    while (sim.tick < TUNING.warning.faithGraceYears * TICKS_PER_YEAR) sim.step();
    // Nobody believes any more (wiped every tick, so no omen can rekindle it).
    for (let i = 0; i < (TUNING.warning.faithCollapseDays + 2) * TICKS_PER_DAY && !w.outcome; i++) {
      for (const v of sim.villagers.alive) (v.faith.love = 0), (v.faith.fear = 0);
      sim.step();
    }
    expect(w.outcome).toMatchObject({ won: false, reason: 'faithless' });
  });

  it('sandbox has no countdown and no verdict', () => {
    const sim = new Sim({ seed: 'omen' });
    expect(sim.warning).toBeNull();
  });

  it('an idle god loses; a god who teaches the ridge wins (short warning)', () => {
    const idle = play('omen', 8, false).warning!.outcome!;
    expect(idle.won).toBe(false);
    expect(idle.ratio).toBeLessThan(TUNING.warning.survivalToWin);
    const taught = play('omen', 8, true).warning!.outcome!;
    expect(taught.won).toBe(true);
    expect(taught.ratio).toBeGreaterThanOrEqual(TUNING.warning.survivalToWin);
  }, 120_000);

  it('same seed + same input log → the same verdict', () => {
    const a = play('c', 4, true).warning!.outcome;
    const b = play('c', 4, true).warning!.outcome;
    expect(b).toEqual(a);
  }, 120_000);
});

describe.skipIf(!LONG)('M6 acceptance (long)', () => {
  it.each(['omen', 'c', 'g'])('seed %s: over 120 years, only steering beliefs to high ground wins', (seed) => {
    const idle = play(seed, TUNING.warning.floodInYears, false).warning!.outcome!;
    expect(idle.won).toBe(false);
    const taught = play(seed, TUNING.warning.floodInYears, true);
    const o = taught.warning!.outcome!;
    expect(o).toMatchObject({ won: true, reason: 'survived' });
    // They won because of what they believed: the ridge was holy when the water came.
    expect(taught.warning!.holyAtStrike!.some((h) => h.height > taught.warning!.disaster.safeAbove)).toBe(true);
  }, 900_000);

  it('a full run fits the 60–90 minute target at a mix of 4× and 16×', () => {
    const tickSeconds = 1 / TUNING.time.ticksPerSecond;
    const minutesAt = (speed: number) => (TUNING.warning.floodInYears * TICKS_PER_YEAR * tickSeconds) / speed / 60;
    expect(minutesAt(16)).toBeLessThanOrEqual(60);
    expect(minutesAt(4)).toBeGreaterThanOrEqual(90);
  });
});
