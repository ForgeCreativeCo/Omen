import * as THREE from 'three';
import type { VoxelWorld } from '../../sim/world/VoxelWorld';
import { TUNING } from '../../sim/tuning';
import { copyColumn, copyColumnLod, LOD, meshColumn, meshVoxels, type MeshData } from './mesher';
import type { MeshRequest, MeshResponse } from './mesh.worker';
import { createTerrainMaterial, createWaterMaterial } from './terrainMaterials';
import { buildUnderside } from './Underside';

interface ColumnEntry {
  /** World column version currently shown. */
  version: number;
  /** Version a worker is meshing right now, or -1. */
  pending: number;
  opaque: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

const WORKERS = 2;
/** Distant columns rebuilt per frame when the land under them changes. */
const LOD_BUDGET = 2;

/** A distant-terrain column: covers LOD×LOD real columns. */
interface LodEntry {
  /** Sum of the covered columns' versions when built (-1: never). */
  version: number;
  opaque: THREE.Mesh | null;
  water: THREE.Mesh | null;
  /** Showing the coarse mesh instead of the detailed ones. */
  far: boolean;
}

/**
 * Owns the chunk-column meshes. Each frame it compares world column versions
 * with what it has shown and sends up to `remeshBudgetPerFrame` stale columns
 * to mesh workers, so terrain edits never stall the main thread. The initial
 * build runs synchronously so the island appears complete on the first frame.
 */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  /** Coarse meshes for far-off terrain, at LOD scale. */
  private readonly lodGroup = new THREE.Group();
  private readonly columns: ColumnEntry[] = [];
  private readonly lods: LodEntry[] = [];
  private readonly lodX: number;
  private readonly lodZ: number;
  /** Columns farther than this from the camera are drawn coarse (voxels; Infinity turns it off). */
  lodDistance = 230;
  private readonly terrainMat = createTerrainMaterial();
  private readonly waterMat = createWaterMaterial();
  private readonly workers: Worker[] = [];
  private nextWorker = 0;
  /** Columns dispatched for re-meshing in the most recent update (for the stats readout). */
  lastRemeshed = 0;

