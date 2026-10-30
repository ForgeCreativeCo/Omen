import * as THREE from 'three';
import type { VoxelWorld } from '../../sim/world/VoxelWorld';
import { TUNING } from '../../sim/tuning';
import { copyColumn, meshColumn, type MeshData } from './mesher';
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

/**
 * Owns the chunk-column meshes. Each frame it compares world column versions
 * with what it has shown and sends up to `remeshBudgetPerFrame` stale columns
 * to mesh workers, so terrain edits never stall the main thread. The initial
 * build runs synchronously so the island appears complete on the first frame.
 */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  private readonly columns: ColumnEntry[] = [];
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
  }

  update(): void {
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

  private onMeshed(res: MeshResponse): void {
    const entry = this.columns[res.key];
    if (!entry) return;
    entry.pending = -1;
    entry.version = res.version;
    this.apply(entry, res.opaque, res.water);
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
  ): THREE.Mesh | null {
    if (old) {
      this.group.remove(old);
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
    this.group.add(mesh);
    return mesh;
  }
}
