import type { DeathCause, SimEvent } from './events';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY } from './time';
import type { Tribe } from './tribe';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.prayers;

export type PrayerKind = 'rain' | 'harvest' | 'heal' | 'child' | 'vengeance' | 'guidance' | 'mercy';

/** How a prayer ended: the god answered, the world did (they thank the god anyway), silence, or harm. */
export type PrayerEnd = 'answered' | 'luck' | 'unheard' | 'defied' | 'lost';

/** Someone asking the god for something, out loud, for a while. */
export interface Prayer {
  id: number;
  tribe: number;
  kind: PrayerKind;
  asker: VillagerId;
  /** Heal: the sick one. Child: the partner. */
  for: VillagerId;
  /** Vengeance: the people that wronged them. */
  against: number;
  bornTick: number;
  untilTick: number;
}

/** Deaths the god's hand is behind. */
const DIVINE: ReadonlySet<DeathCause> = new Set(['lightning', 'meteor', 'thrown', 'crushed', 'quake', 'firestorm']);

/**
 * Prayers: people asking the god for things. Each dawn a people in need may
 * raise a prayer (rain for dry fields, food, healing for the sick, a child,
 * vengeance on raiders, somewhere new to live, mercy after a disaster). It stays
 * open for a few days. Answer it and the one who asked (and their family, and a
 * little the whole people) love the god more; let it pass and they love it less;
 * harm their people while it's open and they take that as the answer. When the
 * world answers on its own (rain falls, the sick get better, a baby comes) they
 * thank the god anyway.
 */
export class Prayers {
  readonly open: Prayer[] = [];
  /** `${tribe}:${kind}` → the tick it was last raised. */
  private readonly lastAsked = new Map<string, number>();
  /** Tribe → its last raid suffered: who from, and when. */
  private readonly wronged = new Map<number, { by: number; tick: number }>();
  /** Tribe → its last disaster. */
  private readonly struck = new Map<number, number>();
  /** Tribe → how its prayers have gone. */
  readonly record = new Map<number, { answered: number; unheard: number; defied: number }>();
  private lastSeq = 0;
  private nextId = 1;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  of(tribe: number): Prayer[] {
    return this.open.filter((p) => p.tribe === tribe);
  }

  /** The open prayer this person raised, if any. */
  byAsker(id: VillagerId): Prayer | undefined {
    return this.open.find((p) => p.asker === id);
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    const events = sim.events.since(this.lastSeq);
    this.lastSeq = sim.events.lastSeq;
    for (const e of events) this.watch(e);
    if (!this.open.length) return;
    const harmed = this.harmed(events);
    for (const p of [...this.open]) {
      const asker = sim.villagers.byId(p.asker);
      if (!asker?.alive || asker.tribeId !== p.tribe) {
        this.close(p, 'lost', true);
        continue;
      }
      if (harmed.has(p.tribe) && p.kind !== 'vengeance') {
        this.close(p, 'defied');
        continue;
      }
      const end = this.answer(p, events, harmed);
      if (end) this.close(p, end);
      else if (sim.tick >= p.untilTick) this.close(p, 'unheard');
    }
  }

  /** Remember what they'll pray about: raids suffered, disasters. */
  private watch(e: SimEvent): void {
    if (e.type === 'raidEnd' && (e.defendersLost > 0 || e.burned || e.loot > 0 || (e.captives ?? 0) > 0)) this.wronged.set(e.to, { by: e.from, tick: e.tick });
    else if (e.type === 'disaster' && e.tribe !== undefined) this.struck.set(e.tribe, e.tick);
  }

