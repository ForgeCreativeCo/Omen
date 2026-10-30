import { DeedLog, featureLabel } from '../omens/context';
import type { FeatureCategory, Omen, OmenMemoryRecord } from '../omens/types';
import { responseOf } from '../omens/types';
import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time';
import { TUNING } from '../tuning';
import type { Villager, VillagerId } from '../villagers/types';
import {
  BELIEF_TYPES,
  DEPICTION_FROM_OMEN,
  DEPICTION_WEIGHT,
  DEPICTION_WORDS,
  PERSONALITIES,
  PRIEST_BIAS,
  type BeliefType,
  type DepictionAxis,
  type PriestBias,
  type PriestPersonality,
} from './catalog';
import { attribute, readingOf, salience, valenceFor, type Attribution, type SalienceRow, type WrongDoing } from './interpret';

const T = TUNING.belief;

/** A circle of ground a place belief applies to. */
export interface Area {
  x: number;
  z: number;
  r: number;
}

/** SPEC §8 step 4, plus bookkeeping for behavior and UI. */
export interface Belief {
  id: string;
  type: BeliefType;
  subject: string;
  response?: string;
  /** −1..1: the god's believed attitude. */
  valence: number;
  /** 0..1 village-wide: mean personal strength over the living. */
  strength: number;
  holders: Map<VillagerId, number>;
  originOmenIds: string[];
  confirmations: number;
  contradictions: number;
  bornTick: number;
  isTradition: boolean;
  scriptureRefs: string[];
  /** Where a ritual is performed, or the ground a place belief covers. */
  place?: string;
  area?: Area;
  /** DEPICTION trait votes. */
  traits?: Record<string, number>;
  /** OFFERING size multiplier after misfortunes. */
  escalation: number;
  /** Highest threshold announced: 0 none, 1 drives behavior, 2 doctrine. */
  level: number;
  /** One-off world changes already made (marker-stones). */
  marked: boolean;
  /** Sacred works raised so far: 0 none, 1 cairn, 2 shrine, 3 temple. */
  works: number;
  /** The latest of those works (a structure id). */
  workId?: number;
  /** Everyone who saw one of its origin omens; when all are dead it becomes tradition. */
  witnesses: VillagerId[];
  /** Belief gained by seeing for oneself vs. from retold stories (for drift). */
  seen: number;
  heard: number;
  /** Daily strength samples for the God's Eye graph. */
  history: number[];
}

/** One step of the God's Eye salience table. */
export interface Analysis {
  omenId: string;
  kind: string;
  rows: SalienceRow[];
  /** What the witnesses ended up believing, by belief key, with how many. */
  readings: { key: string; count: number }[];
  meanValence: number;
}

interface Expectation {
  beliefId: string;
  until: number;
}

/** Plausible stand-ins when a retelling swaps a detail (SPEC §12). */
const SWAP_FALLBACK: Record<string, string[]> = {
  activity: ['activity:dance', 'activity:farming', 'activity:gathering', 'activity:praying', 'activity:woodcutting', 'activity:building'],
  place: ['place:eastHill', 'place:ridge', 'place:river', 'place:well', 'place:fields', 'place:fire', 'place:coast'],
  deed: ['deed:theft', 'deed:fight'],
  time: ['time:dawn', 'time:dusk', 'time:night', 'time:fullMoon'],
  event: ['event:birth', 'event:death'],
  condition: ['condition:drought', 'condition:storm'],
};

/** Belief types a retold story can found (attitudes come from witnessing only). */
const ATTRIBUTION_OK = new Set<BeliefType>(['RITUAL', 'TABOO_ACT', 'SACRED_PLACE', 'CURSED_PLACE', 'CHOSEN_ONE', 'OUTCAST', 'PORTENT']);

const PLACE_AREA: Record<string, number> = {
  'place:eastHill': TUNING.terrain.hillRadius * 0.75,
  'place:well': 4,
  'place:graveyard': 5,
  'place:fire': 5,
};

/**
 * The village's mind (SPEC §8–§10): interprets omens through each witness, keeps
 * the belief store, reinforces and decays, spreads beliefs at the evening fire,
 * keeps the priest, and records deeds people might later blame.
 */
