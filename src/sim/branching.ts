import { findSettlement } from './exodus';
import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './time';
import type { Tribe } from './tribe';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';

const T = TUNING.branching;
const H = TUNING.miracles.hallow;

/** Believers on their way from their people to hallowed ground. */
export interface Calling {
  id: number;
  tribe: number;
  members: VillagerId[];
  /** The hallowed place (its key in the people's place names) and where they walk to. */
  place: string;
  x: number;
  z: number;
  /** Ticks left before the stragglers are left behind. */
  left: number;
}

/**
 * Hallowed ground and the peoples it calls away. Ground the god marks out glows
 * for days; whoever sees it may come to hold it holy (the faithful more, the
 * skeptical less, doubters not at all), and the belief spreads at the fire like
 * any other. If the ground lies well away from home, the village is crowded and
 * enough of them believe, a party of believers sets out, families together, led
 * by the most devout, and founds a people of its own there: kin who share the
 * old faith, for now. On an islet, they sail.
 */
export class Branching {
  readonly callings: Calling[] = [];
  /** Tribe → tick it last sent believers away. */
  readonly lastSent = new Map<number, number>();
  /** Hallowed ground each people knows, by `${tribe}:${place key}`. */
  readonly grounds = new Map<string, { x: number; z: number; r: number }>();
  /** Tribe → the day its believers began to talk of going (while it all holds). */
  readonly talking = new Map<number, number>();
  /** `${hallow id}:${villager id}` → the day they last saw it (it moves them once a day). */
  private readonly seen = new Map<string, number>();
  private nextId = 1;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** On the way to hallowed ground (the villager AI leaves them be). */
  callingOf(v: Villager): Calling | undefined {
    return this.callings.find((c) => c.members.includes(v.id));
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    if (this.sim.miracles.hallows.length && this.sim.tick % 20 === 0) this.witness();
    for (const c of [...this.callings]) this.advance(c);
  }

  /** Whoever can see the glow is moved by it (once a day each). */
  private witness(): void {
    const sim = this.sim;
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    for (const h of sim.miracles.hallows) {
      const r = Math.max(4, h.radius);
      for (const t of sim.tribes) {
        let key = '';
        for (const v of t.members) {
          if (v.inside || v.lying || Math.hypot(v.x - h.x, v.z - h.z) > H.range) continue;
          const seen = `${h.id}:${v.id}`;
          if (this.seen.get(seen) === day) continue;
          this.seen.set(seen, day);
          if (t.dissent.isDoubter(v)) continue;
          if (!key) {
            key = t.myth.hallowedSite(h.x, h.z, r);
            this.grounds.set(`${t.id}:${key}`, { x: h.x, z: h.z, r });
          }
          const k = H.sightStrength * (v.traits.includes('devout') ? 1.3 : v.traits.includes('skeptic') ? 0.5 : 1) * (0.5 + v.faith.love);
          const b = t.belief.hold(v, 'SACRED_PLACE', key, 'favor', k, null);
          b.area ??= { x: h.x, z: h.z, r };
        }
        if (key) t.belief.refreshStrengths();
      }
    }
  }

  private members(c: Calling): Villager[] {
    return c.members.map((id) => this.sim.villagers.byId(id)).filter((v): v is Villager => !!v?.alive && v.tribeId === c.tribe);
  }

  private advance(c: Calling): void {
    const sim = this.sim;
    const crew = this.members(c);
    c.members = crew.map((v) => v.id);
    if (crew.filter((v) => v.lifeStage !== 'child').length < 2) return this.end(c);
    c.left--;
    const near = (v: Villager, d: number) => Math.hypot(v.x - c.x, v.z - c.z) <= d;
    const there = crew.filter((v) => near(v, 6));
    if (there.length >= Math.ceil(crew.length * 0.7) || (c.left <= 0 && there.filter((v) => v.lifeStage !== 'child').length >= 2)) {
      return this.found(c, crew.filter((v) => near(v, 14)));
    }
    if (c.left <= 0) return this.end(c);
    if ((sim.tick + c.id) % 40 === 0) for (const v of crew) if (v.action?.kind !== 'pilgrimage') sim.villagers.order(v, 'pilgrimage', c.x, c.z, c.left);
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    const sim = this.sim;
    // Forget sightings of glows that have faded.
    const live = new Set(sim.miracles.hallows.map((h) => h.id));
    for (const k of this.seen.keys()) if (!live.has(Number(k.split(':')[0]))) this.seen.delete(k);
    if (sim.mode === 'warning') return;
    if (sim.tribes.filter((t) => t.members.length).length + this.callings.length >= T.maxPeoples) return;
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    for (const t of sim.tribes) {
      const was = this.talking.get(t.id);
      this.talking.delete(t.id);
      if (t.members.length < T.crowdedAt || this.callings.some((c) => c.tribe === t.id)) continue;
      if (sim.boats.boats.some((b) => b.tribe === t.id)) continue;
      if (this.lastSent.has(t.id) && sim.tick - this.lastSent.get(t.id)! < T.restYears * TICKS_PER_YEAR) continue;
      for (const b of t.belief.active('SACRED_PLACE', T.beliefAt).sort((a, z) => z.strength - a.strength)) {
        const g = this.grounds.get(`${t.id}:${b.subject}`);
        if (!g) continue;
        const c = t.village.center;
        if (Math.hypot(g.x - c.x, g.z - c.z) < T.minDistance) continue;
        if (sim.tribes.some((o) => o.members.length && Math.hypot(o.village.center.x - g.x, o.village.center.z - g.z) < T.clearOfVillages)) continue;
        const believers = t.members.filter((v) => (b.holders.get(v.id) ?? 0) >= T.holdAt);
        if (believers.length < T.believers) continue;
        // It all holds: they talk it over at the fire for a few days, then go.
        const since = was ?? day;
        this.talking.set(t.id, since);
        if (day - since >= T.deliberateDays) {
          this.talking.delete(t.id);
          this.send(t, b.subject, g, believers.sort((p, q) => (b.holders.get(q.id) ?? 0) - (b.holders.get(p.id) ?? 0)));
        }
        break;
      }
    }
  }

