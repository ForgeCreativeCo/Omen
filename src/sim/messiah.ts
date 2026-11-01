import type { DeathCause, SimEvent } from './events';
import { BASE_VALENCE } from './belief/interpret';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY } from './time';
import type { Tribe } from './tribe';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.messiah;

/** How a messiah's death is remembered. */
export type MessiahDeath = 'saint' | 'martyr' | 'takenHome';

/** Their body, for three days after they die: the Hand can still raise them. */
export interface MessiahBody {
  x: number;
  z: number;
  untilTick: number;
}

/** A messiah walking to another people to preach. */
export interface Journey {
  to: number;
  x: number;
  z: number;
  /** Ticks before they give up and go home. */
  left: number;
}

const DIVINE: ReadonlySet<DeathCause> = new Set(['lightning', 'meteor', 'thrown', 'crushed', 'quake', 'firestorm']);
const KILLED: ReadonlySet<DeathCause> = new Set(['killed', 'executed', 'battle', 'sacrificed']);

/**
 * The messiah: one person the god names as its own. Witnesses hold them chosen;
 * their people credit the god's wonders near them to them (and love the god a
 * little less for it); they preach at the fire, bringing doubters back and
 * pulling followers from a False Prophet; now and then they walk to another
 * people and preach there, and some of their listeners come away with them. The
 * priest comes to resent them, and enemies may kill them. Their death is
 * remembered by how it came: a saint (their grave holy), a martyr (grief and a
 * wave of faith; their killers' own people turn on them), or taken home by the
 * god (the people split). For three days their body lies where they fell, and the
 * Hand can raise them.
 */
export class Messiah {
  /** The living messiah (or the one whose body still lies), or -1. */
  id: VillagerId = -1;
  tribe = -1;
  sinceTick = 0;
  /** Wonders their people credited to them. */
  credits = 0;
  /** People who came over to their people when they preached. */
  converts = 0;
  /** Once risen, they don't rise again. */
  risen = false;
  body: MessiahBody | null = null;
  journey: Journey | null = null;
  /** Everyone who has been the messiah. */
  readonly past: { id: VillagerId; tribe: number; death: MessiahDeath | null }[] = [];
  private nextJourney = 0;
  private lastSeq = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** The living messiah. */
  get living(): Villager | null {
    const v = this.id >= 0 ? this.sim.villagers.byId(this.id) : undefined;
    return v?.alive && !this.body ? v : null;
  }

  is(v: { id: number }): boolean {
    return this.id === v.id && !this.body;
  }

  /** Can this person be anointed? One messiah at a time; a living, waking adult. */
  canAnoint(id: VillagerId): boolean {
    if (this.id >= 0) return false;
    const v = this.sim.villagers.byId(id);
    return !!v?.alive && v.lifeStage === 'adult' && !(v.action?.kind === 'sleep' && v.action.phase === 'work');
  }

