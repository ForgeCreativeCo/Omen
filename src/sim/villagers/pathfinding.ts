import { NEIGHBORS8, type NavGrid } from '../world/nav';

export interface PathOptions {
  /** Succeed on reaching any walkable cell within Chebyshev distance 1 of the goal. */
  adjacent?: boolean;
  maxExpand: number;
}

const SQRT2 = Math.SQRT2;

/**
 * A* over the nav grid with 8-way moves (diagonals only when both orthogonal
 * neighbors are steppable, so agents never cut wall corners). Buffers are reused
 * between searches; a generation stamp avoids clearing them.
 */
export class Pathfinder {
  private readonly g: Float32Array;
  private readonly came: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  // Binary heap of (f, node).
  private heapNode: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  /** Searches run (for stats). */
  searches = 0;

  constructor(private readonly nav: NavGrid) {
    const n = nav.sizeX * nav.sizeZ;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    // Nodes can be pushed more than once (lazy decrease-key), so leave room.
    this.heapNode = new Int32Array(n * 8);
    this.heapF = new Float32Array(n * 8);
  }

  /** Returns the cell indices from start (exclusive) to goal (inclusive), [] if already there, or null. */
  find(sx: number, sz: number, tx: number, tz: number, opts: PathOptions): number[] | null {
    const nav = this.nav;
    this.searches++;
    if (!nav.walkable(sx, sz)) return null;
    const W = nav.sizeX;
    const start = sx + sz * W;
    const isGoal = (x: number, z: number) =>
      (x === tx && z === tz) || (opts.adjacent === true && Math.abs(x - tx) <= 1 && Math.abs(z - tz) <= 1);
    if (isGoal(sx, sz)) return [];
    if (!opts.adjacent && !nav.walkable(tx, tz)) return null;

    this.gen = (this.gen + 1) >>> 0;
    const gen = this.gen;
    this.heapSize = 0;
    const h = (x: number, z: number) => {
      const dx = Math.abs(x - tx);
      const dz = Math.abs(z - tz);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    this.stamp[start] = gen;
    this.g[start] = 0;
    this.came[start] = -1;
    this.push(start, h(sx, sz));

    let expanded = 0;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const cx = cur % W;
      const cz = (cur / W) | 0;
      if (isGoal(cx, cz)) return this.rebuild(cur);
      if (++expanded > opts.maxExpand) return null;
      const gc = this.g[cur] as number;

      for (let i = 0; i < 8; i++) {
        const [dx, dz] = NEIGHBORS8[i]!;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!nav.canStep(cx, cz, nx, nz)) continue;
        if (dx !== 0 && dz !== 0 && (!nav.canStep(cx, cz, nx, cz) || !nav.canStep(cx, cz, cx, nz))) continue;
        const n = nx + nz * W;
        if (this.closed[n] === gen) continue;
        const climb = nav.at(nx, nz) !== nav.at(cx, cz) ? 0.3 : 0;
        const ng = gc + (dx !== 0 && dz !== 0 ? SQRT2 : 1) + climb + (nav.cost[n] as number);
        if (this.stamp[n] === gen && ng >= (this.g[n] as number)) continue;
        this.stamp[n] = gen;
        this.g[n] = ng;
        this.came[n] = cur;
        this.push(n, ng + h(nx, nz));
      }
    }
    return null;
  }

  private rebuild(end: number): number[] {
    const path: number[] = [];
    for (let c = end; this.came[c] !== -1; c = this.came[c] as number) path.push(c);
    return path.reverse();
  }

  private push(node: number, f: number): void {
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.heapF[p] as number) <= f) break;
      this.heapF[i] = this.heapF[p] as number;
      this.heapNode[i] = this.heapNode[p] as number;
      i = p;
    }
    this.heapF[i] = f;
    this.heapNode[i] = node;
  }

  private pop(): number {
    const top = this.heapNode[0] as number;
    const n = --this.heapSize;
    const f = this.heapF[n] as number;
    const node = this.heapNode[n] as number;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && (this.heapF[c + 1] as number) < (this.heapF[c] as number)) c++;
      if ((this.heapF[c] as number) >= f) break;
      this.heapF[i] = this.heapF[c] as number;
      this.heapNode[i] = this.heapNode[c] as number;
      i = c;
    }
    this.heapF[i] = f;
    this.heapNode[i] = node;
    return top;
  }
}
