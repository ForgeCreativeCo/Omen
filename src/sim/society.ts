import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY } from './time';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.society;

export interface Affair {
  /** The one who is partnered (and cheating). */
  a: VillagerId;
  b: VillagerId;
  since: number;
}

const key = (a: VillagerId, b: VillagerId) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * How people feel about each other, and what comes of it (the village's own
 * drama, apart from the god). Fondness grows at the evening fire and in a
 * shared home; grudges come from quarrels, theft and betrayal. Cold partners
 * and warm neighbors make affairs, which may be found out; deep grudges make
 * feuds, feuds make fights, and very rarely a fight ends in a killing, seen at
 * the fire or done in secret.
 *
 * Every deed here goes into the deed log, so the village can tie an omen to
 * it: lightning the day after a killing is a judgment.
 */
export class Society {
  /** Pair key → feeling, −1 (hatred) .. 1 (love). Missing means the default. */
  readonly bonds = new Map<string, number>();
  readonly affairs: Affair[] = [];
  /** Pairs already announced as feuding. */
  readonly feuds = new Set<string>();
  /** Villager → tick their injuries heal. */
  readonly hurt = new Map<VillagerId, number>();
  private lastSeq = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  // ------------------------------------------------------------------ queries

  bond(a: Villager, b: Villager): number {
    const k = key(a.id, b.id);
    const v = this.bonds.get(k);
    if (v !== undefined) return v;
    if (a.partnerId === b.id) return T.partnerStart;
    if (this.sim.villagers.related(a, b)) return T.kinStart;
    return 0;
  }

  shift(a: Villager, b: Villager, d: number): number {
    if (a.id === b.id) return 0;
    const v = Math.max(-1, Math.min(1, this.bond(a, b) + d));
    this.bonds.set(key(a.id, b.id), v);
    return v;
  }

  isHurt(v: Villager): boolean {
    return (this.hurt.get(v.id) ?? 0) > this.sim.tick;
  }

  /** Who they love most and resent most (for the inspector). */
  feelings(v: Villager): { fond: Villager | null; grudge: Villager | null; grudgeLevel: number } {
    let fond: Villager | null = null;
    let grudge: Villager | null = null;
    let hi = 0.35;
    let lo = -0.25;
    for (const o of this.sim.villagers.alive) {
      if (o.id === v.id || o.id === v.partnerId) continue;
      const b = this.bond(v, o);
      // Family is fond by default: friendship is the news.
      if (b > hi && !this.sim.villagers.related(v, o)) (hi = b), (fond = o);
      if (b < lo) (lo = b), (grudge = o);
    }
    return { fond, grudge, grudgeLevel: lo };
  }

