import type { Belief } from '../sim/belief/BeliefSystem';
import { MILESTONES } from '../sim/milestones';
import type { Sim } from '../sim/Sim';
import { formatCalendar } from '../sim/time';
import { TUNING } from '../sim/tuning';
import type { PeopleFocus } from './PeopleFocus';

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
  /** Leader, following and silence, to notice a change. */
  turning: string;
}

/**
 * "What they believe now": at the turn of each season, a short card of what
 * changed in their minds since the last one. New beliefs, doctrine, ideas
 * taking shape, faiths being forgotten, purposes reached, and in the Warning
 * how many would climb to safety. Silent when nothing changed.
 */
export class SeasonReport {
  readonly el: HTMLElement;
  /** Per people: what they believed when they last had a card. */
  private readonly bases = new Map<number, Snapshot>();
  private season = '';
  private sinceShown = Infinity;
  private shownFor = 0;
  private hovered = false;
  /** Births and deaths so far, per people. */
  private readonly births = new Map<number, number>();
  private readonly deaths = new Map<number, number>();
  private lastSeq = -1;
  /** Hidden (and holding its news) while something else needs the space. */
  covered = false;

  constructor(
    root: HTMLElement,
    private readonly focus: PeopleFocus,
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
      if (focus.click(t)) {
        // Show the other people's news over the same span.
        const html = this.render();
        if (html) this.el.innerHTML = html;
        return;
      }
      if (t.closest('[data-sr="beliefs"]')) this.openBeliefs();
      if (t.closest('[data-sr]')) this.close();
    });
  }

  private get sim(): Sim {
    return this.focus.view;
  }

  private get base(): Snapshot {
    const id = this.focus.id;
    let b = this.bases.get(id);
    if (!b) this.bases.set(id, (b = this.snapshot(id)));
    return b;
  }

  update(dt: number): void {
    const sim = this.sim;
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) {
      if (e.type !== 'birth' && e.type !== 'death') continue;
      const tribe = sim.villagers.byId(e.id)?.tribeId ?? e.tribe ?? 0;
      const tally = e.type === 'birth' ? this.births : this.deaths;
      tally.set(tribe, (tally.get(tribe) ?? 0) + 1);
    }
    this.lastSeq = sim.events.lastSeq;
    for (const t of sim.tribes) if (!this.bases.has(t.id)) this.bases.set(t.id, this.snapshot(t.id));

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
    // The next report tells what changed after this one (for every people: they all had the season).
    for (const t of this.sim.tribes) this.bases.set(t.id, this.snapshot(t.id));
  }

  private snapshot(id: number): Snapshot {
    const sim = this.sim.tribes[id]!.view;
    return {
      strength: new Map([...sim.belief.beliefs.values()].map((b) => [b.id, b.strength])),
      people: sim.villagers.alive.length,
      births: this.births.get(id) ?? 0,
      deaths: this.deaths.get(id) ?? 0,
      reached: new Set(Object.keys(sim.milestones.reached)),
      safe: this.safeCount(sim),
      turning: this.turningKey(sim),
    };
  }

  private turningKey(sim: Sim): string {
    const d = sim.dissent;
    return `${d.leader?.id ?? -1}:${d.followers().length}:${d.silent}`;
  }

  /** Who is pulling the village away from the god, and how many listen. */
  private turning(): string {
    const sim = this.sim;
    const d = sim.dissent;
    const lead = d.leader;
    if (!lead) return d.silent ? `No wonder seen in ${d.silenceDays} days. They wonder where you went.` : '';
    const name = sim.villagers.byId(lead.id)?.name ?? 'Someone';
    const n = d.followers().length - 1;
    const listen = n > 0 ? `, and ${n} ${n === 1 ? 'listens' : 'listen'}` : '';
    return lead.kind === 'doubter' ? `${name} says there is no god${listen}.` : `${name} claims to speak for you${listen}.`;
  }

  private safeCount(sim: Sim): number {
    const w = sim.warning;
    if (!w || w.disaster.phase !== 'waiting') return -1;
    return sim.villagers.alive.filter((v) => w.disaster.wouldReachSafety(v)).length;
  }

  private render(): string {
    const sim = this.sim;
    const base = this.base;
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
    const turning = this.turning();
    const turningChanged = this.turningKey(sim) !== base.turning;
    if (!preached.length && !believe.length && !wonder.length && !fading.length && !purposes.length && !turningChanged) return '';

    const section = (label: string, cls: string, items: string[]) =>
      items.length ? `<div class="sr-sec ${cls}"><small>${label}</small><ul>${items.map((s) => `<li>${s}</li>`).join('')}</ul></div>` : '';

    const born = (this.births.get(this.focus.id) ?? 0) - base.births;
    const died = (this.deaths.get(this.focus.id) ?? 0) - base.deaths;
    const people = sim.villagers.alive.length;
    const peopleLine = `${people} people${born ? ` · ${born} born` : ''}${died ? ` · ${died} died` : ''}`;
    const safe = this.safeCount(sim);
    const safeLine =
      safe >= 0 && base.safe >= 0
        ? `<div class="sr-safe">If the sea came now: <b>${safe} of ${people}</b> would climb to safety${safe !== base.safe ? ` <span class="${safe > base.safe ? 'up' : 'down'}">(${safe > base.safe ? '+' : ''}${safe - base.safe})</span>` : ''}</div>`
        : '';

    return `<div class="sr-head"><span>${this.focus.many ? `What ${this.focus.tribe.name} believe now` : 'What they believe now'}</span><small>${formatCalendar(sim.calendar)}</small><button class="sr-x" data-sr="close" aria-label="Close">×</button></div>
      ${this.focus.tabs()}
      ${section('Now preached as doctrine', 'doctrine', preached.map(say))}
      ${section('Came to believe', 'new', believe.map(say))}
      ${section('Starting to wonder', 'wonder', wonder.map(say))}
      ${section('Forgetting', 'fading', fading.map(say))}
      ${section('Purpose fulfilled', 'purpose', purposes.map((m) => m.title))}
      ${turning ? section('Turning away', 'turning', [turning]) : ''}
      ${safeLine}
      <div class="sr-foot"><small>${peopleLine}</small><button data-sr="beliefs">All beliefs (V)</button></div>`;
  }
}
