import type { Rng } from '../rng';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import { M, material } from './materials';
import type { VoxelWorld } from './VoxelWorld';

const F = TUNING.fire;

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
] as const;

export interface FireHost {
  readonly tick: number;
  readonly raining: boolean;
  readonly dryness: number;
  readonly windAngle: number;
  readonly windStrength: number;
  emitFireStarted(x: number, y: number, z: number): void;
}

/**
 * Cellular fire (SPEC §4): burning voxels ignite flammable neighbors with a chance
 * scaled by flammability, dryness and wind; rain douses; burned voxels become
 * their burn result. Ash turns back to grass after a few days (extra fertile meanwhile).
 */
export class Fire {
  /** Burning voxel index → ticks left. Insertion order keeps iteration deterministic. */
  readonly burning = new Map<number, number>();
  /** Ash voxels waiting to regrow: [index, tick when due], in due order. */
  private readonly ash: [number, number][] = [];

  constructor(
    private readonly world: VoxelWorld,
    private readonly rng: Rng,
  ) {}

  key(x: number, y: number, z: number): number {
    return x + this.world.sizeX * (z + this.world.sizeZ * y);
  }

  unkey(k: number): [number, number, number] {
    const sx = this.world.sizeX;
    const sz = this.world.sizeZ;
    return [k % sx, Math.floor(k / (sx * sz)), Math.floor(k / sx) % sz];
  }

  /** Set a voxel alight if it can burn. Returns true if it started burning. */
  ignite(x: number, y: number, z: number): boolean {
    if (this.burning.size >= F.maxBurning) return false;
    const id = this.world.get(x, y, z);
    if (!material(id).flammable) return false;
    const k = this.key(x, y, z);
    if (this.burning.has(k)) return false;
    const [lo, hi] = F.burnTicks;
    this.burning.set(k, this.rng.int(lo!, hi!));
    return true;
  }

  /** Is anything burning within `r` voxels (horizontal) of (x, z)? */
  nearby(x: number, z: number, r: number): { x: number; y: number; z: number } | null {
    for (const k of this.burning.keys()) {
      const [bx, by, bz] = this.unkey(k);
      if (Math.abs(bx - x) <= r && Math.abs(bz - z) <= r) return { x: bx, y: by, z: bz };
    }
    return null;
  }

  step(host: FireHost): void {
    const w = this.world;
    const wx = Math.cos(host.windAngle);
    const wz = Math.sin(host.windAngle);

    if (this.burning.size > 0) {
      const done: number[] = [];
      // Snapshot: voxels ignited this tick start burning next tick.
      for (const [k, left] of [...this.burning]) {
        const [x, y, z] = this.unkey(k);
        // Chopped, built over or otherwise no longer burnable: the flame is gone.
        if (!material(w.get(x, y, z)).flammable || (host.raining && this.rng.chance(F.rainDouse))) {
          done.push(k);
          continue;
        }
        for (const [dx, dy, dz] of DIRS) {
          const nid = w.get(x + dx, y + dy, z + dz);
          const m = material(nid);
          if (!m.flammable) continue;
          // Fire climbs and runs downwind more readily.
          const wind = 1 + host.windStrength * (dx * wx + dz * wz) + (dy > 0 ? 0.5 : 0);
          const p = F.spreadPerTick * m.flammability * host.dryness * Math.max(0.2, wind);
          if (this.rng.chance(p)) this.ignite(x + dx, y + dy, z + dz);
        }
        if (left <= 1) {
          done.push(k);
          const to = material(w.get(x, y, z)).burnsTo ?? M.AIR;
          w.set(x, y, z, to);
          if (to === M.ASH) {
            const [lo, hi] = F.ashRegrowDays;
            this.ash.push([k, host.tick + this.rng.int(lo!, hi!) * TICKS_PER_DAY]);
          }
        } else {
          this.burning.set(k, left - 1);
        }
      }
      for (const k of done) this.burning.delete(k);
    }

    // Ash regrowth: due dates are roughly ordered; check the head.
    while (this.ash.length && (this.ash[0] as [number, number])[1] <= host.tick) {
      const [k] = this.ash.shift()!;
      const [x, y, z] = this.unkey(k);
      if (w.get(x, y, z) === M.ASH && w.get(x, y + 1, z) === M.AIR) w.set(x, y, z, M.GRASS);
    }
  }

  /** Start a fire as a single event (lightning, later miracles). */
  startAt(host: FireHost, x: number, y: number, z: number): boolean {
    const ok = this.ignite(x, y, z);
    if (ok) host.emitFireStarted(x, y, z);
    return ok;
  }
}
