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
    if (this.recent.length >= 4) return;
    this.recent.push(now);
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    this.el.prepend(t);
    setTimeout(() => t.classList.add('out'), 5200);
    setTimeout(() => t.remove(), 6000);
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
      case 'beliefLevel': {
        const b = sim.belief.beliefs.get(e.beliefId);
        if (!b || b.type === 'TEMPERAMENT') return null;
        if (e.level === 'behavior') return `A new belief has taken hold: <i>${sim.belief.statement(b)}</i>`;
        if (e.level === 'doctrine') return `Now doctrine: <i>${sim.belief.statement(b)}</i>`;
        return null;
      }
      case 'priest':
        return e.id >= 0 ? `${who(e.id)} is now the high priest <small>(${e.personality})</small>.` : null;
      case 'prophecy': {
        const b = sim.belief.beliefs.get(e.beliefId);
        return b ? `The priest foretells ${e.good ? 'good fortune' : 'hard times'}: <i>${sim.belief.statement(b)}</i>` : null;
      }
      case 'exiled':
        return `${who(e.id)} has been sent away.`;
      case 'dream':
        return `${who(e.villagerId)} stirs in their sleep.`;
      case 'destroyed':
        return `A ${e.kind === 'hut' ? 'hut' : e.kind} was destroyed.`;
      default:
        return null;
    }
  }
}