  /** Peoples the god harmed in these events: their dead, their homes, their fields. */
  private harmed(events: readonly SimEvent[]): Set<number> {
    const sim = this.sim;
    const out = new Set<number>();
    const person = (id: number) => {
      const v = sim.villagers.byId(id);
      if (!v) return;
      // The guilty struck down is justice, not an answer to the rest.
      if (v.alive && sim.tribes[v.tribeId]?.justice.pending(v)) return;
      out.add(v.tribeId);
    };
    const building = (id: number) => {
      const t = sim.tribes.find((t) => t.village.byId(id));
      if (t) out.add(t.id);
    };
    for (const e of events) {
      switch (e.type) {
        case 'death':
          if (DIVINE.has(e.cause)) person(e.id);
          break;
        case 'meteor':
        case 'cataclysm':
        case 'quakeEnd':
        case 'firestormEnd':
        case 'handImpact':
          e.killed.forEach(person);
          e.wrecked.forEach(building);
          break;
        case 'waveEnd':
          e.carried.forEach(person);
          e.wrecked.forEach(building);
          break;
        case 'plague':
          e.ids.forEach(person);
          break;
        case 'swarm':
          out.add(e.tribe);
          break;
        case 'blight':
          for (const t of sim.tribes) if (this.nearFields(t, e.x, e.z, e.radius + 1) && e.crops > 0) out.add(t.id);
          break;
      }
    }
    return out;
  }

  /** Did these events answer it? */
  private answer(p: Prayer, events: readonly SimEvent[], harmed: Set<number>): PrayerEnd | null {
    const sim = this.sim;
    const t = sim.tribes[p.tribe]!;
    const c = t.village.center;
    const near = (x: number, z: number, r: number) => Math.hypot(x - c.x, z - c.z) <= r || this.nearFields(t, x, z, r - T.villageReach + 4);
    const ours = (id: number) => sim.villagers.byId(id)?.tribeId === p.tribe;
    for (const e of events) {
      switch (p.kind) {
        case 'rain':
          if (e.type === 'miracleRain' && near(e.x, e.z, T.villageReach + e.radius)) return 'answered';
          if (e.type === 'rainStart' && !e.divine) return 'luck';
          break;
        case 'harvest':
          if (e.type === 'bloom' && e.crops > 0 && this.nearFields(t, e.x, e.z, e.radius + 1)) return 'answered';
          if (e.type === 'blessPlace' && e.kind === 'field' && e.tribe === p.tribe) return 'answered';
          break;
        case 'heal':
          if (e.type === 'blessing' && e.villagerId === p.for) return 'answered';
          // Bless cures first, then blesses: a recovery with the god's touch beside it is the god's.
          if (e.type === 'recovered' && e.id === p.for) return events.some((x) => x.type === 'blessing' && x.villagerId === p.for) ? 'answered' : 'luck';
          if (e.type === 'death' && e.id === p.for) return DIVINE.has(e.cause) ? 'defied' : 'lost';
          break;
        case 'child':
          if (e.type === 'blessing' && (e.villagerId === p.asker || e.villagerId === p.for)) return 'answered';
          if (e.type === 'blessPlace' && e.kind === 'hut' && (e.residents.includes(p.asker) || e.residents.includes(p.for))) return 'answered';
          if (e.type === 'birth' && e.parents.includes(p.asker)) return 'luck';
          break;
        case 'vengeance':
          if (harmed.has(p.against)) return 'answered';
          if (harmed.has(p.tribe)) return 'defied';
          break;
        case 'guidance':
          if (e.type === 'hallow' && Math.hypot(e.x - c.x, e.z - c.z) >= TUNING.branching.minDistance) return 'answered';
          break;
        case 'mercy':
          if (e.type === 'blessing' && ours(e.villagerId)) return 'answered';
          if (e.type === 'blessPlace' && e.tribe === p.tribe) return 'answered';
          if ((e.type === 'holyLight' || e.type === 'miracleRain') && near(e.x, e.z, T.villageReach + e.radius)) return 'answered';
          if (e.type === 'bloom' && this.nearFields(t, e.x, e.z, e.radius + 1)) return 'answered';
          break;
      }
    }
    return null;
  }