  constructor(
    private readonly world: VoxelWorld,
    seed: number,
  ) {
    // World voxel (x, z) maps to scene (x - size/2, z - size/2): island centered on origin.
    this.group.position.set(-world.sizeX / 2, 0, -world.sizeZ / 2);
    for (let i = 0; i < world.chunksX * world.chunksZ; i++)
      this.columns.push({ version: -1, pending: -1, opaque: null, water: null });
    this.group.add(buildUnderside(world, seed, this.terrainMat));
    this.lodX = Math.ceil(world.chunksX / LOD);
    this.lodZ = Math.ceil(world.chunksZ / LOD);
    for (let i = 0; i < this.lodX * this.lodZ; i++) this.lods.push({ version: -1, opaque: null, water: null, far: false });
    this.lodGroup.scale.setScalar(LOD);
    this.group.add(this.lodGroup);

    for (let i = 0; i < WORKERS; i++) {
      const w = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<MeshResponse>) => this.onMeshed(e.data);
      this.workers.push(w);
    }
  }

  /** Mesh everything now on the main thread (initial load). */
  buildAll(): void {
    for (let cz = 0; cz < this.world.chunksZ; cz++)
      for (let cx = 0; cx < this.world.chunksX; cx++) {
        const entry = this.columns[cx + cz * this.world.chunksX]!;
        entry.version = this.world.columnVersion(cx, cz);
        const mesh = meshColumn(this.world, cx, cz);
        this.apply(entry, mesh.opaque, mesh.water);
      }
    for (let lz = 0; lz < this.lodZ; lz++) for (let lx = 0; lx < this.lodX; lx++) this.buildLod(lx, lz);
  }

  update(camera?: THREE.Vector3): void {
    if (camera) this.updateLod(camera);
    let budget = TUNING.world.remeshBudgetPerFrame;
    this.lastRemeshed = 0;
    for (let cz = 0; cz < this.world.chunksZ && budget > 0; cz++)
      for (let cx = 0; cx < this.world.chunksX && budget > 0; cx++) {
        const key = cx + cz * this.world.chunksX;
        const entry = this.columns[key]!;
        const v = this.world.columnVersion(cx, cz);
        // One job per column at a time; a newer edit is picked up after it lands.
        if (entry.version === v || entry.pending !== -1) continue;
        entry.pending = v;
        const req: MeshRequest = { key, version: v, column: copyColumn(this.world, cx, cz) };
        const worker = this.workers[this.nextWorker++ % this.workers.length]!;
        worker.postMessage(req, { transfer: [req.column.vox.buffer as ArrayBuffer] });
        budget--;
        this.lastRemeshed++;
      }
  }

  /** Sum of the covered columns' versions (changes whenever any of them does). */
  private lodVersion(lx: number, lz: number): number {
    let v = 0;
    for (let dz = 0; dz < LOD; dz++)
      for (let dx = 0; dx < LOD; dx++) {
        const cx = lx * LOD + dx;
        const cz = lz * LOD + dz;
        if (cx < this.world.chunksX && cz < this.world.chunksZ) v += this.world.columnVersion(cx, cz) + 1;
      }
    return v;
  }

  private buildLod(lx: number, lz: number): void {
    const e = this.lods[lx + lz * this.lodX]!;
    e.version = this.lodVersion(lx, lz);
    const m = meshVoxels(copyColumnLod(this.world, lx, lz));
    e.opaque = this.replace(e.opaque, m.opaque, this.terrainMat, false, true, this.lodGroup);
    e.water = this.replace(e.water, m.water, this.waterMat, false, false, this.lodGroup);
    if (e.opaque) e.opaque.visible = e.far;
    if (e.water) e.water.visible = e.far;
  }

  /** Swap each 2×2 block of columns between detailed and coarse by distance from the camera. */
  private updateLod(camera: THREE.Vector3): void {
    const w = this.world;
    const s = w.chunkSize * LOD;
    let budget = LOD_BUDGET;
    for (let lz = 0; lz < this.lodZ; lz++)
      for (let lx = 0; lx < this.lodX; lx++) {
        const e = this.lods[lx + lz * this.lodX]!;
        // Scene coordinates of the block's middle (the island is centered on the origin).
        const x = lx * s + s / 2 - w.sizeX / 2;
        const z = lz * s + s / 2 - w.sizeZ / 2;
        const d = Math.hypot(camera.x - x, camera.y - 16, camera.z - z);
        // A little hysteresis so blocks don't flicker at the edge.
        const far = e.far ? d > this.lodDistance - 12 : d > this.lodDistance + 12;
        if (far && e.version !== this.lodVersion(lx, lz) && budget > 0) {
          budget--;
          this.buildLod(lx, lz);
        }
        if (far === e.far) continue;
        e.far = far;
        if (e.opaque) e.opaque.visible = far;
        if (e.water) e.water.visible = far;
        for (let dz = 0; dz < LOD; dz++)
          for (let dx = 0; dx < LOD; dx++) {
            const cx = lx * LOD + dx;
            const cz = lz * LOD + dz;
            if (cx >= w.chunksX || cz >= w.chunksZ) continue;
            const c = this.columns[cx + cz * w.chunksX]!;
            if (c.opaque) c.opaque.visible = !far;
            if (c.water) c.water.visible = !far;
          }
      }
  }

  /** Is this real column currently drawn coarse? */
  private coarse(key: number): boolean {
    const cx = key % this.world.chunksX;
    const cz = Math.floor(key / this.world.chunksX);
    return this.lods[Math.floor(cx / LOD) + Math.floor(cz / LOD) * this.lodX]?.far ?? false;
  }

  private onMeshed(res: MeshResponse): void {
    const entry = this.columns[res.key];
    if (!entry) return;
    entry.pending = -1;
    entry.version = res.version;
    this.apply(entry, res.opaque, res.water);
    if (this.coarse(res.key)) {
      if (entry.opaque) entry.opaque.visible = false;
      if (entry.water) entry.water.visible = false;
    }
  }

  private apply(entry: ColumnEntry, opaque: MeshData | null, water: MeshData | null): void {
    entry.opaque = this.replace(entry.opaque, opaque, this.terrainMat, true);
    entry.water = this.replace(entry.water, water, this.waterMat, false, false);
  }

  private replace(
    old: THREE.Mesh | null,
    data: MeshData | null,
    material: THREE.Material,
    castShadow: boolean,
    receiveShadow = true,
    parent: THREE.Group = this.group,
  ): THREE.Mesh | null {
    if (old) {
      parent.remove(old);
      old.geometry.dispose();
    }
    if (!data) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aTint', new THREE.BufferAttribute(data.tint, 1));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    return mesh;
  }
}