  /** The god names its messiah: a pillar of light on them, and those who see it hold them chosen. */
  anoint(id: VillagerId): void {
    const sim = this.sim;
    const v = sim.villagers.byId(id)!;
    this.id = v.id;
    this.tribe = v.tribeId;
    this.sinceTick = sim.tick;
    this.credits = 0;
    this.converts = 0;
    this.risen = false;
    this.body = null;
    this.journey = null;
    this.nextJourney = sim.tick + T.firstJourneyDays * TICKS_PER_DAY;
    this.past.push({ id: v.id, tribe: v.tribeId, death: null });
    v.faith.love = Math.min(1, v.faith.love + 0.5);
    v.faith.fear = Math.min(v.faith.fear, 1 - v.faith.love);
    const seen: VillagerId[] = [];
    for (const o of sim.villagers.alive) {
      if (o === v || o.inside || Math.hypot(o.x - v.x, o.z - v.z) > T.witnessRange) continue;
      const t = sim.tribes[o.tribeId];
      if (!t) continue;
      t.belief.hold(o, 'CHOSEN_ONE', `person:${v.id}`, undefined, o.tribeId === v.tribeId ? T.anointHold : T.anointHold * 0.5, null);
      seen.push(o.id);
    }
    for (const t of sim.tribes) t.belief.refreshStrengths();
    sim.events.push(sim.tick, { type: 'anointed', id: v.id, x: v.x, z: v.z, witnesses: seen }, v.tribeId);
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    const events = sim.events.since(this.lastSeq);
    this.lastSeq = sim.events.lastSeq;
    if (this.id < 0) return;
    if (this.body) {
      if (sim.tick >= this.body.untilTick) this.buried();
      return;
    }
    const v = sim.villagers.byId(this.id);
    if (!v) return void (this.id = -1);
    for (const e of events) {
      if (e.type === 'death' && e.id === v.id) return this.died(v, e.cause, events);
      if (e.type === 'omen') this.credit(v, e.omenId);
    }
    if (!v.alive) return;
    // Taken in by another people (captured, conquered): their messiah now.
    this.tribe = v.tribeId;
    if (this.journey) this.walk(v);
  }

  /** A wonder near the messiah: their people say the messiah did it. */
  private credit(v: Villager, omenId: string): void {
    const sim = this.sim;
    const t = sim.tribes[this.tribe];
    const o = t?.belief.omen(omenId);
    if (!t || !o || !o.isDivine || BASE_VALENCE[o.kind] <= 0) return;
    if (Math.hypot(o.position.x - v.x, o.position.z - v.z) > T.creditRange + o.radius) return;
    const credit = T.creditHold;
    let n = 0;
    for (const id of o.witnesses) {
      const w = sim.villagers.byId(id);
      if (!w?.alive || w.tribeId !== this.tribe || w === v) continue;
      t.belief.hold(w, 'CHOSEN_ONE', `person:${v.id}`, undefined, credit, o);
      // What the god did, they lay at the messiah's feet.
      w.faith.love = Math.max(0, w.faith.love - T.creditDrain);
      n++;
    }
    if (!n) return;
    t.belief.refreshStrengths();
    this.credits++;
    sim.events.push(sim.tick, { type: 'messiahCredited', id: v.id, kind: o.kind, omenId }, this.tribe);
  }

  // ------------------------------------------------------------------ dusk: preaching

  /** At the evening fire the messiah preaches: their faith spreads, doubters come back. */
  dusk(): void {
    const sim = this.sim;
    const v = this.living;
    if (!v || this.journey) return;
    const t = sim.tribes[v.tribeId];
    if (!t || v.inside) return;
    const present = t.members.filter((o) => o !== v && !o.inside && Math.hypot(o.x - v.x, o.z - v.z) <= T.preachRange);
    if (!present.length) return;
    const held = [...t.belief.beliefs.values()].filter((b) => (b.holders.get(v.id) ?? 0) >= T.preachHeld && b.type !== 'CHOSEN_ONE').slice(0, 4);
    const lead = t.dissent.leader;
    let won = 0;
    for (const o of present) {
      for (const b of held) t.belief.hold(o, b.type, b.subject, b.response, T.preachRate, null);
      t.belief.hold(o, 'CHOSEN_ONE', `person:${v.id}`, undefined, T.preachRate, null);
      o.faith.love = Math.min(1 - o.faith.fear, o.faith.love + T.preachLove);
      // Those listening to a Doubter or a False Prophet drift back.
      const p = t.dissent.pull.get(o.id);
      if (p !== undefined && o.id !== lead?.id) {
        const np = p * (1 - T.pullAway);
        if (np < TUNING.dissent.followAt && p >= TUNING.dissent.followAt) won++;
        t.dissent.pull.set(o.id, np);
      }
    }
    t.belief.refreshStrengths();
    // A doubter sitting at the messiah's fire may come round.
    if (lead && lead.kind === 'doubter' && present.some((o) => o.id === lead.id) && this.rng.chance(T.convertDoubter)) t.dissent.end('converted');
    sim.events.push(sim.tick, { type: 'preached', id: v.id, heard: present.length, won }, v.tribeId);
  }

