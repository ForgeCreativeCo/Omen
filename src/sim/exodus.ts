import type { Omen } from './omens/types';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import type { Villager } from './villagers/types';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './time';
import { TUNING } from './tuning';
import { M } from './world/materials';
import { REGION } from './world/terrain';

const T = TUNING.exodus;

export type ExodusReason = 'ruined' | 'cursed' | 'drowned' | 'conquered';

/** How much they'd like to live in each part of the island. */
const REGION_PULL: Record<number, number> = {
  [REGION.home]: 0.5,
  [REGION.meadows]: 1,
  [REGION.lowlands]: 0.8,
  [REGION.highlands]: -0.5,
  [REGION.badlands]: -1.5,
};

/**
 * Leaving a ruined home. When the village's site is lost (the fire drowned or
 * blasted away, the ground cursed, or most homes smashed with the god's hand
 * plainly in it), the survivors give the place up, walk to new ground (flat,
 * near water, reachable, not cursed, well away from the ruin, drawn toward any
 * holy place) and build again around a new fire.
 */
export class Exodus {
  /** Tick the god last harmed the village itself (for "the god's hand was in it"). */
  lastWrathTick = -Infinity;
  lastMoveTick = -Infinity;
  private lastSeq = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) {
      if (e.tribe !== undefined && e.tribe !== sim.tribe.id) continue;
      if (e.type !== 'omen') continue;
      const o = sim.belief.omen(e.omenId);
      if (o && this.struckHome(o)) this.lastWrathTick = sim.tick;
    }
    this.lastSeq = sim.events.lastSeq;
  }

  private struckHome(o: Omen): boolean {
    if (!o.isDivine) return false;
    const c = this.sim.village.center;
    const near = Math.hypot(o.position.x - c.x, o.position.z - c.z) < 30;
    return near && o.outcomes.some((x) => x.type === 'hutDamaged' || x.type === 'died' || x.type === 'fireStarted' || x.type === 'landLowered');
  }

  /** Why home is lost, or null if they can stay. */
  reason(): ExodusReason | null {
    const sim = this.sim;
    const v = sim.village;
    const c = v.center;
    const phase = sim.warning?.disaster.phase;
    if (phase === 'striking') return null;
    // The fire is under water.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (sim.world.get(c.x + dx, c.y + 1, c.z + dz) === M.WATER) return 'drowned';
    if (v.forbidden(c.x, c.z)) return 'cursed';
    const pit = v.structures.find((s) => s.kind === 'firePit' && !s.abandoned);
    if (!pit || pit.destroyed || !v.nearestWalkable(c.x + 2, c.z)) return 'ruined';
    const huts = v.huts.filter((h) => h.complete || h.destroyed || h.next > 0);
    const smashed = huts.filter((h) => h.destroyed).length;
    if (huts.length >= 2 && smashed >= huts.length * T.ruinedShare && sim.tick - this.lastWrathTick <= T.signDays * TICKS_PER_DAY) return 'ruined';
    return null;
  }

  /** Daily, after the village has looked over its damage. */
  dawn(): void {
    const sim = this.sim;
    if (!sim.villagers.alive.length || sim.tick - this.lastMoveTick < T.restYears * TICKS_PER_YEAR) return;
    const why = this.reason();
    if (!why) return;
    const site = this.findHome();
    if (!site) return;
    const v = sim.village;
    const from = { x: v.center.x, z: v.center.z };
    v.relocate(sim, site);
    for (const p of sim.villagers.alive) {
      const home = p.homeId >= 0 ? v.byId(p.homeId) : undefined;
      if (home?.abandoned) {
        p.homeId = -1;
        p.inside = false;
      }
      p.nextThink = sim.tick;
    }
    this.lastMoveTick = sim.tick;
    const region = sim.island.region[site.x + site.z * sim.world.sizeX] ?? REGION.home;
    sim.events.push(sim.tick, { type: 'exodus', fromX: from.x, fromZ: from.z, toX: site.x, toZ: site.z, reason: why, region });
  }

  /** Beaten in war: leave this land for ground far from the conqueror. False if there's nowhere to go. */
  driveOut(from: { x: number; z: number }): boolean {
    const sim = this.sim;
    const v = sim.village;
    const here = { x: v.center.x, z: v.center.z };
    // Away from the conqueror: search from the far side of home.
    const dx = here.x - from.x;
    const dz = here.z - from.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    const away = { x: here.x + (dx / d) * T.minMove, z: here.z + (dz / d) * T.minMove };
    const site =
      findSettlement(sim, sim.villagers.alive, away, 0, T.maxMove, this.rng, v.forbidden, null) ??
      findSettlement(sim, sim.villagers.alive, here, T.minMove, T.maxMove * 1.5, this.rng, v.forbidden, null);
    if (!site || Math.hypot(site.x - from.x, site.z - from.z) < Math.hypot(here.x - from.x, here.z - from.z)) return false;
    v.relocate(sim, site);
    for (const p of sim.villagers.alive) {
      const home = p.homeId >= 0 ? v.byId(p.homeId) : undefined;
      if (home?.abandoned) {
        p.homeId = -1;
        p.inside = false;
      }
      p.nextThink = sim.tick;
    }
    this.lastMoveTick = sim.tick;
    const region = sim.island.region[site.x + site.z * sim.world.sizeX] ?? REGION.home;
    sim.events.push(sim.tick, { type: 'exodus', fromX: here.x, fromZ: here.z, toX: site.x, toZ: site.z, reason: 'conquered', region });
    return true;
  }

  /** The best new ground the survivors can walk to. */
  findHome(): { x: number; y: number; z: number } | null {
    const sim = this.sim;
    return findSettlement(sim, sim.villagers.alive, sim.village.center, T.minMove, T.maxMove, this.rng, sim.village.forbidden, sim.village.attraction());
  }
}

