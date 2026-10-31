import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import type { Villager } from '../villagers/types';
import { M } from '../world/materials';
import type { Area, Belief } from './BeliefSystem';
import { PERFORMABLE } from './catalog';

const T = TUNING.belief;
const HARMFUL = new Set(['lightning', 'wrath', 'drought', 'storm']);

/** A ritual a villager has decided to go and perform. */
export interface RitualPlan {
  belief: Belief;
  activity: 'dance' | 'pray' | 'gather';
  x: number;
  z: number;
}

/**
 * How beliefs change what people do (SPEC §9). The villager AI and the planner ask
 * these questions; daily and evening routines make the world-level changes
 * (markers, cairns, offerings, exiles, prophecies, deeds).
 */
export class BeliefEffects {
  /** Cells inside a cursed area (planner and farmers avoid; paths cost more). */
  readonly cursed: Uint8Array;
  /** Village prepares for a foretold harm until this tick (hoarding, nerves). */
  prepareUntil = -1;
  private lastSeq = 0;
  private dancedTonight = false;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {
    this.cursed = new Uint8Array(sim.world.sizeX * sim.world.sizeZ);
  }

  private get b() {
    return this.sim.belief;
  }

  // ------------------------------------------------------------------ queries

  isCursed(x: number, z: number): boolean {
    const k = Math.floor(x) + Math.floor(z) * this.sim.world.sizeX;
    return (this.cursed[k] ?? 0) > 0;
  }

  /** 0..1: how strongly an activity or deed is taboo (0 = not at all). */
  taboo(subject: string): number {
    const b = this.b.beliefs.get(this.b.key('TABOO_ACT', subject, 'wrath'));
    return b && b.strength >= T.behaviorThreshold ? b.strength : 0;
  }

  /** Strongest sacred area, for pilgrimages, burials and settling nearby. */
  sacredArea(): (Area & { strength: number }) | null {
    const best = this.b.active('SACRED_PLACE').filter((b) => b.area).sort((a, b) => b.strength - a.strength)[0];
    return best?.area ? { ...best.area, strength: best.strength } : null;
  }

  outcastIds(min: number = T.behaviorThreshold): Set<number> {
    return new Set(this.b.active('OUTCAST', min).map((b) => Number(b.subject.slice(7))).filter((n) => !Number.isNaN(n)));
  }

  /** Does the village want what this response brings, right now? */
  private wants(response: string | undefined): boolean {
    const sim = this.sim;
    if (response === 'rain') {
      const dry = sim.village.fields.filter((f) => f.moisture < 0.15).length;
      return sim.weather.drought || dry > sim.village.fields.length / 2;
    }
    if (response === 'bloom') return sim.village.store.food / Math.max(1, sim.villagers.alive.length) < 3;
    if (response === 'favor') return this.b.festivalToday;
    return false;
  }

  /**
   * Should this villager go and perform a ritual now? Holders do it when they want
   * the response; doctrine rituals are also held on festival days.
   */
  ritualFor(v: Villager, gatheringTime: boolean): RitualPlan | null {
    for (const b of this.b.active('RITUAL')) {
      const how = PERFORMABLE[b.subject];
      if (!how || how === 'work') continue;
      if ((b.holders.get(v.id) ?? 0) < 0.2) continue;
      const festival = this.b.festivalToday && b.strength >= T.doctrineThreshold && gatheringTime;
      if (!festival && !(this.wants(b.response) && !gatheringTime)) continue;
      const spot = this.spotFor(b.place ?? 'place:fire', v);
      if (!spot) continue;
      return { belief: b, activity: how, ...spot };
    }
    return null;
  }

  /** A walkable cell near a named place, spread out by villager. */
  private spotFor(place: string, v: Villager): { x: number; z: number } | null {
    const sim = this.sim;
    let cx = sim.village.center.x;
    let cz = sim.village.center.z;
    if (place === 'place:well') {
      const w = sim.village.well;
      if (w) (cx = w.x0 + 1), (cz = w.z0 + 1);
    } else if (place === 'place:eastHill') (cx = sim.island.landmarks.eastHill.x), (cz = sim.island.landmarks.eastHill.z);
    else if (place === 'place:ridge') (cx = sim.island.landmarks.ridgePeak.x), (cz = sim.island.landmarks.ridgePeak.z);
    else if (place === 'place:fields' && sim.village.fields[0]) (cx = sim.village.fields[0].x0 + 2), (cz = sim.village.fields[0].z0 - 1);
    const a = v.id * 2.4;
    for (let r = 2; r <= 5; r++) {
      const x = Math.round(cx + Math.cos(a) * r);
      const z = Math.round(cz + Math.sin(a) * r);
      if (sim.nav.walkable(x, z) && !this.isCursed(x, z)) return { x, z };
    }
    return sim.village.nearestWalkable(cx, cz);
  }

