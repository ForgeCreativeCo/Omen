import * as THREE from 'three';
import { M, MATERIALS } from '../sim/world/materials';
import type { VoxelWorld } from '../sim/world/VoxelWorld';

const HITTABLE = MATERIALS.map((m) => m.solid || m.id === M.WATER);

export interface GroundHit {
  /** Voxel coordinates of the hit voxel. */
  x: number;
  y: number;
  z: number;
}

/**
 * Cast a screen ray into the voxel world (Amanatides–Woo grid traversal).
 * Scene space is world space shifted by (-sizeX/2, 0, -sizeZ/2).
 */
export function pickGround(
  world: VoxelWorld,
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  maxDist = 900,
): GroundHit | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const o = ray.ray.origin.clone().add(new THREE.Vector3(world.sizeX / 2, 0, world.sizeZ / 2));
  const d = ray.ray.direction;

  // Jump to the world's bounding box first.
  const tEnter = enterBox(o, d, world);
  if (tEnter === null) return null;
  const p = o.clone().addScaledVector(d, Math.max(0, tEnter) + 1e-4);

  let x = Math.floor(p.x);
  let y = Math.floor(p.y);
  let z = Math.floor(p.z);
  const stepX = Math.sign(d.x);
  const stepY = Math.sign(d.y);
  const stepZ = Math.sign(d.z);
  const tDeltaX = Math.abs(1 / d.x);
  const tDeltaY = Math.abs(1 / d.y);
  const tDeltaZ = Math.abs(1 / d.z);
  let tMaxX = d.x === 0 ? Infinity : ((stepX > 0 ? x + 1 - p.x : p.x - x) * tDeltaX);
  let tMaxY = d.y === 0 ? Infinity : ((stepY > 0 ? y + 1 - p.y : p.y - y) * tDeltaY);
  let tMaxZ = d.z === 0 ? Infinity : ((stepZ > 0 ? z + 1 - p.z : p.z - z) * tDeltaZ);

  for (let i = 0; i < maxDist; i++) {
    if (world.inBounds(x, y, z)) {
      if (HITTABLE[world.get(x, y, z)]) return { x, y, z };
    } else if (i > 2 && (y < 0 || (y >= world.sizeY && stepY >= 0))) {
      return null;
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}

function enterBox(o: THREE.Vector3, d: THREE.Vector3, w: VoxelWorld): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const lo = [0, 0, 0];
  const hi = [w.sizeX, w.sizeY, w.sizeZ];
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(da[a]!) < 1e-9) {
      if (oa[a]! < lo[a]! || oa[a]! > hi[a]!) return null;
      continue;
    }
    let t1 = (lo[a]! - oa[a]!) / da[a]!;
    let t2 = (hi[a]! - oa[a]!) / da[a]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }
  return tMax >= Math.max(tMin, 0) ? tMin : null;
}