export class BeliefSystem {
  readonly beliefs = new Map<string, Belief>();
  readonly deeds = new DeedLog();
  readonly omens: Omen[] = [];
  priestId = -1;
  personality: PriestPersonality = 'pragmatic';
  festivalToday = false;
  /** Tick of the last food offering (for escalation). */
  lastOfferingTick = -Infinity;
  lastAnalysis: Analysis | null = null;
  private readonly seen = new Map<string, number>();
  private expectations: Expectation[] = [];
  private nextOmen = 1;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  get bias(): PriestBias {
    return PRIEST_BIAS[this.personality];
  }

  key(type: BeliefType, subject: string, response?: string): string {
    return `${type}|${subject}|${response ?? ''}`;
  }

  /** Beliefs strong enough to change behavior, of a type. */
  active(type: BeliefType, min: number = T.behaviorThreshold): Belief[] {
    return [...this.beliefs.values()].filter((b) => b.type === type && b.strength >= min);
  }

  chosenIds(): Set<VillagerId> {
    const out = new Set<VillagerId>();
    for (const b of this.active('CHOSEN_ONE')) if (b.subject.startsWith('person:')) out.add(Number(b.subject.slice(7)));
    return out;
  }

  /** Names the people gave places (SPEC §11). */
  placeName(key: string): string | undefined {
    return this.sim.myth?.places.name(key);
  }

  omen(id: string): Omen | undefined {
    return this.omens.find((o) => o.id === id);
  }

  nextOmenId(): string {
    return `o${this.nextOmen++}`;
  }

  /** Human sentence for a belief, in the villagers' voice. */
  statement(b: Belief): string {
    const sim = this.sim;
    if (b.type === 'DEPICTION') return BELIEF_TYPES.DEPICTION.statement.replace('{s}', this.depictionPhrase(b));
    if (b.type === 'TEMPERAMENT') return BELIEF_TYPES.TEMPERAMENT.statement.replace('{s}', this.temperamentWord(b));
    const r = b.response === 'favor' ? 'blessings' : b.response === 'wrath' ? 'wrath' : b.response === 'lightning' ? 'fire from the sky' : (b.response ?? '');
    const s = featureLabel(sim, b.subject);
    const sentence = BELIEF_TYPES[b.type].statement.replace('{s}', s).replace('{r}', r);
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }

  depictionPhrase(b: Belief): string {
    const t = b.traits ?? {};
    const best = (axis: DepictionAxis) => {
      let k = '';
      let n = 0;
      for (const [key, v] of Object.entries(t)) if (key.startsWith(axis + ':') && v > n) (k = key.slice(axis.length + 1)), (n = v);
      return k;
    };
    const body = best('body') || 'humanoid';
    const element = best('element');
    const feature = best('feature');
    const words = [element ? DEPICTION_WORDS[element] : '', DEPICTION_WORDS[body] ?? body].filter(Boolean).join(' ');
    const extra = feature && feature !== 'raisedHand' ? `, ${DEPICTION_WORDS[feature]}` : feature === 'raisedHand' ? ` ${DEPICTION_WORDS.raisedHand}` : '';
    return `a ${words}${extra}`;
  }

  temperamentWord(b: Belief): string {
    if (b.valence > 0.2) return 'kind';
    if (b.valence < -0.2) return 'wrathful';
    return 'fickle';
  }

  // ------------------------------------------------------------------ helpers

  private ensure(type: BeliefType, subject: string, response: string | undefined, omen: Omen | null, areaOmen: Omen | null = omen): Belief {
    const k = this.key(type, subject, response);
    let b = this.beliefs.get(k);
    if (!b) {
      b = {
        id: k,
        type,
        subject,
        response,
        valence: 0,
        strength: 0,
        holders: new Map(),
        originOmenIds: [],
        confirmations: 0,
        contradictions: 0,
        bornTick: this.sim.tick,
        isTradition: false,
        scriptureRefs: [],
        escalation: 1,
        level: 0,
        marked: false,
        works: 0,
        witnesses: [],
        seen: 0,
        heard: 0,
        history: [],
      };
      if (type === 'DEPICTION') b.traits = {};
      if (type === 'CURSED_PLACE' || type === 'SACRED_PLACE') b.area = this.areaFor(subject, areaOmen);
      this.beliefs.set(k, b);
    }
    if (omen && !b.originOmenIds.includes(omen.id) && b.originOmenIds.length < 8) {
      b.originOmenIds.push(omen.id);
      for (const id of omen.witnesses) if (!b.witnesses.includes(id) && b.witnesses.length < 80) b.witnesses.push(id);
    }
    return b;
  }