  pilgrimageFor(v: Villager): { x: number; z: number } | null {
    const area = this.sacredArea();
    if (!area || !this.rng.chance(T.pilgrimageChance * area.strength * this.b.traitFactor(v))) return null;
    return this.sim.village.nearestWalkable(Math.round(area.x + this.rng.jitter(2)), Math.round(area.z + this.rng.jitter(2)));
  }

  // ------------------------------------------------------------------ routines

  /** Per tick: react to events (portents). */
  step(): void {
    for (const e of this.sim.events.since(this.lastSeq)) this.onEvent(e);
    this.lastSeq = this.sim.events.lastSeq;
  }

  private onEvent(e: SimEvent): void {
    if (e.type === 'droughtStart') this.portent('condition:drought');
    else if (e.type === 'rainStart' && e.storm) this.portent('condition:storm');
    else if (e.type === 'birth') this.portent('event:birth');
    else if (e.type === 'death') this.portent('event:death');
    else if (e.type === 'beliefLevel' && e.level === 'behavior') this.onBeliefActive(e.beliefId);
  }

  /** Something a PORTENT is about just happened: prepare for what it foretells. */
  private portent(subject: string): void {
    for (const b of this.b.active('PORTENT')) {
      if (b.subject !== subject) continue;
      const harmful = HARMFUL.has(b.response ?? '');
      if (harmful) {
        this.prepareUntil = this.sim.tick + TICKS_PER_DAY * 2;
        for (const v of this.sim.villagers.alive) if (b.holders.has(v.id)) v.needs.safety = Math.max(0, v.needs.safety - 0.3);
      } else this.b.festivalToday = true;
      this.sim.events.push(this.sim.tick, { type: 'prophecy', beliefId: b.id, good: !harmful });
    }
  }

  /** One-off world changes when a place belief first takes hold. */
  private onBeliefActive(id: string): void {
    const b = this.b.beliefs.get(id);
    if (!b || b.marked || !b.area) return;
    if (b.type === 'CURSED_PLACE') {
      b.marked = true;
      this.ringOfMarkers(b.area);
    }
  }

