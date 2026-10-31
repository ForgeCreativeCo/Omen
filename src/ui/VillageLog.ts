import type { SimEvent } from '../sim/events';
import { MILESTONES } from '../sim/milestones';
import { featureLabel } from '../sim/omens/context';
import type { Sim } from '../sim/Sim';
import { calendarAt, TICKS_PER_DAY } from '../sim/time';

type Category = 'deeds' | 'love' | 'life' | 'faith';

interface Entry {
  tick: number;
  cat: Category;
  html: string;
}

const FILTERS: [Category | 'all', string][] = [
  ['all', 'All'],
  ['deeds', 'Deeds'],
  ['love', 'Love'],
  ['life', 'Life & death'],
  ['faith', 'Faith'],
];

const MAX = 400;

const DEATH: Record<string, string> = {
  oldAge: 'died of old age',
  starvation: 'starved',
  fire: 'burned',
  lightning: 'was struck by lightning',
  flood: 'drowned',
  meteor: 'was killed by the falling star',
};

const RITE: Record<string, string> = {
  dance: 'danced',
  pray: 'prayed',
};

/**
 * The Village life log: the day's happenings in order, newest first. Thefts,
 * quarrels, couples, births and deaths, rites and the movements of faith.
 * Names are links: click one to go to that person.
 */
export class VillageLog {
  readonly el: HTMLElement;
  private entries: Entry[] = [];
  private filter: Category | 'all' = 'all';
  private lastSeq = 0;
  /** One line per rite per day: "Arin and 3 others danced at the fire". */
  private riteDay = new Map<string, Entry & { names: string[] }>();
  private dirty = true;
  private timer = 0;

