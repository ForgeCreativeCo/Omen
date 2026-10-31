import { MILESTONES } from '../sim/milestones';
import { CRIME_TEXT, whenJudged } from './describe';
import type { Sim } from '../sim/Sim';

const OPEN_KEY = 'omen.goals.open';

/**
 * Purposes (the sandbox's direction): the next milestones to aim for and how to
 * reach them, a suggestion for right now, and, in the Warning, how many people
 * would reach safety if the sea came today.
 */
export class GoalsPanel {
  readonly el: HTMLElement;
  private open: boolean;
  private timer = 0;
  private html = '';
  /** Hidden while the villager inspector uses the same corner. */
  covered = false;

  constructor(
    root: HTMLElement,
    private readonly sim: Sim,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel goals';
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-g="toggle"]')) this.toggle();
    });
    let open = true;
    try {
      open = localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      // storage blocked
    }
    // Narrow screens start folded; there is little room.
    this.open = open && !matchMedia('(max-width: 760px)').matches;
  }

  toggle(): void {
    this.open = !this.open;
    try {
      localStorage.setItem(OPEN_KEY, this.open ? '1' : '0');
    } catch {
      // storage blocked
    }
    this.timer = 0;
  }

  update(dt: number): void {
    this.el.hidden = this.covered;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const html = this.render();
    if (html !== this.html) {
      this.html = html;
      this.el.innerHTML = html;
    }
  }

  private render(): string {
    const sim = this.sim;
    const ms = sim.milestones;
    const done = MILESTONES.filter((m) => ms.has(m.id)).length;
    const head = `<button class="g-head" data-g="toggle" aria-expanded="${this.open}"><span>Purposes</span><span class="g-count">${done} / ${MILESTONES.length}</span><span class="g-caret">${this.open ? '▾' : '▸'}</span></button>`;
    const safety = this.safety();
    if (!this.open) return head + (safety ? `<div class="g-safety compact">${safety}</div>` : '');
    const next = ms.next(2);
    const list = next
      .map(
        (m, i) =>
          `<li class="${i === 0 ? 'g-now' : ''}"><b>${m.title}</b>. ${m.goal}${i === 0 ? `<small>${m.how}</small>` : ''}</li>`,
      )
      .join('');
    const idea = this.idea();
    return `${head}
      ${safety ? `<div class="g-safety">${safety}</div>` : ''}
      ${idea ? `<div class="g-idea"><span>Now</span> ${idea}</div>` : ''}
      ${list ? `<ol class="g-list">${list}</ol>` : '<div class="g-all">Every purpose fulfilled. The religion is theirs now.</div>'}`;
  }

  /** The Warning: who would run to ground the sea won't reach. */
  private safety(): string {
    const w = this.sim.warning;
    if (!w || w.disaster.phase !== 'waiting') return '';
    const alive = this.sim.villagers.alive;
    const safe = alive.filter((v) => w.disaster.wouldReachSafety(v)).length;
    const k = alive.length ? safe / alive.length : 0;
    const cls = k >= 0.75 ? 'good' : k >= 0.4 ? 'mid' : 'bad';
    return `<div class="g-safe-row"><small>If the sea came today</small><b class="${cls}">${safe} of ${alive.length}</b><small>would climb to safety</small></div><i class="g-bar"><b class="${cls}" style="width:${k * 100}%"></b></i>`;
  }

  /** Someone awaits judgment: the god's chance to speak. */
  private trial(): string {
    const sim = this.sim;
    const c = sim.justice.cases[0];
    if (!c) return '';
    const v = sim.villagers.byId(c.accused);
    if (!v) return '';
    const name = `<b>${v.name}</b>`;
    const innocent = c.actual !== c.accused ? ` (You know it was <b>${sim.villagers.byId(c.actual)?.name ?? 'someone else'}</b>.)` : '';
    return `${name} will be judged at ${whenJudged(sim, c)} for ${CRIME_TEXT[c.crime]}.${innocent} <b>Lightning</b> near them is your punishment, <b>Bless</b> them to pardon, Bless the wronged to side with them, or <b>Dream</b> to the priest (fire hardens, water softens). Or stay silent and let them judge.`;
  }

  /** A Doubter or False Prophet, or a silence that will soon raise one. */
  private turning(): string {
    const d = this.sim.dissent;
    const lead = d.leader;
    if (lead) {
      const name = `<b>${this.sim.villagers.byId(lead.id)?.name ?? 'Someone'}</b>`;
      const n = d.followers().length - 1;
      const with_ = n > 0 ? ` (${n} listen)` : '';
      return lead.kind === 'doubter'
        ? `${name} says you are not real${with_}. Work a wonder where ${name} can see it, or send a <b>Dream</b> (N).`
        : `${name} claims to speak for you${with_}, and takes credit for your wonders. Send a <b>Dream</b> (N), or strike <b>Lightning</b> (L) close by.`;
    }
    if (d.silent) return `They have seen no wonder in ${d.silenceDays} days. If the silence goes on, someone will speak in your place.`;
    return '';
  }

  /** One suggestion that fits the moment. */
  private idea(): string {
    const sim = this.sim;
    const m = sim.miracles;
    const alive = sim.villagers.alive;
    if (!alive.length) return '';
    const ready = (id: Parameters<typeof m.check>[0]) => m.check(id) === null;
    if (sim.warning?.disaster.phase === 'striking') return 'The sea is rising. Watch where they run.';
    if (sim.fire.burning.size > 0 && ready('rain')) return 'Something is burning. <b>Rain</b> (R) puts it out.';
    const trial = this.trial();
    if (trial) return trial;
    const turning = this.turning();
    if (turning) return turning;
    if (m.isNight()) {
      return ready('dream')
        ? 'Night: almost everyone is asleep, so wonders go unseen. Send a <b>Dream</b> (N) to a sleeper, or speed up to morning (4).'
        : 'Night: almost everyone is asleep, so wonders go unseen. Speed up to morning (4).';
    }
    const food = sim.village.store.food / alive.length;
    if (food < 2 && ready('bloom')) return 'Food is short. <b>Bloom</b> (B) on a field ripens it at once, and they will thank you.';
    const dry = sim.village.fields.filter((f) => f.moisture < 0.15).length;
    if ((sim.weather.drought || dry > sim.village.fields.length / 2) && ready('rain'))
      return 'The fields are dry. <b>Rain</b> (R) on them while people are working there.';
    const w = sim.warning;
    if (w && w.disaster.phase === 'waiting') {
      const safe = alive.filter((v) => w.disaster.wouldReachSafety(v)).length;
      if (safe < alive.length * 0.75)
        return 'Teach them the <b>ridge</b> is holy: <b>Holy Light</b> (I) on it while people can see, again and again. Dreams of mountain help too.';
    }
    if (m.grace < 15) return 'Grace is low. It comes back as they believe in you; let time pass.';
    return '';
  }
}
