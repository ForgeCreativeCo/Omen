import { Appeasement } from './appease';
import { BeliefEffects } from './belief/effects';
import { BeliefSystem } from './belief/BeliefSystem';
import { Dissent } from './dissent';
import { Exodus } from './exodus';
import { Justice } from './justice';
import { Milestones } from './milestones';
import { MythSystem } from './myth/Myth';
import type { SimEventBody } from './events';
import type { Sim } from './Sim';
import type { Villager } from './villagers/types';
import { Village } from './villagers/village';
import type { Point3 } from './world/terrain';

/** Colors that tell the peoples apart (headbands, belts, banners, sails, names in the log): one hue each, far apart. */
export const TRIBE_COLORS = [0xe8b04a, 0x4f8fe0, 0xd9463a, 0x5fbf5a, 0xa66ee0, 0x3fc8c0] as const;

/** The systems a people has of its own, by the name the sim gives them. */
const OWN = ['village', 'belief', 'effects', 'myth', 'milestones', 'dissent', 'justice', 'exodus', 'appease'] as const;

/**
 * One people: their village, their faith (beliefs, priest, Holy Book, name for
 * the god), their doubters and prophets, their justice, and where they go when
 * home is lost. Each of those systems sees the sim through `view`: the whole
 * world as this people knows it, where `sim.village`, `sim.belief`,
 * `sim.villagers.alive` and the rest mean *theirs*, and everything shared (the
 * land, the weather, the god's miracles, the event log) is the one world.
 */
export class Tribe {
  declare readonly view: Sim;
  readonly village: Village;
  readonly belief: BeliefSystem;
  readonly effects: BeliefEffects;
  readonly myth: MythSystem;
  readonly milestones: Milestones;
  readonly dissent: Dissent;
  readonly justice: Justice;
  readonly exodus: Exodus;
  readonly appease: Appeasement;

  constructor(
    readonly sim: Sim,
    readonly id: number,
    public name: string,
    site: Point3,
  ) {
    // Tribe 0 keeps the original stream names, so a one-people game replays as before.
    const label = (s: string) => (id === 0 ? s : `${s}:${id}`);
    const view = this.makeView();
    this.village = new Village(sim.world, sim.nav, sim.rng.fork(label('village')), site, sim.trees, sim.counters);
    Object.defineProperty(view, 'village', { value: this.village, configurable: true });
    this.belief = new BeliefSystem(view, sim.rng.fork(label('belief')));
    Object.defineProperty(view, 'belief', { value: this.belief, configurable: true });
    this.effects = new BeliefEffects(view, sim.rng.fork(label('effects')));
    Object.defineProperty(view, 'effects', { value: this.effects, configurable: true });
    this.myth = new MythSystem(view, sim.rng.fork(label('myth')));
    Object.defineProperty(view, 'myth', { value: this.myth, configurable: true });
    this.milestones = new Milestones(view);
    this.dissent = new Dissent(view, sim.rng.fork(label('dissent')));
    this.justice = new Justice(view, sim.rng.fork(label('justice')));
    this.exodus = new Exodus(view, sim.rng.fork(label('exodus')));
    this.appease = new Appeasement(view, sim.rng.fork(label('appease')));
    this.bind();
  }

  /** Every system a people has, as the view names it. */
  private systems(): [string, { sim?: Sim }][] {
    return OWN.map((k) => [k, this[k] as unknown as { sim?: Sim }]);
  }

  private makeView(): Sim {
    const sim = this.sim;
    const id = this.id;
    const view = Object.create(sim) as Sim;
    // Everything about the villagers is shared, except who counts as "alive" (ours).
    const people = new Proxy(sim.villagers, {
      get(target, prop) {
        if (prop === 'alive') return target.alive.filter((v) => v.tribeId === id);
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    Object.defineProperty(view, 'villagers', { value: people });
    // What this people's systems announce is marked as theirs.
    const events = new Proxy(sim.events, {
      get(target, prop) {
        if (prop === 'push') return (tick: number, body: SimEventBody) => target.push(tick, body, id);
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    Object.defineProperty(view, 'events', { value: events });
    Object.defineProperty(view, 'tribe', { value: this });
    // Not saved: rebuilt by bind().
    Object.defineProperty(this, 'view', { value: view, configurable: true, writable: true, enumerable: false });
    return view;
  }

  /** (Re)build the view and point every system at it: on founding, and after a save is loaded. */
  bind(): void {
    const view = this.view && Object.getPrototypeOf(this.view) === this.sim ? this.view : this.makeView();
    for (const [k, sys] of this.systems()) {
      Object.defineProperty(view, k, { value: sys, configurable: true });
      if (k !== 'village') sys.sim = view;
    }
    this.village.forbidden = (x, z) => this.effects.isCursed(x, z);
    this.village.attraction = () => this.effects.sacredArea();
  }

  get color(): number {
    return TRIBE_COLORS[this.id % TRIBE_COLORS.length]!;
  }

  get members(): Villager[] {
    return this.sim.villagers.alive.filter((v) => v.tribeId === this.id);
  }
}

const FOLK_ADJ: Record<number, readonly string[]> = {
  0: ['River', 'Valley', 'Reed'],
  1: ['Stone', 'High', 'Pine'],
  2: ['Green', 'Fern', 'Forest'],
  3: ['Dust', 'Red', 'Dry'],
  4: ['Meadow', 'Bright', 'Hill'],
};
const FOLK_NOUN = ['Folk', 'Kin', 'Clan', 'People'] as const;

/** "the Fern Kin", or after a leader, "Orrin's people"; never one already taken. */
export function tribeName(rng: { pick<T>(a: readonly T[]): T; chance(p: number): boolean }, region: number, leader?: string, taken: readonly string[] = []): string {
  if (leader && rng.chance(0.5) && !taken.includes(`${leader}'s people`)) return `${leader}'s people`;
  for (let i = 0; i < 12; i++) {
    const name = `the ${rng.pick(FOLK_ADJ[region] ?? FOLK_ADJ[0]!)} ${rng.pick(FOLK_NOUN)}`;
    if (!taken.includes(name)) return name;
  }
  return `the ${rng.pick(Object.values(FOLK_ADJ).flat())} ${rng.pick(FOLK_NOUN)} of the ${['East', 'West', 'North', 'South'][taken.length % 4]}`;
}
