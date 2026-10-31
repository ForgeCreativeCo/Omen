import type { SimEvent } from './events';
import { BASE_VALENCE } from './belief/interpret';
import type { Omen } from './omens/types';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY } from './time';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.appease;

/** Someone who stands in the open and refuses the god. */
export interface Defier {
  id: VillagerId;
  since: number;
  /** Whose death at the god's hand set them off (-1: none in particular). */
  griefFor: VillagerId;
}

export type DefianceEnd = 'struck' | 'humbled' | 'died' | 'gone';

/**
 * How a people answers a cruel god. Every harm it sends adds to their dread;
 * after a disaster the priest calls for a great offering at the fire, and when
 * the dread is deep enough they give a person to it. Some who lost family to it
 * won't bow at all and say so at the fire; if the god strikes them down the
 * rest are cowed, if it lets them be the defiance spreads. And they watch their
 * neighbors: a people the god has struck must have angered it (we must please
 * it, or be next); a people it has blessed is envied.
 */
export class Appeasement {
  /** 0..1: how much they fear what the god will do next. */
  dread = 0;
  readonly defiers: Defier[] = [];
  /** Food to give at the next evening fire (a great offering after a disaster, or to outdo a neighbor). */
  pendingOffering = 0;
  /** Why it's owed, for the event. */
  offeringFor: 'disaster' | 'rivalry' | '' = '';
  lastSacrifice = -Infinity;
  /** Tick the god last harmed this people (for "it did nothing to the defiers"). */
  lastHarm = -Infinity;
  /** Other people → tick they last stirred our envy or scorn (one reaction a day). */
  private readonly lastRivalry = new Map<number, number>();
  private readonly seen: string[] = [];
  private lastTick = -1;
  private lastSeq = 0;

  constructor(
    public sim: Sim,
    private readonly rng: Rng,
  ) {}

  isDefier(v: Villager): boolean {
    return this.defiers.some((d) => d.id === v.id);
  }

  /** Share of the living who defy (offerings shrink by it). */
  defierShare(): number {
    const n = this.sim.villagers.alive.length;
    return n ? this.defiers.length / n : 0;
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    for (const o of this.newOmens()) this.onOmen(o);
    for (const e of sim.events.since(this.lastSeq)) this.onEvent(e);
    this.lastSeq = sim.events.lastSeq;
  }

  /** This people's omens since last time (the store only grows, but trims its oldest). */
  private newOmens(): Omen[] {
    const out: Omen[] = [];
    for (const o of this.sim.belief.omens) {
      if (o.tick < this.lastTick || (o.tick === this.lastTick && this.seen.includes(o.id))) continue;
      out.push(o);
    }
    for (const o of out) {
      if (o.tick > this.lastTick) (this.lastTick = o.tick), (this.seen.length = 0);
      this.seen.push(o.id);
    }
    return out;
  }

  /** How much an omen hurt this people. */
  private harm(o: Omen): number {
    if (BASE_VALENCE[o.kind] >= 0 && !o.outcomes.some((x) => x.type === 'died')) return 0;
    const ours = new Set(this.sim.villagers.alive.map((v) => v.id));
    const mine = (ids?: VillagerId[]) => (ids ?? []).some((id) => ours.has(id) || this.sim.villagers.byId(id)?.tribeId === this.sim.tribe.id);
    let h = 0;
    for (const x of o.outcomes) {
      if (x.type === 'died' && mine(x.people)) h += T.harmPerDeath;
      else if (x.type === 'hutDamaged' && mine(x.people)) h += T.harmPerHome;
      else if (x.type === 'sickened' && mine(x.people)) h += T.harmPerSick;
      else if (x.type === 'cropsWithered') h += T.harmPerCrops * Math.min(4, (x.amount ?? 10) / 10);
    }
    return h ? h + T.baseHarm : 0;
  }

  private onOmen(o: Omen): void {
    const sim = this.sim;
    const h = this.harm(o);
    if (h > 0) {
      this.dread = Math.min(1, this.dread + h);
      this.lastHarm = sim.tick;
      if (h >= T.disasterAt) {
        // The priest calls for a great offering; the other peoples hear of it.
        this.owe(sim.village.store.food * T.greatOfferingShare, 'disaster');
        const deaths = o.outcomes.filter((x) => x.type === 'died').length;
        sim.events.push(sim.tick, { type: 'disaster', kind: o.kind, harm: Math.round(h * 100) / 100, deaths });
      }
      this.defiance(o);
    }
    // A defier the god strikes down, or touches.
    for (const d of [...this.defiers]) {
      const hit = o.outcomes.some((x) => (x.entity === `person:${d.id}` || x.people?.includes(d.id)) && x.type !== 'blessed');
      if (o.isDivine && o.outcomes.some((x) => x.type === 'blessed' && x.entity === `person:${d.id}`)) this.endDefiance(d, 'humbled');
      else if (o.isDivine && hit && h > 0) this.endDefiance(d, 'struck', o.witnesses);
    }
    // Wonders for others are envied.
    const good = o.isDivine && BASE_VALENCE[o.kind] > 0 && o.outcomes.some((x) => x.type === 'blessed' || x.type === 'cropsRipened' || x.type === 'cropsSaved');
    if (good && o.witnesses.length >= 3) sim.events.push(sim.tick, { type: 'favored', kind: o.kind });
  }

