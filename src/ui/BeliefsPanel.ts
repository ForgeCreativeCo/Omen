import { BELIEF_TYPES } from '../sim/belief/catalog';
import type { Belief } from '../sim/belief/BeliefSystem';
import type { Sim } from '../sim/Sim';
import { TUNING } from '../sim/tuning';
import { describeOmen } from './describe';
import type { PeopleFocus } from './PeopleFocus';

const T = TUNING.belief;

/**
 * Village Beliefs (SPEC §15): what the people hold true, how strongly, and where
 * it came from. Click a belief to see its origin omens.
 */
export class BeliefsPanel {
  readonly el: HTMLElement;
  private open = new Set<string>();
  private timer = 1;
  /** Opens the Holy Book at a verse; set by main. */
  onVerse: (verseId: number) => void = () => {};

  constructor(root: HTMLElement, private readonly focus: PeopleFocus) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel beliefs-panel';
    this.el.hidden = true;
    root.appendChild(this.el);
    focus.onChange(() => !this.el.hidden && this.render());
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) return this.toggle(false);
      if (focus.click(t)) return;
      const verse = t.closest<HTMLElement>('[data-verse]');
      if (verse) return this.onVerse(Number(verse.dataset.verse));
      const row = t.closest<HTMLElement>('[data-belief]');
      if (!row) return;
      const id = row.dataset.belief!;
      if (this.open.has(id)) this.open.delete(id);
      else this.open.add(id);
      this.render();
    });
  }

  /** The focused people's view of the world. */
  private get sim(): Sim {
    return this.focus.view;
  }

  toggle(show = this.el.hidden): void {
    this.el.hidden = !show;
    if (show) this.render();
  }

  update(dt: number): void {
    if (this.el.hidden) return;
    this.timer += dt;
    if (this.timer < 0.5) return;
    this.timer = 0;
    this.render();
  }

  private render(): void {
    const sim = this.sim;
    const bs = sim.belief;
    const priest = sim.villagers.byId(bs.priestId);
    const list = [...bs.beliefs.values()].filter((b) => b.strength >= 0.05).sort((a, b) => b.strength - a.strength);
    const rows = list.map((b) => this.row(b)).join('');
    this.el.innerHTML = `
      <button class="ins-close" data-close aria-label="Close">×</button>
      <h2>${this.focus.many ? `Beliefs of ${this.focus.tribe.name}` : 'Village Beliefs'}</h2>
      ${this.focus.tabs()}
      <div class="bp-priest">High priest: ${priest ? `<b>${priest.name}</b> · ${bs.personality}` : 'none'}</div>
      ${rows || '<div class="ins-empty">The people believe nothing in particular yet.</div>'}`;
  }

  private row(b: Belief): string {
    const sim = this.sim;
    const def = BELIEF_TYPES[b.type];
    const pct = Math.round(b.strength * 100);
    const tag = b.strength >= T.doctrineThreshold ? '<span class="bp-tag doctrine">Doctrine</span>' : b.strength >= T.behaviorThreshold ? '<span class="bp-tag">Active</span>' : '';
    const holders = [...b.holders.values()].filter((s) => s >= 0.2).length;
    const open = this.open.has(b.id);
    const origins = open
      ? b.originOmenIds
          .map((id) => sim.belief.omens.find((o) => o.id === id))
          .filter((o) => !!o)
          .slice(-4)
          .map((o) => `<li>${describeOmen(sim, o!)}</li>`)
          .join('')
      : '';
    return `
      <div class="bp-row ${open ? 'open' : ''}" data-belief="${b.id}">
        <div class="bp-head"><span class="bp-icon" title="${def.label}">${def.icon}</span><span class="bp-text">${sim.belief.statement(b)}</span>${tag}</div>
        <div class="bp-bar"><i style="width:${pct}%"></i><s style="left:${T.behaviorThreshold * 100}%"></s><s style="left:${T.doctrineThreshold * 100}%"></s></div>
        ${
          open
            ? `<div class="bp-more">
                 <div><b>${def.label}.</b> ${def.effect}</div>
                 <div class="bp-stats">${pct}% · held by ${holders} · ${b.confirmations} confirmations, ${b.contradictions} doubts${b.isTradition ? ' · tradition (no living witness)' : ''}</div>
                 ${origins ? `<div class="bp-origin">Began with:</div><ul>${origins}</ul>` : '<div class="bp-origin">Began with a dream, or with talk at the fire.</div>'}
                 ${b.scriptureRefs.length ? `<button class="bp-verse" data-verse="${b.scriptureRefs[0]}">Read it in the Holy Book</button>` : ''}
               </div>`
            : ''
        }
      </div>`;
  }
}
