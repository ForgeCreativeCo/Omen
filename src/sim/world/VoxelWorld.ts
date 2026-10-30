import { M, isSolid, type MaterialId } from './materials';

/**
 * Chunked voxel storage. Chunks are cubes of `chunkSize`, each a Uint8Array of
 * material IDs, allocated lazily (an all-air chunk is null).
 *
 * Every edit bumps a per-chunk version (and neighbors' when on a border, since
 * their faces and AO depend on it). Renderers compare versions to find what to
 * re-mesh, so they never need to write to the world.
 */
export class VoxelWorld {
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunksZ: number;
  private readonly chunks: (Uint8Array | null)[];
  readonly chunkVersions: Uint32Array;
  /** Called after every effective voxel change (nav grid, structures, etc.). */
  readonly listeners: ((x: number, y: number, z: number, from: MaterialId, to: MaterialId) => void)[] = [];

  constructor(
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
    readonly chunkSize: number,
  ) {
    this.chunksX = Math.ceil(sizeX / chunkSize);
    this.chunksY = Math.ceil(sizeY / chunkSize);
    this.chunksZ = Math.ceil(sizeZ / chunkSize);
    const n = this.chunksX * this.chunksY * this.chunksZ;
    this.chunks = new Array<Uint8Array | null>(n).fill(null);
    this.chunkVersions = new Uint32Array(n);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return (cy * this.chunksZ + cz) * this.chunksX + cx;
  }

  /** Out-of-bounds reads return AIR. */
  get(x: number, y: number, z: number): MaterialId {
    if (!this.inBounds(x, y, z)) return M.AIR;
    const s = this.chunkSize;
    const chunk = this.chunks[this.chunkIndex((x / s) | 0, (y / s) | 0, (z / s) | 0)];
    if (!chunk) return M.AIR;
    return chunk[((y % s) * s + (z % s)) * s + (x % s)] as MaterialId;
  }

  set(x: number, y: number, z: number, id: MaterialId): void {
    if (!this.inBounds(x, y, z)) return;
    const s = this.chunkSize;
    const cx = (x / s) | 0;
    const cy = (y / s) | 0;
    const cz = (z / s) | 0;
    const ci = this.chunkIndex(cx, cy, cz);
    let chunk = this.chunks[ci];
    if (!chunk) {
      if (id === M.AIR) return;
      chunk = new Uint8Array(s * s * s);
      this.chunks[ci] = chunk;
    }
    const li = ((y % s) * s + (z % s)) * s + (x % s);
    const old = chunk[li] as MaterialId;
    if (old === id) return;
    chunk[li] = id;
    for (const fn of this.listeners) fn(x, y, z, old, id);
    this.touch(cx, cy, cz);
    const lx = x % s, ly = y % s, lz = z % s;
    if (lx === 0) this.touch(cx - 1, cy, cz);
    if (lx === s - 1) this.touch(cx + 1, cy, cz);
    if (ly === 0) this.touch(cx, cy - 1, cz);
    if (ly === s - 1) this.touch(cx, cy + 1, cz);
    if (lz === 0) this.touch(cx, cy, cz - 1);
    if (lz === s - 1) this.touch(cx, cy, cz + 1);
  }

  private touch(cx: number, cy: number, cz: number): void {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.chunksX || cy >= this.chunksY || cz >= this.chunksZ) return;
    const i = this.chunkIndex(cx, cy, cz);
    this.chunkVersions[i] = ((this.chunkVersions[i] as number) + 1) >>> 0;
  }

  /** Sum of chunk versions in a vertical column; changes whenever anything in it changes. */
  columnVersion(cx: number, cz: number): number {
    let v = 0;
    for (let cy = 0; cy < this.chunksY; cy++) v = (v + (this.chunkVersions[this.chunkIndex(cx, cy, cz)] as number)) >>> 0;
    return v;
  }

  /** Highest y in the column matching `pred`, or -1. */
  topY(x: number, z: number, pred: (id: MaterialId) => boolean = isSolid): number {
    for (let y = this.sizeY - 1; y >= 0; y--) if (pred(this.get(x, y, z))) return y;
    return -1;
  }

  /** Raw chunk access for meshers and serialization. */
  chunkData(cx: number, cy: number, cz: number): Uint8Array | null {
    return this.chunks[this.chunkIndex(cx, cy, cz)] ?? null;
  }
}
