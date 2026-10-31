import type { Sim } from '../Sim';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import type { Villager, VillagerId } from '../villagers/types';
import { M } from '../world/materials';
import type { ContextFeature, FeatureCategory } from './types';

const T = TUNING.belief;

/** Emotional weight of each kind of feature (SPEC §7: a death > a theft > a meal). Data only. */
export const FEATURE_INTENSITY: Record<string, number> = {
  // activities
  'activity:dance': 0.85,
  'activity:praying': 0.7,
  'activity:offering': 0.7,
  'activity:pilgrimage': 0.6,
  'activity:fleeing': 0.6,
  'activity:building': 0.45,
  'activity:gathering': 0.4,
  'activity:farming': 0.35,
  'activity:woodcutting': 0.35,
  'activity:quarrying': 0.3,
  'activity:foraging': 0.3,
  'activity:eating': 0.25,
  // places
  'place:graveyard': 0.6,
  'place:eastHill': 0.6,
  'place:well': 0.55,
  'place:ridge': 0.55,
  'place:river': 0.45,
  'place:fire': 0.4,
  'place:fields': 0.4,
  'place:coast': 0.4,
  'place:hut': 0.45,
  'place:cairn': 0.65,
  'place:valley': 0.15,
  // deeds and events
  'deed:theft': 0.75,
  'deed:fight': 0.65,
  'deed:adultery': 0.8,
  'deed:murder': 1,
  'deed:offering': 0.6,
  'event:death': 0.8,
  'event:birth': 0.6,
  // time and conditions
  'time:dawn': 0.3,
  'time:dusk': 0.3,
  'time:night': 0.35,
  'time:day': 0.1,
  'time:fullMoon': 0.5,
  'time:winter': 0.25,
  'time:festival': 0.5,
  'condition:drought': 0.6,
  'condition:storm': 0.4,
};

/** Activity a villager's current action amounts to, for context purposes. */
export function activityOf(v: Villager): string | null {
  const a = v.action;
  if (!a || v.inside || v.lying) return null;
  switch (a.kind) {
    case 'farm':
      return 'farming';
    case 'chop':
      return 'woodcutting';
    case 'quarry':
      return 'quarrying';
    case 'forage':
      return 'foraging';
    case 'build':
      return 'building';
    case 'gathering':
      return 'gathering';
    case 'eat':
      return 'eating';
    case 'flee':
      return 'fleeing';
    case 'ritual':
      return a.phase === 'work' ? (a.ritual === 'pray' ? 'praying' : (a.ritual ?? 'dance')) : null;
    case 'offering':
      return 'offering';
    case 'pilgrimage':
      return 'pilgrimage';
    default:
      return null;
  }
}

// ---------------------------------------------------------------- deeds

export interface Deed {
  key: string;
  actorId: VillagerId;
  /** Who was wronged (a family), if anyone. */
  victimIds: VillagerId[];
  x: number;
  z: number;
  tick: number;
}

/** Recent deeds people might later connect to an omen (thefts, fights, offerings). */
export class DeedLog {
  deeds: Deed[] = [];

  add(d: Deed): void {
    this.deeds.push(d);
  }

  prune(tick: number): void {
    this.deeds = this.deeds.filter((d) => tick - d.tick < TICKS_PER_DAY * 2);
  }

