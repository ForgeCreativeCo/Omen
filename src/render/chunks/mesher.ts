import { M, MATERIALS } from '../../sim/world/materials';
import type { VoxelWorld } from '../../sim/world/VoxelWorld';

/**
 * Builds plain typed-array geometry for one vertical column of chunks
 * (chunkSize × sizeY × chunkSize). Kept free of three.js so it can be tested
 * headless. Culls hidden faces, bakes per-vertex AO and ±4% color jitter.
 *
 * Meshing whole columns rather than single 16³ chunks keeps draw calls at
 * one opaque + one water mesh per column (≤ 64 each for the full island).
 *
 * Hot path: the column plus a one-voxel border is copied into a padded local
 * buffer first, so neighbor and AO lookups are plain array reads.
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Per-vertex 0..1 weight for the season foliage tint. */
  tint: Float32Array;
  indices: Uint32Array;
}

export interface ColumnMesh {
  opaque: MeshData | null;
  water: MeshData | null;
}

/** sRGB hex → linear RGB triple (three.js expects linear vertex colors). */
function hexToLinear(hex: number): [number, number, number] {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

const LINEAR = MATERIALS.map((m) => hexToLinear(m.color));
const SOLID = Uint8Array.from(MATERIALS, (m) => (m.solid ? 1 : 0));
const TINT = MATERIALS.map((m) => m.seasonTint);
const DECOR = Uint8Array.from(MATERIALS, (m) => (m.decor ? 1 : 0));
const SHORE_FOAM = hexToLinear(0xa9d4e0);

/** AO level (0 = fully occluded … 3 = open) → brightness. */
const AO_CURVE = [0.5, 0.68, 0.84, 1];
const JITTER = 0.04;
const PATCH = 0.06;
const WATER_DROP = 0.18;

/** Fast deterministic per-voxel hash in [0, 1). */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Face {
  n: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
}

// u × v = n for every face, so corners (-,-) (+,-) (+,+) (-,+) wind counter-clockwise.
const FACES: Face[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Growable typed-array geometry sink. */
class Builder {
  private pos = new Float32Array(4096 * 3);
  private nor = new Float32Array(4096 * 3);
  private col = new Float32Array(4096 * 3);
  private tnt = new Float32Array(4096);
  private idx = new Uint32Array(4096 * 1.5);
  private verts = 0;
  private indices = 0;

  private grow(): void {
    const g = <T extends Float32Array | Uint32Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(a.length * 2);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos);
    this.nor = g(this.nor);
    this.col = g(this.col);
    this.tnt = g(this.tnt);
    this.idx = g(this.idx);
  }

  /** Append a quad; corners are packed xyz in `v` (12 numbers), ao is 4 levels. */
  quad(v: Float32Array, n: readonly number[], r: number, g: number, b: number, ao: Uint8Array, tint: number): void {
    if ((this.verts + 4) * 3 > this.pos.length) this.grow();
    const base = this.verts;
    for (let i = 0; i < 4; i++) {
      const o = (base + i) * 3;
      this.pos[o] = v[i * 3]!;
      this.pos[o + 1] = v[i * 3 + 1]!;
      this.pos[o + 2] = v[i * 3 + 2]!;
      this.nor[o] = n[0]!;
      this.nor[o + 1] = n[1]!;
      this.nor[o + 2] = n[2]!;
      const k = AO_CURVE[ao[i]!]!;
      this.col[o] = r * k;
      this.col[o + 1] = g * k;
      this.col[o + 2] = b * k;
      this.tnt[base + i] = tint;
    }
    this.verts += 4;
    const ix = this.idx;
    let p = this.indices;
    // Flip the diagonal so AO interpolates without the classic seam.
    if (ao[0]! + ao[2]! < ao[1]! + ao[3]!) {
      ix[p++] = base + 1; ix[p++] = base + 2; ix[p++] = base + 3;
      ix[p++] = base + 1; ix[p++] = base + 3; ix[p++] = base;
    } else {
      ix[p++] = base; ix[p++] = base + 1; ix[p++] = base + 2;
      ix[p++] = base; ix[p++] = base + 2; ix[p++] = base + 3;
    }
    this.indices = p;
  }

  build(): MeshData | null {
    if (this.indices === 0) return null;
    return {
      positions: this.pos.slice(0, this.verts * 3),
      normals: this.nor.slice(0, this.verts * 3),
      colors: this.col.slice(0, this.verts * 3),
      tint: this.tnt.slice(0, this.verts),
      indices: this.idx.slice(0, this.indices),
    };
  }
}

/** Everything a mesher needs about one column; plain data, so it can cross to a worker. */
export interface ColumnVoxels {
  /** Padded copy: local (x, y, z) in [-1, size] × [-1, height] × [-1, size]. */
  vox: Uint8Array;
  size: number;
  height: number;
  x0: number;
  z0: number;
}

export function copyColumn(world: VoxelWorld, cx: number, cz: number): ColumnVoxels {
  const s = world.chunkSize;
  const H = world.sizeY;
  const x0 = cx * s;
  const z0 = cz * s;
  const strideZ = s + 2;
  const strideY = strideZ * (s + 2);
  const vox = new Uint8Array(strideY * (H + 2));
  for (let y = -1; y <= H; y++)
    for (let z = -1; z <= s; z++)
      for (let x = -1; x <= s; x++)
        vox[(y + 1) * strideY + (z + 1) * strideZ + (x + 1)] = world.get(x0 + x, y, z0 + z);
  return { vox, size: s, height: H, x0, z0 };
}

/** Halving factor for distant terrain. */
export const LOD = 2;
const DECOR_OR_AIR = Uint8Array.from(MATERIALS, (m) => (m.id === M.AIR || m.decor ? 1 : 0));

/**
 * A distant-terrain column: every LOD³ block of voxels becomes one, so a column
 * of `chunkSize` LOD cells covers LOD×LOD real columns at an eighth of the
 * voxels. A block is solid if enough of it is (its color is the topmost solid
 * voxel's, so grass stays on top and canopies stay green); else water if any;
 * else air. Coordinates come out in LOD units: scale the mesh by LOD.
 */
export function copyColumnLod(world: VoxelWorld, lcx: number, lcz: number): ColumnVoxels {
  const s = world.chunkSize;
  const H = Math.ceil(world.sizeY / LOD);
  const x0 = lcx * s;
  const z0 = lcz * s;
  const strideZ = s + 2;
  const strideY = strideZ * (s + 2);
  const vox = new Uint8Array(strideY * (H + 2));
  for (let z = -1; z <= s; z++)
    for (let x = -1; x <= s; x++) {
      const rx = (x0 + x) * LOD;
      const rz = (z0 + z) * LOD;
      for (let y = 0; y < H; y++) {
        let solid = 0;
        let water = 0;
        let top: number = M.AIR;
        for (let dy = LOD - 1; dy >= 0; dy--)
          for (let dz = 0; dz < LOD; dz++)
            for (let dx = 0; dx < LOD; dx++) {
              const id = world.get(rx + dx, y * LOD + dy, rz + dz);
              if (id === M.WATER) water++;
              else if (!DECOR_OR_AIR[id] && SOLID[id]) {
                solid++;
                if (top === M.AIR) top = id;
              }
            }
        vox[(y + 1) * strideY + (z + 1) * strideZ + (x + 1)] = solid >= 3 ? top : water ? M.WATER : solid ? top : M.AIR;
      }
    }
  return { vox, size: s, height: H, x0, z0 };
}

export function meshColumn(world: VoxelWorld, cx: number, cz: number): ColumnMesh {
  return meshVoxels(copyColumn(world, cx, cz));
}

export function meshVoxels(col: ColumnVoxels): ColumnMesh {
  const { vox, size: s, height: H, x0, z0 } = col;
  const strideZ = s + 2;
  const strideY = strideZ * (s + 2);
  const at = (x: number, y: number, z: number) => (y + 1) * strideY + (z + 1) * strideZ + (x + 1);
  const offset = (d: readonly number[]) => d[1]! * strideY + d[2]! * strideZ + d[0]!;

  // Precomputed per-face index offsets: neighbor, and per corner (side1, side2, corner).
  const faceData = FACES.map((f) => ({
    f,
    n: offset(f.n),
    corners: CORNERS.map(([du, dv]) => {
      const u = [f.u[0] * du, f.u[1] * du, f.u[2] * du];
      const v = [f.v[0] * dv, f.v[1] * dv, f.v[2] * dv];
      return {
        s1: offset(u),
        s2: offset(v),
        c: offset([u[0]! + v[0]!, u[1]! + v[1]!, u[2]! + v[2]!]),
        // Vertex position relative to the voxel's min corner.
        px: 0.5 + 0.5 * (f.n[0] + u[0]! + v[0]!),
        py: 0.5 + 0.5 * (f.n[1] + u[1]! + v[1]!),
        pz: 0.5 + 0.5 * (f.n[2] + u[2]! + v[2]!),
      };
    }),
  }));

  const opaque = new Builder();
  const water = new Builder();
  const verts = new Float32Array(12);
  const ao = new Uint8Array(4);
  const fullAo = Uint8Array.of(3, 3, 3, 3);

  for (let y = 0; y < H; y++) {
    for (let lz = 0; lz < s; lz++) {
      for (let lx = 0; lx < s; lx++) {
        const i = at(lx, y, lz);
        const id = vox[i]!;
        if (id === M.AIR) continue;
        const x = x0 + lx;
        const z = z0 + lz;

        if (DECOR[id]) {
          // Flowers: a small cube sitting on the ground, all six faces, no AO.
          const base = LINEAR[id]!;
          const j = 1 + (hash3(x, y, z) * 2 - 1) * 0.12;
          const s = 0.18;
          const ox = x + 0.5 + (hash3(z, y, x) - 0.5) * 0.4;
          const oz = z + 0.5 + (hash3(y, x, z) - 0.5) * 0.4;
          const h = 0.3;
          for (const fd of faceData) {
            for (let k = 0; k < 4; k++) {
              const c = fd.corners[k]!;
              verts[k * 3] = ox + (c.px - 0.5) * 2 * s;
              verts[k * 3 + 1] = y + c.py * h;
              verts[k * 3 + 2] = oz + (c.pz - 0.5) * 2 * s;
            }
            opaque.quad(verts, fd.f.n, base[0] * j, base[1] * j, base[2] * j, fullAo, 0);
          }
          continue;
        }
        if (id === M.WATER) {
          // Water: faces only toward air, top dropped a little, lighter at the shore.
          const surface = vox[i + strideY] === M.AIR;
          let shore = false;
          if (surface) {
            for (const d of [1, -1, strideZ, -strideZ])
              if (SOLID[vox[i + d]!] || SOLID[vox[i + d + strideY]!]) shore = true;
          }
          const base = LINEAR[M.WATER]!;
          const mix = shore ? 0.6 : 0;
          const j = 1 + (hash3(x, y, z) * 2 - 1) * JITTER * 0.5;
          const r = (base[0] * (1 - mix) + SHORE_FOAM[0] * mix) * j;
          const g = (base[1] * (1 - mix) + SHORE_FOAM[1] * mix) * j;
          const b = (base[2] * (1 - mix) + SHORE_FOAM[2] * mix) * j;
          for (const fd of faceData) {
            if (fd.f.n[1] === -1 || vox[i + fd.n] !== M.AIR) continue;
            for (let k = 0; k < 4; k++) {
              const c = fd.corners[k]!;
              let vy = y + c.py;
              if (surface && c.py > 0.99) vy -= WATER_DROP;
              verts[k * 3] = x + c.px;
              verts[k * 3 + 1] = vy;
              verts[k * 3 + 2] = z + c.pz;
            }
            water.quad(verts, fd.f.n, r, g, b, fullAo, 0);
          }
          continue;
        }

        const base = LINEAR[id]!;
        // Per-voxel jitter plus a broad, soft patchiness so meadows aren't flat.
        const patch = Math.sin(x * 0.19 + Math.sin(z * 0.11) * 2) * Math.sin(z * 0.17 + Math.sin(x * 0.07) * 2);
        const j = 1 + (hash3(x, y, z) * 2 - 1) * JITTER + patch * PATCH;
        const hj = (hash3(z, x, y) * 2 - 1) * JITTER * 0.5;
        const r = base[0] * j * (1 + hj);
        const g = base[1] * j;
        const b = base[2] * j * (1 - hj);
        const tint = TINT[id]!;

        for (const fd of faceData) {
          const ni = i + fd.n;
          if (SOLID[vox[ni]!]) continue;
          for (let k = 0; k < 4; k++) {
            const c = fd.corners[k]!;
            const s1 = SOLID[vox[ni + c.s1]!]!;
            const s2 = SOLID[vox[ni + c.s2]!]!;
            const cc = SOLID[vox[ni + c.c]!]!;
            ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            verts[k * 3] = x + c.px;
            verts[k * 3 + 1] = y + c.py;
            verts[k * 3 + 2] = z + c.pz;
          }
          opaque.quad(verts, fd.f.n, r, g, b, ao, tint);
        }
      }
    }
  }
  return { opaque: opaque.build(), water: water.build() };
}