/**
 * Where a people could settle: flat ground near fresh water, reachable on foot
 * from where most of them stand (or from `from`), between minD and maxD from
 * `from`, not on ground they shun, well clear of every other village; drawn to
 * a holy place, preferring meadows and forest to badlands.
 */
export function findSettlement(
  sim: Sim,
  people: Villager[],
  from: { x: number; z: number },
  minD: number,
  maxD: number,
  rng: Rng,
  forbidden: (x: number, z: number) => boolean = () => false,
  pull: { x: number; z: number; strength: number } | null = null,
): { x: number; y: number; z: number } | null {
  const nav = sim.nav;
  const W = sim.world.sizeX;
  const sea = TUNING.terrain.seaLevel;
  const regions = nav.regions();
  // Where most of them stand (or the ground they set out from).
  const count = new Map<number, number>();
  for (const p of people) {
    const r = regions[Math.floor(p.x) + Math.floor(p.z) * W] ?? 0;
    if (r) count.set(r, (count.get(r) ?? 0) + 1);
  }
  const home = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? regions[Math.floor(from.x) + Math.floor(from.z) * W] ?? 0;
  const others = sim.tribes.map((t) => t.village.center);
  let best: { x: number; y: number; z: number } | null = null;
  let bestScore = -Infinity;
  const R = T.flatRadius;
  for (let z = 10; z < sim.world.sizeZ - 10; z += 3)
    for (let x = 10; x < W - 10; x += 3) {
      const d = Math.hypot(x - from.x, z - from.z);
      if (d < minD || d > maxD) continue;
      if (others.some((c) => (c.x !== from.x || c.z !== from.z) && Math.hypot(c.x - x, c.z - z) < T.apart)) continue;
      const h = nav.at(x, z);
      if (h < sea + 2 || (home && regions[x + z * W] !== home) || forbidden(x, z)) continue;
      let lo = h;
      let hi = h;
      let ok = true;
      for (let dz = -R; dz <= R && ok; dz += 2)
        for (let dx = -R; dx <= R && ok; dx += 2) {
          if (dx * dx + dz * dz > R * R) continue;
          const nh = nav.at(x + dx, z + dz);
          if (nh < 0 || forbidden(x + dx, z + dz)) ok = false;
          else (lo = Math.min(lo, nh)), (hi = Math.max(hi, nh));
        }
      if (!ok || hi - lo > T.flatSpread) continue;
      if (!waterNear(sim, x, z)) continue;
      let score = -d * 0.03 - (hi - lo) * 1.5 + (REGION_PULL[sim.island.region[x + z * W] ?? 0] ?? 0) + rng.jitter(0.3);
      if (pull && Math.hypot(pull.x - x, pull.z - z) < 35) score += 2 * pull.strength;
      if (score > bestScore) (bestScore = score), (best = { x, y: h, z });
    }
  return best;
}

function waterNear(sim: Sim, x: number, z: number): boolean {
  const w = sim.world;
  const r = T.waterWithin;
  for (let dz = -r; dz <= r; dz += 2)
    for (let dx = -r; dx <= r; dx += 2) {
      if (dx * dx + dz * dz > r * r) continue;
      const k = x + dx + (z + dz) * w.sizeX;
      const top = sim.island.waterTop[k];
      if (top !== undefined && top >= 0 && w.get(x + dx, top, z + dz) === M.WATER) return true;
    }
  return false;
}
