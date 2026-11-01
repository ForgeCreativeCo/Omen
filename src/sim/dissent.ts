import type { DissentEndReason, DissentKind } from './events';
import { findSettlement } from './exodus';
import type { Omen } from './omens/types';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './time';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.dissent;

/** What a False Prophet forbids in the god's name. */
const PROPHET_TABOOS = ['activity:dance', 'activity:woodcutting', 'activity:foraging', 'activity:quarrying'] as const;

export interface DissentLeader {
  id: VillagerId;
  kind: DissentKind;
  since: number;
  /** A prophet's invented taboo (a feature key). */
  rule?: string;
}

interface Prophecy {
  what: 'rain';
  until: number;
}

/**
 * Turning away: what neglect does. When no wonder has been seen for a while the
 * village notices the silence; when it goes on, someone speaks in the god's
 * place. A skeptic becomes a Doubter ("there is no god, only weather"); someone
 * else claims the god's voice as a False Prophet and invents its laws. Their
 * pull spreads at the evening fire, and past a share of the village it splits:
 * the faithful drive the leader out, or the followers walk away together.
 *
 * Doubters are not wicked: they skip rites and offerings and get more done.
 * Counterplay: a wonder in front of a Doubter converts them; a Dream makes
 * either kind recant; lightning near a prophet discredits them (other wonders
 * they claim as their own).
 */
export class Dissent {
  /** Last tick a divine wonder had someone watching. */
  lastWonderTick = 0;
  /** No new leader rises before this tick (after a movement ends, or longer after a split). */
  restUntil = 0;
  silent = false;
  leader: DissentLeader | null = null;
  /** How strongly each villager is drawn to the leader, 0..1. */
  readonly pull = new Map<VillagerId, number>();
  prophecy: Prophecy | null = null;
  /** Villagers walking off in a split (their departure isn't an exile). */
  readonly departing = new Set<VillagerId>();
  private lastSeq = 0;
  private lastClaimTick = -Infinity;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  get silenceDays(): number {
    return Math.floor((this.sim.tick - this.lastWonderTick) / TICKS_PER_DAY);
  }

  follows(v: Villager): boolean {
    if (!this.leader) return false;
    return v.id === this.leader.id || (this.pull.get(v.id) ?? 0) >= T.followAt;
  }

  followers(): Villager[] {
    return this.leader ? this.sim.villagers.alive.filter((v) => this.follows(v)) : [];
  }

  isDoubter(v: Villager): boolean {
    return this.leader?.kind === 'doubter' && this.follows(v);
  }

  /** Beliefs fade faster for those who doubt. */
  decayFactor(v: Villager): number {
    return this.isDoubter(v) ? T.doubterDecay : 1;
  }

  /** Doubters get more done (no rites to keep). */
  yieldFor(v: Villager): number {
    return this.isDoubter(v) ? T.doubterYield : 1;
  }

  /** How much of a villager's faith reaches the god as Grace. */
  graceShare(v: Villager): number {
    if (!this.leader || !this.follows(v)) return 1;
    return this.leader.kind === 'prophet' ? T.prophetGraceShare : 0;
  }