  /** Those who lost family to the god may stand up against it. */
  private defiance(o: Omen): void {
    const sim = this.sim;
    if (!o.isDivine) return;
    for (const x of o.outcomes) {
      if (x.type !== 'died' || !x.people?.length) continue;
      const dead = sim.villagers.byId(x.people[0]!);
      if (!dead) continue;
      const kin = [dead.partnerId, ...dead.parentIds, ...dead.childIds].map((id) => sim.villagers.byId(id)).filter((v): v is Villager => !!v?.alive && v.tribeId === sim.tribe.id && v.lifeStage !== 'child');
      for (const v of kin) {
        if (this.defiers.length >= T.maxDefiers || this.isDefier(v) || v.id === sim.belief.priestId) continue;
        const temper = v.traits.includes('skeptic') ? 1.6 : v.traits.includes('devout') ? 0.3 : v.traits.includes('fearful') ? 0.5 : 1;
        if (this.rng.chance(T.defyChance * temper)) this.defy(v, dead.id);
      }
    }
  }

  private defy(v: Villager, griefFor: VillagerId): void {
    const sim = this.sim;
    this.defiers.push({ id: v.id, since: sim.tick, griefFor });
    v.faith.love = 0;
    v.faith.fear = 0;
    sim.events.push(sim.tick, { type: 'defiance', id: v.id, griefFor });
  }

  private endDefiance(d: Defier, reason: DefianceEnd, witnesses: VillagerId[] = []): void {
    const sim = this.sim;
    this.defiers.splice(this.defiers.indexOf(d), 1);
    sim.events.push(sim.tick, { type: 'defianceEnd', id: d.id, reason });
    if (reason === 'struck') {
      // They saw what happens to those who stand against it.
      for (const id of witnesses) {
        const w = sim.villagers.byId(id);
        if (w?.alive) w.faith.fear = Math.min(1 - w.faith.love, w.faith.fear + T.struckFear);
      }
      this.dread = Math.min(1, this.dread + 0.15);
      for (const other of [...this.defiers]) if (this.rng.chance(0.5)) this.endDefiance(other, 'humbled');
    } else if (reason === 'humbled') {
      const v = sim.villagers.byId(d.id);
      if (v?.alive) v.faith.love = Math.min(1, v.faith.love + 0.3);
    }
  }

  private onEvent(e: SimEvent): void {
    const sim = this.sim;
    const me = sim.tribe.id;
    if (e.type === 'death' || e.type === 'exiled') {
      const d = this.defiers.find((x) => x.id === e.id);
      if (d) this.endDefiance(d, e.type === 'death' ? 'died' : 'gone');
      return;
    }
    if (e.tribe === undefined || e.tribe === me || !sim.tribe.members.length) return;
    if (e.type !== 'disaster' && e.type !== 'favored') return;
    const other = sim.tribes[e.tribe];
    if (!other?.members.length) return;
    if (sim.tick - (this.lastRivalry.get(e.tribe) ?? -Infinity) < TICKS_PER_DAY) return;
    this.lastRivalry.set(e.tribe, sim.tick);
    if (e.type === 'disaster') {
      // "They angered it. We must please it, or we'll be next."
      sim.war.shift(me, e.tribe, -T.scorn);
      this.dread = Math.min(1, this.dread + T.neighborDread);
      this.owe(sim.village.store.food * T.rivalOfferingShare, 'rivalry');
      sim.events.push(sim.tick, { type: 'rivalry', other: e.tribe, kind: 'scorn' });
    } else {
      // "Why them? What do they give it that we don't?"
      sim.war.shift(me, e.tribe, -T.envy);
      this.owe(sim.village.store.food * T.rivalOfferingShare, 'rivalry');
      sim.events.push(sim.tick, { type: 'rivalry', other: e.tribe, kind: 'envy' });
    }
  }

