import * as THREE from 'three';
import type { GameRenderer } from '../render/GameRenderer';
import type { MiracleId } from '../sim/miracles/defs';
import type { Prayer, PrayerEnd, PrayerKind } from '../sim/prayers';
import type { Sim } from '../sim/Sim';
import { TICKS_PER_DAY } from '../sim/time';
import { TUNING } from '../sim/tuning';
import { MIRACLE_PATHS, svgIcon } from './symbols';

/** What they say, in their own words. {for}: the sick one or the partner; {enemy}: the raiders. */
const LINES: Record<PrayerKind, string[]> = {
  rain: ['Rain, please. Our fields are dying.', 'Send the rain before the grain burns.', 'The ground is cracking. Weep for us.'],
  harvest: ['We are hungry. Fill our fields.', 'Give us food. The children are hungry.', 'Let the grain come quickly.'],
  heal: ['Heal {for}. Don\'t take them.', 'Make {for} well again, I beg you.', '{for} is burning up. Save them.'],
  child: ['Give {for} and me a child.', 'Let a baby come to our house.', 'Our home is too quiet. Give us a child.'],
  vengeance: ['{enemy} came for us. Punish them.', 'Strike {enemy} for what they did.', 'Make {enemy} pay for our dead.'],
  guidance: ['We are too many here. Show us new land.', 'Show us where to go.', 'Mark a place for us, far from here.'],
  mercy: ['Spare us. Tell us you are not angry.', 'What did we do? Forgive us.', 'No more. Please, no more.'],
};

/** How to answer it (the hint under each prayer). */
const HOW: Record<PrayerKind, string> = {
  rain: '<b>Rain</b> (R) over their village or fields',
  harvest: '<b>Bloom</b> (B) on their fields, or <b>Bless</b> (K) a field',
  heal: '<b>Bless</b> (K) {for}',
  child: '<b>Bless</b> (K) one of them, or their home',
  vengeance: 'Harm <b>{enemy}</b> with any wrath',
  guidance: '<b>Hallow</b> (6) ground well away from their village',
  mercy: 'Any kindness near them: <b>Bless</b>, <b>Bloom</b>, <b>Holy Light</b> or <b>Rain</b>',
};

/** The miracle that answers it, armed when the prayer is clicked (and its icon). */
const ANSWER: Record<PrayerKind, MiracleId> = {
  rain: 'rain',
  harvest: 'bloom',
  heal: 'bless',
  child: 'bless',
  vengeance: 'lightning',
  guidance: 'hallow',
  mercy: 'light',
};

const ENDED: Record<PrayerEnd, string> = {
  answered: 'Answered',
  luck: 'Answered, they believe',
  unheard: 'No answer came',
  defied: 'Answered with harm',
  lost: 'Too late',
};

/** Seconds an ended prayer lingers in the list. */
const LINGER = 6;
/** Farther than this (camera distance), bubbles show only their icon. */
const FAR = 150;

/**
 * Prayers, where the player can see them: a bubble over each one who is praying
 * (their words and a ring for the time left) and a list of every open prayer,
 * each with how to answer it. Clicking either goes there and readies the answer.
 */
export class PrayersView {
  readonly el: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly bubbles = new Map<number, { el: HTMLElement; html: string }>();
  private readonly ended: { p: Prayer; end: PrayerEnd; until: number }[] = [];
  private readonly known = new Map<number, Prayer>();
  private lastSeq = -1;
  private clock = 0;
  private timer = 0;
  private html = '';
  private open = true;
  private readonly v = new THREE.Vector3();
  /** Hidden while the villager inspector uses the same corner. */
  covered = false;

