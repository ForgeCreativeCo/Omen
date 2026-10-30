import type { SimEvent } from '../sim/events';
import type { Sim } from '../sim/Sim';

const CAUSE: Record<string, string> = {
  oldAge: 'died of old age',
  starvation: 'starved',
  fire: 'was lost to fire',
  lightning: 'was struck by lightning',
  flood: 'drowned',
};

/** Short-lived notices for notable moments. Rate-limited so 16× stays readable. */
export class Toasts {
  private readonly el: HTMLElement;
  private lastSeq = 0;
  private recent: number[] = [];

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toasts';
    root.appendChild(this.el);
  }

  show(html: string): void {
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 4000);
    if (this.recent.length >= 3) return;
    this.recent.push(now);
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    this.el.prepend(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4500);
  }

  update(sim: Sim): void {
    for (const e of sim.events.since(this.lastSeq)) {
      const msg = this.describe(sim, e);
      if (msg) this.show(msg);
    }
    this.lastSeq = sim.events.lastSeq;
  }

  private describe(sim: Sim, e: SimEvent): string | null {
    const who = (id: number) => `<b>${sim.villagers.byId(id)?.name ?? 'Someone'}</b>`;
    switch (e.type) {
      case 'death':
        return `${who(e.id)} ${CAUSE[e.cause] ?? 'died'}.`;
      case 'birth':
        return `${who(e.id)} was born.`;
      case 'rainStart':
        return e.storm ? 'A storm rolls in.' : null;
      case 'droughtStart':
        return 'The rains have stopped. A drought begins.';
      case 'droughtEnd':
        return 'The drought breaks.';
      case 'fireStarted':
        return 'Fire!';
      case 'dream':
        return `${who(e.villagerId)} stirs in their sleep.`;
      case 'destroyed':
        return `A ${e.kind === 'hut' ? 'hut' : e.kind} was destroyed.`;
      default:
        return null;
    }
  }
}