  /** The ground a place belief covers: named compact places whole, sprawling ones near the omen. */
  private areaFor(subject: string, omen: Omen | null): Area {
    const sim = this.sim;
    const L = sim.island.landmarks;
    const r = PLACE_AREA[subject];
    if (subject === 'place:eastHill') return { x: L.eastHill.x, z: L.eastHill.z, r: r! };
    if (subject === 'place:fire') return { x: sim.village.center.x, z: sim.village.center.z, r: r! };
    if (subject === 'place:well' || /^place:(hut|cairn|shrine|temple|statue):/.test(subject)) {
      const s = subject === 'place:well' ? sim.village.structures.find((x) => x.kind === 'well') : sim.village.byId(Number(subject.split(':')[2]));
      if (s) return { x: s.x0 + s.w / 2, z: s.z0 + s.d / 2, r: r ?? 4 };
    }
    if (subject === 'place:graveyard' && sim.village.graveyard) {
      const g = sim.village.graveyard;
      return { x: g.x0 + g.w / 2, z: g.z0 + g.d / 2, r: 5 };
    }
    if (subject === 'place:ridge' && !omen) return { x: L.ridgePeak.x, z: L.ridgePeak.z, r: 10 };
    const site = sim.myth?.places.site(subject);
    if (site) return { x: site.x, z: site.z, r: site.r };
    if (!omen && subject === 'place:fields' && sim.village.fields[0]) {
      const f = sim.village.fields[0];
      return { x: f.x0 + f.w / 2, z: f.z0 + f.d / 2, r: 6 };
    }
    if (!omen && subject === 'place:river') {
      const c = sim.village.center;
      const p = [...L.riverPath].sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
      if (p) return { x: p.x, z: p.z, r: 6 };
    }
    return { x: omen?.position.x ?? sim.village.center.x, z: omen?.position.z ?? sim.village.center.z, r: 7 };
  }

  traitFactor(v: Villager): number {
    return v.traits.includes('devout') ? T.traitDevout : v.traits.includes('skeptic') ? T.traitSkeptic : 1;
  }

  /** Raise a villager's personal strength toward 1. */
  gain(b: Belief, v: Villager, amount: number): void {
    const s = b.holders.get(v.id) ?? 0;
    b.holders.set(v.id, Math.min(1, s + Math.max(0, amount) * (1 - s)));
  }

  /** Lower a villager's personal strength toward 0. */
  loss(b: Belief, v: Villager, amount: number): void {
    const s = b.holders.get(v.id);
    if (s === undefined) return;
    b.holders.set(v.id, Math.max(0, s - Math.max(0, amount) * s));
  }

  /** Recompute village-wide strengths (mean over the living). */
  refreshStrengths(): void {
    const pop = Math.max(1, this.sim.villagers.alive.length);
    for (const b of this.beliefs.values()) {
      let sum = 0;
      for (const [id, s] of b.holders) {
        if (this.sim.villagers.byId(id)?.alive) sum += s;
        else b.holders.delete(id);
      }
      b.strength = sum / pop;
    }
    this.announce();
  }

  private announce(): void {
    for (const b of this.beliefs.values()) {
      const level = b.strength >= T.doctrineThreshold ? 2 : b.strength >= T.behaviorThreshold ? 1 : 0;
      if (level > b.level) {
        b.level = level;
        this.sim.events.push(this.sim.tick, { type: 'beliefLevel', beliefId: b.id, level: level === 2 ? 'doctrine' : 'behavior' });
      }
    }
  }

  // ------------------------------------------------------------------ interpretation