  constructor(
    root: HTMLElement,
    private readonly sim: Sim,
    private readonly view: GameRenderer,
    private readonly arm: (id: MiracleId) => void,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'prayer-layer';
    root.prepend(this.layer);
    this.el = document.createElement('div');
    this.el.className = 'hud-panel prayers-panel';
    root.appendChild(this.el);
    this.open = !matchMedia('(max-width: 760px)').matches;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-toggle]')) {
        this.open = !this.open;
        this.timer = 0;
        return;
      }
      const li = t.closest<HTMLElement>('[data-prayer]');
      if (li) this.go(Number(li.dataset.prayer));
    });
    this.layer.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-prayer]');
      if (!b) return;
      e.stopPropagation();
      this.go(Number(b.dataset.prayer));
    });
  }

  /** Go to the prayer and ready its answer. */
  go(id: number): void {
    const sim = this.sim;
    const p = sim.prayers.open.find((x) => x.id === id);
    if (!p) return;
    const half = TUNING.world.sizeX / 2;
    const at = this.where(p);
    if (p.kind === 'vengeance') {
      const c = sim.tribes[p.against]?.village.center ?? at;
      this.view.orbit.focus(c.x - half, c.z - half, 70);
    } else this.view.orbit.focus(at.x - half, at.z - half, p.kind === 'guidance' ? 110 : 50);
    this.arm(ANSWER[p.kind]);
  }

  private where(p: Prayer): { x: number; z: number } {
    const sim = this.sim;
    const v = sim.villagers.byId(p.asker);
    if (v?.alive && !v.inside) return { x: v.x, z: v.z };
    const home = v ? sim.structureById(v.homeId) : undefined;
    if (home) return home.door;
    return sim.tribes[p.tribe]?.village.center ?? { x: 0, z: 0 };
  }

  private fill(s: string, p: Prayer): string {
    const sim = this.sim;
    const who = sim.villagers.byId(p.for)?.name ?? 'them';
    const enemy = (sim.tribes[p.against]?.name ?? 'they').replace(/^the /, 'The ');
    return s.replace(/\{for\}/g, who).replace(/\{enemy\}/g, enemy);
  }

  private line(p: Prayer): string {
    const lines = LINES[p.kind];
    return this.fill(lines[p.id % lines.length]!, p);
  }

  private left(p: Prayer): string {
    const days = (p.untilTick - this.sim.tick) / TICKS_PER_DAY;
    return days >= 1.5 ? `${Math.round(days)} days left` : days >= 0.75 ? 'a day left' : 'not long left';
  }

  update(dt: number): void {
    const sim = this.sim;
    this.clock += dt;
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) {
      if (e.type !== 'prayerEnd') continue;
      const p = this.known.get(e.id);
      if (p) this.ended.push({ p, end: e.end, until: this.clock + LINGER });
    }
    this.lastSeq = sim.events.lastSeq;
    for (const p of sim.prayers.open) this.known.set(p.id, p);
    for (const id of [...this.known.keys()]) if (!sim.prayers.open.some((p) => p.id === id) && !this.ended.some((x) => x.p.id === id)) this.known.delete(id);
    while (this.ended.length && this.ended[0]!.until < this.clock) this.ended.shift();

    this.place();
    this.el.hidden = this.covered || (!sim.prayers.open.length && !this.ended.length);
    this.timer -= dt;
    if (this.timer > 0 || this.el.hidden) return;
    this.timer = 0.5;
    const html = this.render();
    if (html !== this.html) this.el.innerHTML = this.html = html;
  }

  private render(): string {
    const sim = this.sim;
    const open = [...sim.prayers.open].sort((a, b) => a.untilTick - b.untilTick);
    const many = sim.tribes.length > 1;
    const head = `<button class="pr-head" data-toggle aria-expanded="${this.open}"><span>Prayers</span><span class="pr-count">${open.length}</span><span class="g-caret">${this.open ? '▾' : '▸'}</span></button>`;
    if (!this.open) return head;
    const item = (p: Prayer, end?: PrayerEnd) => {
      const v = sim.villagers.byId(p.asker);
      const people = many ? ` <small>${(sim.tribes[p.tribe]?.name ?? '').replace(/^the /, '')}</small>` : '';
      const k = Math.max(0, Math.min(1, (p.untilTick - sim.tick) / (p.untilTick - p.bornTick)));
      const foot = end ? `<small class="pr-end ${end}">${ENDED[end]}</small>` : `<small class="pr-how">${this.fill(HOW[p.kind], p)} · ${this.left(p)}</small><i class="pr-bar"><b style="width:${(k * 100).toFixed(0)}%"></b></i>`;
      return `<li class="k-${p.kind}${end ? ' done' : ''}" ${end ? '' : `data-prayer="${p.id}"`}><span class="pr-icon">${svgIcon(MIRACLE_PATHS[ANSWER[p.kind]], 16)}</span><div><b>${v?.name ?? 'Someone'}</b>${people}<q>${this.line(p)}</q>${foot}</div></li>`;
    };
    const list = [...open.map((p) => item(p)), ...this.ended.map((x) => item(x.p, x.end))].join('');
    return `${head}<ul class="pr-list">${list}</ul>${open.length ? '<div class="pr-note">Click a prayer to go there. Harm their people and they take it as your answer.</div>' : ''}`;
  }

  private place(): void {
    const sim = this.sim;
    const canvas = this.view.renderer.domElement;
    const half = TUNING.world.sizeX / 2;
    const far = this.view.orbit.zoom > FAR;
    const seen = new Set<number>();
    for (const p of sim.prayers.open) {
      const v = sim.villagers.byId(p.asker);
      const at = this.where(p);
      const y = v?.alive && !v.inside ? v.y + 2.6 : sim.world.topY(Math.floor(at.x), Math.floor(at.z)) + 4;
      this.v.set(at.x - half, y, at.z - half).project(this.view.camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      seen.add(p.id);
      let b = this.bubbles.get(p.id);
      if (!b) {
        b = { el: document.createElement('div'), html: '' };
        b.el.dataset.prayer = String(p.id);
        this.layer.appendChild(b.el);
        this.bubbles.set(p.id, b);
      }
      const k = Math.max(0, Math.min(1, (p.untilTick - sim.tick) / (p.untilTick - p.bornTick)));
      b.el.className = `prayer-bubble k-${p.kind}${far ? ' far' : ''}`;
      b.el.style.setProperty('--p', `${(k * 100).toFixed(1)}%`);
      const html = `<i class="pb-icon">${svgIcon(MIRACLE_PATHS[ANSWER[p.kind]], 14)}</i><span>${this.line(p)}</span>`;
      if (b.html !== html) b.el.innerHTML = b.html = html;
      const sx = ((this.v.x + 1) / 2) * canvas.clientWidth;
      const sy = ((1 - this.v.y) / 2) * canvas.clientHeight;
      b.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, b] of this.bubbles) {
      if (seen.has(id)) continue;
      b.el.remove();
      this.bubbles.delete(id);
    }
  }
}
