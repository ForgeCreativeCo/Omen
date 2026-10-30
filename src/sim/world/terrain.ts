import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import type { Rng } from '../rng';
import { TUNING } from '../tuning';
import { M, type MaterialId } from './materials';
import { VoxelWorld } from './VoxelWorld';

export interface Point2 {
  x: number;
  z: number;
}
export interface Point3 extends Point2 {
  y: number;
}

export type RidgeSide = 'north' | 'south' | 'west';

/** Named features the rest of the sim refers to (places, the Warning's high ground). */
export interface Landmarks {
  center: Point2;
  seaLevel: number;
  ridgeSide: RidgeSide;
  /** Unit vector from the island center toward the ridge. */
  ridgeDir: Point2;
  ridgePeak: Point3;
  eastHill: Point3;
  villageSite: Point3;
  riverSource: Point3;
  riverMouth: Point2;
  riverPath: Point2[];
}

export interface Island {
  world: VoxelWorld;
  /** Top solid terrain y per column (x + z * sizeX), ignoring trees; -1 off the platform. */
  ground: Int16Array;
  /** Top water y per column, or -1 if the column holds no water. */
  waterTop: Int16Array;
  landmarks: Landmarks;
}

const T = TUNING.terrain;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function fbm(noise: NoiseFunction2D, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

const angleDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/**
 * Generate a floating island: central valley, river to the sea, an east hill,
 * a ridge along one side (north, south or west), forests, beaches and an
 * underside that tapers into the sky.
 */
export function generateIsland(rng: Rng): Island {
  const { sizeX, sizeY, sizeZ, chunkSize } = TUNING.world;
  const world = new VoxelWorld(sizeX, sizeY, sizeZ, chunkSize);
  const rand = () => rng.next();
  const nCoast = createNoise2D(rand);
  const nDetail = createNoise2D(rand);
  const nRidge = createNoise2D(rand);
  const nForest = createNoise2D(rand);
  const nUnder = createNoise2D(rand);

  const cx = sizeX / 2;
  const cz = sizeZ / 2;
  const idx = (x: number, z: number) => x + z * sizeX;

  const ridgeSide = rng.pick<RidgeSide>(['north', 'south', 'west']);
  const ridgeDir: Point2 =
    ridgeSide === 'north' ? { x: 0, z: -1 } : ridgeSide === 'south' ? { x: 0, z: 1 } : { x: -1, z: 0 };
  const hill: Point2 = { x: cx + T.hillDistance + rng.jitter(3), z: cz + rng.jitter(6) - ridgeDir.z * 5 };

  const landRadius = (ang: number) =>
    T.landRadius + T.landRadiusNoise * fbm(nCoast, Math.cos(ang) * 1.3 + 7, Math.sin(ang) * 1.3 + 7, 3);
  const platformRadius = (ang: number) =>
    Math.min(sizeX / 2 - 2, T.platformRadius + T.platformRadiusNoise * nCoast(Math.cos(ang) * 2 - 9, Math.sin(ang) * 2));

  // ---- 1. Height field -------------------------------------------------------
  const height = new Float32Array(sizeX * sizeZ).fill(-1);
  const seabedAt = (r: number, R: number) => T.seaLevel - T.seaDepth - Math.max(0, (r - R) * 0.12);

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const dx = x + 0.5 - cx;
      const dz = z + 0.5 - cz;
      const r = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      if (r > platformRadius(ang)) continue;

      const R = landRadius(ang);
      const along = dx * ridgeDir.x + dz * ridgeDir.z;
      const lateral = dx * ridgeDir.z - dz * ridgeDir.x;

      const ridgeT = smoothstep(T.ridgeStart, T.ridgeCrest, along);
      const ridgeVar = 1 + T.ridgeNoise * fbm(nRidge, lateral * 0.05, along * 0.05, 3);
      const ridgeH = T.ridgeHeight * ridgeT * ridgeVar;

      const hr = Math.hypot(x + 0.5 - hill.x, z + 0.5 - hill.z);
      const hillH = hr < T.hillRadius ? T.hillHeight * 0.5 * (1 + Math.cos((Math.PI * hr) / T.hillRadius)) : 0;

      const base = T.valleyHeight + T.valleyNoise * fbm(nDetail, x * 0.045, z * 0.045, 4);
      const land = Math.min(T.maxGroundY, base + Math.max(ridgeH, hillH * (1 - ridgeT)));

      const m = smoothstep(R + T.coastWidth * 0.35, R - T.coastWidth, r);
      const seabed = seabedAt(r, R);
      height[idx(x, z)] = seabed + (land - seabed) * m;
    }
  }

  const ground = new Int16Array(sizeX * sizeZ).fill(-1);
  for (let i = 0; i < ground.length; i++) {
    const h = height[i] as number;
    ground[i] = h < 0 ? -1 : Math.round(h);
  }
  const g = (x: number, z: number) =>
    x < 0 || z < 0 || x >= sizeX || z >= sizeZ ? -1 : (ground[idx(x, z)] as number);

  // ---- 2. River --------------------------------------------------------------
  const ridgeAngle = Math.atan2(ridgeDir.z, ridgeDir.x);
  const hillAngle = Math.atan2(hill.z - cz, hill.x - cx);
  let mouthAngle = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const score = Math.min(angleDist(a, ridgeAngle), angleDist(a, hillAngle) * 1.15) + rng.jitter(0.05);
    if (score > bestScore) {
      bestScore = score;
      mouthAngle = a;
    }
  }
  const mouthR = landRadius(mouthAngle) + 6;
  const riverMouth: Point2 = { x: cx + Math.cos(mouthAngle) * mouthR, z: cz + Math.sin(mouthAngle) * mouthR };
  // Source sits at the ridge foot, nudged sideways toward the mouth.
  const perp = { x: -ridgeDir.z, z: ridgeDir.x };
  const perpSign = Math.sign((riverMouth.x - cx) * perp.x + (riverMouth.z - cz) * perp.z) || 1;
  const src: Point2 = {
    x: cx + ridgeDir.x * T.riverSourceDistance + perp.x * perpSign * 6,
    z: cz + ridgeDir.z * T.riverSourceDistance + perp.z * perpSign * 6,
  };
  // Control point pulls the river through the valley, away from the hill.
  const awayHill = { x: cx - hill.x, z: cz - hill.z };
  const ah = Math.hypot(awayHill.x, awayHill.z) || 1;
  const ctrl: Point2 = { x: cx + (awayHill.x / ah) * 6, z: cz + (awayHill.z / ah) * 6 };

  const samples = 260;
  const riverPath: Point2[] = [];
  const phase = rng.range(0, Math.PI * 2);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    let px = u * u * src.x + 2 * u * t * ctrl.x + t * t * riverMouth.x;
    let pz = u * u * src.z + 2 * u * t * ctrl.z + t * t * riverMouth.z;
    // Tangent for meander offset
    const tx = 2 * u * (ctrl.x - src.x) + 2 * t * (riverMouth.x - ctrl.x);
    const tz = 2 * u * (ctrl.z - src.z) + 2 * t * (riverMouth.z - ctrl.z);
    const tl = Math.hypot(tx, tz) || 1;
    const meander = Math.sin(t * Math.PI * 3 + phase) * T.riverMeander * Math.sin(t * Math.PI);
    px += (-tz / tl) * meander;
    pz += (tx / tl) * meander;
    riverPath.push({ x: px, z: pz });
  }

  const riverDist = new Float32Array(sizeX * sizeZ).fill(Infinity);
  const riverSurf = new Int16Array(sizeX * sizeZ).fill(-1);
  let surf = g(Math.floor(src.x), Math.floor(src.z)) - 1;
  const reach = 4;
  riverPath.forEach((p, i) => {
    const px = Math.floor(p.x);
    const pz = Math.floor(p.z);
    const gh = g(px, pz);
    if (gh >= 0) surf = Math.max(T.seaLevel, Math.min(surf, gh - 1));
    const w = T.riverWidthStart + (T.riverWidthEnd - T.riverWidthStart) * (i / samples);
    for (let z = pz - reach; z <= pz + reach; z++) {
      for (let x = px - reach; x <= px + reach; x++) {
        if (g(x, z) < 0) continue;
        const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) - w;
        const k = idx(x, z);
        if (d < (riverDist[k] as number)) {
          riverDist[k] = d;
          riverSurf[k] = surf;
        }
      }
    }
  });

  const waterTop = new Int16Array(sizeX * sizeZ).fill(-1);
  for (let k = 0; k < ground.length; k++) {
    if ((ground[k] as number) < 0) continue;
    const d = riverDist[k] as number;
    const s = riverSurf[k] as number;
    if (d <= 0) {
      ground[k] = Math.min(ground[k] as number, s - 1);
      waterTop[k] = s;
    } else if (d < 3.5 && (ground[k] as number) > T.seaLevel) {
      // Banks ease down toward the water; never below it.
      const bank = s + Math.ceil(d);
      ground[k] = Math.max(s + 1, Math.min(ground[k] as number, bank + 1));
    }
  }

  // ---- 3. Village site -------------------------------------------------------
  const flatness = (x: number, z: number, rad: number) => {
    const c = g(x, z);
    let worst = 0;
    for (let dz = -rad; dz <= rad; dz++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dz * dz > rad * rad) continue;
        const k = idx(x + dx, z + dz);
        if ((waterTop[k] ?? -1) >= 0) return Infinity;
        const h = g(x + dx, z + dz);
        if (h < 0) return Infinity;
        worst = Math.max(worst, Math.abs(h - c));
      }
    return worst;
  };

  let site: Point3 | null = null;
  let siteScore = -Infinity;
  for (let z = 8; z < sizeZ - 8; z += 2) {
    for (let x = 8; x < sizeX - 8; x += 2) {
      const h = g(x, z);
      if (h < T.seaLevel + 2 || h > T.valleyHeight + 3) continue;
      const rd = riverDist[idx(x, z)] as number;
      if (rd < T.villageMinRiverDist || rd > T.villageMaxRiverDist) continue;
      const r = Math.hypot(x - cx, z - cz);
      const ang = Math.atan2(z - cz, x - cx);
      if (r > landRadius(ang) - 10) continue;
      if (Math.hypot(x - hill.x, z - hill.z) < T.hillRadius) continue;
      const f = flatness(x, z, 5);
      if (f > 3) continue;
      const score = -Math.abs(rd - 8) * 0.5 - f * 2 - r * 0.08 + rng.jitter(0.3);
      if (score > siteScore) {
        siteScore = score;
        site = { x, y: h, z };
      }
    }
  }
  if (!site) {
    // Fallback: the valley middle, flattened below.
    site = { x: Math.floor(cx - ridgeDir.x * 6), z: Math.floor(cz - ridgeDir.z * 6), y: T.valleyHeight };
  }
  // Flatten a buildable pad, blending to the surroundings.
  {
    const rad = T.villageFlattenRadius;
    const target = Math.max(T.seaLevel + 2, g(site.x, site.z));
    site.y = target;
    for (let dz = -rad - 3; dz <= rad + 3; dz++)
      for (let dx = -rad - 3; dx <= rad + 3; dx++) {
        const x = site.x + dx;
        const z = site.z + dz;
        const k = idx(x, z);
        if (g(x, z) < 0 || (waterTop[k] as number) >= 0) continue;
        const d = Math.hypot(dx, dz);
        const t = smoothstep(rad + 3, rad, d);
        ground[k] = Math.round((ground[k] as number) + (target - (ground[k] as number)) * t);
      }
  }

  // ---- 4. Fill voxels --------------------------------------------------------
  const slopeAt = (x: number, z: number) => {
    const c = g(x, z);
    let s = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const h = g(x + dx, z + dz);
      s = Math.max(s, h < 0 ? 4 : Math.abs(h - c));
    }
    return s;
  };

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const k = idx(x, z);
      const h = ground[k] as number;
      if (h < 0) continue;
      const dx = x + 0.5 - cx;
      const dz = z + 0.5 - cz;
      const r = Math.hypot(dx, dz);
      const pr = platformRadius(Math.atan2(dz, dx));
      const shell = Math.pow(Math.min(1, r / pr), 1.6);
      const lumpy = 3 * fbm(nUnder, x * 0.09, z * 0.09, 3);
      const bottom = Math.max(
        0,
        Math.round(T.undersideBottom + shell * (T.seaLevel - T.seaDepth - 3 - T.undersideBottom) + lumpy),
      );

      const slope = slopeAt(x, z);
      const isRiver = (waterTop[k] as number) >= 0;
      let top: MaterialId;
      if (slope >= 3) top = M.STONE;
      else if (h > T.valleyHeight + T.rockLine + nDetail(x * 0.2, z * 0.2) * 2) top = M.STONE;
      else if (isRiver) top = M.SAND;
      else if (h <= T.seaLevel + 1) top = M.SAND;
      else top = M.GRASS;

      for (let y = Math.min(bottom, h); y <= h; y++) {
        const depth = h - y;
        let mat: MaterialId;
        if (depth === 0) mat = top;
        else if (depth <= 2 && top !== M.STONE) mat = top === M.SAND ? M.SAND : M.DIRT;
        else if (depth <= 4 && nDetail(x * 0.3 + y, z * 0.3) > 0.2) mat = M.DIRT;
        else mat = M.STONE;
        world.set(x, y, z, mat);
      }

      let wt = isRiver ? (waterTop[k] as number) : -1;
      if (h < T.seaLevel) wt = Math.max(wt, T.seaLevel);
      waterTop[k] = wt;
      for (let y = h + 1; y <= wt; y++) world.set(x, y, z, M.WATER);
    }
  }

  // ---- 5. Trees --------------------------------------------------------------
  const taken = new Uint8Array(sizeX * sizeZ);
  const treeOk = (x: number, z: number) => {
    const k = idx(x, z);
    if (world.get(x, ground[k] as number, z) !== M.GRASS) return false;
    if ((riverDist[k] as number) < 2.5) return false;
    if (Math.hypot(x - site.x, z - site.z) < T.treeClearOfVillage) return false;
    if (slopeAt(x, z) > 1) return false;
    const sp = T.treeSpacing;
    for (let dz = -sp; dz <= sp; dz++)
      for (let dx = -sp; dx <= sp; dx++) if (taken[idx(x + dx, z + dz)]) return false;
    return true;
  };

  for (let z = 4; z < sizeZ - 4; z++) {
    for (let x = 4; x < sizeX - 4; x++) {
      const h = ground[idx(x, z)] as number;
      if (h <= T.seaLevel + 1) continue;
      const forest = fbm(nForest, x * 0.035, z * 0.035, 3);
      const chance = forest > T.forestThreshold ? T.forestTreeChance : T.meadowTreeChance;
      if (!rng.chance(chance) || !treeOk(x, z)) continue;
      taken[idx(x, z)] = 1;
      const pine = h > T.valleyHeight + 7;
      plantTree(world, x, h + 1, z, pine, rng);
    }
  }

  // ---- 6. Landmarks ----------------------------------------------------------
  let ridgePeak: Point3 = { x: 0, y: -1, z: 0 };
  let hillTop: Point3 = { x: Math.round(hill.x), y: -1, z: Math.round(hill.z) };
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++) {
      const h = ground[idx(x, z)] as number;
      const along = (x + 0.5 - cx) * ridgeDir.x + (z + 0.5 - cz) * ridgeDir.z;
      if (along > T.ridgeCrest * 0.6 && h > ridgePeak.y) ridgePeak = { x, y: h, z };
      if (Math.hypot(x - hill.x, z - hill.z) < T.hillRadius * 0.5 && h > hillTop.y) hillTop = { x, y: h, z };
    }
  const sx = Math.floor(src.x);
  const sz = Math.floor(src.z);

  return {
    world,
    ground,
    waterTop,
    landmarks: {
      center: { x: cx, z: cz },
      seaLevel: T.seaLevel,
      ridgeSide,
      ridgeDir,
      ridgePeak,
      eastHill: hillTop,
      villageSite: site,
      riverSource: { x: sx, y: g(sx, sz), z: sz },
      riverMouth,
      riverPath,
    },
  };
}