  // ------------------------------------------------------------------ dawn: journeys and rivals

  dawn(): void {
    const sim = this.sim;
    const v = this.living;
    if (!v) return;
    const t = sim.tribes[v.tribeId]!;
    // The priest resents one who speaks for the god over their head.
    const priest = sim.villagers.byId(t.belief.priestId);
    if (priest?.alive && priest !== v) sim.society.shift(priest, v, -T.priestResent);
    if (this.plot(v, t)) return;
    if (!this.journey && sim.tick >= this.nextJourney && this.rng.chance(T.journeyChance)) this.setOut(v, t);
  }

  /** Someone who hates the messiah, or defies the god, may kill them. */
  private plot(v: Villager, t: Tribe): boolean {
    const sim = this.sim;
    const defiers = new Set(t.appease.defiers.map((d) => d.id));
    const foes = t.members.filter((o) => o !== v && o.lifeStage === 'adult' && (defiers.has(o.id) || sim.society.bond(o, v) <= T.hateAt));
    if (!foes.length || !this.rng.chance(T.plotChance * foes.length)) return false;
    const killer = this.rng.pick(foes);
    sim.society.kill(killer, v, this.rng.chance(0.6));
    return true;
  }

  /** Off to preach to another people. */
  private setOut(v: Villager, t: Tribe): void {
    const sim = this.sim;
    const others = sim.tribes.filter((o) => o.id !== t.id && o.members.length >= 3 && o.village.centerRegion === t.village.centerRegion);
    if (!others.length) return;
    const to = others.sort((a, b) => Math.hypot(a.village.center.x - v.x, a.village.center.z - v.z) - Math.hypot(b.village.center.x - v.x, b.village.center.z - v.z))[0]!;
    const c = to.village.center;
    this.journey = { to: to.id, x: c.x, z: c.z, left: T.journeyDays * TICKS_PER_DAY };
    sim.villagers.order(v, 'pilgrimage', Math.round(c.x), Math.round(c.z), T.preachTicks);
    sim.events.push(sim.tick, { type: 'messiahJourney', id: v.id, to: to.id, x: c.x, z: c.z }, v.tribeId);
  }