  /** The most recent deed of this kind by this villager, if any. */
  latest(actorId: VillagerId, key: string): Deed | undefined {
    for (let i = this.deeds.length - 1; i >= 0; i--) {
      const d = this.deeds[i]!;
      if (d.actorId === actorId && d.key === key) return d;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------- places

/**
 * Named places villagers talk about (SPEC §7, §11). Distances are from a point to
 * the nearest part of the place (0 inside).
 */
export function placesNear(sim: Sim, x: number, z: number, radius: number): { key: string; distance: number }[] {
  const out: { key: string; distance: number }[] = [];
  const add = (key: string, d: number) => {
    if (d <= radius) out.push({ key, distance: Math.max(0, d) });
  };
  const L = sim.island.landmarks;
  const v = sim.village;

  add('place:fire', Math.hypot(x - v.center.x, z - v.center.z) - 3);
  add('place:eastHill', Math.hypot(x - L.eastHill.x, z - L.eastHill.z) - TUNING.terrain.hillRadius * 0.75);
  const along = (x + 0.5 - L.center.x) * L.ridgeDir.x + (z + 0.5 - L.center.z) * L.ridgeDir.z;
  add('place:ridge', TUNING.terrain.ridgeCrest * 0.55 - along);
  let river = Infinity;
  for (const p of L.riverPath) river = Math.min(river, Math.hypot(p.x - x, p.z - z));
  add('place:river', river - 2.5);

  let fields = Infinity;
  for (const s of v.structures) {
    if (s.abandoned) continue;
    const dx = Math.max(s.x0 - x, 0, x - (s.x0 + s.w - 1));
    const dz = Math.max(s.z0 - z, 0, z - (s.z0 + s.d - 1));
    const d = Math.hypot(dx, dz);
    if (s.kind === 'field') fields = Math.min(fields, d);
    else if (s.kind === 'well') add('place:well', d - 1);
    else if (s.kind === 'hut' && s.residents.length) add(`place:hut:${s.id}`, d - 0.5);
    else if (s.kind === 'cairn' || s.kind === 'shrine' || s.kind === 'temple' || (s.kind === 'statue' && !s.ruined)) add(`place:${s.kind}:${s.id}`, d - 1);
  }
  add('place:fields', fields - 1);
  // Places that exist because the god reshaped the land there.
  for (const site of sim.myth?.places.sites ?? []) add(site.key, Math.hypot(x - site.x, z - site.z) - site.r);
  if (v.graveyard) {
    const g = v.graveyard;
    add('place:graveyard', Math.hypot(Math.max(g.x0 - x, 0, x - (g.x0 + g.w)), Math.max(g.z0 - z, 0, z - (g.z0 + g.d))));
  }
  // The shore: any low sand/water within a few cells.
  let coast = Infinity;
  for (let dz = -3; dz <= 3; dz++)
    for (let dx = -3; dx <= 3; dx++) {
      const h = sim.island.ground[Math.round(x) + dx + (Math.round(z) + dz) * sim.world.sizeX];
      if (h !== undefined && h >= 0 && h <= TUNING.terrain.seaLevel) coast = Math.min(coast, Math.hypot(dx, dz));
    }
  add('place:coast', coast);
  // Somewhere that is nowhere in particular.
  if (!out.some((p) => p.distance === 0)) out.push({ key: 'place:valley', distance: 0 });
  return out;
}

// ---------------------------------------------------------------- snapshot

function category(key: string): FeatureCategory {
  return key.slice(0, key.indexOf(':')) as FeatureCategory;
}

/** Look up base intensity, falling back to the family ('place:hut:12' → 'place:hut'). */
export function baseIntensity(key: string): number {
  if (FEATURE_INTENSITY[key] !== undefined) return FEATURE_INTENSITY[key]!;
  const family = key.split(':').slice(0, 2).join(':');
  return FEATURE_INTENSITY[family] ?? 0.3;
}

/**
 * What was going on around (x, z) right now (SPEC §7): activities, places, people,
 * recent deeds and events, time and conditions. `affected` lists villagers the omen
 * touched (they become vivid "person" features).
 */
export function snapshot(sim: Sim, x: number, z: number, affected: VillagerId[] = []): ContextFeature[] {
  const R = T.contextRadius;
  const tick = sim.tick;
  const out: ContextFeature[] = [];
  const push = (key: string, distance: number, recency = 0, intensity = baseIntensity(key), people?: VillagerId[]) =>
    out.push({ key, category: category(key), intensity, distance, recency, people });

  // Activities and people present
  const acts = new Map<string, { n: number; d: number; who: VillagerId[] }>();
  const near: { v: Villager; d: number }[] = [];
  for (const v of sim.villagers.alive) {
    const d = Math.hypot(v.x - x, v.z - z);
    if (d > R) continue;
    near.push({ v, d });
    const act = activityOf(v);
    if (!act) continue;
    const a = acts.get(act) ?? { n: 0, d: Infinity, who: [] };
    a.n++;
    a.d = Math.min(a.d, d);
    a.who.push(v.id);
    acts.set(act, a);
  }
  for (const [act, a] of acts) {
    const key = `activity:${act}`;
    push(key, a.d, 0, baseIntensity(key) * Math.min(1, 0.55 + a.n * 0.15), a.who);
  }
  near.sort((a, b) => a.d - b.d);
  const priestId = sim.belief.priestId;
  const chosen = sim.belief.chosenIds();
  const persons = new Map<VillagerId, number>();
  // Bystanders only register when right there; the priest, the chosen and the affected
  // are noticed anywhere in the scene.
  near.filter(({ d }) => d <= 5).slice(0, 4).forEach(({ v, d }) => persons.set(v.id, d));
  for (const { v, d } of near) if (v.id === priestId || chosen.has(v.id)) persons.set(v.id, d);
  for (const id of affected) {
    const v = sim.villagers.byId(id);
    if (v) persons.set(id, Math.min(persons.get(id) ?? Infinity, Math.hypot(v.x - x, v.z - z)));
  }
  for (const [id, d] of persons) {
    const intensity = affected.includes(id) ? 0.8 : id === priestId ? 0.55 : chosen.has(id) ? 0.6 : 0.3;
    push(`person:${id}`, d, 0, intensity, [id]);
  }

  // Places
  for (const p of placesNear(sim, x, z, R)) push(p.key, p.distance);

  // Deeds, measured to wherever they're most vivid: the scene, the doer, or the doer's home.
  for (const dd of sim.belief.deeds.deeds) {
    const actor = sim.villagers.byId(dd.actorId);
    const home = actor && actor.homeId >= 0 ? sim.village.byId(actor.homeId) : undefined;
    const d = Math.min(
      Math.hypot(dd.x - x, dd.z - z),
      actor?.alive ? Math.hypot(actor.x - x, actor.z - z) : Infinity,
      home ? Math.hypot(home.x0 + home.w / 2 - x, home.z0 + home.d / 2 - z) : Infinity,
    );
    if (d <= R * 1.5) push(dd.key, d, tick - dd.tick, baseIntensity(dd.key), [dd.actorId]);
  }

  // Births and deaths in the last day
  for (const e of sim.events.since(Math.max(0, sim.events.lastSeq - 60))) {
    if (tick - e.tick > TICKS_PER_DAY) continue;
    if (e.type === 'birth') {
      const c = sim.villagers.byId(e.id);
      if (c && Math.hypot(c.x - x, c.z - z) <= R) push('event:birth', Math.hypot(c.x - x, c.z - z), tick - e.tick, undefined, [e.id]);
    } else if (e.type === 'death' && Math.hypot(e.x - x, e.z - z) <= R) {
      push('event:death', Math.hypot(e.x - x, e.z - z), tick - e.tick, undefined, [e.id]);
    }
  }

  // Time and conditions (everywhere, distance 0)
  const cal = sim.calendar;
  push(`time:${cal.timeOfDay}`, 0);
  if (cal.season === 'winter') push('time:winter', 0);
  if (cal.day % 6 === 3 && cal.timeOfDay === 'night') push('time:fullMoon', 0);
  if (sim.belief.festivalToday) push('time:festival', 0);
  if (sim.weather.drought) push('condition:drought', 0);
  if (sim.weather.precipitation === 'storm') push('condition:storm', 0);
  return out;
}

// ---------------------------------------------------------------- labels

const ACTIVITY_LABEL: Record<string, string> = {
  dance: 'dancing',
  praying: 'prayer',
  offering: 'offerings',
  pilgrimage: 'pilgrimage',
  fleeing: 'flight',
  building: 'building',
  gathering: 'gathering at the fire',
  farming: 'farming',
  woodcutting: 'felling trees',
  quarrying: 'cutting stone',
  foraging: 'foraging',
  eating: 'feasting',
};

const PLACE_LABEL: Record<string, string> = {
  fire: 'the fire',
  eastHill: 'the east hill',
  ridge: 'the ridge',
  river: 'the river',
  fields: 'the fields',
  well: 'the well',
  graveyard: 'the graves',
  coast: 'the shore',
  valley: 'the valley',
};

const OTHER_LABEL: Record<string, string> = {
  'deed:theft': 'theft',
  'deed:fight': 'quarrels',
  'deed:adultery': 'faithlessness',
  'deed:murder': 'the killing',
  'deed:offering': 'offerings',
  'event:birth': 'a birth',
  'event:death': 'a death',
  'time:dawn': 'dawn',
  'time:dusk': 'dusk',
  'time:night': 'the night',
  'time:day': 'the day',
  'time:fullMoon': 'the full moon',
  'time:winter': 'winter',
  'time:festival': 'the festival',
  'condition:drought': 'the drought',
  'condition:storm': 'the storm',
};

/** Human words for a feature key, as villagers would say it. */
export function featureLabel(sim: Sim, key: string): string {
  const [cat, a, b] = key.split(':');
  if (cat === 'activity') return ACTIVITY_LABEL[a!] ?? a!;
  if (cat === 'person') return sim.villagers.byId(Number(a))?.name ?? 'someone';
  if (cat === 'place') {
    if (a === 'hut') {
      const h = sim.village.byId(Number(b));
      const owner = h?.residents.map((id) => sim.villagers.byId(id)).find((p) => p && p.lifeStage !== 'child');
      return owner ? `${owner.name}'s hut` : 'an empty hut';
    }
    if (a === 'cairn' || a === 'shrine' || a === 'temple' || a === 'statue') return `the ${a}`;
    if (a === 'site') return sim.belief.placeName(key) ?? 'the shaped ground';
    return sim.belief.placeName(key) ?? PLACE_LABEL[a!] ?? a!;
  }
  return OTHER_LABEL[key] ?? key;
}

/** Ground column top for a point, ignoring foliage. */
export function surfaceY(sim: Sim, x: number, z: number): number {
  return sim.world.topY(x, z, (id) => id !== M.AIR && id !== M.LEAVES && id !== M.PINE_LEAVES && id !== M.WATER);
}
