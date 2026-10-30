import type { Sim } from '../sim/Sim';
import { formatCalendar } from '../sim/time';
import type { FixedLoop } from '../loop';
import type { GameRenderer } from '../render/GameRenderer';

/** M1 HUD: calendar, speed controls, island seed, view toggles, perf readout. */
export class Hud {
  private readonly calendarEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly villageEl: HTMLElement;
  private readonly tiltBtn: HTMLButtonElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private frames = 0;
  private fpsTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly loop: FixedLoop,
    private readonly view: GameRenderer,
    seedLabel: string,
  ) {
    root.innerHTML = `
      <div class="hud-panel hud-time">
        <div class="hud-calendar"></div>
        <div class="hud-speeds"></div>
      </div>
      <div class="hud-panel hud-view">
        <span class="hud-seed" title="Island seed"></span>
        <button class="hud-new" title="Generate a new island">New island</button>
        <button class="hud-tilt" title="Tilt-shift (T)">Tilt-shift</button>
      </div>
      <div class="hud-panel hud-village"></div>
      <div class="hud-panel hud-fps"></div>`;
    this.calendarEl = root.querySelector('.hud-calendar')!;
    this.statsEl = root.querySelector('.hud-fps')!;
    this.villageEl = root.querySelector('.hud-village')!;
    this.tiltBtn = root.querySelector('.hud-tilt')!;
    root.querySelector('.hud-seed')!.textContent = `seed: ${seedLabel}`;

    const speeds = root.querySelector('.hud-speeds')!;
    ['❚❚', '1×', '4×', '16×'].forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => loop.setSpeedIndex(i));
      speeds.appendChild(b);
      this.speedButtons.push(b);
    });

    this.tiltBtn.addEventListener('click', () => this.toggleTilt());
    root.querySelector('.hud-new')!.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('seed', Math.random().toString(36).slice(2, 8));
      location.href = url.toString();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        loop.togglePause();
      } else if (e.key >= '1' && e.key <= '4') {
        // 1 = pause … 4 = 16×, matching the button order
        loop.setSpeedIndex(Number(e.key) - 1);
      } else if (e.code === 'KeyT') {
        this.toggleTilt();
      }
    });
  }

  private toggleTilt(): void {
    this.view.post.enabled = !this.view.post.enabled;
  }

  update(sim: Sim, dtSeconds: number): void {
    const c = sim.calendar;
    this.calendarEl.textContent = `${formatCalendar(c)} · ${c.timeOfDay}`;
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', i === this.loop.speedIndex));
    this.tiltBtn.classList.toggle('active', this.view.post.enabled);
    const vs = sim.village.store;
    const w = sim.weather;
    const sky = w.precipitation === 'storm' ? 'Storm' : w.raining ? 'Rain' : w.drought ? 'Drought' : '';
    const stat = (label: string, value: number) => `<span><small>${label}</small> ${Math.floor(value)}</span>`;
    this.villageEl.innerHTML =
      stat('People', sim.villagers.alive.length) +
      stat('Food', vs.food) +
      stat('Wood', vs.wood) +
      stat('Stone', vs.stone) +
      (sky ? `<span class="hud-sky">${sky}</span>` : '');

    this.frames++;
    this.fpsTimer += dtSeconds;
    if (this.fpsTimer >= 0.5) {
      const s = this.view.stats;
      this.statsEl.textContent =
        `${Math.round(this.frames / this.fpsTimer)} fps · ${s.drawCalls} calls · ` +
        `${(s.triangles / 1000).toFixed(0)}k tris · ${s.pixelRatio}× res · tick ${sim.tick}`;
      this.frames = 0;
      this.fpsTimer = 0;
    }
  }
}