  /** Share of the living who doubt (offerings shrink by it). */
  doubterShare(): number {
    if (this.leader?.kind !== 'doubter') return 0;
    const alive = this.sim.villagers.alive;
    return alive.length ? alive.filter((v) => this.follows(v)).length / alive.length : 0;
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) {
      if (e.tribe !== undefined && e.tribe !== sim.tribe.id) continue;
      switch (e.type) {
        case 'omen': {
          const o = sim.belief.omen(e.omenId);
          if (o) this.onOmen(o);
          break;
        }
        case 'dream':
          if (this.leader?.id === e.villagerId) this.end('recanted');
          break;
        case 'rainStart':
          if (this.prophecy?.what === 'rain') this.resolveProphecy(true);
          break;
        case 'death':
          if (this.leader?.id === e.id) this.end(e.cause === 'lightning' || e.cause === 'meteor' || e.cause === 'firestorm' || e.cause === 'quake' ? 'discredited' : 'died');
          break;
        case 'exiled':
          if (this.leader?.id === e.id && !e.left) this.end('gone');
          break;
        default:
          break;
      }
    }
    this.lastSeq = sim.events.lastSeq;
  }

  private onOmen(o: Omen): void {
    if (!o.isDivine || o.kind === 'dream' || !o.witnesses.length) return;
    const sim = this.sim;
    this.lastWonderTick = sim.tick;
    this.silent = false;
    for (const id of o.witnesses) {
      const p = this.pull.get(id);
      if (p !== undefined) this.pull.set(id, Math.max(0, p - T.wonderCure * o.magnitude));
    }
    const lead = this.leader;
    if (!lead) return;
    const v = sim.villagers.byId(lead.id);
    if (lead.kind === 'doubter') {
      // Seeing is believing.
      if (o.witnesses.includes(lead.id)) this.end('converted');
      return;
    }
    // A prophet struck at, in front of everyone, is shown up.
    const near = v && Math.hypot(v.x - o.position.x, v.z - o.position.z) <= T.discreditRadius;
    if ((o.kind === 'lightning' || o.kind === 'meteor' || o.kind === 'cataclysm' || o.kind === 'firestorm' || o.kind === 'quake') && near) {
      this.end('discredited');
      return;
    }
    // Anything else, the prophet claims as their own doing.
    if (v?.alive && o.witnesses.includes(lead.id)) {
      for (const f of this.followers()) if (f.id !== lead.id) this.pull.set(f.id, Math.min(1, (this.pull.get(f.id) ?? 0) + T.wonderCure * 0.5));
      if (sim.tick - this.lastClaimTick > TICKS_PER_DAY) {
        this.lastClaimTick = sim.tick;
        sim.events.push(sim.tick, { type: 'prophetClaims', id: lead.id });
      }
    }
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    const sim = this.sim;
    const days = this.silenceDays;
    if (!this.silent && days >= T.silenceDays) {
      this.silent = true;
      sim.events.push(sim.tick, { type: 'silence', days });
    }
    if (!this.leader && days >= T.leaderAfterDays && sim.tick >= this.restUntil) this.raise();

    // Pull fades without the leader's voice; doubters stop praying, and their faith goes.
    for (const [id, p] of this.pull) {
      const v = sim.villagers.byId(id);
      const np = this.leader ? p * (1 - T.pullFadePerDay) : p * 0.5;
      if (!v?.alive || np < 0.02) this.pull.delete(id);
      else this.pull.set(id, np);
    }
    for (const v of sim.villagers.alive) {
      if (!this.isDoubter(v)) continue;
      v.faith.love *= 1 - T.doubterFaithFade;
      v.faith.fear *= 1 - T.doubterFaithFade;
    }

    if (this.leader?.kind === 'prophet') this.prophesy();
    this.schism();
  }

  /** Someone speaks in the god's place: a skeptic denies it, anyone else claims its voice. */
  raise(force?: { v: Villager; kind: DissentKind }): void {
    const sim = this.sim;
    let v = force?.v;
    let kind = force?.kind;
    if (!v) {
      const chosen = sim.belief.chosenIds();
      const pool = sim.villagers.alive.filter((p) => p.lifeStage === 'adult' && p.id !== sim.belief.priestId && !chosen.has(p.id) && !this.departing.has(p.id));
      if (!pool.length) return;
      const faith = (p: Villager) => p.faith.love + p.faith.fear;
      const skeptics = pool.filter((p) => p.traits.includes('skeptic')).sort((a, b) => faith(a) - faith(b));
      // Fear and wonder make prophets; the faithless make doubters.
      const fearful = pool.reduce((s, p) => s + p.faith.fear, 0) > pool.reduce((s, p) => s + p.faith.love, 0);
      if (skeptics.length && !(fearful && this.rng.chance(0.5))) {
        v = skeptics[0]!;
        kind = 'doubter';
      } else {
        const keen = pool.filter((p) => p.traits.includes('curious') || p.traits.includes('gossip'));
        v = this.rng.pick(keen.length ? keen : pool);
        kind = 'prophet';
      }
    }
    const lead: DissentLeader = { id: v.id, kind: kind!, since: sim.tick };
    if (lead.kind === 'prophet') lead.rule = this.rng.pick(PROPHET_TABOOS);
    this.leader = lead;
    this.pull.set(v.id, 1);
    this.prophecy = null;
    sim.events.push(sim.tick, { type: 'dissent', id: v.id, kind: lead.kind, rule: lead.rule });
  }

  /** The movement ends: its followers drift back. */
  end(reason: DissentEndReason): void {
    const lead = this.leader;
    if (!lead) return;
    const sim = this.sim;
    this.leader = null;
    this.prophecy = null;
    for (const [id, p] of this.pull) this.pull.set(id, p * (reason === 'converted' || reason === 'recanted' ? 0.2 : 0.4));
    this.pull.delete(lead.id);
    const v = sim.villagers.byId(lead.id);
    // A converted doubter is the most zealous of all.
    if (v?.alive && reason === 'converted') v.faith.love = Math.min(1 - v.faith.fear, v.faith.love + 0.5);
    this.restUntil = sim.tick + T.leaderAfterDays * TICKS_PER_DAY;
    sim.events.push(sim.tick, { type: 'dissentEnd', id: lead.id, kind: lead.kind, reason });
  }

  /** Each evening at the fire, the leader (and to a lesser degree the followers) talk. */
  dusk(present: Villager[]): void {
    const lead = this.leader;
    if (!lead || present.length < 2) return;
    const voices = present.filter((v) => this.follows(v));
    if (!voices.length) return;
    const leaderHere = voices.some((v) => v.id === lead.id);
    const rate = T.spreadPerEvening * (leaderHere ? 1 : 0.5) * (this.silent ? 1.5 : 1);
    const priest = this.sim.belief.priestId;
    for (const v of present) {
      if (v.id === lead.id || v.lifeStage === 'child') continue;
      const faith = Math.min(1, v.faith.love + v.faith.fear);
      let k = 1 - faith * 0.8;
      if (v.traits.includes('devout')) k *= 0.3;
      if (v.id === priest) k *= 0.1;
      if (lead.kind === 'doubter' && v.traits.includes('skeptic')) k *= 1.6;
      if (lead.kind === 'prophet' && (v.traits.includes('fearful') || v.traits.includes('curious'))) k *= 1.3;
      const p = this.pull.get(v.id) ?? 0;
      this.pull.set(v.id, Math.min(1, p + rate * k));
    }
    // A prophet's followers take on the prophet's law, and the prophet's standing.
    if (lead.kind === 'prophet') {
      const amount = TUNING.belief.formationRate * 0.5;
      for (const f of this.followers()) {
        if (lead.rule) this.sim.belief.hold(f, 'TABOO_ACT', lead.rule, undefined, amount, null);
        if (f.id !== lead.id) this.sim.belief.hold(f, 'CHOSEN_ONE', `person:${lead.id}`, undefined, amount, null);
      }
      this.sim.belief.refreshStrengths();
    }
  }

  private prophesy(): void {
    const sim = this.sim;
    if (this.prophecy) {
      if (sim.tick >= this.prophecy.until) this.resolveProphecy(false);
      return;
    }
    if (sim.raining || !this.rng.chance(T.prophecyChancePerDay)) return;
    this.prophecy = { what: 'rain', until: sim.tick + T.prophecyDays * TICKS_PER_DAY };
    sim.events.push(sim.tick, { type: 'prophesied', id: this.leader!.id, what: 'rain' });
  }

  private resolveProphecy(fulfilled: boolean): void {
    const lead = this.leader;
    this.prophecy = null;
    if (!lead) return;
    for (const v of this.sim.villagers.alive) {
      if (v.id === lead.id) continue;
      const p = this.pull.get(v.id) ?? 0;
      if (fulfilled) this.pull.set(v.id, Math.min(1, p + T.prophecyPull * (p > 0 ? 1 : 0.5)));
      else if (p > 0) this.pull.set(v.id, Math.max(0, p - T.prophecyPull));
    }
    this.sim.events.push(this.sim.tick, { type: 'prophecyResult', id: lead.id, fulfilled });
  }

  /** Past a share of the village, it splits: the leader is driven out, or the followers leave. */
  private schism(): void {
    const sim = this.sim;
    const lead = this.leader;
    if (!lead || sim.tick - lead.since < T.schismMinDays * TICKS_PER_DAY) return;
    if (sim.villagers.alive.length < T.schismMinPopulation) return;
    const adults = sim.villagers.alive.filter((v) => v.lifeStage !== 'child');
    const followers = adults.filter((v) => this.follows(v));
    if (followers.length < T.schismMinFollowers || followers.length < adults.length * T.schismShare) return;
    const loyal = adults.filter((v) => (this.pull.get(v.id) ?? 0) < 0.2 && v.faith.love + v.faith.fear >= 0.25);
    // Nobody left to split from: the village simply goes the leader's way.
    if (loyal.length < Math.max(T.schismMinLoyal, adults.length * T.schismMinLoyalShare)) return;
    const leader = sim.villagers.byId(lead.id)!;
    if (loyal.length >= followers.length * T.loyalPerFollower) {
      this.leader = null;
      this.prophecy = null;
      for (const [id, p] of this.pull) this.pull.set(id, p * 0.3);
      this.pull.delete(lead.id);
      this.restUntil = sim.tick + T.leaderAfterDays * TICKS_PER_DAY;
      sim.villagers.exile(leader);
      sim.events.push(sim.tick, { type: 'schism', leaderId: lead.id, outcome: 'drivenOut', ids: [lead.id] });
      return;
    }
    // They go together, with their children, and settle somewhere of their own.
    const going = new Set(followers.map((v) => v.id));
    for (const v of sim.villagers.alive)
      if (v.lifeStage === 'child' && v.parentIds.some((id) => going.has(id))) going.add(v.id);
    const cap = Math.floor(sim.villagers.alive.length * T.maxLeaving);
    const ids = [...going].sort((a, b) => (a === lead.id ? -1 : b === lead.id ? 1 : (this.pull.get(b) ?? 0) - (this.pull.get(a) ?? 0))).slice(0, cap);
    this.leader = null;
    this.prophecy = null;
    const people = ids.map((id) => sim.villagers.byId(id)!).filter((v) => v.alive);
    const X = TUNING.exodus;
    // The Warning is one people's story: there, those who split away leave the island.
    const site = sim.mode === 'warning' || people.length < TUNING.exodus.minFounders ? null : findSettlement(sim, people, sim.village.center, X.splitMin, X.splitMax, this.rng);
    for (const id of ids) this.pull.delete(id);
    for (const [id, p] of this.pull) this.pull.set(id, p * 0.3);
    this.restUntil = sim.tick + T.restAfterSplitYears * TICKS_PER_YEAR;
    sim.events.push(sim.tick, { type: 'schism', leaderId: lead.id, outcome: 'split', ids });
    if (site) {
      // A prophet leads their people as priest; a doubter's people keep no priest of the old faith.
      sim.foundTribe(people, site, { reason: 'schism', leaderId: lead.id, priestId: lead.kind === 'prophet' ? lead.id : undefined });
    } else {
      // Nowhere to go (or the Warning): they leave the island.
      for (const p of people) {
        this.departing.add(p.id);
        sim.villagers.exile(p);
      }
    }
  }
}
