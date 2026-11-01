import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY } from './time';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const P = TUNING.miracles.plague;
/** Contacts are checked this often (ticks), so the chances per day hold at any speed. */
const EVERY = 20;
const CHECKS_PER_DAY = TICKS_PER_DAY / EVERY;

/**
 * Sickness the god sends. It starts with whoever is near where the god points
 * and goes from person to person: standing close, most of all at the evening
 * fire, and among those who sleep under one roof. The sick can't work; some
 * die of it, most get up again and never catch it twice. It doesn't care whose
 * people anyone belongs to: a war party can carry it home.
 */
export class Plague {
  /** Sick villager → tick they get better (if they live). */
  readonly sick = new Map<VillagerId, number>();
  /** Sick villager → tick they fell ill (it can't kill in the first day). */
  readonly onset = new Map<VillagerId, number>();
  readonly immune = new Set<VillagerId>();

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  isSick(v: Villager): boolean {
    return this.sick.has(v.id);
  }

  /** The god's cast: everyone close to the point falls sick (at least the nearest soul). */
  outbreak(x: number, z: number): VillagerId[] {
    const sim = this.sim;
    const near = sim.villagers.alive.filter((v) => !this.immune.has(v.id) && Math.hypot(v.x - x, v.z - z) <= P.radius);
    if (!near.length) {
      const nearest = sim.villagers.alive.filter((v) => !this.immune.has(v.id)).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      if (nearest && Math.hypot(nearest.x - x, nearest.z - z) <= P.radius * 3) near.push(nearest);
    }
    for (const v of near) this.infect(v, -1);
    sim.events.push(sim.tick, { type: 'plague', x, z, ids: near.map((v) => v.id) });
    return near.map((v) => v.id);
  }

  infect(v: Villager, by: VillagerId): boolean {
    if (!v.alive || this.sick.has(v.id) || this.immune.has(v.id)) return false;
    const sim = this.sim;
    const [lo, hi] = P.sickDays;
    const until = sim.tick + Math.round(this.rng.range(lo!, hi!) * TICKS_PER_DAY);
    this.sick.set(v.id, until);
    this.onset.set(v.id, sim.tick);
    // Too ill to work while it lasts.
    sim.society.hurt.set(v.id, Math.max(sim.society.hurt.get(v.id) ?? 0, until));
    sim.events.push(sim.tick, { type: 'sickened', id: v.id, by });
    return true;
  }

  step(): void {
    const sim = this.sim;
    if (!this.sick.size || sim.tick % EVERY !== 0) return;
    const gathering = (v: Villager) => v.action?.kind === 'gathering' && v.action.phase === 'work';
    const alive = sim.villagers.alive;
    for (const [id, until] of [...this.sick]) {
      const v = sim.villagers.byId(id);
      if (!v?.alive) {
        this.sick.delete(id);
        this.onset.delete(id);
        continue;
      }
      if (sim.tick >= until) {
        this.sick.delete(id);
        this.onset.delete(id);
        this.immune.add(id);
        sim.events.push(sim.tick, { type: 'recovered', id });
        continue;
      }
      v.needs.energy = Math.max(0, v.needs.energy - 0.02);
      if (v.inside) continue;
      for (const o of alive) {
        if (o === v || o.inside || this.sick.has(o.id) || this.immune.has(o.id)) continue;
        if (Math.abs(o.x - v.x) > P.contactRadius || Math.abs(o.z - v.z) > P.contactRadius) continue;
        const k = (gathering(v) && gathering(o) ? P.gatheringSpread : P.spreadChance) / CHECKS_PER_DAY;
        if (this.rng.chance(k)) this.infect(o, v.id);
      }
    }
  }

  /** Each morning: some of the sick die; it passes among those who slept under one roof. */
  dawn(): void {
    const sim = this.sim;
    for (const id of [...this.sick.keys()]) {
      const v = sim.villagers.byId(id);
      if (!v?.alive) continue;
      const frail = v.lifeStage !== 'adult' || v.age < 5;
      const grown = sim.tick - (this.onset.get(id) ?? 0) >= TICKS_PER_DAY;
      if (grown && this.rng.chance(frail ? P.frailDeathPerDay : P.deathPerDay)) {
        this.sick.delete(id);
        this.onset.delete(id);
        sim.villagers.kill(v, 'plague');
        continue;
      }
      if (v.homeId < 0) continue;
      const home = sim.structureById(v.homeId);
      // Under a blessed roof it doesn't pass from one to another.
      if (home && (home.blessedUntil ?? 0) > sim.tick) continue;
      for (const r of home?.residents ?? []) {
        const o = sim.villagers.byId(r);
        if (o && o !== v && this.rng.chance(P.spreadChance)) this.infect(o, v.id);
      }
    }
  }
}
