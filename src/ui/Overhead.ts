import * as THREE from 'three';
import type { GameRenderer } from '../render/GameRenderer';
import type { Sim } from '../sim/Sim';
import { TUNING } from '../sim/tuning';
import type { Villager } from '../sim/villagers/types';
import { CRIME_TEXT } from './describe';
import { activity } from './Inspector';
import { DOING_PATHS, svgIcon, type DoingIcon } from './symbols';

/** Closer than this (camera distance), routine work shows too. */
const CLOSE = 95;
/** Seconds a deed's icon stays over the people involved. */
const DEED_SECONDS = 7;

const ROUTINE: Partial<Record<string, DoingIcon>> = {
  farm: 'farm',
  chop: 'chop',
  quarry: 'quarry',
  forage: 'forage',
  build: 'build',
  eat: 'eat',
  gathering: 'fire',
};

/** What sort of mark it is, for color. */
const TONE: Record<DoingIcon, string> = {
  dance: 'rite',
  pray: 'rite',
  pilgrim: 'rite',
  build: 'work',
  love: 'love',
  quarrel: 'deed',
  theft: 'deed',
  flee: 'alarm',
  leave: 'alarm',
  dissent: 'dissent',
  farm: 'work',
  chop: 'work',
  quarry: 'work',
  forage: 'work',
  eat: 'work',
  sleep: 'work',
  fire: 'work',
  hurt: 'alarm',
  judge: 'deed',
};

/** Labels for the hover card's tags. */
export function villagerTags(sim: Sim, v: Villager): string[] {
  const tags: string[] = [];
  if (v.id === sim.belief.priestId) tags.push('Priest');
  if (sim.belief.chosenIds().has(v.id)) tags.push('Chosen');
  if (sim.effects.outcastIds().has(v.id)) tags.push('Outcast');
  const c = sim.justice.pending(v);
  if (c) tags.push(`Accused of ${CRIME_TEXT[c.crime]}`);
  const lead = sim.dissent.leader;
  if (lead?.id === v.id) tags.push(lead.kind === 'doubter' ? 'Doubter' : 'False Prophet');
  else if (lead && sim.dissent.follows(v)) tags.push(lead.kind === 'doubter' ? 'Doubts' : 'Follows the prophet');
  return tags;
}

/**
 * What everyone is doing, at a glance: a small mark over each head. Rites,
 * flight, departures and deeds always show; routine work only up close.
 * Hovering anyone shows their name, what they're doing and who they are.
 */
export class Overhead {
  private readonly el: HTMLElement;
  private readonly card: HTMLElement;
  private readonly marks = new Map<number, { el: HTMLElement; icon: DoingIcon | null }>();
  /** Recent deeds: villager → icon until a time (seconds). */
  private readonly recent = new Map<number, { icon: DoingIcon; until: number }>();
  private lastSeq = -1;
  private clock = 0;
  private readonly p = new THREE.Vector3();
  private hover: { x: number; y: number } | null = null;
  private hoverTimer = 0;
  private hoverId = -1;
  private cardHtml = '';
  enabled = true;

