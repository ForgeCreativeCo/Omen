import { describe, expect, it } from 'vitest';
import { meshColumn } from '../src/render/chunks/mesher';
import { Rng } from '../src/sim/rng';
import { M } from '../src/sim/world/materials';
import { generateIsland } from '../src/sim/world/terrain';
import { VoxelWorld } from '../src/sim/world/VoxelWorld';

describe('mesher', () => {
  it('a lone voxel produces 6 faces with full AO', () => {
    const w = new VoxelWorld(16, 16, 16, 16);
    w.set(5, 5, 5, M.STONE);
    const { opaque, water } = meshColumn(w, 0, 0);
    expect(water).toBeNull();
    expect(opaque!.indices.length).toBe(6 * 6);
    expect(opaque!.positions.length).toBe(6 * 4 * 3);
  });

  it('culls the shared face between neighbors and darkens corners next to walls', () => {
    const w = new VoxelWorld(16, 16, 16, 16);
    w.set(5, 5, 5, M.STONE);
    w.set(6, 5, 5, M.STONE);
    expect(meshColumn(w, 0, 0).opaque!.indices.length).toBe(10 * 6);

    // A floor with a wall: the floor's top face corners touching the wall get occluded.
    const v = new VoxelWorld(16, 16, 16, 16);
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) v.set(x, 0, z, M.STONE);
    v.set(1, 1, 0, M.STONE);
    const col = meshColumn(v, 0, 0).opaque!.colors;
    let min = 1;
    for (const c of col) min = Math.min(min, c);
    expect(min).toBeLessThan(0.5 * 0.9);
  });

  it('edits bump the version of the touched column and its border neighbor', () => {
    const w = new VoxelWorld(32, 16, 32, 16);
    const before = [w.columnVersion(0, 0), w.columnVersion(1, 0)];
    w.set(15, 3, 3, M.DIRT); // on the border between column 0 and 1
    expect(w.columnVersion(0, 0)).not.toBe(before[0]);
    expect(w.columnVersion(1, 0)).not.toBe(before[1]);
    const c11 = w.columnVersion(1, 1);
    w.set(3, 3, 3, M.DIRT);
    expect(w.columnVersion(1, 1)).toBe(c11);
  });

  it('meshes a whole island quickly', () => {
    const isl = generateIsland(new Rng('omen').fork('terrain'));
    const w = isl.world;
    const t0 = performance.now();
    let tris = 0;
    let water = 0;
    for (let cz = 0; cz < w.chunksZ; cz++)
      for (let cx = 0; cx < w.chunksX; cx++) {
        const m = meshColumn(w, cx, cz);
        tris += (m.opaque?.indices.length ?? 0) / 3;
        water += (m.water?.indices.length ?? 0) / 3;
      }
    const ms = performance.now() - t0;
    console.log(`island mesh: ${tris} opaque tris, ${water} water tris, ${ms.toFixed(0)} ms`);
    expect(tris).toBeGreaterThan(10000);
    expect(water).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(3000);
  });
});
