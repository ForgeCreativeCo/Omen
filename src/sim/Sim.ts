import { Rng } from './rng';
import { calendarAt, type Calendar } from './time';

export interface SimOptions {
  seed: number | string;
}

/**
 * Top-level simulation. Pure TypeScript: no rendering, no DOM, no wall-clock time.
 * Advancing is only ever done through `step()`, one fixed tick at a time.
 */
export class Sim {
  readonly seed: number;
  /** Root stream; systems should take `rng.fork('<system>')` rather than share this. */
  readonly rng: Rng;
  tick = 0;

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.seed = this.rng.seed;
  }

  get calendar(): Calendar {
    return calendarAt(this.tick);
  }

  /** Advance exactly one fixed tick. Systems are ticked here in a fixed order. */
  step(): void {
    this.tick++;
  }
}