  affairOf(v: Villager): Affair | undefined {
    return this.affairs.find((f) => f.a === v.id || f.b === v.id);
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) {
      switch (e.type) {
        case 'quarrel': {
          const a = sim.villagers.byId(e.a);
          const b = sim.villagers.byId(e.b);
          if (a && b) this.shift(a, b, -T.quarrelGrudge);
          break;
        }
        case 'theft': {
          if (!e.known) break;
          const thief = sim.villagers.byId(e.id);
          if (!thief) break;
          for (const id of e.victims) {
            const v = sim.villagers.byId(id);
            if (v?.alive && v.lifeStage !== 'child') this.shift(v, thief, -T.theftGrudge);
          }
          break;
        }
        case 'couple': {
          const a = sim.villagers.byId(e.a);
          const b = sim.villagers.byId(e.b);
          if (a && b) this.bonds.set(key(a.id, b.id), Math.max(this.bond(a, b), T.partnerStart));
          break;
        }
        default:
          break;
      }
    }
    this.lastSeq = sim.events.lastSeq;
  }

  // ------------------------------------------------------------------ evening

  /** At the fire: people warm to whoever they sit with; feuds flare. */
  dusk(present: Villager[]): void {
    const adults = present.filter((v) => v.lifeStage !== 'child');
    if (adults.length >= 2) {
      for (const v of adults) {
        const o = this.rng.pick(adults);
        if (o.id !== v.id) this.shift(v, o, T.fondPerEvening);
      }
    }
    // Feuds: those who hate each other and are both at the fire.
    const here = new Set(adults.map((v) => v.id));
    for (const v of adults) {
      for (const o of adults) {
        if (o.id <= v.id || !here.has(o.id)) continue;
        const b = this.bond(v, o);
        if (b > T.feudAt || !this.rng.chance(T.feudQuarrelChance)) continue;
        if (b <= T.violenceAt) this.fight(v.id < o.id ? v : o, v.id < o.id ? o : v, present.length > 2);
        else this.quarrel(v, o);
      }
    }
  }

  private quarrel(a: Villager, b: Villager): void {
    const sim = this.sim;
    sim.belief.deeds.add({ key: 'deed:fight', actorId: a.id, victimIds: [b.id], x: Math.floor(a.x), z: Math.floor(a.z), tick: sim.tick });
    sim.events.push(sim.tick, { type: 'quarrel', a: a.id, b: b.id, x: Math.floor(a.x), z: Math.floor(a.z) });
  }

  /** Blows: whoever hates more strikes; sometimes someone is hurt, very rarely killed. */
  private fight(x: Villager, y: Villager, seen: boolean): void {
    const sim = this.sim;
    const [a, b] = this.rng.chance(0.5) ? [x, y] : [y, x];
    if (this.rng.chance(T.killChance)) {
      this.kill(a, b, seen);
      return;
    }
    const hurt = this.rng.chance(T.fightHurtChance) ? b.id : -1;
    if (hurt >= 0) this.hurt.set(b.id, sim.tick + T.hurtDays * TICKS_PER_DAY);
    this.shift(a, b, -0.1);
    sim.belief.deeds.add({ key: 'deed:fight', actorId: a.id, victimIds: [b.id], x: Math.floor(a.x), z: Math.floor(a.z), tick: sim.tick });
    sim.events.push(sim.tick, { type: 'fight', a: a.id, b: b.id, hurt, x: Math.floor(a.x), z: Math.floor(a.z) });
  }

  /** A killing. Blood calls for blood: the victim's family turns on the killer. */
  kill(killer: Villager, victim: Villager, seen: boolean): void {
    const sim = this.sim;
    const x = Math.floor(victim.x);
    const z = Math.floor(victim.z);
    sim.events.push(sim.tick, { type: 'killing', killer: killer.id, victim: victim.id, seen, x, z });
    sim.belief.deeds.add({ key: 'deed:murder', actorId: killer.id, victimIds: [victim.id], x, z, tick: sim.tick });
    const kin = [victim.partnerId, ...victim.parentIds, ...victim.childIds].map((id) => sim.villagers.byId(id)).filter((v): v is Villager => !!v?.alive);
    for (const k of kin) if (seen) this.shift(k, killer, -T.bloodGrudge);
    sim.villagers.kill(victim, 'killed');
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    const sim = this.sim;
    // Grudges and fondness both fade a little; partners grow a little stale.
    for (const [k, v] of this.bonds) {
      const nv = v * (1 - T.bondFadePerDay);
      if (Math.abs(nv) < 0.01) this.bonds.delete(k);
      else this.bonds.set(k, nv);
    }
    for (const v of sim.villagers.alive) {
      const p = v.partnerId >= 0 ? sim.villagers.byId(v.partnerId) : undefined;
      if (p && v.id < p.id) {
        // A shared roof keeps warmth; quarrels and staleness wear it down.
        const together = v.homeId >= 0 && v.homeId === p.homeId;
        this.shift(v, p, together ? T.homeWarmth - T.partnerStaleness : -T.partnerStaleness);
      }
    }
    for (const [id, until] of this.hurt) if (until <= sim.tick) this.hurt.delete(id);

    this.affairsDay();
    this.feudsDay();
  }

  private affairsDay(): void {
    const sim = this.sim;
    // Ongoing affairs: found out, or quietly over.
    for (const f of [...this.affairs]) {
      const a = sim.villagers.byId(f.a);
      const b = sim.villagers.byId(f.b);
      if (!a?.alive || !b?.alive) {
        this.endAffair(f);
        continue;
      }
      if (this.rng.chance(T.affairExposePerDay)) this.expose(f, a, b);
      else if (this.rng.chance(T.affairFadePerDay)) this.endAffair(f);
    }
    // New ones: a cold home and a warm neighbor.
    for (const a of sim.villagers.alive) {
      if (a.lifeStage !== 'adult' || a.partnerId < 0 || this.affairOf(a)) continue;
      const p = sim.villagers.byId(a.partnerId);
      if (!p?.alive || this.bond(a, p) > T.affairColdBelow) continue;
      const b = this.warmest(a);
      if (!b || !this.rng.chance(T.affairChancePerDay)) continue;
      this.affairs.push({ a: a.id, b: b.id, since: sim.tick });
      sim.events.push(sim.tick, { type: 'affair', a: a.id, b: b.id });
    }
  }

  private warmest(a: Villager): Villager | null {
    let best: Villager | null = null;
    let hi: number = T.affairFondAbove;
    for (const o of this.sim.villagers.alive) {
      if (o.id === a.id || o.id === a.partnerId || o.lifeStage !== 'adult' || this.affairOf(o)) continue;
      if (o.sex === a.sex || this.sim.villagers.related(a, o)) continue;
      const b = this.bond(a, o);
      if (b > hi) (hi = b), (best = o);
    }
    return best;
  }

  private endAffair(f: Affair): void {
    const i = this.affairs.indexOf(f);
    if (i >= 0) this.affairs.splice(i, 1);
  }

  /** Found out: the partner learns of it. Grudges, a scene, maybe a parting. */
  private expose(f: Affair, a: Villager, b: Villager): void {
    const sim = this.sim;
    this.endAffair(f);
    const p = sim.villagers.byId(a.partnerId);
    sim.belief.deeds.add({ key: 'deed:adultery', actorId: a.id, victimIds: p ? [p.id] : [], x: Math.floor(a.x), z: Math.floor(a.z), tick: sim.tick });
    a.standing = Math.max(0, a.standing - T.exposureStanding);
    b.standing = Math.max(0, b.standing - T.exposureStanding);
    let breakup = false;
    if (p?.alive) {
      this.shift(p, a, -T.exposureGrudgePartner);
      this.shift(p, b, -T.exposureGrudgeLover);
      breakup = this.rng.chance(T.breakupChance);
      if (breakup) sim.villagers.separate(a, p);
    }
    sim.events.push(sim.tick, { type: 'affairExposed', a: a.id, b: b.id, by: p?.id ?? -1, breakup });
    if (p?.alive) this.quarrel(p, b);
    // Free to choose: the lovers may make it open.
    if (breakup && b.partnerId < 0) sim.villagers.pair(a, b);
  }

  private feudsDay(): void {
    const sim = this.sim;
    const alive = sim.villagers.alive.filter((v) => v.lifeStage !== 'child');
    for (const a of alive) {
      for (const b of alive) {
        if (b.id <= a.id) continue;
        const bond = this.bond(a, b);
        const k = key(a.id, b.id);
        if (bond <= T.feudAt && !this.feuds.has(k)) {
          this.feuds.add(k);
          sim.events.push(sim.tick, { type: 'feud', a: a.id, b: b.id });
        } else if (bond > T.feudAt * 0.5 && this.feuds.has(k)) this.feuds.delete(k);
        // The worst hatred waits for a chance alone.
        if (bond <= T.ambushAt && this.rng.chance(T.ambushChancePerDay)) {
          const [killer, victim] = this.rng.chance(0.5) ? [a, b] : [b, a];
          if (!victim.inside) this.kill(killer, victim, false);
          return;
        }
      }
    }
  }
}
