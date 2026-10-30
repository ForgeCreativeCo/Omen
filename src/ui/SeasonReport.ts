import type { Belief } from '../sim/belief/BeliefSystem';
import { MILESTONES } from '../sim/milestones';
import type { Sim } from '../sim/Sim';
import { formatCalendar } from '../sim/time';
import { TUNING } from '../sim/tuning';

const B = TUNING.belief;
/** Half-way to changing behavior: worth mentioning as a new idea. */
const WONDER = B.behaviorThreshold * 0.5;
/** Real seconds between reports, so 16× doesn't bury the screen. */
const MIN_GAP = 20;
const SHOW_FOR = 14;

interface Snapshot {
  strength: Map<string, number>;
  people: number;
  births: number;
  deaths: number;
  reached: Set<string>;
  safe: number;
}

/**
 * "What they believe now": at the turn of each season, a short card of what
 * changed in their minds since the last one. New beliefs, doctrine, ideas
 * taking shape, faiths being forgotten, purposes reached, and in the Warning
 * how many would climb to safety. Silent when nothing changed.
 */
export class SeasonReport {
  readonly el: HTMLElement;
  private base: Snapshot | null = null;
  private season = '';
  private sinceShown = Infinity;
  private shownFor = 0;
  private hovered = false;
  private births = 0;
  private deaths = 0;
  private lastSeq = -1;
  /** Hidden (and holding its news) while something else needs the space. */
  covered = false;

  constructor(
    root: HTMLElement,
    private readonly sim: Sim,
    private readonly openBeliefs: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel season-report';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('pointerenter', () => (this.hovered = true));
    this.el.addEventListener('pointerleave', () => (this.hovered = false));
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-sr="beliefs"]')) this.openBeliefs();
      if (t.closest('[data-sr]')) this.close();
    });
  }

  update(dt: number): void {
    const sim = this.sim;
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) {
      if (e.type === 'birth') this.births++;
      else if (e.type === 'death') this.deaths++;
    }
    this.lastSeq = sim.events.lastSeq;
    if (!this.base) this.base = this.snapshot();

    this.sinceShown += dt;
    if (!this.el.hidden) {
      if (!this.hovered) this.shownFor += dt;
      if (this.covered) this.el.hidden = true; // keep the news for the next report
      else if (this.shownFor > SHOW_FOR) this.close();
    }

    const cal = sim.calendar;
    const season = `${cal.year}:${cal.season}`;
    if (season === this.season) return;
    const first = this.season === '';
    this.season = season;
    if (first || this.covered || this.sinceShown < MIN_GAP) return;
    const html = this.render();
    if (!html) return;
    this.el.innerHTML = html;
    this.el.hidden = false;
    this.shownFor = 0;
    this.sinceShown = 0;
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.hovered = false;
    // The next report tells what changed after this one.
    this.base = this.snapshot();
  }

  private snapshot(): Snapshot {
    const sim = this.sim;
    return {
      strength: new Map([...sim.belief.beliefs.values()].map((b) => [b.id, b.strength])),
      people: sim.villagers.alive.length,
      births: this.births,
      deaths: this.deaths,
      reached: new Set(Object.keys(sim.milestones.reached)),
      safe: this.safeCount(),
    };
  }

  private safeCount(): number {
    const w = this.sim.warning;
    if (!w || w.disaster.phase !== 'waiting') return -1;
    return this.sim.villagers.alive.filter((v) => w.disaster.wouldReachSafety(v)).length;
  }

  private render(): string {
    const sim = this.sim;
    const base = this.base!;
    const was = (b: Belief) => base.strength.get(b.id) ?? 0;
    const say = (b: Belief) => sim.belief.statement(b);
    const all = [...sim.belief.beliefs.values()].sort((a, b) => b.strength - a.strength);

    const preached = all.filter((b) => b.strength >= B.doctrineThreshold && was(b) < B.doctrineThreshold);
    const believe = all.filter((b) => b.strength >= B.behaviorThreshold && b.strength < B.doctrineThreshold && was(b) < B.behaviorThreshold);
    const wonder = all.filter((b) => b.strength >= WONDER && b.strength < B.behaviorThreshold && was(b) < WONDER).slice(0, 3);
    const fading = [...base.strength]
      .filter(([id, s]) => s >= B.behaviorThreshold && (sim.belief.beliefs.get(id)?.strength ?? 0) < B.behaviorThreshold * 0.85)
      .map(([id]) => sim.belief.beliefs.get(id))
      .filter((b): b is Belief => !!b)
      .slice(0, 3);
    const purposes = MILESTONES.filter((m) => sim.milestones.has(m.id) && !base.reached.has(m.id));
    if (!preached.length && !believe.length && !wonder.length && !fading.length && !purposes.length) return '';

    const section = (label: string, cls: string, items: string[]) =>
      items.length ? `<div class="sr-sec ${cls}"><small>${label}</small><ul>${items.map((s) => `<li>${s}</li>`).join('')}</ul></div>` : '';

    const born = this.births - base.births;
    const died = this.deaths - base.deaths;
    const people = sim.villagers.alive.length;
    const peopleLine = `${people} people${born ? ` · ${born} born` : ''}${died ? ` · ${died} died` : ''}`;
    const safe = this.safeCount();
    const safeLine =
      safe >= 0 && base.safe >= 0
        ? `<div class="sr-safe">If the sea came now: <b>${safe} of ${people}</b> would climb to safety${safe !== base.safe ? ` <span class="${safe > base.safe ? 'up' : 'down'}">(${safe > base.safe ? '+' : ''}${safe - base.safe})</span>` : ''}</div>`
        : '';

    return `<div class="sr-head"><span>What they believe now</span><small>${formatCalendar(sim.calendar)}</small><button class="sr-x" data-sr="close" aria-label="Close">×</button></div>
      ${section('Now preached as doctrine', 'doctrine', preached.map(say))}
      ${section('Came to believe', 'new', believe.map(say))}
      ${section('Starting to wonder', 'wonder', wonder.map(say))}
      ${section('Forgetting', 'fading', fading.map(say))}
      ${section('Purpose fulfilled', 'purpose', purposes.map((m) => m.title))}
      ${safeLine}
      <div class="sr-foot"><small>${peopleLine}</small><button data-sr="beliefs">All beliefs (V)</button></div>`;
  }
}
