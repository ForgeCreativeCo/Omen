import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY } from './time';
import type { Tribe } from './tribe';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.war;

export type RaidPhase = 'march' | 'fight' | 'return';

/** A war party: some of one people's fighters, on their way to another's fire and back. */
export interface Raid {
  id: number;
  from: number;
  to: number;
  members: VillagerId[];
  phase: RaidPhase;
  /** Ticks left in the current phase before it gives up and moves on. */
  left: number;
  /** Food carried off. */
  loot: number;
  burned: boolean;
  raidersLost: number;
  defendersLost: number;
  startSize: number;
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * War between peoples. How each pair of peoples feels about the other drifts
 * daily: neighbors chafe over land, the hungry resent the well-fed, a different
 * name for the god divides (a shared one eases), a people born of a schism
 * starts out bitter, and every death in battle hardens it. Past a point they
 * go to war; at war, each side sends war parties of its fighting adults to
 * the other's fire: the defenders rally, children and elders run, and after
 * the fight the raiders carry off what food they can, maybe leave a hut
 * burning, and walk home. Peace comes when the bitterness eases or the dead
 * are too many.
 */
export class War {
  /** Pair key → feeling between two peoples, −1 (hatred) .. 1. */
  readonly relations = new Map<string, number>();
  readonly wars = new Set<string>();
  /** Pair key → how tired of war they are (rises with the dead). */
  readonly weariness = new Map<string, number>();
  readonly raids: Raid[] = [];
  /** Tribe → tick its last war party set out. */
  readonly lastRaid = new Map<number, number>();
  private nextId = 1;
  private lastSeq = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  relation(a: number, b: number): number {
    return this.relations.get(key(a, b)) ?? 0;
  }

  shift(a: number, b: number, d: number): void {
    if (a === b) return;
    this.relations.set(key(a, b), Math.max(-1, Math.min(1, this.relation(a, b) + d)));
  }

  atWar(a: number, b: number): boolean {
    return this.wars.has(key(a, b));
  }

  /** The raid a villager is fighting in, if any. */
  raidOf(v: Villager): Raid | undefined {
    return this.raids.find((r) => r.members.includes(v.id));
  }

  /** Busy with the war: in a war party, or defending their fire. */
  engaged(v: Villager): boolean {
    if (this.raidOf(v)) return true;
    const raid = this.raids.find((r) => r.to === v.tribeId && r.phase === 'fight');
    return !!raid && this.defender(v, raid);
  }

  private defender(v: Villager, raid: Raid): boolean {
    const c = this.sim.tribes[raid.to]?.village.center;
    return !!c && v.lifeStage === 'adult' && v.tribeId === raid.to && !v.inside && Math.hypot(v.x - c.x, v.z - c.z) <= T.defendRadius;
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) {
      // A people born of a schism starts out bitter toward the one it left.
      if (e.type === 'tribeFounded' && e.reason === 'schism') this.shift(e.id, e.from, T.schismStart);
    }
    this.lastSeq = sim.events.lastSeq;
    for (const r of [...this.raids]) this.advance(r);
  }

  private members(r: Raid): Villager[] {
    return r.members.map((id) => this.sim.villagers.byId(id)).filter((v): v is Villager => !!v?.alive);
  }

  private advance(r: Raid): void {
    const sim = this.sim;
    const home = sim.tribes[r.from]?.village.center;
    const target = sim.tribes[r.to]?.village.center;
    const party = this.members(r);
    r.members = party.map((v) => v.id);
    if (!home || !target || !party.length) return this.end(r);
    r.left--;
    if (r.phase === 'march') {
      const there = party.filter((v) => Math.hypot(v.x - target.x, v.z - target.z) <= T.arriveRadius).length;
      if (there >= party.length * 0.6 || r.left <= 0) this.beginFight(r, target);
      else if ((sim.tick + r.id) % 20 === 0) for (const v of party) this.march(v, target.x, target.z);
      return;
    }
    if (r.phase === 'fight') {
      this.fight(r, party, target);
      return;
    }
    // Home again: the loot goes in the store.
    const back = party.filter((v) => Math.hypot(v.x - home.x, v.z - home.z) <= T.arriveRadius + 4).length;
    if (back >= party.length * 0.6 || r.left <= 0) {
      const t = sim.tribes[r.from]!;
      t.village.store.food += r.loot;
      this.end(r);
    }
  }

  private march(v: Villager, x: number, z: number): void {
    const spot = this.sim.tribes[v.tribeId]!.village.nearestWalkable(Math.round(x + this.rng.jitter(3)), Math.round(z + this.rng.jitter(3))) ?? { x: Math.round(x), z: Math.round(z) };
    this.sim.villagers.order(v, 'raid', spot.x, spot.z, TICKS_PER_DAY * 3);
  }

