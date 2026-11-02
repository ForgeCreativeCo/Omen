import { findSettlement } from './exodus';
import { TICKS_PER_YEAR } from './time';
import { TUNING } from './tuning';
import { M } from './world/materials';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import type { Tribe } from './tribe';
import type { Villager } from './villagers/types';

const T = TUNING.castaways;

/** Where newcomers go: to live with a people, or to make one of their own. */
export type Welcome = { join: Tribe } | { found: true };

/**
 * Strangers from beyond the sea. Now and then a boat breaks up on the coast and
 * its few survivors come ashore. They go to live with the nearest people they can
 * walk to; on an island with no one left, they make a people of their own. They
 * know nothing of the god. To an empty island they come sooner.
 *
 * The god's Create miracle settles its couple the same way (`welcome`).
 */
export class Castaways {
  /** Tick the last ones came ashore. */
  lastTick = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  dawn(): void {
    const sim = this.sim;
    const empty = !this.living().length;
    if (!empty && sim.tick - this.lastTick < T.restYears * TICKS_PER_YEAR) return;
    if (this.rng.chance(empty ? T.emptyChancePerDay : T.chancePerDay)) this.wreck();
  }

  /** A boat breaks up on the shore. Returns those who came ashore (none if there's nowhere to land). */
  wreck(): Villager[] {
    const sim = this.sim;
    const at = this.landing();
    const plan = at && this.plan(at, Infinity);
    if (!at || !plan) return [];
    const V = sim.villagers;
    // At least a young woman and man, so a people could start again from them.
    const a = V.spawn({ age: this.rng.range(17, 28), sex: 'f', x: at.x, z: at.z, tribeId: -1 });
    const b = V.spawn({ age: this.rng.range(17, 30), sex: 'm', x: at.x, z: at.z, tribeId: -1 });
    if (this.rng.chance(T.coupleChance)) (a.partnerId = b.id), (b.partnerId = a.id);
    const people = [a, b];
    const more = this.rng.int(T.partyMin, T.partyMax) - 2;
    for (let i = 0; i < more; i++) people.push(V.spawn({ age: this.rng.range(14, 50), x: at.x, z: at.z, tribeId: -1 }));
    this.wreckage(at.x, at.z);
    const t = this.settle(people, at, plan, 'castaways', T.foodDays);
    this.lastTick = sim.tick;
    sim.events.push(sim.tick, { type: 'castaways', ids: people.map((v) => v.id), x: at.x, z: at.z, tribe: t.id, founded: 'found' in plan });
    return people;
  }

  /**
   * Where newcomers standing at `at` would go: the nearest living people they can
   * walk to (within `joinRadius` of its fire), else a people of their own if there's
   * room for another. Null if neither (they'd be stranded).
   */
  plan(at: { x: number; z: number }, joinRadius: number): Welcome | null {
    const sim = this.sim;
    const living = this.living();
    // The Warning is one people's story.
    if (sim.mode === 'warning') return living[0] ? { join: living[0] } : null;
    const regions = sim.nav.regions();
    const here = this.regionAround(at.x, at.z, regions);
    const near = living
      .filter((t) => here && this.regionAround(t.village.center.x, t.village.center.z, regions) === here)
      .map((t) => ({ t, d: Math.hypot(t.village.center.x - at.x, t.village.center.z - at.z) }))
      .sort((p, q) => p.d - q.d)[0];
    if (near && near.d <= joinRadius) return { join: near.t };
    if (living.length < TUNING.branching.maxPeoples) return { found: true };
    return near ? { join: near.t } : null;
  }

  /** Newcomers join a people or found one (with `foodDays` of food to start). Returns their people. */
  settle(people: Villager[], at: { x: number; z: number }, plan: Welcome, reason: 'castaways' | 'created', foodDays: number): Tribe {
    const sim = this.sim;
    if ('join' in plan) {
      for (const p of people) {
        p.tribeId = plan.join.id;
        p.nextThink = sim.tick;
      }
      sim.villagers.newDayRolesAndHomes();
      return plan.join;
    }
    const site = findSettlement(sim, people, at, 0, T.settleRadius, this.rng) ?? { x: at.x, y: sim.nav.at(at.x, at.z), z: at.z };
    const eldest = [...people].sort((p, q) => q.age - p.age)[0];
    const t = sim.foundTribe(people, site, { reason, leaderId: eldest?.id, strangers: true });
    const V = TUNING.villagers;
    t.village.store.food += people.length * foodDays * V.hungerPerDay * 2 * V.mealFood;
    return t;
  }

  /** A shore cell where living people (or, with none, the main island) can be walked to; near a village if there is one. */
  private landing(): { x: number; z: number } | null {
    const sim = this.sim;
    const W = sim.world.sizeX;
    const sea = TUNING.terrain.seaLevel;
    const regions = sim.nav.regions();
    const wanted = new Set(this.living().map((t) => this.regionAround(t.village.center.x, t.village.center.z, regions)));
    wanted.delete(0);
    if (!wanted.size) {
      const s = sim.island.landmarks.villageSite;
      wanted.add(this.regionAround(s.x, s.z, regions));
    }
    const fires = this.living().map((t) => t.village.center);
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let i = 0, found = 0; i < 4000 && found < 12; i++) {
      const x = this.rng.int(2, W - 3);
      const z = this.rng.int(2, sim.world.sizeZ - 3);
      const y = sim.nav.at(x, z);
      if (y < 0 || y > sea + 2 || !wanted.has(regions[x + z * W] ?? 0) || sim.structureAt(x, z)) continue;
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => sim.world.get(x + dx!, sea, z + dz!) === M.WATER);
      if (!wet) continue;
      found++;
      // With no one left, any shore will do.
      if (!fires.length) return { x, z };
      const d = Math.min(...fires.map((c) => Math.hypot(c.x - x, c.z - z)));
      if (d < bestD) (best = { x, z }), (bestD = d);
    }
    return best;
  }

  /** Planks of the wrecked boat, half buried in the sand. */
  private wreckage(x: number, z: number): void {
    const sim = this.sim;
    const n = this.rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const wx = x + this.rng.int(-2, 2);
      const wz = z + this.rng.int(-2, 2);
      const y = sim.nav.at(wx, wz);
      if (y < 0 || sim.structureAt(wx, wz)) continue;
      const m = sim.world.get(wx, y, wz);
      if (m === M.SAND || m === M.GRASS || m === M.DIRT) sim.world.set(wx, y, wz, M.PLANK);
    }
  }

  /** Peoples with anyone still alive (the dead leave the roll at the end of the tick). */
  private living(): Tribe[] {
    return this.sim.tribes.filter((t) => t.members.some((v) => v.alive));
  }

  /** The walkable region at or around a cell (a fire blocks its own cell). */
  private regionAround(x: number, z: number, regions: Int32Array): number {
    const W = this.sim.world.sizeX;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    for (let r = 0; r <= 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const k = regions[cx + dx + (cz + dz) * W] ?? 0;
          if (k) return k;
        }
    return 0;
  }
}
