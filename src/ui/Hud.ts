import type { Sim } from '../sim/Sim';
import { formatCalendar } from '../sim/time';
import type { FixedLoop } from '../loop';
import type { GameRenderer } from '../render/GameRenderer';

/** M1 HUD: calendar, speed controls, island seed, view toggles, perf readout. */
export class Hud {
  private readonly calendarEl: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly villageEl: HTMLElement;
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
        <div class="hud-clock">
          <div class="hud-calendar"></div>
          <div class="hud-countdown" hidden></div>
        </div>
        <div class="hud-speeds"></div>
      </div>
      <div class="hud-panel hud-view">
        <span class="hud-seed" title="Island seed"></span>
        <button class="hud-menu" title="Back to the title">Menu</button>
        <button class="hud-new" title="Generate a new island">New island</button>
        <button class="hud-beliefs" title="Village Beliefs (V)">Beliefs</button>
        <button class="hud-book" title="The Holy Book (H)">Holy Book</button>
        <button class="hud-settings" title="Settings, sound and saving" aria-label="Settings">⚙</button>
        <button class="hud-help" title="Tutorial">?</button>
      </div>
      <div class="hud-panel hud-village"></div>
      <div class="hud-panel hud-fps"></div>`;
    this.calendarEl = root.querySelector('.hud-calendar')!;
    this.countdownEl = root.querySelector('.hud-countdown')!;
    this.statsEl = root.querySelector('.hud-fps')!;
    this.villageEl = root.querySelector('.hud-village')!;
    root.querySelector('.hud-seed')!.textContent = `seed: ${seedLabel}`;

    const speeds = root.querySelector('.hud-speeds')!;
    ['❚❚', '1×', '4×', '16×'].forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => loop.setSpeedIndex(i));
      speeds.appendChild(b);
      this.speedButtons.push(b);
    });

    root.querySelector('.hud-new')!.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('seed', Math.random().toString(36).slice(2, 8));
      url.searchParams.delete('load');
      location.href = url.toString();
    });
    root.querySelector('.hud-menu')!.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('load');
      location.href = url.toString();
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

  /** The Warning's countdown: quiet, then less quiet. */
  private countdown(sim: Sim): void {
    const w = sim.warning;
    this.countdownEl.hidden = !w;
    if (!w) return;
    const phase = w.disaster.phase;
    const left = w.yearsLeft;
    this.countdownEl.textContent =
      phase === 'waiting' ? (left >= 1 ? `the sea · ${Math.ceil(left)} years` : 'the sea · this year') : phase === 'striking' ? 'the sea is rising' : 'the sea has risen';
    this.countdownEl.title = 'Only you know this. When the countdown ends, the sea rises over the valley.';
    this.countdownEl.classList.toggle('near', phase === 'waiting' && left < 10);
    this.countdownEl.classList.toggle('now', phase !== 'waiting');
  }

  update(sim: Sim, dtSeconds: number): void {
    const c = sim.calendar;
    this.calendarEl.textContent = `${formatCalendar(c)} · ${c.timeOfDay}`;
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', i === this.loop.speedIndex));
    const vs = sim.village.store;
    const w = sim.weather;
    const sky = w.precipitation === 'storm' ? 'Storm' : w.raining ? 'Rain' : w.drought ? 'Drought' : '';
    // Average faith with its love / fear split (SPEC §15).
    let love = 0;
    let fear = 0;
    for (const v of sim.villagers.alive) (love += v.faith.love), (fear += v.faith.fear);
    const n = Math.max(1, sim.villagers.alive.length);
    const faith = `<span class="hud-faith" title="Faith: love ${Math.round((love / n) * 100)}%, fear ${Math.round((fear / n) * 100)}%"><small>Faith</small> <i><b style="width:${(love / n) * 100}%"></b><s style="width:${(fear / n) * 100}%"></s></i></span>`;
    this.countdown(sim);
    const stat = (label: string, value: number) => `<span><small>${label}</small> ${Math.floor(value)}</span>`;
    this.villageEl.innerHTML =
      stat('People', sim.villagers.alive.length) +
      stat('Food', vs.food) +
      stat('Wood', vs.wood) +
      stat('Stone', vs.stone) +
      faith +
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