  constructor(
    root: HTMLElement,
    private readonly view: GameRenderer,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overhead';
    root.prepend(this.el); // under the HUD panels
    this.card = document.createElement('div');
    this.card.className = 'hover-card';
    this.card.hidden = true;
    root.appendChild(this.card);
    const canvas = view.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && e.buttons === 0) this.hover = { x: e.clientX, y: e.clientY };
      else this.hover = null;
    });
    canvas.addEventListener('pointerleave', () => (this.hover = null));
    canvas.addEventListener('pointerdown', () => (this.hover = null));
  }

  update(sim: Sim, dt: number): void {
    this.clock += dt;
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) {
      const until = this.clock + DEED_SECONDS;
      if (e.type === 'theft') this.recent.set(e.id, { icon: 'theft', until });
      else if (e.type === 'quarrel') for (const id of [e.a, e.b]) this.recent.set(id, { icon: 'quarrel', until });
      else if (e.type === 'couple') for (const id of [e.a, e.b]) this.recent.set(id, { icon: 'love', until });
      else if (e.type === 'fight') for (const id of [e.a, e.b]) this.recent.set(id, { icon: 'quarrel', until });
      else if (e.type === 'affairExposed') for (const id of [e.a, e.b, e.by]) this.recent.set(id, { icon: 'quarrel', until });
      else if (e.type === 'killing') this.recent.set(e.killer, { icon: 'theft', until: until + 10 });
    }
    this.lastSeq = sim.events.lastSeq;
    for (const [id, r] of this.recent) if (r.until < this.clock) this.recent.delete(id);

    this.place(sim);
    this.hoverCard(sim, dt);
  }

  private iconFor(sim: Sim, v: Villager, close: boolean): DoingIcon | null {
    const recent = this.recent.get(v.id);
    if (recent) return recent.icon;
    const a = v.action;
    if (sim.dissent.leader?.id === v.id) return 'dissent';
    if (sim.justice.pending(v)) return 'judge';
    if (sim.society.isHurt(v)) return 'hurt';
    if (a?.kind === 'ritual' && a.phase === 'work') return a.ritual === 'dance' ? 'dance' : 'pray';
    if (a?.kind === 'pilgrimage') return 'pilgrim';
    if (a?.kind === 'flee') return 'flee';
    if (a?.kind === 'exile') return 'leave';
    if (!close || !a) return null;
    if (a.kind === 'sleep') return v.lying ? 'sleep' : null;
    if (a.phase === 'path') return null;
    return ROUTINE[a.kind] ?? null;
  }

  private place(sim: Sim): void {
    const canvas = this.view.renderer.domElement;
    const half = TUNING.world.sizeX / 2;
    const close = this.view.orbit.zoom < CLOSE;
    const seen = new Set<number>();
    for (const v of this.enabled ? sim.villagers.alive : []) {
      if (v.inside) continue;
      const icon = this.iconFor(sim, v, close);
      if (!icon) continue;
      this.p.set(v.x - half, v.y + 1.9, v.z - half).project(this.view.camera);
      if (this.p.z > 1 || Math.abs(this.p.x) > 1.05 || Math.abs(this.p.y) > 1.05) continue;
      seen.add(v.id);
      let m = this.marks.get(v.id);
      if (!m) {
        m = { el: document.createElement('div'), icon: null };
        this.el.appendChild(m.el);
        this.marks.set(v.id, m);
      }
      if (m.icon !== icon) {
        m.icon = icon;
        m.el.className = `doing ${TONE[icon]}`;
        m.el.innerHTML = svgIcon(DOING_PATHS[icon], 14);
      }
      const sx = ((this.p.x + 1) / 2) * canvas.clientWidth;
      const sy = ((1 - this.p.y) / 2) * canvas.clientHeight;
      m.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, m] of this.marks) {
      if (seen.has(id)) continue;
      m.el.remove();
      this.marks.delete(id);
    }
  }

  private hoverCard(sim: Sim, dt: number): void {
    this.hoverTimer -= dt;
    if (!this.hover) {
      this.card.hidden = true;
      this.hoverId = -1;
      return;
    }
    if (this.hoverTimer <= 0) {
      this.hoverTimer = 0.12;
      this.hoverId = this.view.pickVillager(sim, this.hover.x, this.hover.y);
    }
    const v = this.hoverId >= 0 ? sim.villagers.byId(this.hoverId) : undefined;
    if (!v?.alive) {
      this.card.hidden = true;
      return;
    }
    const tags = villagerTags(sim, v)
      .map((t) => `<span>${t}</span>`)
      .join('');
    const what = activity(v, v.action);
    const html = `<b>${v.name}</b> <small>${Math.floor(v.age)}</small><div>${what.charAt(0).toUpperCase() + what.slice(1)}</div>${tags ? `<div class="hc-tags">${tags}</div>` : ''}`;
    if (this.cardHtml !== html) this.card.innerHTML = this.cardHtml = html;
    this.card.hidden = false;
    const x = Math.min(this.hover.x + 14, window.innerWidth - this.card.offsetWidth - 8);
    const y = Math.max(8, this.hover.y - this.card.offsetHeight - 10);
    this.card.style.transform = `translate(${x}px, ${y}px)`;
  }
}