  private walk(v: Villager): void {
    const sim = this.sim;
    const j = this.journey!;
    j.left--;
    const host = sim.tribes[j.to];
    if (!host?.members.length || j.left <= 0) return this.home(v, 0);
    if (Math.hypot(v.x - j.x, v.z - j.z) > T.arriveWithin) {
      if (v.action?.kind !== 'pilgrimage' && (sim.tick + v.id) % 40 === 0) sim.villagers.order(v, 'pilgrimage', Math.round(j.x), Math.round(j.z), T.preachTicks);
      return;
    }
    // Among enemies, they may not live to speak.
    if (sim.war.atWar(v.tribeId, host.id) && this.rng.chance(T.enemyKills)) {
      const killer = host.members.filter((o) => o.lifeStage === 'adult').sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))[0];
      if (killer) {
        sim.society.kill(killer, v, true);
        return;
      }
    }
    // They preach; some who hear come away with them.
    const heard = host.members.filter((o) => !o.inside && Math.hypot(o.x - v.x, o.z - v.z) <= T.preachRange * 1.5);
    const fond = Math.max(0, sim.war.relation(v.tribeId, host.id) + 0.5);
    const came: Villager[] = [];
    for (const o of heard) {
      if (o.id === host.belief.priestId || o.lifeStage === 'child') continue;
      host.belief.hold(o, 'CHOSEN_ONE', `person:${v.id}`, undefined, T.preachRate * 2, null);
      const k = T.convertChance * fond * (o.traits.includes('devout') ? 0.5 : 1) * (o.traits.includes('curious') ? 1.5 : 1);
      if (this.rng.chance(k)) came.push(o);
    }
    host.belief.refreshStrengths();
    for (const o of came) {
      this.join(o, v.tribeId);
      // Their young children come with them.
      for (const id of o.childIds) {
        const k = sim.villagers.byId(id);
        if (k?.alive && k.lifeStage === 'child' && k.tribeId === host.id) this.join(k, v.tribeId);
      }
    }
    this.home(v, came.length, heard.length);
  }

  /** Someone comes over to the messiah's people. */
  private join(o: Villager, tribe: number): void {
    const sim = this.sim;
    const from = sim.tribes[o.tribeId];
    const home = from?.village.byId(o.homeId);
    if (home) home.residents = home.residents.filter((id) => id !== o.id);
    o.homeId = -1;
    o.tribeId = tribe;
    o.faith.love = Math.min(1 - o.faith.fear, o.faith.love + 0.3);
    sim.tribes[tribe]?.belief.inherit(o);
    this.converts++;
    const t = sim.tribes[tribe];
    if (t && !o.inside) {
      const c = t.village.center;
      sim.villagers.order(o, 'pilgrimage', Math.round(c.x), Math.round(c.z), 20);
    }
  }

  private home(v: Villager, came: number, heard = 0): void {
    const sim = this.sim;
    const j = this.journey!;
    this.journey = null;
    this.nextJourney = sim.tick + T.journeyEveryDays * TICKS_PER_DAY;
    const c = sim.tribes[v.tribeId]?.village.center;
    if (c) sim.villagers.order(v, 'pilgrimage', Math.round(c.x), Math.round(c.z), 20);
    sim.events.push(sim.tick, { type: 'messiahPreachedAbroad', id: v.id, to: j.to, heard, came }, v.tribeId);
  }

  // ------------------------------------------------------------------ death

  private died(v: Villager, cause: DeathCause, events: readonly SimEvent[]): void {
    const sim = this.sim;
    const t = sim.tribes[v.tribeId];
    this.journey = null;
    this.body = { x: v.x, z: v.z, untilTick: sim.tick + T.bodyDays * TICKS_PER_DAY };
    const death: MessiahDeath = DIVINE.has(cause) ? 'takenHome' : KILLED.has(cause) ? 'martyr' : 'saint';
    const rec = this.past[this.past.length - 1];
    if (rec) rec.death = death;
    let killerTribe = -1;
    if (t) {
      const people = t.members;
      const love = (o: Villager, d: number) => (o.faith.love = Math.max(0, Math.min(1 - o.faith.fear, o.faith.love + d)));
      if (death === 'saint') {
        // Where they lie is holy.
        const key = t.myth.hallowedSite(v.x, v.z, 3);
        for (const o of people) t.belief.hold(o, 'SACRED_PLACE', key, 'favor', T.saintHold, null);
        t.belief.refreshStrengths();
      } else if (death === 'martyr') {
        for (const o of people) love(o, T.martyrLove);
        // Whoever did it: their own people turn on them.
        const k = events.find((e) => e.type === 'killing' && e.victim === v.id);
        const killer = k?.type === 'killing' ? sim.villagers.byId(k.killer) : undefined;
        if (killer) {
          killerTribe = killer.tribeId;
          const theirs = sim.tribes[killer.tribeId]?.members ?? [];
          for (const o of theirs) if (o !== killer) sim.society.shift(o, killer, -T.martyrShame);
          if (killer.tribeId !== v.tribeId) {
            sim.war.shift(v.tribeId, killer.tribeId, -T.martyrShame);
            // Some of the killers' people, ashamed, come over.
            const ashamed = this.rng.shuffle(theirs.filter((o) => o !== killer && o.lifeStage === 'adult' && o.faith.love >= 0.4)).slice(0, T.martyrConverts);
            for (const o of ashamed) this.join(o, v.tribeId);
          }
        }
      } else {
        // Taken home by the god: the faithful say it called them; the rest, that it abandoned them.
        for (const o of people) {
          if (o.faith.love >= T.splitAt) love(o, T.takenLove);
          else {
            love(o, -T.abandonedLove);
            o.faith.fear = Math.min(1, o.faith.fear + 0.1);
          }
        }
      }
    }
    sim.events.push(sim.tick, { type: 'messiahDied', id: v.id, death, cause, x: v.x, z: v.z, killerTribe }, this.tribe);
  }

  /** The days have passed: they stay dead. */
  private buried(): void {
    this.sim.events.push(this.sim.tick, { type: 'messiahBuried', id: this.id }, this.tribe);
    this.id = -1;
    this.body = null;
  }

  /** The Hand takes up the body: they rise. Returns them, alive. */
  raise(): Villager | null {
    const sim = this.sim;
    const b = this.body;
    if (!b || this.risen) return null;
    const v = sim.villagers.byId(this.id);
    if (!v) return null;
    this.body = null;
    this.risen = true;
    v.alive = true;
    v.deathTick = 0;
    v.deathCause = null;
    v.x = b.x;
    v.z = b.z;
    v.y = sim.world.topY(Math.floor(b.x), Math.floor(b.z)) + 1;
    v.needs.hunger = 0;
    v.needs.energy = 1;
    v.needs.safety = 1;
    v.faith.love = 1;
    v.faith.fear = 0;
    v.lying = false;
    v.inside = false;
    v.action = null;
    v.path = [];
    v.pathPos = -1;
    v.nextThink = sim.tick;
    // Old age can't take back what the god gave back.
    v.lifespan = Math.max(v.lifespan, v.age + T.risenYears);
    const partner = sim.villagers.byId(v.partnerId);
    if (!partner?.alive || partner.partnerId !== -1) v.partnerId = -1;
    else partner.partnerId = v.id;
    if (!sim.villagers.alive.includes(v)) sim.villagers.alive.push(v);
    const rec = this.past[this.past.length - 1];
    if (rec) rec.death = null;
    // Everyone hears of it; those who see it never doubt again.
    const witnesses: VillagerId[] = [];
    for (const o of sim.villagers.alive) {
      if (o === v) continue;
      const t = sim.tribes[o.tribeId];
      if (!t) continue;
      const saw = !o.inside && Math.hypot(o.x - v.x, o.z - v.z) <= T.witnessRange;
      const ours = o.tribeId === v.tribeId;
      t.belief.hold(o, 'CHOSEN_ONE', `person:${v.id}`, undefined, saw ? T.risenHold : T.risenHold * 0.3, null);
      o.faith.love = Math.min(1 - o.faith.fear * 0.5, o.faith.love + (saw ? T.risenLove : ours ? T.risenLove / 2 : T.risenLove / 4));
      if (saw) {
        o.faith.fear = Math.max(0, o.faith.fear - 0.1);
        witnesses.push(o.id);
      }
      if (ours && t.dissent.isDoubter(o) && t.dissent.leader?.id === o.id && saw) t.dissent.end('converted');
    }
    // Some of the other peoples who saw it come to them.
    const came = this.rng.shuffle(witnesses.map((id) => sim.villagers.byId(id)!).filter((o) => o.tribeId !== v.tribeId && o.lifeStage === 'adult' && o.id !== sim.tribes[o.tribeId]?.belief.priestId)).slice(0, T.risenConverts);
    for (const o of came) this.join(o, v.tribeId);
    for (const t of sim.tribes) t.belief.refreshStrengths();
    sim.events.push(sim.tick, { type: 'messiahRisen', id: v.id, x: v.x, z: v.z, witnesses: witnesses.length, came: came.length }, v.tribeId);
    return v;
  }
}
