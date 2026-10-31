import type { Omen } from './omens/types';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './time';
import { TUNING } from './tuning';
import { M } from './world/materials';
import { REGION } from './world/terrain';

const T = TUNING.exodus;

export type ExodusReason = 'ruined' | 'cursed' | 'drowned';

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

  /** The best new ground the survivors can walk to. */
  findHome(): { x: number; y: number; z: number } | null {
    const sim = this.sim;
    const nav = sim.nav;
    const v = sim.village;
    const W = sim.world.sizeX;
    const sea = TUNING.terrain.seaLevel;
    const regions = nav.regions();
    // Where most of the survivors stand.
    const count = new Map<number, number>();
    for (const p of sim.villagers.alive) {
      const r = regions[Math.floor(p.x) + Math.floor(p.z) * W] ?? 0;
      if (r) count.set(r, (count.get(r) ?? 0) + 1);
    }
    const home = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const pull = v.attraction();
    const c = v.center;
    let best: { x: number; y: number; z: number } | null = null;
    let bestScore = -Infinity;
    const R = T.flatRadius;
    for (let z = 10; z < sim.world.sizeZ - 10; z += 3)
      for (let x = 10; x < W - 10; x += 3) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < T.minMove || d > T.maxMove) continue;
        const h = nav.at(x, z);
        if (h < sea + 2 || (home && regions[x + z * W] !== home) || v.forbidden(x, z)) continue;
        let lo = h;
        let hi = h;
        let ok = true;
        for (let dz = -R; dz <= R && ok; dz += 2)
          for (let dx = -R; dx <= R && ok; dx += 2) {
            if (dx * dx + dz * dz > R * R) continue;
            const nh = nav.at(x + dx, z + dz);
            if (nh < 0 || v.forbidden(x + dx, z + dz)) ok = false;
            else (lo = Math.min(lo, nh)), (hi = Math.max(hi, nh));
          }
        if (!ok || hi - lo > T.flatSpread) continue;
        if (!this.waterNear(x, z)) continue;
        let score = -d * 0.03 - (hi - lo) * 1.5 + (REGION_PULL[sim.island.region[x + z * W] ?? 0] ?? 0) + this.rng.jitter(0.3);
        if (pull && Math.hypot(pull.x - x, pull.z - z) < 35) score += 2 * pull.strength;
        if (score > bestScore) (bestScore = score), (best = { x, y: h, z });
      }
    return best;
  }

  private waterNear(x: number, z: number): boolean {
    const w = this.sim.world;
    const r = T.waterWithin;
    for (let dz = -r; dz <= r; dz += 2)
      for (let dx = -r; dx <= r; dx += 2) {
        if (dx * dx + dz * dz > r * r) continue;
        const k = x + dx + (z + dz) * w.sizeX;
        const top = this.sim.island.waterTop[k];
        if (top !== undefined && top >= 0 && w.get(x + dx, top, z + dz) === M.WATER) return true;
      }
    return false;
  }
}
