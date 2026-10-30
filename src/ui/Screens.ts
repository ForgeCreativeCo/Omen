import type { SaveHeader } from '../sim/save';
import type { GameMode, Sim } from '../sim/Sim';
import { calendarAt, formatCalendar } from '../sim/time';
import { TUNING } from '../sim/tuning';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Start a game: reload with the chosen mode and seed in the URL. */
export function startGame(mode: GameMode | null, seed: string): void {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  url.searchParams.delete('load');
  if (mode) url.searchParams.set('mode', mode);
  else url.searchParams.delete('mode');
  location.href = url.toString();
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Mode select (SPEC M6), drawn over a quietly running island. */
export class TitleScreen {
  readonly el: HTMLElement;

  constructor(root: HTMLElement, seed: string, saved: SaveHeader | null, loadFailed = false) {
    this.el = document.createElement('div');
    this.el.className = 'screen title-screen';
    const cont = saved
      ? `<button data-continue class="ts-continue">Continue <small>${saved.mode === 'warning' ? 'The Warning' : 'Sandbox'} · ${escape(saved.label)} · island ${escape(saved.seed)}</small></button>`
      : '';
    this.el.innerHTML = `
      <div class="ts-inner">
        <h1>OMEN</h1>
        <p class="ts-tag">You are a god who cannot speak. They will make of you what they can.</p>
        ${loadFailed ? '<p class="ts-error">That save could not be loaded (it may be from an older version).</p>' : ''}
        ${cont}
        <div class="ts-modes">
          <button data-mode="warning" class="ts-mode ts-warning">
            <b>The Warning</b>
            <span>The sea will rise in ${TUNING.warning.floodInYears} years. They will never be told. Teach them to seek high ground, without a single word.</span>
          </button>
          <button data-mode="sandbox" class="ts-mode">
            <b>Sandbox</b>
            <span>No end and no flood. Work wonders, and watch a faith take shape around them.</span>
          </button>
        </div>
        <label class="ts-seed">Island <input value="${escape(seed)}" spellcheck="false" maxlength="24"><button data-reroll title="Another island">↻</button></label>
      </div>`;
    root.appendChild(this.el);
    const input = this.el.querySelector('input')!;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-continue]')) {
        const url = new URL(location.href);
        url.search = '?load=1';
        location.href = url.toString();
        return;
      }
      if (t.closest('[data-reroll]')) {
        e.preventDefault();
        startGame(null, randomSeed());
        return;
      }
      const m = t.closest<HTMLElement>('[data-mode]');
      if (m) startGame(m.dataset.mode as GameMode, input.value.trim() || randomSeed());
    });
  }
}

/** The Warning's opening vision: only the player ever sees what is coming. */
export class Vision {
  readonly el: HTMLElement;

  constructor(root: HTMLElement, years: number, onBegin: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'screen vision';
    const lines = [
      'You see the water.',
      `In ${years} years the sea will rise over the valley, over the hill, over everything they have built.`,
      'Only the high ridge will stand above it.',
      'They cannot hear you. They will only see what you do, and decide for themselves what it means.',
    ];
    this.el.innerHTML = `
      <div class="vi-inner">
        ${lines.map((l, i) => `<p style="animation-delay:${0.6 + i * 1.8}s">${l}</p>`).join('')}
        <button class="vi-begin" style="animation-delay:${0.6 + lines.length * 1.8}s">Begin</button>
      </div>`;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.querySelector('.vi-begin')!.addEventListener('click', () => {
      this.el.classList.add('out');
      setTimeout(() => this.el.remove(), 900);
      onBegin();
    });
  }
}

const OUTCOME_TITLE: Record<string, [string, string]> = {
  survived: ['They Endured', 'The water came, and enough of them were on the high ground.'],
  perished: ['The Sea Took Them', 'The water came, and too few were above it.'],
  faithless: ['Forgotten', 'They stopped believing in you before the water came. A god no one believes in can do nothing.'],
  extinct: ['No One Remained', 'There was no one left to save.'],
};

const KIND_ICON: Record<string, string> = {
  doctrine: '✦',
  tradition: '✧',
  omen: '⚡',
  name: '☉',
  place: '△',
  statue: '♜',
  works: '⌂',
  legend: '❦',
  priest: '†',
  creation: '◌',
};

/** End of the Warning: the verdict, what they held holy, a timeline, and the way into the Book. */
export class EndScreen {
  readonly el: HTMLElement;

  constructor(
    root: HTMLElement,
    sim: Sim,
    actions: { book: () => void; watch: () => void; again: () => void; title: () => void },
  ) {
    const w = sim.warning!;
    const o = w.outcome!;
    const [title, line] = OUTCOME_TITLE[o.reason] ?? ['The End', ''];
    const need = Math.round(TUNING.warning.survivalToWin * 100);
    const level = w.disaster.safeAbove;
    const holy = (w.holyAtStrike ?? [])
      .slice(0, 5)
      .map((h) => `<li class="${h.height > level ? 'dry' : 'wet'}"><b>${escape(h.label)}</b> ${Math.round(h.strength * 100)}% <small>${h.height > level ? 'stayed above the water' : 'went under'}</small></li>`)
      .join('');
    const timeline = sim.myth.book
      .verses()
      .filter((v) => v.kind !== 'priest' && v.kind !== 'legend')
      .map(
        (v) => `<li><span class="es-when">${formatCalendar(calendarAt(v.tick)).replace(' · ', '<br>')}</span><span class="es-icon">${KIND_ICON[v.kind] ?? '·'}</span><span class="es-what">${escape(v.text)}${v.truth[0] ? `<small>${escape(v.truth[0])}</small>` : ''}</span></li>`,
      )
      .join('');
    this.el = document.createElement('div');
    this.el.className = `screen end-screen ${o.won ? 'won' : 'lost'}`;
    this.el.innerHTML = `
      <div class="es-inner">
        <h1>${title}</h1>
        <p class="es-line">${line}</p>
        <div class="es-stats">
          ${
            o.startPopulation
              ? `<div><b>${o.survivors}</b> of ${o.startPopulation} survived the flood</div><div><b>${Math.round(o.ratio * 100)}%</b> <small>${need}% needed</small></div>`
              : `<div><b>${sim.villagers.alive.length}</b> people</div>`
          }
          <div><b>${formatCalendar(calendarAt(o.tick)).split(' · ')[0]}</b> <small>${sim.myth.book.chapters.length} high priests</small></div>
          <div><b>${escape(sim.myth.god)}</b> <small>what they called you</small></div>
        </div>
        ${holy ? `<h2>What they held holy when the water came</h2><ul class="es-holy">${holy}</ul>` : o.startPopulation ? '<h2>They held nothing holy when the water came.</h2>' : ''}
        <h2>How it was written</h2>
        <ol class="es-timeline">${timeline || '<li>Nothing was written.</li>'}</ol>
        <div class="es-actions">
          <button data-a="book" class="primary">Read the Holy Book, with the Truth</button>
          <button data-a="watch">Keep watching</button>
          <button data-a="again">Another island</button>
          <button data-a="title">Title</button>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a as keyof typeof actions | undefined;
      if (a) actions[a]();
    });
  }

  close(): void {
    this.el.remove();
  }
}