function plantTree(world: VoxelWorld, x: number, y: number, z: number, pine: boolean, rng: Rng): void {
  const trunk = rng.int(3, pine ? 4 : 5);
  const put = (px: number, py: number, pz: number, m: MaterialId) => {
    if (py < world.sizeY && world.get(px, py, pz) === M.AIR) world.set(px, py, pz, m);
  };
  for (let i = 0; i < trunk; i++) world.set(x, y + i, z, M.WOOD);
  const top = y + trunk;
  if (pine) {
    const layers = [2, 2, 1, 1, 0];
    layers.forEach((rad, i) => {
      for (let dz = -rad; dz <= rad; dz++)
        for (let dx = -rad; dx <= rad; dx++)
          if (Math.abs(dx) + Math.abs(dz) <= rad + (rad > 1 ? 1 : 0)) put(x + dx, top - 2 + i, z + dz, M.PINE_LEAVES);
    });
  } else {
    const rad = 2.3 + rng.range(0, 0.6);
    const cy = top;
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy * 1.25, dz);
          if (d <= rad && (d < rad - 0.6 || rng.chance(0.6))) put(x + dx, cy + dy, z + dz, M.LEAVES);
        }
    for (let i = 0; i < 2; i++) world.set(x, top + i - 1, z, M.WOOD);
  }
}
