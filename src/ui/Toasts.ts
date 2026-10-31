import type { DissentEndReason, SimEvent } from '../sim/events';
import { featureLabel } from '../sim/omens/context';
import { TUNING } from '../sim/tuning';
import { MILESTONES } from '../sim/milestones';
import type { Sim } from '../sim/Sim';

/** How a Doubter's or False Prophet's movement ends. */
const END_TEXT: Record<DissentEndReason, string> = {
  converted: 'saw a wonder with their own eyes, and believes again.',
  recanted: 'woke from a dream and recanted.',
  discredited: 'has been shown up as a false prophet. The followers drift back.',
  died: 'is dead. The followers drift back.',
  gone: 'is gone. The followers drift back.',
};

const CAUSE: Record<string, string> = {
  oldAge: 'died of old age',
  starvation: 'starved',
  fire: 'was lost to fire',
  lightning: 'was struck by lightning',
  flood: 'drowned',
  meteor: 'was killed by the falling star',
};

/** Short-lived notices for notable moments. Rate-limited so 16× stays readable. */
export class Toasts {
  private readonly el: HTMLElement;
  /** -1 until the first update: start from now (a loaded game doesn't replay its past). */
  private lastSeq = -1;
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
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
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
        return e.left ? null : `${who(e.id)} has been sent away.`;
      case 'silence':
        return 'They have seen no wonder in a long while. <i>Where has the god gone?</i>';
      case 'dissent':
        return e.kind === 'doubter'
          ? `${who(e.id)} says there is no god, only weather. <small>(a Doubter)</small>`
          : `${who(e.id)} claims to speak for the god${e.rule ? `, and forbids ${featureLabel(sim, e.rule)}` : ''}. <small>(a False Prophet)</small>`;
      case 'dissentEnd':
        return `${who(e.id)} ${END_TEXT[e.reason]}`;
      case 'prophetClaims':
        return `${who(e.id)} claims the wonder as their own doing.`;
      case 'prophesied':
        return `${who(e.id)} foretells rain within ${TUNING.dissent.prophecyDays} days.`;
      case 'prophecyResult':
        return e.fulfilled ? `Rain came, as ${who(e.id)} foretold. More listen.` : `${who(e.id)}'s prophecy failed. Some stop listening.`;
      case 'schism':
        return e.outcome === 'split'
          ? `<b>The village has split.</b> ${who(e.leaderId)} leads ${e.ids.length - 1} away to live without you.`
          : `The faithful have driven ${who(e.leaderId)} out of the village.`;
      case 'dream':
        return `${who(e.villagerId)} stirs in their sleep.`;
      case 'blessing':
        return `${who(e.villagerId)} glows.`;
      case 'meteorFall':
        return 'A star is falling.';
      case 'milestone': {
        const m = MILESTONES.find((x) => x.id === e.id);
        return m ? `<span class="toast-purpose">Purpose fulfilled: <b>${m.title}</b></span>` : null;
      }
      case 'tradition': {
        const b = sim.belief.beliefs.get(e.beliefId);
        return b ? `The last who saw it are gone. Now tradition: <i>${sim.belief.statement(b)}</i>` : null;
      }
      case 'placeNamed':
        return `The people now speak of <b>${e.name}</b>.`;
      case 'godNamed':
        return e.old ? `They no longer say ${e.old}. The god is now <b>${e.name}</b>.` : `The people have named the god: <b>${e.name}</b>.`;
      case 'built':
        if (e.kind === 'statue') return `A statue of ${sim.myth.god} stands finished.`;
        if (e.kind === 'shrine' || e.kind === 'temple' || e.kind === 'cairn') return `The people have raised a ${e.kind}.`;
        return null;
      case 'flood':
        return e.phase === 'strike' ? '<b>The sea is rising.</b>' : e.phase === 'peak' ? 'The water has stopped rising.' : null;
      case 'ruined':
        return 'The old statue is left to weather.';
      case 'destroyed':
        return `A ${e.kind === 'hut' ? 'hut' : e.kind} was destroyed.`;
      default:
        return null;
    }
  }
}
