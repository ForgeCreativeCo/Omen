import type { SimEvent } from './events';
import type { Sim } from './Sim';
import { TUNING } from './tuning';

/**
 * Purposes: the milestones of a religion taking shape, from the first witnessed
 * wonder to a tradition nobody alive remembers the start of. They give the
 * sandbox a direction and teach the systems one at a time. Pure observation:
 * reaching one changes nothing in the world.
 */
export interface MilestoneDef {
  id: string;
  title: string;
  /** What it is, in a sentence. */
  goal: string;
  /** How to get there. */
  how: string;
  /** Checked a few times a day until met. */
  met?: (sim: Sim) => boolean;
  /** Or met by an event. */
  on?: (e: SimEvent, sim: Sim) => boolean;
}

const B = TUNING.belief;

const believed = (sim: Sim, min: number, type?: string) => {
  for (const b of sim.belief.beliefs.values()) if ((!type || b.type === type) && b.strength >= min) return true;
  return false;
};

export const MILESTONES: readonly MilestoneDef[] = [
  {
    id: 'seen',
    title: 'Be seen',
    goal: 'Work a miracle in front of someone.',
    how: 'Any miracle, in daylight, close to people. Wonders nobody sees build nothing.',
    met: (sim) => [...sim.myth.facts.values()].some((f) => f.isDivine && f.witnesses > 0),
  },
  {
    id: 'believed',
    title: 'Be believed',
    goal: 'A belief strong enough to change what they do.',
    how: 'Repeat a wonder at the same place, or while they do the same thing, and let them talk at the evening fire.',
    met: (sim) => believed(sim, B.behaviorThreshold),
  },
  {
    id: 'holyPlace',
    title: 'Holy ground',
    goal: 'They believe a place is sacred.',
    how: 'Holy Light (I) or Bloom (B) on one landmark (the hill, the well, the ridge) more than once, while people watch.',
    met: (sim) => believed(sim, B.behaviorThreshold, 'SACRED_PLACE'),
  },
  {
    id: 'named',
    title: 'A name on the land',
    goal: 'They name a place after what happened there.',
    how: 'Keep working wonders at one landmark, or make a new place: raise a mound with Shape Earth (G), or drop a Falling Star (O).',
    met: (sim) => sim.myth.places.all.length > 0,
  },
  {
    id: 'rite',
    title: 'A rite',
    goal: 'They perform a ritual to ask you for something.',
    how: 'Answer the same activity more than once: Rain while they dance, Bloom while they pray. They will try it again.',
    on: (e) => e.type === 'ritual',
  },
  {
    id: 'chosen',
    title: 'A chosen one',
    goal: 'They believe someone among them is favored.',
    how: 'Bless (K) the same person, more than once, where others can see.',
    met: (sim) => believed(sim, B.behaviorThreshold, 'CHOSEN_ONE'),
  },
  {
    id: 'doctrine',
    title: 'Doctrine',
    goal: 'A belief so strong the priest preaches it.',
    how: 'Keep confirming one belief over the seasons. Doing what they expect after a ritual counts.',
    met: (sim) => believed(sim, B.doctrineThreshold),
  },
  {
    id: 'shrine',
    title: 'A house for the god',
    goal: 'They build a shrine.',
    how: 'Holy places get a cairn, then a shrine, then a temple as the belief grows and the village has stone to spare.',
    met: (sim) => [...sim.belief.beliefs.values()].some((b) => b.works >= 2),
  },
  {
    id: 'statue',
    title: 'Graven image',
    goal: 'They carve a statue of you.',
    how: 'Once they agree on what you look like, they carve it. Every miracle shapes the image: storms give wings, earth gives a serpent.',
    met: (sim) => sim.myth.statues.length > 0,
  },
  {
    id: 'godName',
    title: 'A name for you',
    goal: 'They give you a name.',
    how: 'Become famous for something: many witnessed wonders of one kind.',
    met: (sim) => sim.myth.godName !== '',
  },
  {
    id: 'people',
    title: 'A people',
    goal: `Grow the village to 40.`,
    how: 'Fed people have children, and loved people more than frightened ones. Bloom and Rain keep the fields full.',
    met: (sim) => sim.villagers.alive.length >= 40,
  },
  {
    id: 'tradition',
    title: 'Tradition',
    goal: 'A belief outlives everyone who saw it begin.',
    how: 'Generations pass. Let time run (16×) and keep the faith alive.',
    met: (sim) => [...sim.belief.beliefs.values()].some((b) => b.isTradition),
  },
];

const CHECK_EVERY = 10;

export class Milestones {
  /** Milestone id → tick it was reached. */
  readonly reached: Record<string, number> = {};
  private lastSeq = 0;

  constructor(private readonly sim: Sim) {}

  has(id: string): boolean {
    return id in this.reached;
  }

  /** The next few to aim for, in order. */
  next(n: number): MilestoneDef[] {
    return MILESTONES.filter((m) => !this.has(m.id)).slice(0, n);
  }

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) {
      for (const m of MILESTONES) if (m.on && !this.has(m.id) && m.on(e, sim)) this.reach(m.id);
    }
    this.lastSeq = sim.events.lastSeq;
    if (sim.tick % CHECK_EVERY !== 0) return;
    for (const m of MILESTONES) if (m.met && !this.has(m.id) && m.met(sim)) this.reach(m.id);
  }

  private reach(id: string): void {
    this.reached[id] = this.sim.tick;
    this.sim.events.push(this.sim.tick, { type: 'milestone', id });
  }
}