  /** SPEC §8: every witness reads the omen for themselves. */
  interpret(omen: Omen): void {
    const sim = this.sim;
    this.omens.push(omen);
    if (this.omens.length > 400) this.omens.splice(0, this.omens.length - 300);
    if (!omen.witnesses.length) return;

    const bias = this.bias;
    const wrongs: WrongDoing[] = this.deeds.deeds.filter((d) => d.key === 'deed:theft').map((d) => ({ actorId: d.actorId, victimIds: d.victimIds }));
    const witnesses = omen.witnesses.map((id) => sim.villagers.byId(id)!).filter((v) => v?.alive);
    const valences = witnesses.map((w) => valenceFor(omen, w, bias, wrongs));
    const meanValence = valences.reduce((a, b) => a + b, 0) / Math.max(1, valences.length);
    const priest = sim.villagers.byId(this.priestId);
    const priestFamily = new Set<VillagerId>(priest ? [priest.id, priest.partnerId, ...priest.childIds] : []);
    const novelty = (key: string) => Math.max(T.noveltyFloor, 1 / (1 + (this.seen.get(key) ?? 0) * T.noveltyDecay));

    // Village-level ranking (the priest's reading shapes everyone's), then per-witness wobble.
    const rowsGood = salience(omen, novelty, bias, true, priestFamily, this.rng);
    const rowsBad = salience(omen, novelty, bias, false, priestFamily, this.rng);
    const readings = new Map<string, number>();

    witnesses.forEach((w, i) => {
      const val = valences[i]!;
      const good = val >= 0;
      const rows = (good ? rowsGood : rowsBad).map((r) => ({ ...r, score: Math.max(0, r.score + this.rng.jitter(T.salienceNoise)) }));
      rows.sort((a, b) => b.score - a.score);
      const att = attribute(rows, omen, val, bias);
      const mag = 0.5 + 0.5 * omen.magnitude;
      const tf = this.traitFactor(w) * (val < 0 && w.traits.includes('fearful') ? T.traitFearfulHarm : 1);
      for (const a of att) {
        const b = this.ensure(a.type, a.subject, a.response, omen);
        if (a.type === 'RITUAL' && !b.place) b.place = this.ritualPlace(omen);
        // The priest's favorite readings take hold faster; vivid harm or help, more strongly.
        const preferred = bias.prefers.includes(a.type) ? 1.3 : 1;
        const amount = T.formationRate * a.confidence * mag * tf * a.weight * preferred * Math.min(1.4, Math.abs(val) * 1.5 + 0.3);
        this.gain(b, w, amount);
        b.seen += amount;
        b.valence = b.valence * 0.8 + (good ? 1 : -1) * 0.2;
        readings.set(b.id, (readings.get(b.id) ?? 0) + 1);
      }
      this.contradictions(omen, w, rows, val, att);
      this.temperament(w, val, omen.magnitude);
      this.depict(w, omen.kind, omen.magnitude);
      this.remember(w, omen, att[0]?.feature?.key ?? '', val, false);
      // Faith: help breeds love, harm breeds fear (unwitnessed acts build nothing).
      const df = Math.abs(val) * omen.magnitude * T.faithPerOmen;
      if (val >= 0) w.faith.love = Math.min(1 - w.faith.fear, w.faith.love + df);
      else w.faith.fear = Math.min(1 - w.faith.love, w.faith.fear + df);
    });

    // Rituals expecting this response are confirmed; offerings that didn't avert harm escalate.
    this.checkExpectations(omen, meanValence);
    // Harm right after an offering means it wasn't enough.
    if (meanValence < 0 && sim.tick - this.lastOfferingTick < TICKS_PER_DAY * 2)
      for (const b of this.active('OFFERING')) b.escalation = Math.min(3, b.escalation * T.offeringEscalation);

    for (const f of omen.context) this.seen.set(f.key, (this.seen.get(f.key) ?? 0) + 1);
    this.lastAnalysis = {
      omenId: omen.id,
      kind: omen.kind,
      rows: (meanValence >= 0 ? rowsGood : rowsBad).slice(0, 14),
      readings: [...readings].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      meanValence,
    };
    this.refreshStrengths();
  }

  /** The most specific place in an omen's context, for where a ritual should be performed. */
  private ritualPlace(omen: Omen): string {
    const places = omen.context.filter((f) => f.category === 'place' && f.key !== 'place:valley').sort((a, b) => a.distance - b.distance);
    return places[0]?.key ?? 'place:fire';
  }

