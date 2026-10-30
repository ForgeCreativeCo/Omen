import type { Sim } from '../sim/Sim';
import type { Action, Villager } from '../sim/villagers/types';

const ACTIVITY: Record<string, string> = {
  sleep: 'sleeping',
  eat: 'eating',
  farm: 'tending the fields',
  chop: 'felling a tree',
  quarry: 'cutting stone',
  forage: 'foraging',
  build: 'building',
  gathering: 'at the evening fire',
  flee: 'fleeing the fire',
  wander: 'wandering',
  idle: 'resting',
};

const TRAIT_LABEL: Record<string, string> = {
  devout: 'Devout',
  skeptic: 'Skeptic',
  fearful: 'Fearful',
  curious: 'Curious',
  gossip: 'Gossip',
};

function activity(v: Villager, a: Action | null): string {
  if (!a) return 'thinking';
  if (a.phase === 'deliver' && v.carrying) return `carrying ${v.carrying.kind} home`;
  const what = ACTIVITY[a.kind] ?? a.kind;
  return a.phase === 'path' && a.kind !== 'wander' ? `on the way to ${what.replace(/^at /, 'the ')}` : what;
}

function bar(label: string, value: number, invert = false): string {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<div class="ins-bar"><span>${label}</span><div><i style="width:${pct}%" class="${invert ? 'bad' : ''}"></i></div></div>`;
}

/**
 * Villager inspector (SPEC §15): who they are, what they're doing, family, needs,
 * and (from M4) the omens they remember and what they believe.
 */
export class Inspector {
  private readonly el: HTMLElement;
  villagerId = -1;
  private timer = 0;

  constructor(root: HTMLElement, private readonly onClose: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel inspector';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.close !== undefined) this.close();
      const goto = t.dataset.villager;
      if (goto) this.villagerId = Number(goto);
    });
  }

  open(id: number): void {
    this.villagerId = id;
    this.el.hidden = false;
    this.timer = 1;
  }

  close(): void {
    this.villagerId = -1;
    this.el.hidden = true;
    this.onClose();
  }

  update(sim: Sim, dt: number): void {
    if (this.villagerId < 0) return;
    this.timer += dt;
    if (this.timer < 0.25) return;
    this.timer = 0;
    const v = sim.villagers.byId(this.villagerId);
    if (!v) return this.close();
    const name = (id: number) => {
      const o = sim.villagers.byId(id);
      if (!o) return '';
      return `<a data-villager="${o.id}">${o.name}${o.alive ? '' : ' †'}</a>`;
    };
    const kids = v.childIds.map(name).filter(Boolean).join(', ');
    const parents = v.parentIds.map(name).filter(Boolean).join(' & ');
    const home = v.homeId >= 0 ? sim.village.byId(v.homeId) : undefined;
    const status = v.alive
      ? activity(v, v.action)
      : `died ${v.deathCause === 'oldAge' ? 'of old age' : v.deathCause === 'starvation' ? 'of hunger' : `by ${v.deathCause}`}`;
    const view =
      v.faith.love + v.faith.fear < 0.15
        ? 'barely thinks of the god'
        : v.faith.love >= v.faith.fear
          ? 'loves the god'
          : 'fears the god';
    this.el.innerHTML = `
      <button class="ins-close" data-close aria-label="Close">×</button>
      <h2>${v.name}</h2>
      <div class="ins-sub">${Math.floor(v.age)} years · ${cap(v.role)}${v.alive ? '' : ' · †'}</div>
      <div class="ins-traits">${v.traits.map((t) => `<span>${TRAIT_LABEL[t]}</span>`).join('')}</div>
      <div class="ins-now">${cap(status)}</div>
      ${v.alive ? bar('Hunger', v.needs.hunger, true) + bar('Energy', v.needs.energy) + bar('Safety', v.needs.safety) : ''}
      <dl>
        ${v.partnerId >= 0 ? `<dt>Partner</dt><dd>${name(v.partnerId)}</dd>` : ''}
        ${parents ? `<dt>Parents</dt><dd>${parents}</dd>` : ''}
        ${kids ? `<dt>Children</dt><dd>${kids}</dd>` : ''}
        <dt>Home</dt><dd>${home ? `hut #${home.id}` : 'none'}</dd>
        <dt>The god</dt><dd>${view}</dd>
      </dl>
      <div class="ins-section">Remembers</div>
      ${v.dreams.length ? v.dreams.slice(-3).map((d) => `<div class="ins-dream">Dreamt of ${d.symbols.join(', ')}</div>`).join('') : ''}
      <div class="ins-empty">${v.memories.length || v.dreams.length ? '' : 'No omens yet.'}</div>
      <div class="ins-section">Believes</div>
      <div class="ins-empty">${v.beliefStrengths.size ? '' : 'Nothing yet.'}</div>`;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
