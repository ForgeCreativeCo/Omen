import type { Rng } from './rng';
import type { Sim } from './Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './time';
import type { Tribe } from './tribe';
import { TUNING } from './tuning';
import type { Villager, VillagerId } from './villagers/types';
import { M } from './world/materials';
import type { Islet } from './world/terrain';

const T = TUNING.boats;

export type BoatPhase = 'gather' | 'sail';

/** Settlers bound for an islet: first gathering on the shore, then afloat. */
export interface Boat {
  id: number;
  tribe: number;
  members: VillagerId[];
  phase: BoatPhase;
  /** Where they gather on the shore, where they put to sea, and where they land. */
  shore: { x: number; z: number };
  launch: { x: number; z: number };
  landing: { x: number; z: number };
  islet: number;
  /** Afloat: position and heading. */
  x: number;
  z: number;
  heading: number;
  /** Ticks left before the gathering gives up waiting for stragglers. */
  left: number;
}

/**
 * Boats and the islands off the coast. A people that has grown crowded may
 * send a few families to settle an empty islet: they walk to the nearest shore,
 * put to sea in a boat, and found a people of their own on the far side. The
 * voyage is short; whatever the god does to them on the water, it does.
 */
export class Boats {
  readonly boats: Boat[] = [];
  /** Tribe → tick it last sent settlers. */
  readonly lastSent = new Map<number, number>();
  private nextId = 1;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** Afloat in a boat (the villager AI leaves them be). */
  carries(v: Villager): boolean {
    return this.boats.some((b) => b.phase === 'sail' && b.members.includes(v.id));
  }

  boatOf(v: Villager): Boat | undefined {
    return this.boats.find((b) => b.members.includes(v.id));
  }

  /** Islets no people lives on (and none is sailing for). */
  emptyIslets(): number[] {
    const sim = this.sim;
    return sim.island.landmarks.islets
      .map((_, i) => i)
      .filter((i) => {
        const l = sim.island.landmarks.islets[i]!;
        if (this.boats.some((b) => b.islet === i)) return false;
        return !sim.tribes.some((t) => t.members.length && Math.hypot(t.village.center.x - l.x, t.village.center.z - l.z) <= l.r + 4);
      });
  }

  // ------------------------------------------------------------------ daily

  dawn(): void {
    const sim = this.sim;
    if (sim.mode === 'warning') return;
    for (const t of sim.tribes) {
      if (t.members.length < T.crowdedAt || this.boats.some((b) => b.tribe === t.id)) continue;
      if (sim.tick - (this.lastSent.get(t.id) ?? 0) < T.restYears * TICKS_PER_YEAR) continue;
      // Crowded: more people than beds, or simply many.
      const beds = t.village.bedCapacity();
      if (t.members.length <= beds && t.members.length < T.crowdedAt * 1.5) continue;
      if (!this.rng.chance(T.chancePerDay)) continue;
      this.send(t);
    }
  }

  /** Choose settlers and an islet, and send them to the shore. */
  send(t: Tribe, islet?: number): Boat | null {
    const sim = this.sim;
    const c = t.village.center;
    const free = this.emptyIslets();
    const target = islet ?? free.sort((a, b) => this.dist(a, c) - this.dist(b, c))[0];
    if (target === undefined || !free.includes(target)) return null;
    const l = sim.island.landmarks.islets[target]!;
    // The fire itself blocks the ground: start from the nearest open cell.
    const route = this.route(t.village.nearestWalkable(c.x, c.z) ?? c, l);
    if (!route) return null;
    // A young couple or two with their children, and whoever else is restless.
    const busy = (v: Villager) => sim.war.engaged(v) || v.id === t.belief.priestId || v.action?.kind === 'exile';
    const couples = t.members.filter((v) => v.lifeStage === 'adult' && v.partnerId >= 0 && v.sex === 'f' && !busy(v)).sort((a, b) => a.age - b.age);
    const party: Villager[] = [];
    for (const a of couples) {
      if (party.length >= T.settlers) break;
      const b = sim.villagers.byId(a.partnerId);
      if (!b?.alive || b.tribeId !== t.id || busy(b)) continue;
      party.push(a, b);
      for (const k of a.childIds.map((id) => sim.villagers.byId(id))) if (k?.alive && k.lifeStage === 'child' && k.tribeId === t.id) party.push(k);
    }
    for (const v of this.rng.shuffle(t.members.filter((v) => v.lifeStage === 'adult' && !busy(v) && !party.includes(v)))) {
      if (party.length >= T.settlers) break;
      party.push(v);
    }
    if (party.filter((v) => v.lifeStage !== 'child').length < 2) return null;
    const boat: Boat = { id: this.nextId++, tribe: t.id, members: party.map((v) => v.id), phase: 'gather', ...route, islet: target, x: route.launch.x, z: route.launch.z, heading: 0, left: TICKS_PER_DAY * 2 };
    this.boats.push(boat);
    this.lastSent.set(t.id, sim.tick);
    for (const v of party) sim.villagers.order(v, 'pilgrimage', boat.shore.x, boat.shore.z, TICKS_PER_DAY * 2);
    sim.events.push(sim.tick, { type: 'voyage', tribe: t.id, ids: [...boat.members], islet: target, x: boat.shore.x, z: boat.shore.z });
    return boat;
  }