  /** The believers and their families set out (on foot, or by boat for an islet). */
  send(t: Tribe, place: string, g: { x: number; z: number }, believers: Villager[]): Calling | boolean {
    const sim = this.sim;
    const busy = (v: Villager) => sim.war.engaged(v) || v.id === t.belief.priestId || v.action?.kind === 'exile' || !!sim.boats.boatOf(v) || !!this.callingOf(v);
    const party: Villager[] = [];
    const add = (v: Villager | undefined) => {
      if (v?.alive && v.tribeId === t.id && !busy(v) && !party.includes(v)) party.push(v);
    };
    // The most devout first, each with their household: a partner follows, and the children.
    for (const v of believers) {
      if (party.length >= T.party) break;
      if (v.lifeStage === 'child' || busy(v)) continue;
      add(v);
      add(sim.villagers.byId(v.partnerId));
      for (const id of v.childIds) {
        const k = sim.villagers.byId(id);
        if (k?.lifeStage === 'child') add(k);
      }
    }
    if (party.filter((v) => v.lifeStage !== 'child').length < 3) return false;
    // On an islet, the boats take them.
    const islet = sim.island.landmarks.islets.findIndex((l) => Math.hypot(l.x - g.x, l.z - g.z) <= l.r + 2);
    const regions = sim.nav.regions();
    const W = sim.world.sizeX;
    const dest = t.village.nearestWalkable(Math.round(g.x), Math.round(g.z)) ?? { x: Math.round(g.x), z: Math.round(g.z) };
    const onFoot = regions[dest.x + dest.z * W] === t.village.centerRegion;
    if (!onFoot) {
      if (islet < 0) return false;
      const boat = sim.boats.send(t, islet, party, place);
      if (!boat) return false;
      this.lastSent.set(t.id, sim.tick);
      sim.events.push(sim.tick, { type: 'calling', tribe: t.id, ids: [...boat.members], x: dest.x, z: dest.z, place });
      return true;
    }
    const walk = T.walkDays * TICKS_PER_DAY;
    const c: Calling = { id: this.nextId++, tribe: t.id, members: party.map((v) => v.id), place, x: dest.x, z: dest.z, left: walk };
    this.callings.push(c);
    this.lastSent.set(t.id, sim.tick);
    for (const v of party) sim.villagers.order(v, 'pilgrimage', c.x, c.z, walk);
    sim.events.push(sim.tick, { type: 'calling', tribe: t.id, ids: [...c.members], x: c.x, z: c.z, place });
    return c;
  }

  /** Arrived: a people of their own on the hallowed ground. */
  private found(c: Calling, crew: Villager[]): void {
    const sim = this.sim;
    this.callings.splice(this.callings.indexOf(c), 1);
    const from = sim.tribes[c.tribe]!;
    const g = this.grounds.get(`${c.tribe}:${c.place}`) ?? { x: c.x, z: c.z, r: 5 };
    // The fire goes on good ground close by (flat, near water), else where they stand.
    const site =
      findSettlement(sim, crew, g, 0, 14, this.rng, from.village.forbidden, { x: g.x, z: g.z, strength: 1 }) ??
      { x: c.x, y: sim.nav.at(c.x, c.z), z: c.z };
    this.settle(from, crew, c.place, site);
  }

  /** Found the daughter people (also used by the boats for an islet). */
  settle(from: Tribe, crew: Villager[], place: string, site: { x: number; y: number; z: number }): Tribe {
    const sim = this.sim;
    const holders = from.belief.beliefs.get(from.belief.key('SACRED_PLACE', place, 'favor'))?.holders;
    const leader = crew.filter((v) => v.lifeStage !== 'child').sort((p, q) => (holders?.get(q.id) ?? 0) - (holders?.get(p.id) ?? 0))[0];
    const t = sim.foundTribe(crew, site, { reason: 'hallowed', leaderId: leader?.id });
    // The place keeps its name among them, and it's theirs now.
    const named = from.myth.places.site(place);
    const name = from.myth.places.name(place);
    if (named) t.myth.places.adopt(named, name);
    const g = this.grounds.get(`${from.id}:${place}`);
    if (g) this.grounds.set(`${t.id}:${place}`, g);
    // Kin: they part on good terms.
    sim.war.relations.set(from.id < t.id ? `${from.id}:${t.id}` : `${t.id}:${from.id}`, T.startFondness);
    return t;
  }

  private end(c: Calling): void {
    this.callings.splice(this.callings.indexOf(c), 1);
    for (const v of this.members(c)) v.nextThink = this.sim.tick;
    this.sim.events.push(this.sim.tick, { type: 'callingEnd', tribe: c.tribe, ids: [...c.members] });
  }
}
