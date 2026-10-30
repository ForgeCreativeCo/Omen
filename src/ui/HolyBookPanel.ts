import type { DriftKind, Verse } from '../sim/myth/HolyBook';
import type { Sim } from '../sim/Sim';
import { calendarAt, formatCalendar } from '../sim/time';

const DRIFT_LABEL: Record<DriftKind, string> = {
  tradition: 'reason forgotten',
  compressed: 'merged & inflated',
  rumor: 'retold',
  misread: 'misread',
};

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The Holy Book (SPEC §13): chapters by era, verses in the scripture voice, and a
 * player-only "Show the Truth" toggle that sets what really happened beside each verse.
 */
export class HolyBookPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly title: HTMLElement;
  private truth = false;
  private signature = '';
  private timer = 1;
  private highlight = -1;

  constructor(root: HTMLElement, private readonly sim: Sim) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel holy-book';
    this.el.hidden = true;
    this.el.innerHTML = `
      <header class="hb-head">
        <div class="hb-title"></div>
        <label class="hb-truth"><input type="checkbox"><span class="hb-switch"></span>Show the Truth</label>
        <button class="ins-close" data-close aria-label="Close">×</button>
      </header>
      <nav class="hb-nav"></nav>
      <div class="hb-body"></div>`;
    this.body = this.el.querySelector('.hb-body')!;
    this.nav = this.el.querySelector('.hb-nav')!;
    this.title = this.el.querySelector('.hb-title')!;
    root.appendChild(this.el);
    const box = this.el.querySelector<HTMLInputElement>('.hb-truth input')!;
    box.addEventListener('change', () => {
      this.truth = box.checked;
      this.el.classList.toggle('truth', this.truth);
      this.render(true);
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) return this.toggle(false);
      const ch = t.closest<HTMLElement>('[data-chapter]');
      if (ch) this.body.querySelector(`#hb-ch-${ch.dataset.chapter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Wheel and touch scrolling stay inside the book.
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !(e.target instanceof HTMLInputElement)) this.toggle();
      if (e.code === 'Escape' && !this.el.hidden) this.toggle(false);
    });
  }

  /** Turn "Show the Truth" on or off from outside (the end screen). */
  setTruth(on: boolean): void {
    const box = this.el.querySelector<HTMLInputElement>('.hb-truth input')!;
    box.checked = on;
    this.truth = on;
    this.el.classList.toggle('truth', on);
    if (this.open) this.render(true);
  }

  get showingTruth(): boolean {
    return this.truth;
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(show = this.el.hidden): void {
    this.el.hidden = !show;
    if (show) this.render(true);
  }

  /** Open at a particular verse (from the Beliefs panel). */
  showVerse(id: number): void {
    this.highlight = id;
    this.toggle(true);
    // After layout settles (the panel may just have appeared).
    requestAnimationFrame(() => this.body.querySelector(`[data-verse="${id}"]`)?.scrollIntoView({ block: 'center' }));
  }

  update(dt: number): void {
    if (this.el.hidden) return;
    this.timer += dt;
    if (this.timer < 1) return;
    this.timer = 0;
    this.render(false);
  }

  private render(force: boolean): void {
    const sim = this.sim;
    const book = sim.myth.book;
    const sig = `${book.chapters.length}|${book.verses().length}|${book.verses().reduce((n, v) => n + v.drift.length, 0)}|${sim.myth.god}`;
    if (!force && sig === this.signature) return;
    this.signature = sig;
    const name = sim.myth.godName;
    this.title.innerHTML = name ? `The Holy Book of <b>${escape(name)}</b>` : 'The Holy Book';
    const atBottom = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 30;
    const scroll = this.body.scrollTop;

    this.nav.innerHTML = book.chapters
      .map((c, i) => `<button data-chapter="${i}" title="From ${formatCalendar(calendarAt(c.startTick))}">${escape(c.title.replace('The Book of ', ''))}</button>`)
      .join('');
    const chapters = book.chapters
      .map(
        (c, i) => `
        <section class="hb-chapter" id="hb-ch-${i}">
          <h3>${escape(c.title)}</h3>
          <div class="hb-era">${formatCalendar(calendarAt(c.startTick))}</div>
          ${c.verses.map((v, k) => this.verse(v, i + 1, k + 1)).join('') || '<p class="hb-empty">Nothing is written yet.</p>'}
        </section>`,
      )
      .join('');
    this.body.innerHTML = chapters || '<p class="hb-empty">Nothing is written yet. The people have not yet named what they have seen.</p>';
    // Keep the reader's place; follow new verses if they were at the end.
    if (!force) this.body.scrollTop = atBottom ? this.body.scrollHeight : scroll;
    else if (this.highlight < 0) this.body.scrollTop = this.body.scrollHeight;
  }

  private verse(v: Verse, ch: number, n: number): string {
    const truth = this.truth
      ? `<aside class="hb-note">
          ${v.drift.length ? `<div class="hb-drift">${v.drift.map((d) => `<span class="d-${d}">${DRIFT_LABEL[d]}</span>`).join('')}</div>` : ''}
          ${v.truth.map((t) => `<div>${escape(t)}</div>`).join('')}
          ${v.original ? `<div class="hb-orig">Once it read: <s>${escape(v.original)}</s></div>` : ''}
        </aside>`
      : '';
    return `<div class="hb-verse k-${v.kind}${v.id === this.highlight ? ' hl' : ''}" data-verse="${v.id}">
        <p><sup>${ch}:${n}</sup>${escape(v.text)}</p>${truth}
      </div>`;
  }
}
