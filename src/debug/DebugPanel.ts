import type { Sim } from '../sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/time';
import type { GameRenderer } from '../render/GameRenderer';

/**
 * Early God's Eye panel (F3, or triple-tap the top-left corner on touch): sim stats
 * and buttons to force weather and skip time. The full interpretation overlay
 * arrives with M4.
 */
export class DebugPanel {
  private readonly el: HTMLElement;
  private readonly statsEl: HTMLElement;
  private timer = 0;
  private lastTick = 0;
  private tickRate = 0;
  private taps: number[] = [];

  constructor(root: HTMLElement, private readonly sim: Sim, private readonly view: GameRenderer) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel debug';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="dbg-title">God's Eye <small>F3</small></div>
      <pre class="dbg-stats"></pre>
      <div class="dbg-buttons">
        <button data-act="rain">Rain</button>
        <button data-act="storm">Storm</button>
        <button data-act="drought">Drought</button>
        <button data-act="bolt">Lightning</button>
        <button data-act="day">+1 day</button>
        <button data-act="year">+1 year</button>
      </div>`;
    this.statsEl = this.el.querySelector('.dbg-stats')!;
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act;
      if (act) this.run(act);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
    // Hidden triple-tap in the top-left corner for touch devices.
    window.addEventListener('pointerdown', (e) => {
      if (e.clientX > 60 || e.clientY > 60) return;
      const now = performance.now();
      this.taps = [...this.taps.filter((t) => now - t < 600), now];
      if (this.taps.length >= 3) {
        this.taps = [];
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  /** Debug actions mutate the sim directly; that's the point of them. */
  private run(act: string): void {
    const sim = this.sim;
    switch (act) {
      case 'rain':
        sim.weather.startRain(sim, false);
        break;
      case 'storm':
        sim.weather.startRain(sim, true);
        break;
      case 'drought':
        sim.weather.startDrought(sim);
        break;
      case 'bolt':
        sim.naturalLightning();
        break;
      case 'day':
        for (let i = 0; i < TICKS_PER_DAY; i++) sim.step();
        break;
      case 'year':
        for (let i = 0; i < TICKS_PER_YEAR; i++) sim.step();
        break;
    }
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.el.hidden || this.timer < 0.5) return;
    this.tickRate = (this.sim.tick - this.lastTick) / this.timer;
    this.lastTick = this.sim.tick;
    this.timer = 0;
    const s = this.sim;
    const v = s.village;
    const roles: Record<string, number> = {};
    for (const p of s.villagers.alive) roles[p.role] = (roles[p.role] ?? 0) + 1;
    const r = this.view.stats;
    this.statsEl.textContent = [
      `tick ${s.tick}  (${this.tickRate.toFixed(0)}/s)`,
      `draw ${r.drawCalls}  tris ${(r.triangles / 1000).toFixed(0)}k  res ${r.pixelRatio}×`,
      `villagers ${s.villagers.alive.length}  (${Object.entries(roles).map(([k, n]) => `${k} ${n}`).join(', ')})`,
      `huts ${v.huts.filter((h) => v.usableHut(h)).length}/${v.huts.length}  fields ${v.fields.length}  trees ${v.trees.filter((t) => t.alive).length}`,
      `food ${v.store.food.toFixed(0)}  wood ${v.store.wood.toFixed(0)}  stone ${v.store.stone.toFixed(0)}`,
      `weather ${s.weather.precipitation}${s.weather.drought ? ' + drought' : ''}  moisture ${s.weather.moisture.toFixed(2)}  dryness ${s.weather.dryness.toFixed(2)}`,
      `burning ${s.fire.burning.size}  paths ${s.villagers.pathfinder.searches}`,
    ].join('\n');
  }
}
