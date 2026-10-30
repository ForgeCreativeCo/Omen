import type { Sim } from '../Sim';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import type { Villager } from '../villagers/types';
import { material, M } from '../world/materials';
import type { Disaster, DisasterPhase } from './types';

const F = TUNING.flood;

/**
 * The sea rises (SPEC §14): over a few days, layer by layer, water climbs from the
 * sea to a height that covers the valley and the east hill but not the ridge top.
 * Nobody is told. People run where they trust (their holy place), or nowhere.
 */
export class FloodDisaster implements Disaster {
  readonly kind = 'flood' as const;
  phase: DisasterPhase = 'waiting';
  /** Top y the water reaches. */
  readonly finalLevel: number;
  /** Top y currently filled. */
  level: number;
  startPopulation = 0;
  peakTick = -1;

  get safeAbove(): number {
    return this.finalLevel;
  }
  private filling = -1;
  private cursorZ = 0;
  private nextRise = 0;
  private interval = 1;
  private refuges = new Map<string, { x: number; z: number; h: number; tick: number } | null>();

  constructor(
    private readonly sim: Sim,
    readonly strikesAt: number,
  ) {
    this.finalLevel = FloodDisaster.finalLevelFor(sim);
    this.level = TUNING.terrain.seaLevel;
  }

  /** Over the east hill, never over the ridge top, always over the valley. */
  static finalLevelFor(sim: Sim): number {
    const L = sim.island.landmarks;
    const t = TUNING.terrain;
    const want = Math.max(L.eastHill.y + F.aboveHill, t.valleyHeight + F.minAboveValley);
    return Math.min(want, L.ridgePeak.y - F.belowRidgeTop);
  }

  step(): void {
    const sim = this.sim;
    if (this.phase === 'waiting') {
      if (sim.tick < this.strikesAt) return;
      this.phase = 'striking';
      this.startPopulation = sim.villagers.alive.length;
      this.interval = Math.max(1, Math.floor((F.riseDays * TICKS_PER_DAY) / Math.max(1, this.finalLevel - this.level)));
      this.nextRise = sim.tick;
      sim.events.push(sim.tick, { type: 'flood', phase: 'strike', level: this.level });
      // Everyone looks up from what they were doing.
      for (const v of sim.villagers.alive) v.nextThink = sim.tick;
    }
    if (this.phase === 'striking') {
      if (this.filling >= 0) this.fillRows();
      else if (sim.tick >= this.nextRise) {
        if (this.level >= this.finalLevel) {
          this.phase = 'settling';
          this.peakTick = sim.tick;
          sim.events.push(sim.tick, { type: 'flood', phase: 'peak', level: this.level });
        } else {
          this.level++;
          this.filling = this.level;
          this.cursorZ = 0;
          this.nextRise = sim.tick + this.interval;
          sim.events.push(sim.tick, { type: 'flood', phase: 'rise', level: this.level });
        }
      }
    } else if (this.phase === 'settling' && sim.tick >= this.peakTick + F.settleDays * TICKS_PER_DAY) {
      this.phase = 'done';
    }
  }

  /** Fill one layer a few rows per tick: water settles on anything solid (or on water). */
  private fillRows(): void {
    const w = this.sim.world;
    const y = this.filling;
    const end = Math.min(w.sizeZ, this.cursorZ + F.rowsPerTick);
    for (let z = this.cursorZ; z < end; z++)
      for (let x = 0; x < w.sizeX; x++) {
        const id = w.get(x, y, z);
        if (id !== M.AIR && !material(id).decor && !material(id).cropStage) continue;
        const below = w.get(x, y - 1, z);
        if (below === M.AIR || (material(below).passable && below !== M.WATER)) continue;
        w.set(x, y, z, M.WATER);
      }
    this.cursorZ = end;
    if (end >= w.sizeZ) this.filling = -1;
  }

  /**
   * Believers run up the highest holy place they trust (with water rising, the high
   * one feels safest); everyone else carries on, and wades for the nearest dry ground
   * when the water reaches them.
   */
  refugeFor(v: Villager): { x: number; z: number } | null {
    if (this.phase !== 'striking' && this.phase !== 'settling') return null;
    let best: { x: number; z: number; h: number } | null = null;
    for (const b of this.sim.belief.active('SACRED_PLACE')) {
      if (!b.area || (b.holders.get(v.id) ?? 0) < F.refugeTrust) continue;
      const top = this.summit(b.id);
      if (top && (!best || top.h > best.h)) best = top;
    }
    return best;
  }

  /** The highest walkable cell of a sacred area (re-checked as the water climbs). */
  private summit(beliefId: string): { x: number; z: number; h: number } | null {
    const cached = this.refuges.get(beliefId);
    if (cached && this.sim.tick - cached.tick < this.interval) return cached;
    const a = this.sim.belief.beliefs.get(beliefId)?.area;
    if (!a) return null;
    const nav = this.sim.nav;
    let top: { x: number; z: number; h: number; tick: number } | null = null;
    let h = -1;
    for (let z = Math.floor(a.z - a.r); z <= Math.ceil(a.z + a.r); z++)
      for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
        if (Math.hypot(x - a.x, z - a.z) > a.r) continue;
        const y = nav.at(x, z);
        if (y > h) (h = y), (top = { x, z, h: y, tick: this.sim.tick });
      }
    this.refuges.set(beliefId, top);
    return top;
  }
}
