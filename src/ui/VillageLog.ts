import type { SimEvent } from '../sim/events';
import { MILESTONES } from '../sim/milestones';
import { featureLabel } from '../sim/omens/context';
import { CRIME_TEXT, EXODUS_TEXT, LAW_TEXT, REGION_TEXT, SENTENCE_TEXT } from './describe';
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
  thrown: 'was hurled down by the god',
  crushed: 'was crushed by what the god threw',
  battle: 'fell in battle',
  executed: 'was put to death',
  quake: 'was crushed when the earth shook',
  firestorm: 'was burned by the fire from the sky',
  plague: 'died of the sickness',
  sacrificed: 'was given to the god at the fire',
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
    // A people's news, in its own terms (its beliefs, its god); named when there are several.
    const t = e.tribe !== undefined ? this.sim.tribes[e.tribe] : undefined;
    const before = this.entries.length;
    this.addFor(t?.view ?? this.sim, e);
    if (t && this.sim.tribes.length > 1)
      for (let i = before; i < this.entries.length; i++) {
        const en = this.entries[i]!;
        en.html = `<small class="vl-tribe" style="color:#${t.color.toString(16).padStart(6, '0')}">${t.name}</small> ${en.html}`;
      }
  }

  private addFor(sim: Sim, e: SimEvent): void {
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
        return e.cause === 'killed' || e.cause === 'executed' ? undefined : this.push(e.tick, 'life', `${w(e.id)} ${DEATH[e.cause] ?? 'died'}.`);
      case 'killing':
        return this.push(e.tick, 'deeds', e.seen ? `<b>${w(e.killer)} killed ${w(e.victim)}</b> at the fire.` : `${w(e.victim)} was found dead. Nobody saw ${w(e.killer)} do it.`);
      case 'fight':
        return this.push(e.tick, 'deeds', `${w(e.a)} struck ${w(e.b)}${e.hurt >= 0 ? ', and hurt them' : ''}.`);
      case 'war':
        return this.push(e.tick, 'deeds', `<b>War</b> between ${sim.tribes[e.a]?.name ?? 'a people'} and ${sim.tribes[e.b]?.name ?? 'a people'}.`);
      case 'peace':
        return this.push(e.tick, 'deeds', `<b>Peace</b> between ${sim.tribes[e.a]?.name ?? 'a people'} and ${sim.tribes[e.b]?.name ?? 'a people'}.`);
      case 'raid':
        return this.push(e.tick, 'deeds', `A war party of ${sim.tribes[e.from]?.name ?? 'a people'} set out against ${sim.tribes[e.to]?.name ?? 'a people'}: ${e.ids.map(w).join(', ')}.`);
      case 'slain':
        return this.push(e.tick, 'deeds', `${w(e.killer)} struck down ${w(e.victim)}.`);
      case 'raidEnd':
        return this.push(e.tick, 'deeds', `The raid on ${sim.tribes[e.to]?.name ?? 'a people'} ended: ${e.raidersLost} raiders and ${e.defendersLost} defenders dead${e.loot ? `, ${e.loot} food taken` : ''}${e.captives ? `, ${e.captives} carried off` : ''}${e.burned ? ', a hut burned' : ''}.`);
      case 'captured':
        return this.push(e.tick, 'deeds', `${e.ids.map(w).join(' and ')} ${e.ids.length > 1 ? 'were' : 'was'} carried off by ${sim.tribes[e.by]?.name ?? 'raiders'}.`);
      case 'captiveJoined':
        return this.push(e.tick, 'life', `${w(e.id)}, taken from ${sim.tribes[e.from]?.name ?? 'another people'}, is one of ${sim.tribes[e.by]?.name ?? 'them'} now.`);
      case 'alliance':
        return this.push(e.tick, 'deeds', `${sim.tribes[e.a]?.name ?? 'A people'} and ${sim.tribes[e.b]?.name ?? 'a people'} made an alliance against ${sim.tribes[e.against]?.name ?? 'a common enemy'}.`);
      case 'allianceEnd':
        return this.push(e.tick, 'deeds', `The alliance of ${sim.tribes[e.a]?.name ?? 'a people'} and ${sim.tribes[e.b]?.name ?? 'a people'} ended.`);
      case 'conquest':
        return this.push(e.tick, 'deeds', e.outcome === 'driven' ? `${sim.tribes[e.winner]?.name ?? 'A people'} drove ${sim.tribes[e.loser]?.name ?? 'their enemies'} from their land.` : `${sim.tribes[e.loser]?.name ?? 'A people'} were conquered by ${sim.tribes[e.winner]?.name ?? 'their enemies'} and live under them.`);
      case 'prayForVictory':
        return this.push(e.tick, 'faith', `${w(e.priest)} prayed to the god for victory over ${sim.tribes[e.against]?.name ?? 'the enemy'}.`);
      case 'prayerAnswered':
        return this.push(e.tick, 'faith', e.answered ? `They believe the god answered: it struck ${sim.tribes[e.against]?.name ?? 'the enemy'}.` : 'They prayed for victory, and the god struck them instead.');
      case 'absorbed':
        return this.push(e.tick, 'life', `The last of ${sim.tribes[e.from]?.name ?? 'a people'} (${e.ids.map(w).join(', ')}) went to live with ${sim.tribes[e.into]?.name ?? 'a people'}.`);
      case 'cataclysm': {
        const gone = e.villages.map((id) => sim.tribes[id]?.name).filter(Boolean);
        return this.push(e.tick, 'life', `<b>The sky fell</b>${gone.length ? ` on ${gone.join(' and ')}` : ''}: ${e.killed.length} dead.`);
      }
      case 'calling':
        return this.push(e.tick, 'faith', `${e.ids.map(w).join(', ')} set out for ${sim.tribes[e.tribe]?.myth.places.name(e.place) ?? 'the hallowed ground'}, to live there.`);
      case 'callingEnd':
        return this.push(e.tick, 'faith', `${e.ids.map(w).join(', ')} turned back from the hallowed ground.`);
      case 'voyage':
        return this.push(e.tick, 'life', `${e.ids.map(w).join(', ')} set out to settle an island.`);
      case 'castaways':
        return this.push(e.tick, 'life', `${e.ids.slice(0, -1).map(w).join(', ')} and ${w(e.ids.at(-1)!)} came ashore from a wreck${e.founded ? `, and became <b>${sim.tribes[e.tribe]?.name ?? 'a new people'}</b>` : `, and went to live with ${sim.tribes[e.tribe]?.name ?? 'the people'}`}.`);
      case 'created':
        return this.push(e.tick, 'faith', `${e.ids.map(w).join(' and ')} rose from the earth, made by the god${e.founded ? `: the first of <b>${sim.tribes[e.tribe]?.name ?? 'a new people'}</b>` : `, and went to live with ${sim.tribes[e.tribe]?.name ?? 'the people'}`}.`);
      case 'tribeFounded':
        if (e.reason === 'castaways' || e.reason === 'created') return;
        if (e.reason === 'settlers') return this.push(e.tick, 'life', `<b>${e.name}</b> came ashore on an island off the coast${e.leaderId >= 0 ? `, led by ${w(e.leaderId)}` : ''}.`);
        if (e.reason === 'hallowed') return this.push(e.tick, 'faith', `<b>${e.name}</b> settled the hallowed ground${e.leaderId >= 0 ? `, led by ${w(e.leaderId)}` : ''}: kin of ${sim.tribes[e.from]?.name ?? 'their people'}, with the old faith.`);
        return this.push(e.tick, 'life', `<b>${e.name}</b> broke away${e.leaderId >= 0 ? `, led by ${w(e.leaderId)},` : ''} and settled in ${REGION_TEXT[sim.island.region[e.x + e.z * sim.world.sizeX] ?? 0] ?? 'new country'}.`);
      case 'exodus':
        return this.push(e.tick, 'life', `<b>The village moved</b> to ${REGION_TEXT[e.region] ?? 'new ground'}. ${EXODUS_TEXT[e.reason]}`);
      case 'accused':
        return this.push(e.tick, 'deeds', `${w(e.accused)} was accused of ${CRIME_TEXT[e.crime]}.${e.actual !== e.accused ? ` <small>(It was ${w(e.actual)}.)</small>` : ''}`);
      case 'verdict':
        return this.push(
          e.tick,
          'deeds',
          e.by === 'godPunished'
            ? `The god struck at ${w(e.accused)} before judgment.`
            : e.by === 'godPardoned'
              ? `The god spared ${w(e.accused)}.`
              : `${w(e.accused)} ${SENTENCE_TEXT[e.sentence]} for ${CRIME_TEXT[e.crime]}.`,
        );
      case 'law':
        return this.push(e.tick, 'faith', `A law was written: whoever is guilty of ${CRIME_TEXT[e.crime]} ${LAW_TEXT[e.sentence]}.`);
      case 'feud':
        return this.push(e.tick, 'deeds', `${w(e.a)} and ${w(e.b)} are now bitter enemies.`);
      case 'sacrifice':
        return this.push(e.tick, 'faith', `${w(e.priest)} gave ${w(e.id)} to the god at the fire${e.ritual ? ', as is their custom' : ''}.`);
      case 'greatOffering':
        return this.push(e.tick, 'faith', `They burned ${e.amount} food at the fire ${e.why === 'rivalry' ? 'to outdo their neighbors' : 'to turn the god’s anger'}.`);
      case 'defiance':
        return this.push(e.tick, 'faith', `${w(e.id)} stood up at the fire and refused the god.`);
      case 'defianceEnd':
        return e.reason === 'struck' || e.reason === 'humbled' ? this.push(e.tick, 'faith', e.reason === 'struck' ? `${w(e.id)} defied the god and was struck down.` : `${w(e.id)} bowed to the god again.`) : undefined;
      case 'rivalry':
        return this.push(e.tick, 'faith', e.kind === 'scorn' ? `They said ${sim.tribes[e.other]?.name ?? 'their neighbors'} had angered the god.` : `They envied ${sim.tribes[e.other]?.name ?? 'their neighbors'} the god’s favor.`);
      case 'sickened':
        return this.push(e.tick, 'life', e.by >= 0 ? `${w(e.id)} caught the sickness from ${w(e.by)}.` : `${w(e.id)} fell sick.`);
      case 'recovered':
        return this.push(e.tick, 'life', `${w(e.id)} got up from the sickness.`);
      case 'swarmEnd':
        return e.eaten || e.food ? this.push(e.tick, 'life', `A swarm ate ${e.eaten} rows of crops${e.food ? ` and ${e.food} food` : ''} from ${sim.tribes[e.tribe]?.name ?? 'a people'}.`) : undefined;
      case 'quakeEnd':
        return this.push(e.tick, 'life', `The earth shook: ${e.wrecked.length} buildings damaged, ${e.trees} trees down${e.killed.length ? `, ${e.killed.length} crushed` : ''}.`);
      case 'waveEnd':
        return this.push(e.tick, 'life', `A wave came in from the sea${e.carried.length ? ` and swept away ${e.carried.map(w).join(', ')}` : ''}.`);
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
        if (e.variant === 'longhouse') return this.push(e.tick, 'life', 'A longhouse was finished.');
        if (e.kind === 'hut') return this.push(e.tick, 'life', 'A new hut was finished.');
        if (e.kind === 'storehouse') return this.push(e.tick, 'life', 'A storehouse was finished.');
        if (e.kind === 'fence') return this.push(e.tick, 'life', 'A field was fenced.');
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
      case 'anointed':
        return this.push(e.tick, 'faith', `The god anointed ${w(e.id)}.`);
      case 'messiahCredited':
        return this.push(e.tick, 'faith', `The people said ${w(e.id)} worked a wonder.`);
      case 'messiahPreachedAbroad':
        return this.push(e.tick, 'faith', `${w(e.id)} preached to ${this.sim.tribes[e.to]?.name ?? 'another people'}${e.came ? `; ${e.came} came away with them` : ''}.`);
      case 'messiahDied':
        return this.push(e.tick, 'faith', `${w(e.id)}, the messiah, died: ${e.death === 'saint' ? 'a saint' : e.death === 'martyr' ? 'a martyr' : 'taken home by the god'}.`);
      case 'messiahRisen':
        return this.push(e.tick, 'faith', `${w(e.id)} rose from the dead.`);
      case 'prayer':
        return this.push(e.tick, 'faith', `${w(e.asker)} prayed ${({ rain: 'for rain', harvest: 'for food', heal: `for ${w(e.for)} to be healed`, child: 'for a child', vengeance: 'for vengeance', guidance: 'for a new land', mercy: 'for mercy' } as Record<string, string>)[e.kind]}.`);
      case 'prayerEnd':
        return this.push(e.tick, 'faith', e.end === 'answered' || e.end === 'luck' ? `${w(e.asker)}'s prayer was answered.` : e.end === 'defied' ? `${w(e.asker)} prayed, and the god struck.` : `${w(e.asker)}'s prayer went unanswered.`);
      case 'blessPlace':
        return this.push(e.tick, 'faith', e.kind === 'field' ? 'The god blessed a field.' : `The god blessed ${e.residents.length ? `the home of ${e.residents.map((id) => w(id)).join(', ')}` : 'an empty home'}.`);
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