  private nearFields(t: Tribe, x: number, z: number, r: number): boolean {
    return t.village.fields.some((f) => !f.destroyed && Math.hypot(f.x0 + f.w / 2 - x, f.z0 + f.d / 2 - z) <= r + Math.max(f.w, f.d) / 2);
  }

  private close(p: Prayer, end: PrayerEnd, quiet = false): void {
    const sim = this.sim;
    this.open.splice(this.open.indexOf(p), 1);
    if (quiet) return;
    const asker = sim.villagers.byId(p.asker);
    const rec = this.record.get(p.tribe) ?? { answered: 0, unheard: 0, defied: 0 };
    this.record.set(p.tribe, rec);
    const t = sim.tribes[p.tribe];
    if (asker?.alive && t) {
      const family = new Set([asker.partnerId, ...asker.parentIds, ...asker.childIds]);
      const love = (v: Villager, d: number) => (v.faith.love = Math.max(0, Math.min(1 - v.faith.fear, v.faith.love + d)));
      if (end === 'answered' || end === 'luck') {
        rec.answered++;
        const k = end === 'answered' ? 1 : T.luckShare;
        love(asker, T.askerLove * k);
        for (const v of t.members) if (v !== asker) love(v, (family.has(v.id) ? T.familyLove : T.peopleLove) * k);
        t.appease.dread = Math.max(0, t.appease.dread - T.dreadEased * k);
        t.dissent.lastWonderTick = sim.tick;
      } else if (end === 'unheard' || end === 'lost') {
        rec.unheard++;
        love(asker, -T.unheardLove);
        for (const v of t.members) if (family.has(v.id)) love(v, -T.unheardLove / 2);
      } else {
        rec.defied++;
        asker.faith.fear = Math.min(1, asker.faith.fear + T.defiedFear);
        love(asker, -T.defiedLove);
      }
    }
    sim.events.push(sim.tick, { type: 'prayerEnd', id: p.id, kind: p.kind, asker: p.asker, for: p.for, against: p.against, end }, p.tribe);
  }

  // ------------------------------------------------------------------ dawn

  /** Each dawn, a people in need may raise a prayer. */
  dawn(): void {
    const sim = this.sim;
    for (const t of sim.tribes) {
      if (this.open.length >= T.maxOpen) return;
      const people = t.members;
      if (people.length < 2 || this.of(t.id).length >= T.maxPerPeople) continue;
      if (!this.rng.chance(T.dailyChance)) continue;
      const wants = this.needs(t, people);
      if (!wants.length) continue;
      const w = wants[this.rng.int(0, wants.length - 1)]!;
      this.raise(t, w);
    }
  }

  private ready(t: Tribe, kind: PrayerKind): boolean {
    if (this.open.some((p) => p.tribe === t.id && p.kind === kind)) return false;
    const last = this.lastAsked.get(`${t.id}:${kind}`);
    return last === undefined || this.sim.tick - last >= T.againDays[kind] * TICKS_PER_DAY;
  }

