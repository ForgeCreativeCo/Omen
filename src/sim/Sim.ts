import { Rng } from './rng';
import { calendarAt, type Calendar } from './time';
import { generateIsland, type Island } from './world/terrain';
import type { VoxelWorld } from './world/VoxelWorld';

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
  readonly island: Island;
  tick = 0;

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.seed = this.rng.seed;
    this.island = generateIsland(this.rng.fork('terrain'));
  }

  get world(): VoxelWorld {
    return this.island.world;
  }

  get calendar(): Calendar {
    return calendarAt(this.tick);
  }

  /** Advance exactly one fixed tick. Systems are ticked here in a fixed order. */
  step(): void {
    this.tick++;
  }
}