  /** Existing beliefs whose subject was present, but whose prediction this omen went against. */
  private contradictions(omen: Omen, w: Villager, rows: SalienceRow[], val: number, att: Attribution[]): void {
    // Only what stood out counts as evidence for or against (top three features).
    const present = new Set(rows.slice(0, 3).filter((r) => r.score > 0.04).map((r) => r.feature.key));
    const formed = new Set(att.map((a) => this.key(a.type, a.subject, a.response)));
    for (const b of this.beliefs.values()) {
      if (formed.has(b.id) || !b.holders.has(w.id) || !present.has(b.subject)) continue;
      const expectsGood = b.type === 'SACRED_PLACE' || b.type === 'CHOSEN_ONE';
      const expectsBad = b.type === 'CURSED_PLACE' || b.type === 'OUTCAST' || b.type === 'TABOO_ACT';
      if ((expectsGood && val < -0.1) || (expectsBad && val > 0.1)) this.contradict(b, [w], omen.magnitude);
      else if ((expectsGood && val > 0.1) || (expectsBad && val < -0.1)) this.confirm(b, [w], omen.magnitude * 0.5);
    }
  }

  /** SPEC §8 step 5: a confirmation strengthens everyone given (all holders if none given). */
  confirm(b: Belief, who?: Villager[], weight = 1): void {
    b.confirmations++;
    const people = who ?? this.holdersAlive(b);
    for (const v of people) this.gain(b, v, T.formationRate * 0.5 * weight * this.traitFactor(v));
  }

  /** A contradiction weakens, but only ~0.3× as much (confirmation bias), and may be explained away. */
  contradict(b: Belief, who?: Villager[], weight = 1): void {
    if (b.strength >= T.behaviorThreshold && this.rng.chance(this.bias.explainAway)) return;
    b.contradictions++;
    const people = who ?? this.holdersAlive(b);
    for (const v of people) {
      const skeptic = v.traits.includes('skeptic') ? 1.8 : 1;
      this.loss(b, v, T.formationRate * 0.5 * T.contradictionWeight * weight * skeptic);
    }
  }

  private holdersAlive(b: Belief): Villager[] {
    return [...b.holders.keys()].map((id) => this.sim.villagers.byId(id)!).filter((v) => v?.alive);
  }

  private temperament(w: Villager, val: number, mag: number): void {
    const b = this.ensure('TEMPERAMENT', 'god', undefined, null);
    b.valence = Math.max(-1, Math.min(1, b.valence * 0.92 + val * 0.08 * (0.5 + mag)));
    this.gain(b, w, 0.06 * (0.5 + mag));
  }

  private depict(w: Villager, kind: string, mag: number): void {
    const traits = DEPICTION_FROM_OMEN[kind];
    if (!traits) return;
    const b = this.ensure('DEPICTION', 'god', undefined, null);
    const mystic = (this.personality === 'mystic' ? 1.6 : 1) * (DEPICTION_WEIGHT[kind] ?? 1);
    for (const [axis, t] of traits) b.traits![`${axis}:${t}`] = (b.traits![`${axis}:${t}`] ?? 0) + mag * mystic * 0.1;
    this.gain(b, w, 0.05 * mag * mystic);
  }

  /** Add a depiction trait directly (dreams). */
  addDepictionTrait(axis: DepictionAxis, trait: string, amount: number, w: Villager): void {
    const b = this.ensure('DEPICTION', 'god', undefined, null);
    b.traits![`${axis}:${trait}`] = (b.traits![`${axis}:${trait}`] ?? 0) + amount;
    this.gain(b, w, 0.1 * amount);
  }

  remember(w: Villager, omen: Omen, cause: string, valence: number, hearsay: boolean): void {
    const place = omen.kind === 'dream' ? '' : this.placeOf(omen);
    this.store(w, { omenId: omen.id, tick: omen.tick, kind: omen.kind, cause, place, valence, magnitude: omen.magnitude, hearsay, retold: 0 });
  }

  private store(w: Villager, m: OmenMemoryRecord): void {
    w.memories.push(m);
    if (w.memories.length > 24) w.memories.shift();
  }