  constructor(
    root: HTMLElement,
    private readonly sim: Sim,
    private readonly goTo: (villagerId: number) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel village-log';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) return this.toggle(false);
      const f = t.closest<HTMLElement>('[data-filter]');
      if (f) {
        this.filter = f.dataset.filter as Category | 'all';
        this.dirty = true;
        this.render();
      }
      const who = t.closest<HTMLElement>('[data-villager]');
      if (who) this.goTo(Number(who.dataset.villager));
    });
    // What happened before this session (a loaded game) is still in the record.
    this.read(sim.events.since(0).slice(-1500));
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(show = this.el.hidden): void {
    this.el.hidden = !show;
    if (show) {
      this.dirty = true;
      this.render();
    }
  }

  update(dt: number): void {
    const fresh = this.sim.events.since(this.lastSeq);
    if (fresh.length) this.read(fresh);
    if (this.el.hidden) return;
    this.timer -= dt;
    if (this.timer > 0 || !this.dirty) return;
    this.timer = 0.4;
    this.render();
  }

  private read(events: readonly SimEvent[]): void {
    for (const e of events) {
      this.lastSeq = Math.max(this.lastSeq, e.seq);
      this.add(e);
    }
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
  }

  private who(id: number): string {
    const v = this.sim.villagers.byId(id);
    return v ? `<a data-villager="${id}">${v.name}</a>` : 'Someone';
  }

  private push(tick: number, cat: Category, html: string): void {
    this.entries.push({ tick, cat, html });
    this.dirty = true;
  }

  private add(e: SimEvent): void {
    const sim = this.sim;
    const w = (id: number) => this.who(id);
    switch (e.type) {
      case 'theft': {
        const owner = e.victims.map((id) => sim.villagers.byId(id)).find((p) => p && p.lifeStage !== 'child');
        return this.push(e.tick, 'deeds', `${w(e.id)} stole from ${owner ? `${w(owner.id)}'s` : 'a neighbor’s'} hut${e.known ? '' : ', unseen'}.`);
      }
      case 'quarrel':
        return this.push(e.tick, 'deeds', `${w(e.a)} and ${w(e.b)} quarreled at the fire.`);
      case 'couple':
        return this.push(e.tick, 'love', `${w(e.a)} and ${w(e.b)} are together now.`);
      case 'birth':
        return this.push(e.tick, 'life', `${w(e.id)} was born${e.parents.length ? ` to ${e.parents.map(w).join(' and ')}` : ''}.`);
      case 'death':
        return e.cause === 'killed' ? undefined : this.push(e.tick, 'life', `${w(e.id)} ${DEATH[e.cause] ?? 'died'}.`);
      case 'killing':
        return this.push(e.tick, 'deeds', e.seen ? `<b>${w(e.killer)} killed ${w(e.victim)}</b> at the fire.` : `${w(e.victim)} was found dead. Nobody saw ${w(e.killer)} do it.`);
      case 'fight':
        return this.push(e.tick, 'deeds', `${w(e.a)} struck ${w(e.b)}${e.hurt >= 0 ? ', and hurt them' : ''}.`);
      case 'feud':
        return this.push(e.tick, 'deeds', `${w(e.a)} and ${w(e.b)} are now bitter enemies.`);
      case 'affair':
        return this.push(e.tick, 'love', `${w(e.a)} has been meeting ${w(e.b)} in secret.`);
      case 'affairExposed':
        return this.push(e.tick, 'love', `${w(e.by)} found out about ${w(e.a)} and ${w(e.b)}.${e.breakup ? ' They parted.' : ''}`);
      case 'exiled':
        return this.push(e.tick, 'deeds', e.left ? `${w(e.id)} left the village.` : `${w(e.id)} was sent away.`);
      case 'ritual': {
        if (e.villagerId === undefined) return;
        const day = Math.floor(e.tick / TICKS_PER_DAY);
        const key = `${day}:${e.activity}`;
        const name = this.who(e.villagerId);
        const row = this.riteDay.get(key);
        const verb = RITE[e.activity] ?? `performed ${featureLabel(sim, `activity:${e.activity}`)}`;
        if (row) {
          if (row.names.includes(name)) return;
          row.names.push(name);
          row.html = `${row.names[0]}${row.names.length > 1 ? ` and ${row.names.length - 1} other${row.names.length > 2 ? 's' : ''}` : ''} ${verb}, asking the god for something.`;
          this.dirty = true;
          return;
        }
        const entry = { tick: e.tick, cat: 'faith' as const, html: `${name} ${verb}, asking the god for something.`, names: [name] };
        this.riteDay.set(key, entry);
        if (this.riteDay.size > 60) this.riteDay.delete(this.riteDay.keys().next().value!);
        this.entries.push(entry);
        this.dirty = true;
        return;
      }
      case 'beliefLevel': {
        const b = sim.belief.beliefs.get(e.beliefId);
        if (!b || b.type === 'TEMPERAMENT' || e.level === 'died') return;
        return this.push(e.tick, 'faith', `${e.level === 'doctrine' ? 'Now doctrine' : 'They came to believe'}: <i>${sim.belief.statement(b)}</i>`);
      }
      case 'priest':
        return e.id >= 0 ? this.push(e.tick, 'faith', `${w(e.id)} became the high priest.`) : undefined;
      case 'tradition': {
        const b = sim.belief.beliefs.get(e.beliefId);
        return b ? this.push(e.tick, 'faith', `Now tradition: <i>${sim.belief.statement(b)}</i>`) : undefined;
      }
      case 'placeNamed':
        return this.push(e.tick, 'faith', `They began to call a place <b>${e.name}</b>.`);
      case 'godNamed':
        return this.push(e.tick, 'faith', `They named the god <b>${e.name}</b>.`);
      case 'built':
        if (e.kind === 'hut') return this.push(e.tick, 'life', 'A new hut was finished.');
        if (e.kind === 'grave') return this.push(e.tick, 'life', 'A grave was dug.');
        if (e.kind === 'cairn' || e.kind === 'shrine' || e.kind === 'temple' || e.kind === 'statue') return this.push(e.tick, 'faith', `A ${e.kind} was raised.`);
        return;
      case 'milestone': {
        const m = MILESTONES.find((x) => x.id === e.id);
        return m ? this.push(e.tick, 'faith', `Purpose fulfilled: <b>${m.title}</b>`) : undefined;
      }
      case 'silence':
        return this.push(e.tick, 'faith', 'They have seen no wonder in a long while.');
      case 'dissent':
        return this.push(e.tick, 'faith', e.kind === 'doubter' ? `${w(e.id)} began to say there is no god.` : `${w(e.id)} began to claim the god’s voice.`);
      case 'dissentEnd':
        return this.push(e.tick, 'faith', `${w(e.id)} ${e.reason === 'converted' ? 'believes again' : e.reason === 'recanted' ? 'recanted' : e.reason === 'discredited' ? 'was shown up as a false prophet' : 'is gone, and the following fades'}.`);
      case 'prophesied':
        return this.push(e.tick, 'faith', `${w(e.id)} foretold rain.`);
      case 'prophecyResult':
        return this.push(e.tick, 'faith', e.fulfilled ? `Rain came, as ${w(e.id)} foretold.` : `${w(e.id)}'s prophecy failed.`);
      case 'schism':
        return this.push(e.tick, 'deeds', e.outcome === 'split' ? `The village split: ${w(e.leaderId)} led ${e.ids.length - 1} away.` : `The faithful drove ${w(e.leaderId)} out.`);
      case 'blessing':
        return this.push(e.tick, 'faith', `${w(e.villagerId)} was touched by the god.`);
      default:
        return;
    }
  }

  private render(): void {
    this.dirty = false;
    const shown = (this.filter === 'all' ? this.entries : this.entries.filter((e) => e.cat === this.filter)).slice(-150).reverse();
    let day = -1;
    const rows: string[] = [];
    for (const e of shown) {
      const d = Math.floor(e.tick / TICKS_PER_DAY);
      if (d !== day) {
        day = d;
        const c = calendarAt(e.tick);
        rows.push(`<li class="vl-day">Year ${c.year} · ${c.season.charAt(0).toUpperCase() + c.season.slice(1)}, day ${c.dayOfSeason + 1}</li>`);
      }
      rows.push(`<li class="vl-${e.cat}">${e.html}</li>`);
    }
    const top = this.el.querySelector('.vl-list')?.scrollTop ?? 0;
    this.el.innerHTML = `
      <button class="ins-close" data-close aria-label="Close">×</button>
      <h2>Village life</h2>
      <div class="vl-filters">${FILTERS.map(([id, label]) => `<button data-filter="${id}" class="${id === this.filter ? 'on' : ''}">${label}</button>`).join('')}</div>
      <ol class="vl-list">${rows.join('') || '<li class="vl-empty">Nothing yet. Let some time pass.</li>'}</ol>`;
    this.el.querySelector('.vl-list')!.scrollTop = top;
  }
}