  private beginFight(r: Raid, target: { x: number; z: number }): void {
    const sim = this.sim;
    r.phase = 'fight';
    r.left = T.fightTicks;
    const defenders = sim.tribes[r.to]!.members;
    // The children and the old run from the fire; the able rally to it.
    for (const v of defenders) {
      const d = Math.hypot(v.x - target.x, v.z - target.z);
      if (d > T.defendRadius * 1.5 || v.inside) continue;
      if (v.lifeStage === 'adult') sim.villagers.order(v, 'defend', Math.round(target.x), Math.round(target.z), T.fightTicks);
      else sim.villagers.scare(v, target.x, target.z);
    }
    // The defenders will remember who came at them (raids count as wrongs, for the god's judgments).
    const leader = r.members[0] ?? -1;
    sim.tribes[r.to]!.belief.deeds.add({ key: 'deed:raid', actorId: leader, victimIds: defenders.map((v) => v.id), x: Math.round(target.x), z: Math.round(target.z), tick: sim.tick });
    sim.events.push(sim.tick, { type: 'battle', raid: r.id, from: r.from, to: r.to, x: Math.round(target.x), z: Math.round(target.z) });
  }

  /** Blows at the fire. Each raider near a defender may fall or strike one down; home ground helps. */
  private fight(r: Raid, party: Villager[], target: { x: number; z: number }): void {
    const sim = this.sim;
    const defenders = sim.tribes[r.to]!.members.filter((v) => v.lifeStage === 'adult' && !v.inside && Math.hypot(v.x - target.x, v.z - target.z) <= T.defendRadius);
    const raiders = party.length;
    const homeSide = defenders.length * T.homeAdvantage;
    for (const raider of party) {
      if (!raider.alive) continue;
      let foe: Villager | undefined;
      let fd = Infinity;
      for (const d of defenders) {
        if (!d.alive) continue;
        const dist = Math.hypot(d.x - raider.x, d.z - raider.z);
        if (dist < fd) (fd = dist), (foe = d);
      }
      if (!foe) continue;
      if (fd > T.reach) {
        if ((sim.tick + raider.id) % 10 === 0) sim.villagers.order(raider, 'raid', Math.floor(foe.x), Math.floor(foe.z), T.fightTicks);
        continue;
      }
      if (!this.rng.chance(T.blowChance)) continue;
      // Who falls: the side with more around it is likelier to land the blow.
      const raiderWins = this.rng.chance(raiders / (raiders + homeSide));
      const [winner, loser] = raiderWins ? [raider, foe] : [foe, raider];
      if (this.rng.chance(T.killShare)) {
        this.slay(winner, loser, r);
      } else sim.society.hurt.set(loser.id, sim.tick + TICKS_PER_DAY);
    }
    const alive = this.members(r).length;
    const standing = defenders.filter((v) => v.alive).length;
    if (r.left > 0 && alive > r.startSize * T.breakAt && standing > 0) return;
    // Over: the raiders take what they can carry, maybe set a hut alight, and go home.
    const victims = sim.tribes[r.to]!;
    if (alive && standing <= alive) {
      r.loot = Math.min(victims.village.store.food, T.lootPerRaider * alive);
      victims.village.store.food -= r.loot;
      if (this.rng.chance(T.burnChance)) r.burned = this.burnAHut(victims);
    }
    r.phase = 'return';
    r.left = TICKS_PER_DAY * 3;
    const home = sim.tribes[r.from]!.village.center;
    for (const v of this.members(r)) this.march(v, home.x, home.z);
    for (const v of victims.members) if (v.action?.kind === 'defend') sim.villagers.order(v, 'idle', Math.floor(v.x), Math.floor(v.z), 1);
  }

  private slay(killer: Villager, victim: Villager, r: Raid): void {
    const sim = this.sim;
    if (victim.tribeId === r.from) r.raidersLost++;
    else r.defendersLost++;
    const kin = [victim.partnerId, ...victim.parentIds, ...victim.childIds].map((id) => sim.villagers.byId(id)).filter((v): v is Villager => !!v?.alive);
    for (const k of kin) sim.society.shift(k, killer, -TUNING.society.bloodGrudge);
    this.shift(r.from, r.to, -T.deathGrudge);
    const k = key(r.from, r.to);
    this.weariness.set(k, (this.weariness.get(k) ?? 0) + T.wearinessPerDeath);
    sim.events.push(sim.tick, { type: 'slain', killer: killer.id, victim: victim.id, raid: r.id, x: Math.floor(victim.x), z: Math.floor(victim.z) });
    sim.villagers.kill(victim, 'battle');
  }

  private burnAHut(t: Tribe): boolean {
    const huts = t.village.huts.filter((h) => h.complete && !h.destroyed);
    if (!huts.length) return false;
    const h = this.rng.pick(huts);
    for (const s of h.steps) if (this.sim.fire.ignite(s.x, s.y, s.z)) return true;
    return false;
  }

