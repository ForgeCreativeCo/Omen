import type { MaterialId } from './materials';
import { M } from './materials';
import { LEGEND, prefabSize, type PrefabDef } from './prefabs';
import type { VoxelWorld } from './VoxelWorld';

export type StructureKind = 'hut' | 'field' | 'well' | 'firePit' | 'grave' | 'cairn' | 'shrine' | 'temple' | 'statue' | 'storehouse' | 'fence';

export interface BuildStep {
  x: number;
  y: number;
  z: number;
  mat: MaterialId;
}

export interface FieldTile {
  x: number;
  z: number;
  /** y of the tilled soil; crops grow at y + 1. */
  y: number;
  /** 0 untilled, 1 tilled & empty, 2 growing. */
  state: 0 | 1 | 2;
  /** 0..1 growth; 1 = ripe. */
  progress: number;
  /** 0..1; crops die at 0 (drought). */
  health: number;
  /** Villager id currently working this tile, or -1. */
  reservedBy: number;
}

export interface Structure {
  id: number;
  kind: StructureKind;
  variant: string;
  /** Footprint in world cells (after rotation). */
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** y of the first layer above ground. */
  baseY: number;
  rot: number;
  steps: BuildStep[];
  /** Index of the next step to place. */
  next: number;
  complete: boolean;
  /** Damaged below the destroyed threshold (fire, lightning, terrain). */
  destroyed: boolean;
  /** Left to weather (old statues): never repaired. */
  ruined?: boolean;
  /** Left behind when the village moved: ruins, no longer part of village life. */
  abandoned?: boolean;
  bornTick: number;
  /** Last tick a block was placed (or the structure was planned); stalled sites get abandoned. */
  progressTick: number;
  /** Walkable cell villagers go to in order to use / enter it. */
  door: { x: number; z: number };
  residents: number[];
  /** Fields only. */
  tiles: FieldTile[];
  /** Fields only: the fence around it, once there is one. */
  fenceId?: number;
  moisture: number;
  nearWater: boolean;
  /** Fields and homes the god blessed: blessed until this tick. */
  blessedUntil?: number;
}

/** Is this field or home under the god's blessing now? */
export function blessed(s: Structure, tick: number): boolean {
  return (s.blessedUntil ?? 0) > tick;
}

/** Rotate local (lx, lz) of a w×d box; front row (lz = d-1) faces +z, +x, -z, -x for rot 0, 3, 2, 1. */
export function rotateLocal(lx: number, lz: number, w: number, d: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1:
      return [d - 1 - lz, lx];
    case 2:
      return [w - 1 - lx, d - 1 - lz];
    case 3:
      return [lz, w - 1 - lx];
    default:
      return [lx, lz];
  }
}

/** Rotation that makes a structure at (x, z) face toward (tx, tz). */
export function rotationToward(x: number, z: number, tx: number, tz: number): number {
  const dx = tx - x;
  const dz = tz - z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 1;
  return dz >= 0 ? 0 : 2;
}

export function rotatedSize(p: PrefabDef, rot: number): { w: number; d: number } {
  const { w, d } = prefabSize(p);
  return rot & 1 ? { w: d, d: w } : { w, d };
}

/**
 * Turn a prefab placed with its rotated footprint at (x0, z0) and base y into
 * ordered build steps: foundation (fill or clear to an even floor) then layers
 * bottom-up. Steps that already match the world are still listed so damage can
 * be detected later; builders skip them instantly.
 */
export function planSteps(
  p: PrefabDef,
  x0: number,
  z0: number,
  baseY: number,
  rot: number,
  groundAt: (x: number, z: number) => number,
): { steps: BuildStep[]; door: { x: number; z: number } | null } {
  const { w, d } = prefabSize(p);
  const steps: BuildStep[] = [];
  const toWorld = (lx: number, lz: number): [number, number] => {
    const [rx, rz] = rotateLocal(lx, lz, w, d, rot);
    return [x0 + rx, z0 + rz];
  };

  if (p.yOffset >= 0) {
    for (let lz = 0; lz < d; lz++)
      for (let lx = 0; lx < w; lx++) {
        const [x, z] = toWorld(lx, lz);
        const g = groundAt(x, z);
        for (let y = g + 1; y < baseY; y++) steps.push({ x, y, z, mat: M.DIRT });
        for (let y = baseY; y <= g; y++) steps.push({ x, y, z, mat: M.AIR });
      }
  }

  p.layers.forEach((rows, li) => {
    const y = baseY + p.yOffset + li;
    rows.forEach((row, lz) => {
      for (let lx = 0; lx < row.length; lx++) {
        const ch = row[lx]!;
        if (ch === ' ') continue;
        const mat = LEGEND[ch];
        if (mat === undefined) continue;
        const [x, z] = toWorld(lx, lz);
        steps.push({ x, y, z, mat });
      }
    });
  });

  let door: { x: number; z: number } | null = null;
  if (p.doorX !== undefined) {
    const [x, z] = toWorld(p.doorX, d); // one past the front row
    door = { x, z };
  }
  return { steps, door };
}

/** Fraction of non-air steps whose voxel is currently correct. */
export function integrity(world: VoxelWorld, s: Structure): number {
  let total = 0;
  let ok = 0;
  for (let i = 0; i < Math.min(s.next, s.steps.length); i++) {
    const st = s.steps[i]!;
    if (st.mat === M.AIR) continue;
    total++;
    if (world.get(st.x, st.y, st.z) === st.mat) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

/** Index of the first already-placed step that no longer matches the world, or -1. */
export function firstDamagedStep(world: VoxelWorld, s: Structure): number {
  for (let i = 0; i < Math.min(s.next, s.steps.length); i++) {
    const st = s.steps[i]!;
    if (st.mat !== M.AIR && world.get(st.x, st.y, st.z) !== st.mat) return i;
  }
  return -1;
}
