import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { Rng } from '../../sim/rng';
import { M } from '../../sim/world/materials';
import { VoxelWorld } from '../../sim/world/VoxelWorld';
import { meshColumn } from './mesher';

/** How far the decorative rock hangs below the sim world's y = 0. */
const DEPTH = 34;

/**
 * Decorative rock "root" hanging under the island: built once from the sim world's
 * footprint, purely visual, never part of the simulation. It continues each
 * column's lowest voxel downward and tapers to a craggy point, then the terrain
 * shader fades it into the sky.
 */
export function buildUnderside(sim: VoxelWorld, seed: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const w = new VoxelWorld(sim.sizeX, DEPTH + 16, sim.sizeZ, sim.chunkSize);
  const rng = new Rng(seed).fork('underside');
  const noise = createNoise2D(() => rng.next());
  const cx = sim.sizeX / 2;
  const cz = sim.sizeZ / 2;

  // Footprint radius: furthest occupied column from center.
  let maxR = 1;
  const bottoms = new Int16Array(sim.sizeX * sim.sizeZ).fill(-1);
  for (let z = 0; z < sim.sizeZ; z++)
    for (let x = 0; x < sim.sizeX; x++) {
      for (let y = 0; y < sim.sizeY; y++) {
        const id = sim.get(x, y, z);
        if (id !== M.AIR && id !== M.WATER) {
          bottoms[x + z * sim.sizeX] = y;
          maxR = Math.max(maxR, Math.hypot(x + 0.5 - cx, z + 0.5 - cz));
          break;
        }
      }
    }

  for (let z = 0; z < sim.sizeZ; z++)
    for (let x = 0; x < sim.sizeX; x++) {
      const b = bottoms[x + z * sim.sizeX] as number;
      if (b < 0) continue;
      const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / maxR;
      const taper = Math.pow(Math.max(0, 1 - r), 1.3);
      const crag = noise(x * 0.08, z * 0.08) * 6 + noise(x * 0.3, z * 0.3) * 3;
      const depth = Math.max(0, Math.round(taper * DEPTH + crag * taper));
      // Local y = DEPTH corresponds to sim y = 0.
      const top = DEPTH + b - 1;
      for (let y = Math.max(0, DEPTH - depth); y <= top; y++) {
        const strata = noise(x * 0.05 + y * 0.4, z * 0.05) > 0.45;
        w.set(x, y, z, top - y < 2 || strata ? M.DIRT : M.STONE);
      }
    }

  for (let cz2 = 0; cz2 < w.chunksZ; cz2++)
    for (let cx2 = 0; cx2 < w.chunksX; cx2++) {
      const data = meshColumn(w, cx2, cz2).opaque;
      if (!data) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setAttribute('aTint', new THREE.BufferAttribute(data.tint, 1));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.computeBoundingSphere();
      group.add(new THREE.Mesh(geo, material));
    }
  group.position.y = -DEPTH;
  return group;
}