  private end(r: Raid): void {
    const sim = this.sim;
    this.raids.splice(this.raids.indexOf(r), 1);
    for (const v of this.members(r)) {
      v.action = null;
      v.nextThink = sim.tick;
    }
    sim.events.push(sim.tick, { type: 'raidEnd', raid: r.id, from: r.from, to: r.to, loot: Math.round(r.loot), burned: r.burned, raidersLost: r.raidersLost, defendersLost: r.defendersLost });
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    const sim = this.sim;
    const tribes = sim.tribes.filter((t) => t.members.length);
    for (const a of tribes)
      for (const b of tribes) {
        if (b.id <= a.id) continue;
        this.drift(a, b);
        const k = key(a.id, b.id);
        const rel = this.relation(a.id, b.id);
        if (!this.wars.has(k)) {
          if (rel <= T.warAt && this.fighters(a).length >= T.minFighters && this.fighters(b).length >= T.minFighters) {
            this.wars.add(k);
            this.weariness.set(k, 0);
            sim.events.push(sim.tick, { type: 'war', a: a.id, b: b.id });
          }
          continue;
        }
        if (rel >= T.peaceAt || (this.weariness.get(k) ?? 0) >= T.peaceWeariness || !this.fighters(a).length || !this.fighters(b).length) {
          this.wars.delete(k);
          this.weariness.delete(k);
          this.relations.set(k, Math.max(rel, T.afterPeace));
          sim.events.push(sim.tick, { type: 'peace', a: a.id, b: b.id });
          continue;
        }
        // At war: each side may send a party.
        for (const [x, y] of [
          [a, b],
          [b, a],
        ] as const)
          this.maybeRaid(x, y);
      }
    // The last few of a dying people go to live with the neighbor they get on with best.
    for (const t of tribes) {
      const left = t.members;
      if (!left.length || left.length > T.absorbAtOrBelow) continue;
      const host = tribes.filter((o) => o.id !== t.id && o.members.length > T.absorbAtOrBelow && !this.atWar(o.id, t.id)).sort((x, y) => this.relation(t.id, y.id) - this.relation(t.id, x.id))[0];
      if (!host) continue;
      for (const v of left) {
        const home = v.homeId >= 0 ? t.village.byId(v.homeId) : undefined;
        if (home) home.residents = home.residents.filter((r) => r !== v.id);
        v.homeId = -1;
        v.tribeId = host.id;
        if (v.role === 'priest') v.role = 'gatherer';
        v.nextThink = sim.tick;
      }
      host.belief.adopt(t.belief, left);
      sim.events.push(sim.tick, { type: 'absorbed', from: t.id, into: host.id, ids: left.map((v) => v.id) });
    }
    // Peoples that are gone are at war with no one.
    for (const k of [...this.wars]) {
      const [a, b] = k.split(':').map(Number);
      if (!sim.tribes[a!]?.members.length || !sim.tribes[b!]?.members.length) this.wars.delete(k);
    }
  }

  /** Adults who can fight (not the priest). */
  private fighters(t: Tribe): Villager[] {
    return t.members.filter((v) => v.lifeStage === 'adult' && v.id !== t.belief.priestId && !this.raidOf(v));
  }

  private drift(a: Tribe, b: Tribe): void {
    const ca = a.village.center;
    const cb = b.village.center;
    const d = Math.hypot(ca.x - cb.x, ca.z - cb.z);
    let delta = 0;
    // Neighbors chafe over land.
    if (d < T.nearDistance) delta -= T.landFriction * (1 - d / T.nearDistance);
    // The hungry resent the fed.
    const food = (t: Tribe) => t.village.store.food / Math.max(1, t.members.length);
    if (food(a) < T.hungryBelow && food(b) > food(a) * 2) delta -= T.hungerFriction;
    if (food(b) < T.hungryBelow && food(a) > food(b) * 2) delta -= T.hungerFriction;
    // The god's name: a different one divides, the same one eases.
    const na = a.myth.godName;
    const nb = b.myth.godName;
    if (na && nb) delta += na === nb ? T.faithFriction * 0.5 : -T.faithFriction;
    const rel = this.relation(a.id, b.id) + delta;
    // Feelings ease back toward nothing over time.
    this.relations.set(key(a.id, b.id), Math.max(-1, Math.min(1, rel * (1 - T.easePerDay))));
  }

  private maybeRaid(from: Tribe, to: Tribe): void {
    const sim = this.sim;
    if (this.raids.some((r) => r.from === from.id)) return;
    if (sim.tick - (this.lastRaid.get(from.id) ?? -Infinity) < T.raidRestDays * TICKS_PER_DAY) return;
    if (!this.rng.chance(T.raidChancePerDay)) return;
    const fighters = this.fighters(from);
    const n = Math.max(T.partyMin, Math.round(fighters.length * T.partyShare));
    if (fighters.length < T.partyMin) return;
    const party = this.rng.shuffle([...fighters]).slice(0, n);
    const r: Raid = { id: this.nextId++, from: from.id, to: to.id, members: party.map((v) => v.id), phase: 'march', left: TICKS_PER_DAY * 3, loot: 0, burned: false, raidersLost: 0, defendersLost: 0, startSize: party.length };
    this.raids.push(r);
    this.lastRaid.set(from.id, sim.tick);
    const c = to.village.center;
    for (const v of party) this.march(v, c.x, c.z);
    sim.events.push(sim.tick, { type: 'raid', raid: r.id, from: from.id, to: to.id, ids: [...r.members] });
  }
}