  private dist(i: number, p: { x: number; z: number }): number {
    const l = this.sim.island.landmarks.islets[i]!;
    return Math.hypot(l.x - p.x, l.z - p.z);
  }

  /**
   * The crossing: a walkable shore cell on the people's own land nearest the
   * islet, open water beside it, and open water beside the islet's beach.
   */
  private route(home: { x: number; z: number }, l: Islet): { shore: { x: number; z: number }; launch: { x: number; z: number }; landing: { x: number; z: number } } | null {
    const sim = this.sim;
    const nav = sim.nav;
    const w = sim.world;
    const sea = TUNING.terrain.seaLevel;
    const regions = nav.regions();
    const W = w.sizeX;
    const homeRegion = regions[Math.round(home.x) + Math.round(home.z) * W] ?? 0;
    const wet = (x: number, z: number) => w.get(x, sea, z) === M.WATER && w.get(x, sea + 1, z) === M.AIR;
    const byWater = (x: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: x + dx!, z: z + dz! })).find((p) => wet(p.x, p.z));
    let shore: { x: number; z: number } | null = null;
    let launch: { x: number; z: number } | null = null;
    let best = Infinity;
    for (let z = 2; z < w.sizeZ - 2; z += 2)
      for (let x = 2; x < W - 2; x += 2) {
        if (!nav.walkable(x, z) || regions[x + z * W] !== homeRegion) continue;
        const water = byWater(x, z);
        if (!water) continue;
        const d = Math.hypot(x - l.x, z - l.z);
        if (d < best) (best = d), (shore = { x, z }), (launch = water);
      }
    if (!shore || !launch) return null;
    // Landing: the islet's beach cell nearest the launch, with water beside it.
    let landing: { x: number; z: number } | null = null;
    best = Infinity;
    for (let z = l.z - l.r - 3; z <= l.z + l.r + 3; z++)
      for (let x = l.x - l.r - 3; x <= l.x + l.r + 3; x++) {
        if (!wet(x, z)) continue;
        const land = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => nav.walkable(x + dx!, z + dz!) && Math.hypot(x + dx! - l.x, z + dz! - l.z) <= l.r + 1);
        if (!land) continue;
        const d = Math.hypot(x - launch.x, z - launch.z);
        if (d < best) (best = d), (landing = { x, z });
      }
    return landing ? { shore, launch, landing } : null;
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    for (const b of [...this.boats]) this.advance(b);
  }

  private members(b: Boat): Villager[] {
    return b.members.map((id) => this.sim.villagers.byId(id)).filter((v): v is Villager => !!v?.alive);
  }

  private advance(b: Boat): void {
    const sim = this.sim;
    const crew = this.members(b);
    b.members = crew.map((v) => v.id);
    if (crew.filter((v) => v.lifeStage !== 'child').length < 2) return this.abandon(b);
    if (b.phase === 'gather') {
      b.left--;
      const there = crew.filter((v) => Math.hypot(v.x - b.shore.x, v.z - b.shore.z) <= 4).length;
      if (there >= crew.length * 0.75 || b.left <= 0) {
        b.phase = 'sail';
        b.heading = Math.atan2(b.landing.z - b.launch.z, b.landing.x - b.launch.x);
        // Stragglers stay behind.
        b.members = crew.filter((v) => Math.hypot(v.x - b.shore.x, v.z - b.shore.z) <= 10).map((v) => v.id);
        for (const v of this.members(b)) {
          sim.villagers.lift(v);
          v.inside = false;
        }
        sim.events.push(sim.tick, { type: 'setSail', tribe: b.tribe, ids: [...b.members], x: b.launch.x, z: b.launch.z });
      } else if ((sim.tick + b.id) % 40 === 0) for (const v of crew) if (v.action?.kind !== 'pilgrimage') sim.villagers.order(v, 'pilgrimage', b.shore.x, b.shore.z, TICKS_PER_DAY);
      return;
    }
    // Afloat.
    const dx = b.landing.x - b.x;
    const dz = b.landing.z - b.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, T.speed);
    if (d > 0.01) {
      b.x += (dx / d) * step;
      b.z += (dz / d) * step;
      b.heading = Math.atan2(dz, dx);
    }
    const y = TUNING.terrain.seaLevel + 0.6;
    crew.forEach((v, i) => {
      v.px = v.x;
      v.py = v.y;
      v.pz = v.z;
      const a = b.heading + Math.PI / 2;
      const off = (i % 3) - 1;
      const back = Math.floor(i / 3) * 0.6 - 0.6;
      v.x = b.x + 0.5 + Math.cos(a) * off * 0.45 - Math.cos(b.heading) * back;
      v.z = b.z + 0.5 + Math.sin(a) * off * 0.45 - Math.sin(b.heading) * back;
      v.y = y;
      v.drowningTicks = 0;
    });
    if (d > 0.3) return;
    this.land(b, crew);
  }

  /** Ashore: they found a people of their own on the islet. */
  private land(b: Boat, crew: Villager[]): void {
    const sim = this.sim;
    this.boats.splice(this.boats.indexOf(b), 1);
    const l = sim.island.landmarks.islets[b.islet]!;
    const spot = (i: number) => {
      for (let r = 1; r <= 3; r++)
        for (let k = 0; k < 8; k++) {
          const x = b.landing.x + Math.round(Math.cos(k + i) * r);
          const z = b.landing.z + Math.round(Math.sin(k + i) * r);
          if (sim.nav.walkable(x, z)) return { x, z };
        }
      return { x: l.x, z: l.z };
    };
    crew.forEach((v, i) => {
      const s = spot(i);
      v.x = v.px = s.x + 0.5;
      v.z = v.pz = s.z + 0.5;
      v.y = v.py = sim.nav.at(s.x, s.z) + 1;
      v.nextThink = sim.tick;
    });
    // The fire goes on the islet's high ground.
    let site = { x: l.x, y: sim.nav.at(l.x, l.z), z: l.z };
    if (site.y < 0) site = { x: crew[0] ? Math.floor(crew[0].x) : l.x, y: sim.nav.at(Math.floor(crew[0]?.x ?? l.x), Math.floor(crew[0]?.z ?? l.z)), z: crew[0] ? Math.floor(crew[0].z) : l.z };
    const leader = crew.find((v) => v.lifeStage === 'adult');
    const t = sim.foundTribe(crew, site, { reason: 'settlers', leaderId: leader?.id });
    // They left on good terms.
    sim.war.relations.set(b.tribe < t.id ? `${b.tribe}:${t.id}` : `${t.id}:${b.tribe}`, T.startFondness);
    sim.events.push(sim.tick, { type: 'landfall', tribe: t.id, from: b.tribe, ids: crew.map((v) => v.id), x: b.landing.x, z: b.landing.z });
  }

  private abandon(b: Boat): void {
    this.boats.splice(this.boats.indexOf(b), 1);
    // Afloat with nobody to row: whoever is left wades for land.
    for (const v of this.members(b)) v.nextThink = this.sim.tick;
    this.sim.events.push(this.sim.tick, { type: 'voyageEnd', tribe: b.tribe, ids: [...b.members] });
  }
}
