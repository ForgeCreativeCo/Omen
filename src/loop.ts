import type { Sim } from './sim/Sim';
import { TUNING } from './sim/tuning';

/**
 * Fixed-timestep driver. Converts real elapsed time × speed into whole sim ticks
 * and reports the leftover fraction so the renderer can interpolate.
 */
export class FixedLoop {
  /** Index into TUNING.time.speeds; 0 = paused. */
  speedIndex = 1;
  private accumulator = 0;
  private resumeIndex = 1;

  constructor(private readonly sim: Sim) {}

  get speed(): number {
    return TUNING.time.speeds[this.speedIndex] ?? 0;
  }

  setSpeedIndex(i: number): void {
    const max = TUNING.time.speeds.length - 1;
    this.speedIndex = Math.max(0, Math.min(max, i));
    if (this.speedIndex > 0) this.resumeIndex = this.speedIndex;
  }

  togglePause(): void {
    this.setSpeedIndex(this.speedIndex === 0 ? this.resumeIndex : 0);
  }

  /**
   * Run however many ticks are due for `dtSeconds` of real time.
   * Returns interpolation alpha in [0, 1) between the previous and current tick.
   */
  advance(dtSeconds: number): number {
    const tickSeconds = 1 / TUNING.time.ticksPerSecond;
    this.accumulator += Math.min(dtSeconds, 0.25) * this.speed;
    let ran = 0;
    while (this.accumulator >= tickSeconds && ran < TUNING.time.maxTicksPerFrame) {
      this.sim.step();
      this.accumulator -= tickSeconds;
      ran++;
    }
    // If we hit the cap, drop the backlog instead of spiraling.
    if (ran >= TUNING.time.maxTicksPerFrame) this.accumulator = 0;
    return this.accumulator / tickSeconds;
  }
}