  /** Marker-stones around a cursed area's border (SPEC §11). */
  private ringOfMarkers(a: Area): void {
    const w = this.sim.world;
    const n = T.cursedMarkerCount;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + 0.3;
      const x = Math.round(a.x + Math.cos(ang) * (a.r + 0.5));
      const z = Math.round(a.z + Math.sin(ang) * (a.r + 0.5));
      const h = this.sim.nav.at(x, z);
      if (h < 0 || this.sim.village.structureAt(x, z)) continue;
      w.set(x, h + 1, z, M.MARKER_STONE);
    }
  }

  /** Daily at dawn. */
  dawn(): void {
    const sim = this.sim;
    const day = sim.calendar.day;
    // Festivals: doctrine rituals are celebrated every few days.
    this.b.festivalToday = day % T.festivalEveryDays === 0 && this.b.active('RITUAL', T.doctrineThreshold).length > 0;
    if (sim.calendar.season === 'winter' && sim.calendar.dayOfSeason === 0) this.portent('time:winter');
    if (day % 6 === 3) this.portent('time:fullMoon');

    this.refreshCursed();
    this.sacredWorks();
    this.exiles();

    // The god's believed temperament tints how everyone feels about it.
    const temp = this.b.beliefs.get(this.b.key('TEMPERAMENT', 'god'));
    if (temp && temp.strength > 0.1) {
      for (const v of sim.villagers.alive) {
        if (!temp.holders.has(v.id)) continue;
        if (temp.valence > 0.2) v.faith.love = Math.min(1 - v.faith.fear, v.faith.love + 0.004);
        else if (temp.valence < -0.2) v.faith.fear = Math.min(1 - v.faith.love, v.faith.fear + 0.004);
      }
    }
    this.dancedTonight = false;
  }

  /** Paint cursed areas into the cell mask and the path-cost overlay. */
  private refreshCursed(): void {
    const sim = this.sim;
    const W = sim.world.sizeX;
    this.cursed.fill(0);
    sim.nav.cost.fill(0);
    for (const b of this.b.active('CURSED_PLACE')) {
      const a = b.area;
      if (!a) continue;
      for (let z = Math.floor(a.z - a.r); z <= Math.ceil(a.z + a.r); z++)
        for (let x = Math.floor(a.x - a.r); x <= Math.ceil(a.x + a.r); x++) {
          if (x < 0 || z < 0 || x >= W || z >= sim.world.sizeZ || Math.hypot(x - a.x, z - a.z) > a.r) continue;
          this.cursed[x + z * W] = 1;
          sim.nav.cost[x + z * W] = T.cursedPathCost * b.strength;
        }
    }
  }

  /** Sacred places grow cairn → shrine → temple as belief and the village grow (SPEC §11). */
  private sacredWorks(): void {
    const sim = this.sim;
    const pop = sim.villagers.alive.length;
    for (const b of this.b.active('SACRED_PLACE', T.sacredCairnAt)) {
      if (!b.area) continue;
      if (b.workId !== undefined) {
        const last = sim.village.byId(b.workId);
        if (!last) {
          // The builders gave up on it: try that stage again.
          b.works--;
          b.workId = undefined;
        } else if (!last.complete) continue;
      }
      const next =
        b.works === 0
          ? 'cairn'
          : b.works === 1 && b.strength >= T.sacredShrineAt && pop >= T.shrinePopulation
            ? 'shrine'
            : b.works === 2 && b.strength >= T.sacredTempleAt && pop >= T.templePopulation
              ? 'temple'
              : null;
      if (!next) continue;
      const s = sim.village.placePrefab(sim, next, Math.round(b.area.x), Math.round(b.area.z), false, next === 'cairn' ? 6 : 10);
      if (s) {
        b.works++;
        b.workId = s.id;
      }
    }
  }

  /** OUTCAST at full strength: they are sent away. */
  private exiles(): void {
    for (const id of this.outcastIds(T.outcastExileAt)) {
      const v = this.sim.villagers.byId(id);
      if (v?.alive && v.action?.kind !== 'exile') this.sim.villagers.exile(v);
    }
  }

  /** Each evening at the fire: dancing, offerings, quarrels, thefts, and the telling of beliefs. */
  dusk(): void {
    const sim = this.sim;
    const c = sim.village.center;
    const present = sim.villagers.alive.filter((v) => (v.action?.kind === 'gathering' || v.action?.kind === 'eat' || v.action?.kind === 'ritual') && Math.hypot(v.x - c.x, v.z - c.z) < 12);

    // When people are content, someone gets up and dances.
    let love = 0;
    let fear = 0;
    for (const v of sim.villagers.alive) (love += v.faith.love), (fear += v.faith.fear);
    if (!this.dancedTonight && present.length >= 3 && love >= fear && this.rng.chance(T.spontaneousDance)) {
      this.dancedTonight = true;
      const n = Math.min(present.length, this.rng.int(2, 4));
      for (const v of this.rng.shuffle([...present]).slice(0, n)) sim.villagers.startRitual(v, 'dance', Math.floor(v.x), Math.floor(v.z), null);
    }

    // Offerings: food left at the fire for a god that must be fed.
    for (const b of this.b.active('OFFERING')) {
      // Nobody gives away the last of the grain: offerings come out of the surplus.
      const surplus = sim.village.store.food - sim.villagers.alive.length * T.offeringReservePerCapita;
      // Doubters give nothing.
      const amount = Math.min(b.strength * sim.villagers.alive.length * T.offeringPerCapita * b.escalation, Math.max(0, surplus) * T.offeringSurplusShare) * (1 - sim.dissent.doubterShare());
      if (amount <= 0) continue;
      sim.village.store.food = Math.max(0, sim.village.store.food - amount);
      this.b.lastOfferingTick = sim.tick;
      this.b.deeds.add({ key: 'deed:offering', actorId: this.b.priestId, victimIds: [], x: c.x, z: c.z, tick: sim.tick });
    }

    this.deeds(present);
    this.b.tellRumors(present);
    this.b.spreadAtGathering(present);
    sim.dissent.dusk(present);
    sim.society.dusk(present);
    sim.justice.dusk();
  }

  /** Thefts and quarrels happen; taboos make them rarer and costlier. */
  private deeds(present: Villager[]): void {
    const sim = this.sim;
    const theftTaboo = this.taboo('deed:theft');
    const huts = sim.village.huts.filter((h) => sim.village.usableHut(h) && h.residents.length);
    for (const v of sim.villagers.alive) {
      if (v.lifeStage === 'child') continue;
      const temper = v.traits.includes('devout') ? 0.5 : v.traits.includes('skeptic') ? 1.5 : 1;
      const p = T.theftChancePerDay * (1 + v.needs.hunger * 4) * temper * (1 - theftTaboo);
      if (!this.rng.chance(p)) continue;
      const victims = huts.filter((h) => h.id !== v.homeId);
      if (!victims.length) continue;
      const h = this.rng.pick(victims);
      this.b.deeds.add({ key: 'deed:theft', actorId: v.id, victimIds: [...h.residents], x: h.door.x, z: h.door.z, tick: sim.tick });
      sim.events.push(sim.tick, { type: 'theft', id: v.id, hutId: h.id, victims: [...h.residents], x: h.door.x, z: h.door.z, known: this.rng.chance(TUNING.society.theftKnownChance) });
      if (theftTaboo > 0) v.standing = Math.max(0, v.standing - 0.25 * theftTaboo);
    }
    if (present.length >= 2 && this.rng.chance(T.fightChancePerDay * present.length * (1 - this.taboo('deed:fight')))) {
      const [a, b] = this.rng.shuffle([...present]);
      this.b.deeds.add({ key: 'deed:fight', actorId: a!.id, victimIds: [b!.id], x: Math.floor(a!.x), z: Math.floor(a!.z), tick: sim.tick });
      sim.events.push(sim.tick, { type: 'quarrel', a: a!.id, b: b!.id, x: Math.floor(a!.x), z: Math.floor(a!.z) });
    }
  }
}
