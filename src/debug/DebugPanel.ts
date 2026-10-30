import { PERSONALITIES, type PriestPersonality } from '../sim/belief/catalog';
import { featureLabel } from '../sim/omens/context';
import type { Sim } from '../sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../sim/time';
import type { GameRenderer } from '../render/GameRenderer';
import { describeOmen } from '../ui/describe';

const GRAPH_COLORS = ['#ffd36e', '#8fd3ff', '#f28b82', '#b4e38a', '#d7aefb', '#fdba74'];

/**
 * God's Eye (SPEC §15; F3, or triple-tap the top-left corner): the truth behind the
 * villagers' beliefs. Salience table for the latest omen, lines to its witnesses,
 * belief history, sim stats, and tools to force events and switch the priest.
 */
export class DebugPanel {
  private readonly el: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly omenEl: HTMLElement;
  private readonly graph: HTMLCanvasElement;
  private readonly legend: HTMLElement;
  private timer = 0;
  private lastTick = 0;
  private tickRate = 0;
  private taps: number[] = [];
  private lastOmen = '';

  constructor(root: HTMLElement, private readonly sim: Sim, private readonly view: GameRenderer) {
    this.el = document.createElement('div');
    this.el.className = 'hud-panel debug';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="dbg-title">God's Eye <small>F3</small></div>
      <pre class="dbg-stats"></pre>
      <div class="dbg-omen"></div>
      <div class="dbg-sub">Belief strength (days)</div>
      <canvas class="dbg-graph" width="380" height="90"></canvas>
      <div class="dbg-legend"></div>
      <div class="dbg-sub">Priest</div>
      <div class="dbg-buttons">${PERSONALITIES.map((p) => `<button data-priest="${p}">${p}</button>`).join('')}</div>
      <div class="dbg-sub">Force</div>
      <div class="dbg-buttons">
        <button data-act="rain">Rain</button>
        <button data-act="storm">Storm</button>
        <button data-act="drought">Drought</button>
        <button data-act="bolt">Lightning</button>
        <button data-act="omen">Omen near village</button>
        <button data-act="day">+1 day</button>
        <button data-act="year">+1 year</button>
      </div>`;
    this.statsEl = this.el.querySelector('.dbg-stats')!;
    this.omenEl = this.el.querySelector('.dbg-omen')!;
    this.graph = this.el.querySelector('.dbg-graph')!;
    this.legend = this.el.querySelector('.dbg-legend')!;
    root.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.act) this.run(t.dataset.act);
      if (t.dataset.priest) this.sim.belief.setPersonality(t.dataset.priest as PriestPersonality);
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

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    this.view.witnessLines.visible = !this.el.hidden;
    this.lastOmen = '';
    this.timer = 1;
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
      case 'omen': {
        // A natural strike just outside the village, where everyone can see it.
        const c = sim.village.center;
        const a = (sim.tick % 360) * (Math.PI / 180);
        sim.strikeLightning(Math.round(c.x + Math.cos(a) * 9), Math.round(c.z + Math.sin(a) * 9), false);
        break;
      }
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
    this.renderStats();
    this.renderOmen();
    this.renderGraph();
  }

  private renderStats(): void {
    const s = this.sim;
    const v = s.village;
    const r = this.view.stats;
    this.statsEl.textContent = [
      `tick ${s.tick} (${this.tickRate.toFixed(0)}/s)  draw ${r.drawCalls}  tris ${(r.triangles / 1000).toFixed(0)}k  res ${r.pixelRatio}×`,
      `villagers ${s.villagers.alive.length}  huts ${v.huts.filter((h) => v.usableHut(h)).length}/${v.huts.length}  fields ${v.fields.length}  food ${v.store.food.toFixed(0)}`,
      `weather ${s.weather.precipitation}${s.weather.drought ? '+drought' : ''}  burning ${s.fire.burning.size}  omens ${s.belief.omens.length}  beliefs ${s.belief.beliefs.size}`,
    ].join('\n');
  }

  private renderOmen(): void {
    const sim = this.sim;
    const a = sim.belief.lastAnalysis;
    const omen = a ? sim.belief.omens.find((o) => o.id === a.omenId) : sim.belief.omens.at(-1);
    if (!omen) {
      this.omenEl.innerHTML = '<div class="dbg-sub">No omens yet.</div>';
      return;
    }
    if (omen.id === this.lastOmen) return;
    this.lastOmen = omen.id;
    const truth = omen.isDivine ? '<b class="divine">divine</b>' : '<b>natural</b>';
    const aim = omen.aim ? ` · aimed at (${omen.aim.x}, ${omen.aim.z}), struck (${omen.position.x}, ${omen.position.z})` : '';
    const outcomes = omen.outcomes.map((o) => o.type).join(', ') || 'none';
    const rows = (a?.omenId === omen.id ? a.rows : [])
      .slice(0, 10)
      .map((r, i) => {
        const f = r.feature;
        return `<tr class="${i === 0 ? 'win' : ''}"><td>${featureLabel(sim, f.key)}<small> ${f.category}</small></td><td>${f.intensity.toFixed(2)}</td><td>${r.proximity.toFixed(2)}</td><td>${r.recency.toFixed(2)}</td><td>${r.novelty.toFixed(2)}</td><td>${r.categoryWeight.toFixed(1)}</td><td>${r.priest.toFixed(2)}</td><td><b>${r.score.toFixed(3)}</b></td></tr>`;
      })
      .join('');
    const readings = (a?.omenId === omen.id ? a.readings : [])
      .slice(0, 4)
      .map((x) => {
        const b = sim.belief.beliefs.get(x.key);
        return `<li>${x.count} × ${b ? sim.belief.statement(b) : x.key}</li>`;
      })
      .join('');
    this.omenEl.innerHTML = `
      <div class="dbg-sub">Latest omen · ${truth} · ${omen.witnesses.length} witnesses${aim}</div>
      <div class="dbg-omen-what">${describeOmen(sim, omen)} <small>(outcomes: ${outcomes}${a?.omenId === omen.id ? ` · mean valence ${a.meanValence.toFixed(2)}` : ''})</small></div>
      ${rows ? `<table class="dbg-salience"><tr><th>feature</th><th>int</th><th>prox</th><th>rec</th><th>nov</th><th>cat</th><th>priest</th><th>score</th></tr>${rows}</table>` : ''}
      ${readings ? `<div class="dbg-sub">They concluded</div><ul class="dbg-readings">${readings}</ul>` : ''}`;
  }

  private renderGraph(): void {
    const sim = this.sim;
    const g = this.graph.getContext('2d')!;
    const W = this.graph.width;
    const H = this.graph.height;
    g.clearRect(0, 0, W, H);
    // Threshold guides at 0.3 and 0.6.
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.setLineDash([3, 3]);
    for (const t of [0.3, 0.6]) {
      g.beginPath();
      g.moveTo(0, H - t * H);
      g.lineTo(W, H - t * H);
      g.stroke();
    }
    g.setLineDash([]);
    const top = [...sim.belief.beliefs.values()].filter((b) => b.history.length > 1).sort((a, b) => b.strength - a.strength).slice(0, 6);
    top.forEach((b, i) => {
      const h = b.history;
      g.strokeStyle = GRAPH_COLORS[i]!;
      g.lineWidth = 1.5;
      g.beginPath();
      h.forEach((s, k) => {
        const x = (k / Math.max(1, h.length - 1)) * W;
        const y = H - s * H;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    });
    this.legend.innerHTML = top
      .map((b, i) => `<div><i style="background:${GRAPH_COLORS[i]}"></i>${sim.belief.statement(b)}</div>`)
      .join('');
  }
}
