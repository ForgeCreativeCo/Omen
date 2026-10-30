import type { Sim } from '../sim/Sim';
import { formatCalendar } from '../sim/time';
import type { FixedLoop } from '../loop';

/** Minimal M0 HUD: calendar, time-of-day, speed controls, FPS. */
export class Hud {
  private readonly calendarEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private frames = 0;
  private fpsTimer = 0;

  constructor(root: HTMLElement, private readonly loop: FixedLoop) {
    root.innerHTML = `
      <div class="hud-panel hud-time">
        <div class="hud-calendar"></div>
        <div class="hud-speeds"></div>
      </div>
      <div class="hud-panel hud-fps"></div>`;
    this.calendarEl = root.querySelector('.hud-calendar')!;
    this.fpsEl = root.querySelector('.hud-fps')!;
    const speeds = root.querySelector('.hud-speeds')!;
    ['❚❚', '1×', '4×', '16×'].forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => loop.setSpeedIndex(i));
      speeds.appendChild(b);
      this.speedButtons.push(b);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        loop.togglePause();
      } else if (e.key >= '1' && e.key <= '4') {
        // 1 = pause … 4 = 16×, matching the button order
        loop.setSpeedIndex(Number(e.key) - 1);
      }
    });
  }

  update(sim: Sim, dtSeconds: number): void {
    const c = sim.calendar;
    this.calendarEl.textContent = `${formatCalendar(c)} · ${c.timeOfDay}`;
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', i === this.loop.speedIndex));

    this.frames++;
    this.fpsTimer += dtSeconds;
    if (this.fpsTimer >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsTimer)} fps · tick ${sim.tick}`;
      this.frames = 0;
      this.fpsTimer = 0;
    }
  }
}
