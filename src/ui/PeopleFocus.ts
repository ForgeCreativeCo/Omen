import type { Sim } from '../sim/Sim';
import type { Tribe } from '../sim/tribe';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Which people the faith panels (Beliefs, the Holy Book, Purposes, the season
 * card) are showing. Shared, so switching in one switches them all; clicking a
 * villager follows their people.
 */
export class PeopleFocus {
  private current = 0;
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly sim: Sim) {}

  get id(): number {
    return this.sim.tribes[this.current] ? this.current : 0;
  }

  get tribe(): Tribe {
    return this.sim.tribes[this.id]!;
  }

  /** The sim as the focused people see it: their beliefs, book, village and members. */
  get view(): Sim {
    return this.tribe.view;
  }

  set(id: number): void {
    if (!this.sim.tribes[id] || id === this.current) return;
    this.current = id;
    for (const f of this.listeners) f();
  }

  onChange(f: () => void): void {
    this.listeners.push(f);
  }

  /** More than one people worth choosing between. */
  get many(): boolean {
    return this.sim.tribes.filter((t) => t.members.length).length > 1;
  }

  /** The switcher row: one button per living people (and the focused one, even if gone). */
  tabs(): string {
    if (!this.many) return '';
    const buttons = this.sim.tribes
      .filter((t) => t.members.length || t.id === this.id)
      .map((t) => {
        const color = `#${t.color.toString(16).padStart(6, '0')}`;
        const on = t.id === this.id;
        return `<button class="pf-tab${on ? ' on' : ''}" data-people="${t.id}" aria-pressed="${on}" title="${escape(cap(t.name))}"><i style="background:${color}"></i>${escape(cap(t.name.replace(/^the /, '')))}</button>`;
      })
      .join('');
    return `<div class="pf-tabs" role="group" aria-label="Which people">${buttons}</div>`;
  }

  /** Handle a click inside a panel; true if it was a switcher button. */
  click(target: HTMLElement): boolean {
    const b = target.closest<HTMLElement>('[data-people]');
    if (!b) return false;
    this.set(Number(b.dataset.people));
    return true;
  }
}