  /** The nearest named place in an omen's context, or ''. */
  placeOf(omen: Omen): string {
    const places = omen.context.filter((f) => f.category === 'place' && f.key !== 'place:valley' && !f.key.startsWith('place:hut:')).sort((a, b) => a.distance - b.distance);
    return places[0] && places[0].distance <= 4 ? places[0].key : '';
  }

  /** Form or reinforce a belief for one villager directly (dreams, teaching). */
  hold(v: Villager, type: BeliefType, subject: string, response: string | undefined, amount: number, omen: Omen | null): Belief {
    const b = this.ensure(type, subject, response, omen);
    if (type === 'RITUAL' && !b.place) b.place = 'place:fire';
    this.gain(b, v, amount);
    return b;
  }

  // ------------------------------------------------------------------ rituals & expectations

  /** A ritual (or anything a RITUAL belief is about) was just performed: expect the response. */
  notePerformance(activityKey: string): void {
    const until = this.sim.tick + T.confirmationWindowDays * TICKS_PER_DAY;
    for (const b of this.beliefs.values()) {
      if (b.type !== 'RITUAL' || b.subject !== activityKey) continue;
      // One open expectation per ritual: repeating it doesn't move the deadline.
      if (!this.expectations.some((x) => x.beliefId === b.id)) this.expectations.push({ beliefId: b.id, until });
    }
  }

