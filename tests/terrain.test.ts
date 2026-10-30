import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { TUNING } from '../src/sim/tuning';
import { M } from '../src/sim/world/materials';
import { generateIsland, type Island } from '../src/sim/world/terrain';

const { sizeX, sizeZ, sizeY } = TUNING.world;
const T = TUNING.terrain;
const gen = (seed: string | number) => generateIsland(new Rng(seed).fork('terrain'));

/** Flood-fill over dry land where each step changes height by at most 1. */
function walkableFrom(isl: Island, sx: number, sz: number): Uint8Array {
  const seen = new Uint8Array(sizeX * sizeZ);
  const dry = (k: number) => (isl.ground[k] as number) >= 0 && (isl.waterTop[k] as number) < 0;
  const start = sx + sz * sizeX;
  if (!dry(start)) return seen;
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const k = queue.pop()!;
    const x = k % sizeX;
    const z = (k / sizeX) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue;
      const n = nx + nz * sizeX;
      if (seen[n] || !dry(n)) continue;
      if (Math.abs((isl.ground[n] as number) - (isl.ground[k] as number)) > 1) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

function checksum(isl: Island): number {
  let h = 0;
  for (let y = 0; y < sizeY; y += 1)
    for (let z = 0; z < sizeZ; z += 3)
      for (let x = 0; x < sizeX; x += 3) h = (Math.imul(h, 31) + isl.world.get(x, y, z)) >>> 0;
  return h;
}

const SEEDS = Array.from({ length: 16 }, (_, i) => `seed-${i}`);

describe('island generation', () => {
  it('is deterministic for a seed', () => {
    expect(checksum(gen('omen'))).toBe(checksum(gen('omen')));
  });

  it('differs between seeds', () => {
    const sums = new Set(SEEDS.slice(0, 6).map((s) => checksum(gen(s))));
    expect(sums.size).toBe(6);
  });

  describe.each(SEEDS)('%s is a valid island', (seed) => {
    const isl = gen(seed);
    const L = isl.landmarks;
    const at = (x: number, z: number) => x + z * sizeX;

    it('has land, sea and a floating underside', () => {
      let land = 0;
      let sea = 0;
      let platform = 0;
      for (let k = 0; k < isl.ground.length; k++) {
        if ((isl.ground[k] as number) < 0) continue;
        platform++;
        if ((isl.waterTop[k] as number) >= 0) sea++;
        else land++;
      }
      expect(land / platform).toBeGreaterThan(0.4);
      expect(sea / platform).toBeGreaterThan(0.1);
      // World edges are open sky; the island floats.
      expect(isl.world.get(0, 20, 0)).toBe(M.AIR);
      expect(isl.world.get(Math.floor(L.center.x), 0, 0)).toBe(M.AIR);
    });

    it('has a high ridge, an east hill and a valley village site', () => {
      expect(L.ridgePeak.y).toBeGreaterThanOrEqual(T.seaLevel + 18);
      expect(L.eastHill.x).toBeGreaterThan(L.center.x + 10);
      expect(L.eastHill.y).toBeGreaterThanOrEqual(T.valleyHeight + 4);
      expect(L.villageSite.y).toBeGreaterThan(T.seaLevel + 1);
      expect(L.villageSite.y).toBeLessThan(L.ridgePeak.y - 12);
    });

    it('village pad is flat and dry', () => {
      const { x, z, y } = L.villageSite;
      for (let dz = -5; dz <= 5; dz++)
        for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dz * dz > 25) continue;
          const k = at(x + dx, z + dz);
          if ((isl.waterTop[k] as number) >= 0) continue; // a river bend may graze the edge
          expect(Math.abs((isl.ground[k] as number) - y)).toBeLessThanOrEqual(1);
        }
    });

    it('high ground on the ridge is reachable on foot from the village', () => {
      const reach = walkableFrom(isl, L.villageSite.x, L.villageSite.z);
      let best = -1;
      for (let k = 0; k < reach.length; k++) if (reach[k]) best = Math.max(best, isl.ground[k] as number);
      expect(best).toBeGreaterThanOrEqual(T.seaLevel + 14);
    });

    it('the river runs from the ridge foot to the sea', () => {
      // Walk water columns from the source; must reach sea-level water.
      const s = L.riverPath[0]!;
      let start = -1;
      for (let r = 0; r <= 3 && start < 0; r++)
        for (let dz = -r; dz <= r && start < 0; dz++)
          for (let dx = -r; dx <= r && start < 0; dx++) {
            const k = at(Math.floor(s.x) + dx, Math.floor(s.z) + dz);
            if ((isl.waterTop[k] as number) >= 0) start = k;
          }
      expect(start).toBeGreaterThanOrEqual(0);
      expect(isl.waterTop[start]).toBeGreaterThan(T.seaLevel);
      const seen = new Set([start]);
      const queue = [start];
      let reachedSea = false;
      while (queue.length && !reachedSea) {
        const k = queue.pop()!;
        if ((isl.ground[k] as number) < T.seaLevel) reachedSea = true;
        const x = k % sizeX;
        const z = (k / sizeX) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = at(x + dx, z + dz);
          if (!seen.has(n) && (isl.waterTop[n] as number) >= 0) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect(reachedSea).toBe(true);
    });

    it('has forest and everything fits under the world ceiling', () => {
      let trees = 0;
      for (let z = 0; z < sizeZ; z++)
        for (let x = 0; x < sizeX; x++) {
          const k = at(x, z);
          const g = isl.ground[k] as number;
          if (g >= 0 && isl.world.get(x, g + 1, z) === M.WOOD) trees++;
        }
      expect(trees).toBeGreaterThan(25);
      for (let z = 0; z < sizeZ; z += 2)
        for (let x = 0; x < sizeX; x += 2) expect(isl.world.get(x, sizeY - 1, z)).toBe(M.AIR);
    });
  });
});