  /** Who would ask the god for what, today. */
  private needs(t: Tribe, people: Villager[]): Omit<Prayer, 'id' | 'tribe' | 'bornTick' | 'untilTick'>[] {
    const sim = this.sim;
    const out: Omit<Prayer, 'id' | 'tribe' | 'bornTick' | 'untilTick'>[] = [];
    const adults = people.filter((v) => v.lifeStage === 'adult' && !this.byAsker(v.id));
    if (!adults.length) return out;
    const devout = [...adults].sort((a, b) => b.faith.love - a.faith.love || a.id - b.id);
    const pick = (list: Villager[]) => list[this.rng.int(0, list.length - 1)]!;
    const day = sim.tick;

    // Rain: the fields are drying in a growing season.
    const fields = t.village.fields.filter((f) => !f.destroyed && f.tiles.length);
    const growing = TUNING.farming.seasonGrowth[sim.seasonIndex]! > 0;
    if (this.ready(t, 'rain') && growing && fields.length && !sim.weather.raining) {
      const dry = fields.filter((f) => f.moisture < T.dryBelow && !f.nearWater).length;
      if (sim.weather.drought || dry >= Math.max(1, fields.length / 2)) {
        const farmers = adults.filter((v) => v.role === 'farmer');
        out.push({ kind: 'rain', asker: pick(farmers.length ? farmers : adults).id, for: -1, against: -1 });
      }
    }
    // Food: the stores are running low.
    if (this.ready(t, 'harvest') && t.village.store.food / people.length < T.hungryBelow) out.push({ kind: 'harvest', asker: pick(adults).id, for: -1, against: -1 });
    // Healing: someone is sick; their kin ask.
    if (this.ready(t, 'heal')) {
      const sick = people.filter((v) => sim.plague.isSick(v)).sort((a, b) => a.id - b.id);
      for (const s of sick) {
        const kin = adults.filter((v) => !sim.plague.isSick(v) && (v.id === s.partnerId || s.parentIds.includes(v.id) || s.childIds.includes(v.id)));
        const asker = kin.length ? pick(kin) : adults.includes(s) ? s : null;
        if (asker) {
          out.push({ kind: 'heal', asker: asker.id, for: s.id, against: -1 });
          break;
        }
      }
    }
    // A child: a couple of age, with few or none.
    if (this.ready(t, 'child') && this.rng.chance(T.childChance)) {
      const V = TUNING.villagers;
      const mothers = adults.filter((m) => {
        if (m.sex !== 'f' || m.partnerId < 0 || m.age < V.fertileMinAge || m.age > V.fertileMaxAge) return false;
        const f = sim.villagers.byId(m.partnerId);
        return !!f?.alive && m.childIds.filter((c) => f.childIds.includes(c)).length < 1;
      });
      if (mothers.length) {
        const m = pick(mothers);
        out.push({ kind: 'child', asker: m.id, for: m.partnerId, against: -1 });
      }
    }
    // Vengeance: raiders hurt them, and the war goes on.
    const w = this.wronged.get(t.id);
    if (w && this.ready(t, 'vengeance') && day - w.tick <= T.vengeanceDays * TICKS_PER_DAY && sim.war.atWar(t.id, w.by) && sim.tribes[w.by]?.members.length)
      out.push({ kind: 'vengeance', asker: pick(adults).id, for: -1, against: w.by });
    // Somewhere new: too many for this valley.
    const B = TUNING.branching;
    if (
      this.ready(t, 'guidance') &&
      sim.mode !== 'warning' &&
      people.length >= B.crowdedAt &&
      !sim.branching.callings.some((c) => c.tribe === t.id) &&
      sim.tribes.filter((o) => o.members.length).length < B.maxPeoples
    )
      out.push({ kind: 'guidance', asker: pick(devout.slice(0, 4)).id, for: -1, against: -1 });
    // Mercy: after a disaster, or in deep dread.
    const struck = this.struck.get(t.id);
    if (this.ready(t, 'mercy') && ((struck !== undefined && day - struck <= T.mercyDays * TICKS_PER_DAY) || t.appease.dread >= T.mercyDread))
      out.push({ kind: 'mercy', asker: pick(devout.slice(0, 4)).id, for: -1, against: -1 });
    return out;
  }

  private raise(t: Tribe, w: Omit<Prayer, 'id' | 'tribe' | 'bornTick' | 'untilTick'>): void {
    const sim = this.sim;
    const p: Prayer = { ...w, id: this.nextId++, tribe: t.id, bornTick: sim.tick, untilTick: sim.tick + Math.round(T.days[w.kind] * TICKS_PER_DAY) };
    this.open.push(p);
    this.lastAsked.set(`${t.id}:${w.kind}`, sim.tick);
    sim.events.push(sim.tick, { type: 'prayer', id: p.id, kind: p.kind, asker: p.asker, for: p.for, against: p.against, until: p.untilTick }, t.id);
  }
}