  private checkExpectations(omen: Omen, meanValence: number): void {
    const resp = responseOf(omen.kind);
    this.expectations = this.expectations.filter((e) => {
      const b = this.beliefs.get(e.beliefId);
      if (!b) return false;
      const match = b.response === resp || (b.response === 'favor' && meanValence > 0.1);
      if (match) {
        this.confirm(b);
        return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ priests

  /** Pick a personality for a new priest: traits lean it, chance does the rest. */
  setPriest(v: Villager | undefined): void {
    const old = this.priestId;
    this.priestId = v?.id ?? -1;
    if (!v || v.id === old) return;
    const w = PERSONALITIES.map((p) =>
      p === 'fearful' ? (v.traits.includes('fearful') ? 4 : 1) : p === 'mystic' ? (v.traits.includes('devout') ? 3 : 1) : p === 'ambitious' ? (v.traits.includes('gossip') ? 2 : 1) : v.traits.includes('skeptic') ? 3 : 1,
    );
    this.setPersonality(PERSONALITIES[this.rng.weightedIndex(w)]!, old >= 0);
  }

  /** New priests re-read doctrine through their own bias (SPEC §8). */
  setPersonality(p: PriestPersonality, reread = true): void {
    this.personality = p;
    const bias = PRIEST_BIAS[p];
    if (reread) {
      for (const b of this.beliefs.values()) {
        if (b.strength < T.behaviorThreshold) continue;
        const k = bias.prefers.includes(b.type) ? 1.15 : 0.9;
        for (const [id, s] of b.holders) b.holders.set(id, Math.min(1, s * k));
      }
      this.refreshStrengths();
    }
    this.sim.events.push(this.sim.tick, { type: 'priest', id: this.priestId, personality: p });
  }

  // ------------------------------------------------------------------ daily and evening

  /** Children inherit doctrine from their parents and the priest at reduced strength. */
  inherit(child: Villager): void {
    const sources = [...child.parentIds, this.priestId].map((id) => this.sim.villagers.byId(id)).filter((v): v is Villager => !!v);
    for (const b of this.beliefs.values()) {
      if (b.strength < T.doctrineThreshold) continue;
      const best = Math.max(0, ...sources.map((s) => b.holders.get(s.id) ?? 0));
      if (best > 0) b.holders.set(child.id, best * T.inheritance);
    }
  }

  // ------------------------------------------------------------------ rumor (SPEC §12)

  /**
   * At the fire, people retell what they remember. Each retelling can grow the omen,
   * swap a detail for a plausible one, or lose where it happened; listeners who
   * weren't there form beliefs from the story as they heard it, at hearsay weight.
   */
  tellRumors(present: Villager[]): void {
    const R = TUNING.rumor;
    if (present.length < 2) return;
    const outcast = new Set(this.active('OUTCAST').map((b) => Number(b.subject.slice(7))));
    const tick = this.sim.tick;
    // Decide what everyone will tell before anyone hears anything: a story moves one
    // listener further per evening, not across the whole village in one night.
    const tellings: [Villager, OmenMemoryRecord][] = [];
    for (const teller of present) {
      if (outcast.has(teller.id) || teller.lifeStage === 'child') continue;
      const stories = teller.memories
        .filter((m) => !m.told && m.kind !== 'dream' && m.cause && tick - m.tick < R.maxAgeDays * TICKS_PER_DAY && Math.min(1, m.magnitude) * Math.abs(m.valence) >= R.minInterest)
        .slice(-(teller.traits.includes('gossip') ? 2 : 1));
      for (const m of stories) tellings.push([teller, m]);
    }
    for (const [teller, m] of tellings) {
      const gossip = teller.traits.includes('gossip');
      m.told = true;
      const audience = this.rng
        .shuffle(present.filter((v) => v !== teller && !outcast.has(v.id) && !v.memories.some((x) => x.omenId === m.omenId)))
        .slice(0, gossip ? R.gossipListeners : R.listeners);
      for (const l of audience) this.hear(l, this.mutate(m, gossip, present, l));
    }
    this.refreshStrengths();
  }

  /** One retelling: it grows, may swap a detail, may lose its place. Gossips embroider more. */
  private mutate(m: OmenMemoryRecord, gossip: boolean, present: Villager[], listener: Villager): OmenMemoryRecord {
    const R = TUNING.rumor;
    const k = gossip ? R.gossipMutation : 1;
    const out: OmenMemoryRecord = { omenId: m.omenId, tick: m.tick, kind: m.kind, cause: m.cause, place: m.place, valence: m.valence, magnitude: m.magnitude, hearsay: true, retold: m.retold + 1 };
    out.magnitude = Math.min(R.maxMagnitude, m.magnitude * this.rng.range(R.magnitudeGrowthMin, R.magnitudeGrowthMax));
    if (this.rng.chance(R.swapDetailChance * k)) out.cause = this.plausibleSwap(m, present, listener) ?? m.cause;
    if (out.place && this.rng.chance(R.dropPlaceChance * k)) out.place = '';
    return out;
  }

  private plausibleSwap(m: OmenMemoryRecord, present: Villager[], listener: Villager): string | null {
    const cat = m.cause.split(':')[0]!;
    const pool = new Set<string>();
    for (const f of this.omen(m.omenId)?.context ?? []) if (f.category === cat && f.key !== m.cause && f.key !== 'place:valley') pool.add(f.key);
    if (cat === 'person') for (const v of present) if (v !== listener && `person:${v.id}` !== m.cause) pool.add(`person:${v.id}`);
    for (const key of SWAP_FALLBACK[cat] ?? []) if (key !== m.cause) pool.add(key);
    const list = [...pool];
    return list.length ? this.rng.pick(list) : null;
  }

  /** A listener takes in a story: remembered as hearsay, believed a little (×hearsayWeight). */
  private hear(l: Villager, m: OmenMemoryRecord): void {
    this.store(l, m);
    const cat = m.cause.split(':')[0] as FeatureCategory;
    const omen = this.omen(m.omenId) ?? null;
    const a = readingOf({ key: m.cause, category: cat, intensity: 0, distance: 0, recency: 0 }, m, m.valence >= 0, 1, 1);
    if (!ATTRIBUTION_OK.has(a.type)) return;
    // A swapped detail points somewhere the omen never was: its ground comes from the name alone.
    const faithful = !!omen?.context.some((f) => f.key === m.cause);
    const b = this.ensure(a.type, a.subject, a.response, omen, faithful ? omen : null);
    if (a.type === 'RITUAL' && !b.place) b.place = m.place || 'place:fire';
    const skeptic = l.traits.includes('skeptic') ? 0.5 : 1;
    const amount = T.formationRate * TUNING.rumor.hearsayWeight * Math.min(1.5, m.magnitude) * Math.min(1.2, Math.abs(m.valence) * 1.5 + 0.3) * skeptic * this.traitFactor(l) * 0.6;
    this.gain(b, l, amount);
    b.heard += amount;
  }

  /** At the evening fire, people tell each other what they believe (SPEC §12, simple form). */
  spreadAtGathering(present: Villager[]): void {
    if (present.length < 2) return;
    const priestId = this.priestId;
    const chosen = this.chosenIds();
    const outcast = new Set(this.active('OUTCAST').map((b) => Number(b.subject.slice(7))));
    const listeners = present.filter((v) => !outcast.has(v.id));
    for (const b of this.beliefs.values()) {
      if (b.type === 'DEPICTION' || b.type === 'TEMPERAMENT') continue;
      // The most convincing teller present sets how far listeners can be drawn: hearsay
      // alone never makes anyone surer than the teller (priests and the chosen carry more).
      let target = 0;
      for (const v of listeners) {
        const s = b.holders.get(v.id) ?? 0;
        if (s < 0.2) continue;
        const weight = v.id === priestId || chosen.has(v.id) ? 1 : 0.8;
        target = Math.max(target, s * weight);
      }
      if (target <= 0) continue;
      for (const v of listeners) {
        const s = b.holders.get(v.id) ?? 0;
        if (s >= target) continue;
        const skeptic = v.traits.includes('skeptic') ? 0.5 : 1;
        const k = T.spreadRate * TUNING.rumor.hearsayWeight * 2 * skeptic * this.traitFactor(v);
        b.holders.set(v.id, s + (target - s) * Math.min(1, k));
      }
    }
    this.refreshStrengths();
  }

  /** Daily: decay, death of weak beliefs, expired expectations, history. */
  newDay(): void {
    const tick = this.sim.tick;
    // Expectations that ran out unanswered are contradictions.
    this.expectations = this.expectations.filter((e) => {
      if (e.until > tick) return true;
      const b = this.beliefs.get(e.beliefId);
      if (b) this.contradict(b);
      return false;
    });
    // A belief nobody alive saw begin is tradition: it holds steady, but its reason fades (SPEC §12).
    for (const b of this.beliefs.values()) {
      if (b.isTradition || !b.witnesses.length || b.type === 'DEPICTION' || b.type === 'TEMPERAMENT') continue;
      if (b.strength < T.behaviorThreshold || tick - b.bornTick < TICKS_PER_YEAR) continue;
      if (b.witnesses.some((id) => this.sim.villagers.byId(id)?.alive)) continue;
      b.isTradition = true;
      this.sim.events.push(tick, { type: 'tradition', beliefId: b.id });
    }
    // The image of the god follows recent omens; old impressions fade.
    const dep = this.beliefs.get(this.key('DEPICTION', 'god'));
    if (dep?.traits) for (const k of Object.keys(dep.traits)) dep.traits[k]! *= T.depictionFadePerDay;
    const bias = this.bias;
    // Offerings relax back toward normal while nothing bad follows.
    for (const b of this.beliefs.values()) if (b.type === 'OFFERING') b.escalation = Math.max(1, b.escalation * 0.93);
    for (const b of [...this.beliefs.values()]) {
      const failing = b.contradictions > b.confirmations ? bias.failedDecay : 1;
      for (const [id, s] of b.holders) {
        const v = this.sim.villagers.byId(id);
        if (!v) continue;
        const k = v.traits.includes('skeptic') ? T.skepticDecay : v.traits.includes('devout') ? T.devoutDecay : 1;
        const ns = s * (1 - T.decayPerDay * k * failing * (b.isTradition ? T.traditionDecay : 1));
        if (ns < 0.02) b.holders.delete(id);
        else b.holders.set(id, ns);
      }
    }
    this.refreshStrengths();
    for (const b of [...this.beliefs.values()]) {
      b.history.push(b.strength);
      if (b.history.length > T.historyLength) b.history.shift();
      const persistent = b.type === 'DEPICTION' || b.type === 'TEMPERAMENT';
      if (!persistent && b.strength < T.deathThreshold && tick - b.bornTick > TICKS_PER_DAY) {
        this.beliefs.delete(b.id);
        if (b.level > 0) this.sim.events.push(tick, { type: 'beliefLevel', beliefId: b.id, level: 'died' });
      }
    }
    this.deeds.prune(tick);
  }
}