  private owe(amount: number, why: 'disaster' | 'rivalry'): void {
    if (amount <= this.pendingOffering) return;
    this.pendingOffering = amount;
    this.offeringFor = why;
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    const sim = this.sim;
    this.dread = Math.max(0, this.dread - T.dreadDecayPerDay);
    // Deep dread turns to fear in everyone but the defiers.
    if (this.dread > 0.3)
      for (const v of sim.villagers.alive) if (!this.isDefier(v)) v.faith.fear = Math.min(1 - v.faith.love, v.faith.fear + this.dread * 0.01);
    // A god that does nothing to those who defy it: they're proven right, and others join.
    for (const d of this.defiers) {
      const v = sim.villagers.byId(d.id);
      if (!v?.alive) continue;
      v.faith.love = 0;
      v.faith.fear = 0;
      if (sim.tick - Math.max(d.since, this.lastHarm) < T.vindicatedDays * TICKS_PER_DAY) continue;
      d.since = sim.tick;
      v.standing = Math.min(1, v.standing + 0.1);
      const recruit = sim.villagers.alive.find((o) => !this.isDefier(o) && o.lifeStage === 'adult' && o.traits.includes('skeptic') && o.id !== sim.belief.priestId && (sim.society.bond(o, v) ?? 0) > 0);
      sim.events.push(sim.tick, { type: 'vindicated', id: v.id });
      if (recruit && this.defiers.length < T.maxDefiers) this.defy(recruit, -1);
      break;
    }
  }

  /** At the evening fire: the defiers speak, offerings burn, and sometimes a person is given to the god. */
  dusk(present: Villager[]): void {
    const sim = this.sim;
    const c = sim.village.center;
    // Defiers at the fire take the fear out of those who listen.
    const speaking = this.defiers.filter((d) => present.some((p) => p.id === d.id));
    if (speaking.length) {
      for (const p of present) {
        if (this.isDefier(p)) continue;
        p.faith.fear = Math.max(0, p.faith.fear - T.defierFearCure * speaking.length);
        p.faith.love = Math.max(0, p.faith.love - T.defierFearCure * 0.5 * speaking.length);
      }
      if (this.rng.chance(0.5)) sim.events.push(sim.tick, { type: 'defies', id: this.rng.pick(speaking).id, x: Math.round(c.x), z: Math.round(c.z) });
    }

    if (this.pendingOffering > 0) {
      const amount = Math.min(sim.village.store.food, this.pendingOffering) * (1 - this.defierShare());
      if (amount >= 1) {
        sim.village.store.food -= amount;
        sim.belief.lastOfferingTick = sim.tick;
        sim.belief.deeds.add({ key: 'deed:offering', actorId: sim.belief.priestId, victimIds: [], x: c.x, z: c.z, tick: sim.tick });
        this.dread = Math.max(0, this.dread - T.offeringCalm);
        sim.events.push(sim.tick, { type: 'greatOffering', amount: Math.round(amount), why: this.offeringFor || 'disaster', x: Math.round(c.x), z: Math.round(c.z) });
      }
      this.pendingOffering = 0;
      this.offeringFor = '';
    }

    this.sacrifice(present);
  }

  /**
   * When the dread is deep (or giving a life has come to be a rite), the priest
   * chooses someone the people can spare: one the god turned from, one they
   * have judged, or one of no standing.
   */
  private sacrifice(present: Villager[]): void {
    const sim = this.sim;
    const priest = sim.villagers.byId(sim.belief.priestId);
    if (!priest?.alive || !present.includes(priest)) return;
    if (sim.tick - this.lastSacrifice < T.sacrificeRestDays * TICKS_PER_DAY) return;
    if (sim.villagers.alive.length < T.sacrificeMinPeople) return;
    // Giving a life can become a rite (the god relented after one), or a taboo (it struck back).
    const rite = sim.belief.active('RITUAL').some((b) => b.subject === 'deed:sacrifice');
    const ritual = rite && sim.belief.festivalToday;
    if ((this.dread < T.sacrificeAt && !ritual) || sim.effects.taboo('deed:sacrifice') > 0) return;
    // A people led by doubters, or with many defiers, won't.
    if (sim.dissent.doubterShare() > 0.3 || this.defierShare() > 0.15) return;
    const pool = present.filter((v) => v !== priest && v.lifeStage !== 'child' && !this.isDefier(v));
    if (!pool.length) return;
    const outcast = sim.effects.outcastIds(0.1);
    const score = (v: Villager) => (outcast.has(v.id) ? 3 : 0) + (sim.justice.convictions.get(v.id) ?? 0) + (1 - v.standing) + (v.lifeStage === 'elder' ? 0.3 : 0);
    const victim = [...pool].sort((a, b) => score(b) - score(a) || a.id - b.id)[0]!;
    this.lastSacrifice = sim.tick;
    this.dread = Math.max(0, this.dread - T.sacrificeCalm);
    // Their kin won't forgive the priest.
    for (const id of [victim.partnerId, ...victim.parentIds, ...victim.childIds]) {
      const k = sim.villagers.byId(id);
      if (k?.alive) sim.society.shift(k, priest, -TUNING.society.bloodGrudge);
    }
    const fire = sim.village.center;
    sim.belief.deeds.add({ key: 'deed:sacrifice', actorId: priest.id, victimIds: [victim.id], x: Math.round(fire.x), z: Math.round(fire.z), tick: sim.tick });
    sim.events.push(sim.tick, { type: 'sacrifice', id: victim.id, priest: priest.id, x: Math.round(victim.x), z: Math.round(victim.z), ritual });
    sim.villagers.kill(victim, 'sacrificed');
  }
}

