import { MATERIALS, M } from './materials';
import type { VoxelWorld } from './VoxelWorld';

const STANDABLE = Uint8Array.from(MATERIALS, (m) => (m.walkable ? 1 : 0));
const PASSABLE = Uint8Array.from(MATERIALS, (m) => (m.passable ? 1 : 0));

/**
 * 2D walkable surface derived from voxel tops (SPEC §5). For each column, `height`
 * is the y of the voxel a villager stands on (feet at height + 1), or -1 when the
 * column can't be stood in: water, tree trunks, building walls, no headroom.
 * Kept up to date through the world's change listener.
 */
export class NavGrid {
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly height: Int16Array;
  /** Extra path cost per cell (beliefs will add to this, e.g. cursed ground). */
  readonly cost: Float32Array;
  /** Cells closed to walking regardless of voxels (fire pits, wells). */
  readonly blocked: Uint8Array;
  /** Bumped whenever any column's height changes; lets agents notice stale paths. */
  version = 0;

  constructor(private readonly world: VoxelWorld) {
    this.sizeX = world.sizeX;
    this.sizeZ = world.sizeZ;
    this.height = new Int16Array(this.sizeX * this.sizeZ);
    this.cost = new Float32Array(this.sizeX * this.sizeZ);
    this.blocked = new Uint8Array(this.sizeX * this.sizeZ);
    for (let z = 0; z < this.sizeZ; z++) for (let x = 0; x < this.sizeX; x++) this.recompute(x, z);
    world.listeners.push((x, _y, z) => this.recompute(x, z));
  }

  index(x: number, z: number): number {
    return x + z * this.sizeX;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.sizeX && z < this.sizeZ;
  }

  /** Stand height at (x, z), or -1 if not walkable / out of bounds. */
  at(x: number, z: number): number {
    if (!this.inBounds(x, z)) return -1;
    const k = x + z * this.sizeX;
    return this.blocked[k] ? -1 : (this.height[k] as number);
  }

  walkable(x: number, z: number): boolean {
    return this.at(x, z) >= 0;
  }

  /** Can a villager step directly between these two adjacent cells? */
  canStep(ax: number, az: number, bx: number, bz: number): boolean {
    const ha = this.at(ax, az);
    const hb = this.at(bx, bz);
    return ha >= 0 && hb >= 0 && Math.abs(ha - hb) <= 1;
  }

  /** Close or reopen a cell to walking. */
  setBlocked(x: number, z: number, blocked: boolean): void {
    if (!this.inBounds(x, z)) return;
    this.blocked[x + z * this.sizeX] = blocked ? 1 : 0;
    this.version++;
  }

  private recompute(x: number, z: number): void {
    const w = this.world;
    let h = -1;
    for (let y = w.sizeY - 1; y >= 0; y--) {
      const id = w.get(x, y, z);
      if (PASSABLE[id]) continue;
      if (STANDABLE[id] && PASSABLE[w.get(x, y + 1, z)] && PASSABLE[w.get(x, y + 2, z)]) h = y;
      // Anything else (water, trunks, walls, embers) blocks the column.
      if (id === M.WATER) h = -1;
      break;
    }
    const k = x + z * this.sizeX;
    if (this.height[k] !== h) {
      this.height[k] = h;
      this.version++;
    }
  }

  /** Label connected walkable regions; returns per-cell region id (0 = none). */
  regions(): Int32Array {
    const label = new Int32Array(this.sizeX * this.sizeZ);
    const stack: number[] = [];
    let next = 0;
    for (let k = 0; k < label.length; k++) {
      if (label[k] || (this.height[k] as number) < 0 || this.blocked[k]) continue;
      next++;
      label[k] = next;
      stack.push(k);
      while (stack.length) {
        const c = stack.pop()!;
        const x = c % this.sizeX;
        const z = (c / this.sizeX) | 0;
        for (const [dx, dz] of NEIGHBORS4) {
          const nx = x + dx;
          const nz = z + dz;
          if (!this.canStep(x, z, nx, nz)) continue;
          const n = nx + nz * this.sizeX;
          if (label[n]) continue;
          label[n] = next;
          stack.push(n);
        }
      }
    }
    return label;
  }
}

export const NEIGHBORS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export const NEIGHBORS8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
