import * as THREE from 'three';
import type { GameRenderer } from '../render/GameRenderer';
import type { Omen } from '../sim/omens/types';
import type { Sim } from '../sim/Sim';
import { TUNING } from '../sim/tuning';
import type { Villager } from '../sim/villagers/types';
import { reactionLine, ritualLine } from './describe';

const LIFE = 5.5;
const MAX_BUBBLES = 5;
/** Everyday weather gets one voice; wonders get a few. */
const NATURAL = new Set(['naturalRain', 'storm', 'naturalLightning', 'drought']);

interface Bubble {
  el: HTMLElement;
  villagerId: number;
  age: number;
  x: number;
  y: number;
  placed: boolean;
}

/**
 * Speech over villagers' heads right after something happens: how a few of the
 * witnesses read it ("The ridge is holy!", "Our dancing angered it!"), and
 * rites as they begin. Shows the player what each wonder taught.
 */
export class Reactions {
  private readonly el: HTMLElement;
  private bubbles: Bubble[] = [];
  /** -1 until the first update: a loaded game doesn't replay its past. */
  private lastSeq = -1;
  private lastRitual = -Infinity;
  private clock = 0;
  private readonly p = new THREE.Vector3();
  enabled = true;

  constructor(
    root: HTMLElement,
    private readonly view: GameRenderer,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'reactions';
    root.appendChild(this.el);
  }

  update(sim: Sim, dt: number): void {
    this.clock += dt;
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) {
      if (!this.enabled) continue;
      if (e.type === 'omen') {
        const o = sim.belief.omens.find((x) => x.id === e.omenId);
        if (o) this.react(sim, o);
      } else if (e.type === 'ritual' && e.villagerId !== undefined && this.clock - this.lastRitual > 8) {
        const v = sim.villagers.byId(e.villagerId);
        if (!v?.alive) continue;
        const subject = e.activity === 'pray' ? 'activity:praying' : `activity:${e.activity}`;
        const rite = sim.belief.active('RITUAL', 0).filter((b) => b.subject === subject).sort((a, b) => b.strength - a.strength)[0];
        this.lastRitual = this.clock;
        this.say(v, ritualLine(sim, subject.slice(9), rite?.response), 'rite');
      }
    }
    this.lastSeq = sim.events.lastSeq;
    this.place(sim, dt);
  }

  private react(sim: Sim, o: Omen): void {
    if (o.kind === 'dream') return;
    const seen = o.witnesses
      .map((id) => sim.villagers.byId(id))
      .filter((v): v is Villager => !!v?.alive && !v.inside)
      .map((v) => ({ v, d: Math.hypot(v.x - o.position.x, v.z - o.position.z) }));
    if (!seen.length) return;
    // The person it happened to speaks first, then the nearest onlookers.
    const affected = (v: Villager) => o.outcomes.some((x) => x.entity === `person:${v.id}` || x.people?.includes(v.id));
    seen.sort((a, b) => Number(affected(b.v)) - Number(affected(a.v)) || a.d - b.d);
    const n = NATURAL.has(o.kind) ? 1 : Math.min(3, seen.length);
    const said = new Set<string>();
    for (const { v } of seen) {
      if (said.size >= n) break;
      const m = v.memories.find((x) => x.omenId === o.id);
      if (!m) continue;
      const line = reactionLine(sim, v, m, o);
      if (said.has(line)) continue;
      said.add(line);
      this.say(v, line, m.valence > 0.15 ? 'good' : m.valence < -0.15 ? 'bad' : '');
    }
  }

  private say(v: Villager, line: string, tone: string): void {
    this.bubbles.find((b) => b.villagerId === v.id)?.el.remove();
    this.bubbles = this.bubbles.filter((b) => b.villagerId !== v.id && b.el.isConnected);
    while (this.bubbles.length >= MAX_BUBBLES) this.bubbles.shift()!.el.remove();
    const el = document.createElement('div');
    el.className = `reaction ${tone}`;
    el.innerHTML = `<b>${v.name}</b> ${line}`;
    this.el.appendChild(el);
    this.bubbles.push({ el, villagerId: v.id, age: 0, x: 0, y: 0, placed: false });
  }

  /** Follow each speaker on screen; fade out at the end of its life. */
  private place(sim: Sim, dt: number): void {
    const canvas = this.view.renderer.domElement;
    const half = TUNING.world.sizeX / 2;
    /** Boxes already placed this frame (bottom-centered), so neighbors stack instead of overlapping. */
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    for (const b of this.bubbles) {
      b.age += dt;
      const v = sim.villagers.byId(b.villagerId);
      if (b.age > LIFE || !v?.alive || v.inside) {
        b.el.remove();
        continue;
      }
      this.p.set(v.x - half, v.y + 2.6, v.z - half).project(this.view.camera);
      const visible = this.p.z < 1 && Math.abs(this.p.x) < 1.1 && Math.abs(this.p.y) < 1.1;
      const sx = ((this.p.x + 1) / 2) * canvas.clientWidth;
      let sy = ((1 - this.p.y) / 2) * canvas.clientHeight;
      const w = b.el.offsetWidth;
      const h = b.el.offsetHeight + 4;
      for (let moved = true, n = 0; moved && n < 8; n++) {
        moved = false;
        for (const t of taken) {
          if (Math.abs(t.x - sx) < (t.w + w) / 2 && sy > t.y - t.h && sy - h < t.y) {
            sy = t.y - t.h;
            moved = true;
          }
        }
      }
      if (visible) taken.push({ x: sx, y: sy, w, h });
      // Ease toward the head so tick-by-tick steps don't jitter the text.
      const k = b.placed ? 1 - Math.exp(-dt * 14) : 1;
      b.x += (sx - b.x) * k;
      b.y += (sy - b.y) * k;
      b.placed = true;
      b.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -100%)`;
      b.el.style.opacity = visible ? String(Math.min(1, b.age * 5, (LIFE - b.age) * 1.5)) : '0';
    }
    this.bubbles = this.bubbles.filter((b) => b.el.isConnected);
  }
}
