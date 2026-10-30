import type { Rng } from '../rng';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import { CROP_STAGES, M, material } from '../world/materials';
import type { NavGrid } from '../world/nav';
import { NEIGHBORS8 } from '../world/nav';
import { prefabsOf, type PrefabKind } from '../world/prefabs';
import {
  firstDamagedStep,
  integrity,
  planSteps,
  rotatedSize,
  rotationToward,
  type FieldTile,
  type Structure,
  type StructureKind,
} from '../world/structures';
import { plantTree, type Point3 } from '../world/terrain';
import type { VoxelWorld } from '../world/VoxelWorld';

const B = TUNING.building;
const FARM = TUNING.farming;
const WORK = TUNING.work;

/** Occupancy markers besides structure ids. */
const PLAZA = -1;
const GRAVEYARD = -2;
/** Fields update their crops every this many ticks. */
const CROP_STEP = 10;
/** After failing to find a site, wait this many days before searching again. */
const SITE_RETRY_DAYS = 3;
/** Build mask bits: walkable in the village region; headroom of 2 / 6 voxels. */
const MASK_OK = 1;
const MASK_CLEAR2 = 2;
const MASK_CLEAR6 = 4;

export interface Tree extends Point3 {
  alive: boolean;
  reservedBy: number;
}

export interface VillageHost {
  readonly tick: number;
  readonly seasonIndex: number;
  readonly raining: boolean;
  emitBuilt(s: Structure): void;
  emitDestroyed(s: Structure): void;
}

/**
 * The village as a whole: shared stores, structures and the planner that decides
 * what to build where. Villagers do the actual work; this only decides and records.
 */
export class Village {
  readonly center: { x: number; z: number; y: number };
  readonly store: { food: number; wood: number; stone: number } = {
    food: WORK.startFood,
    wood: WORK.startWood,
    stone: WORK.startStone,
  };
  /** Running totals for debugging and balance (never reset). */
  readonly stats = { harvested: 0, foraged: 0, eaten: 0, chopped: 0, quarried: 0 };
  readonly structures: Structure[] = [];
  readonly trees: Tree[];
  /** Walkable stone cells near the village, nearest first. */
  readonly stoneSpots: { x: number; z: number }[] = [];
  private readonly occupancy: Int32Array;
  private region: Int32Array;
  /** Walking distance (4-way steps) from the fire, refreshed daily; -1 = not reachable. */
  private walkDist: Int32Array;
  /** Per-cell build suitability (MASK_* bits), refreshed with the walk distances. */
  private readonly buildMask: Uint8Array;
  private nextId = 1;
  private retryHutAt = 0;
  private retryFieldAt = 0;
  graveyard: { x0: number; z0: number; w: number; d: number; used: number } | null = null;
  /** Cell offsets within maxRadius, nearest first. */
  private readonly ring: [number, number][] = [];

  constructor(
    private readonly world: VoxelWorld,
    private readonly nav: NavGrid,
    private readonly rng: Rng,
    site: Point3,
    trees: Point3[],
  ) {
    this.center = { x: site.x, z: site.z, y: site.y };
    this.occupancy = new Int32Array(world.sizeX * world.sizeZ);
    this.region = nav.regions();
    this.walkDist = new Int32Array(world.sizeX * world.sizeZ).fill(-1);
    this.buildMask = new Uint8Array(world.sizeX * world.sizeZ);
    this.trees = trees.map((t) => ({ ...t, alive: true, reservedBy: -1 }));
    const R = B.maxRadius;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R) this.ring.push([dx, dz]);
    this.ring.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);

    for (const [dx, dz] of this.ring) {
      const x = site.x + dx;
      const z = site.z + dz;
      const h = nav.at(x, z);
      if (h >= 0 && world.get(x, h, z) === M.STONE) this.stoneSpots.push({ x, z });
      if (this.stoneSpots.length >= 40) break;
    }
  }

  byId(id: number): Structure | undefined {
    return this.structures.find((s) => s.id === id);
  }

  get huts(): Structure[] {
    return this.structures.filter((s) => s.kind === 'hut');
  }

  get fields(): Structure[] {
    return this.structures.filter((s) => s.kind === 'field');
  }

  usableHut(s: Structure): boolean {
    return s.kind === 'hut' && s.complete && !s.destroyed;
  }

  /** Beds in usable huts, or in every hut including ones being built or repaired. */
  bedCapacity(includePlanned = false): number {
    const huts = this.huts;
    return (includePlanned ? huts.length : huts.filter((h) => this.usableHut(h)).length) * B.hutCapacity;
  }

  regionAt(x: number, z: number): number {
    return this.nav.inBounds(x, z) ? (this.region[x + z * this.world.sizeX] as number) : 0;
  }

  /** Recompute which cells could hold a building (one pass, so site searches are array reads). */
  private refreshBuildMask(): void {
    const region = this.centerRegion;
    const W = this.world.sizeX;
    for (let z = 0; z < this.world.sizeZ; z++)
      for (let x = 0; x < W; x++) {
        const h = this.nav.at(x, z);
        let m = 0;
        if (h >= 0 && this.regionAt(x, z) === region) {
          m = MASK_OK;
          if (this.clearAbove(x, z, h, 2)) {
            m |= MASK_CLEAR2;
            if (this.clearAbove(x, z, h, 6)) m |= MASK_CLEAR6;
          }
        }
        this.buildMask[x + z * W] = m;
      }
  }

  /** Breadth-first walking distance from the fire over the nav grid. */
  private refreshWalkDist(): void {
    const d = this.walkDist;
    d.fill(-1);
    const start = this.nearestWalkable(this.center.x + 2, this.center.z) ?? this.nearestWalkable(this.center.x, this.center.z);
    if (!start) return;
    const W = this.world.sizeX;
    const queue = [start.x + start.z * W];
    d[queue[0]!] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi]!;
      const x = c % W;
      const z = (c / W) | 0;
      for (const [dx, dz] of NEIGHBORS8.slice(0, 4)) {
        const n = x + dx + (z + dz) * W;
        if (!this.nav.canStep(x, z, x + dx, z + dz) || d[n] !== -1) continue;
        d[n] = (d[c] as number) + 1;
        queue.push(n);
      }
    }
  }

  /**
   * Cheap reachability pre-check from the (daily) region map, so agents don't run
   * doomed A* searches toward targets across water or cliffs.
   */
  reachable(sx: number, sz: number, tx: number, tz: number, adjacent: boolean, radius = 1): boolean {
    const from = this.regionAt(sx, sz);
    if (!from) return true; // standing somewhere new; let A* decide
    if (this.regionAt(tx, tz) === from) return true;
    if (!adjacent) return false;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) if (this.regionAt(tx + dx, tz + dz) === from) return true;
    return false;
  }

  /** Region of the walkable ground around the fire (the fire cell itself is not walkable). */
  get centerRegion(): number {
    const c = this.nearestWalkable(this.center.x + 2, this.center.z) ?? this.nearestWalkable(this.center.x, this.center.z);
    return c ? this.regionAt(c.x, c.z) : 0;
  }

  // ---------------------------------------------------------------- setup

  /** Founding layout: fire pit + plaza, graveyard, some huts and fields, built instantly. */
  found(host: VillageHost, huts: number, fields: number): void {
    this.refreshWalkDist();
    this.refreshBuildMask();
    const pit = this.placePrefab(host, 'firePit', this.center.x, this.center.z, true);
    if (pit) {
      this.center.y = pit.baseY - 1;
    }
    // Keep a plaza clear around the fire for gatherings.
    for (let dz = -4; dz <= 4; dz++)
      for (let dx = -4; dx <= 4; dx++) {
        const k = this.center.x + dx + (this.center.z + dz) * this.world.sizeX;
        if (dx * dx + dz * dz <= 16 && this.occupancy[k] === 0) this.occupancy[k] = PLAZA;
      }
    this.refreshWalkDist();
    this.refreshBuildMask();
    this.reserveGraveyard();
    for (let i = 0; i < huts; i++) this.placePrefab(host, 'hut', this.center.x, this.center.z, true);
    for (let i = 0; i < fields; i++) {
      const f = this.placeField(host, true);
      if (f) for (const t of f.tiles) this.plant(t, this.rng.range(0, 0.9));
    }
    this.region = this.nav.regions();
  }

  // ---------------------------------------------------------------- sites

  private occupied(x: number, z: number): boolean {
    if (!this.nav.inBounds(x, z)) return true;
    return this.occupancy[x + z * this.world.sizeX] !== 0;
  }

  private clearAbove(x: number, z: number, h: number, up: number): boolean {
    for (let y = h + 1; y <= h + up; y++) if (this.world.get(x, y, z) !== M.AIR) return false;
    return true;
  }

  /**
   * Find the nearest footprint (w×d) around (cx, cz) whose cells are walkable, in
   * the village's region, unoccupied (with a one-cell margin), within `maxDh` in
   * height, and clear of foliage up to `clearance`.
   */
  private findSite(
    cx: number,
    cz: number,
    w: number,
    d: number,
    maxR: number,
    clearance: number,
    accept?: (x0: number, z0: number) => boolean,
  ): { x0: number; z0: number; hMin: number; hMax: number } | null {
    const need = clearance <= 2 ? MASK_CLEAR2 : MASK_CLEAR6;
    for (const [dx, dz] of this.ring) {
      if (dx * dx + dz * dz > maxR * maxR) break;
      const x0 = cx + dx - (w >> 1);
      const z0 = cz + dz - (d >> 1);
      let ok = true;
      let hMin = Infinity;
      let hMax = -Infinity;
      for (let z = z0 - 1; z <= z0 + d && ok; z++)
        for (let x = x0 - 1; x <= x0 + w && ok; x++) {
          if (this.occupied(x, z)) ok = false;
          else if (x >= x0 && x < x0 + w && z >= z0 && z < z0 + d) {
            const k = x + z * this.world.sizeX;
            const h = this.nav.at(x, z);
            if (((this.buildMask[k] as number) & (MASK_OK | need)) !== (MASK_OK | need)) ok = false;
            else {
              hMin = Math.min(hMin, h);
              hMax = Math.max(hMax, h);
              if (hMax - hMin > 1) ok = false;
            }
          }
        }
      if (ok) {
        // Reject sites that are close as the crow flies but a long walk around water or cliffs.
        const wd = this.walkDist[x0 + (w >> 1) + (z0 + (d >> 1)) * this.world.sizeX] as number;
        if (wd >= 0 && wd > Math.hypot(dx, dz) * 1.5 + 6) ok = false;
      }
      if (ok && (!accept || accept(x0, z0))) return { x0, z0, hMin, hMax };
    }
    return null;
  }

  private markOccupied(s: { x0: number; z0: number; w: number; d: number }, id: number): void {
    for (let z = s.z0; z < s.z0 + s.d; z++)
      for (let x = s.x0; x < s.x0 + s.w; x++) this.occupancy[x + z * this.world.sizeX] = id;
  }

  private newStructure(kind: StructureKind, variant: string, tick: number): Structure {
    return {
      id: this.nextId++,
      kind,
      variant,
      x0: 0,
      z0: 0,
      w: 0,
      d: 0,
      baseY: 0,
      rot: 0,
      steps: [],
      next: 0,
      complete: false,
      destroyed: false,
      bornTick: tick,
      progressTick: tick,
      door: { x: 0, z: 0 },
      residents: [],
      tiles: [],
      moisture: 0.6,
      nearWater: false,
    };
  }

  get maxRadius(): number {
    const pop = this.population;
    return Math.min(B.maxRadius, B.baseRadius + pop * B.radiusPerPerson);
  }

  /** Set by the sim each day; used for the planner's radius. */
  population = 0;

  placePrefab(host: VillageHost, kind: PrefabKind, nearX: number, nearZ: number, instant: boolean): Structure | null {
    const variants = prefabsOf(kind);
    const p = this.rng.pick(variants);
    // Rotation depends on where the site lands; try the rotation toward center for a provisional size.
    for (const rot of [0, 1]) {
      const { w, d } = rotatedSize(p, rot);
      const clearance = kind === 'grave' ? 1 : 6;
      const accept = (x0: number, z0: number) => {
        const r = rotationToward(x0 + w / 2, z0 + d / 2, this.center.x + 0.5, this.center.z + 0.5);
        return (r & 1) === rot || kind === 'firePit' || kind === 'well';
      };
      // Prefer the compact village radius; spread out to the full radius when it's full.
      const site =
        kind === 'firePit'
          ? this.findSite(nearX, nearZ, w, d, 4, clearance, accept)
          : (this.findSite(nearX, nearZ, w, d, this.maxRadius, clearance, accept) ??
            this.findSite(nearX, nearZ, w, d, B.maxRadius, clearance, accept));
      if (!site) continue;
      const finalRot =
        kind === 'firePit' || kind === 'well' || kind === 'grave'
          ? rot
          : rotationToward(site.x0 + w / 2, site.z0 + d / 2, this.center.x + 0.5, this.center.z + 0.5);
      const s = this.newStructure(kind, p.variant, host.tick);
      s.x0 = site.x0;
      s.z0 = site.z0;
      s.w = w;
      s.d = d;
      s.rot = finalRot;
      s.baseY = site.hMax + 1;
      const plan = planSteps(p, s.x0, s.z0, s.baseY, finalRot, (x, z) => this.nav.at(x, z));
      s.steps = plan.steps;
      s.door = plan.door ?? this.accessCells(s)[0] ?? { x: s.x0 - 1, z: s.z0 };
      this.structures.push(s);
      this.markOccupied(s, s.id);
      if (kind === 'firePit' || kind === 'well')
        for (let z = s.z0; z < s.z0 + s.d; z++) for (let x = s.x0; x < s.x0 + s.w; x++) this.nav.setBlocked(x, z, true);
      if (plan.door) this.occupancy[plan.door.x + plan.door.z * this.world.sizeX] = PLAZA;
      if (instant) this.finishInstantly(host, s);
      return s;
    }
    return null;
  }

  placeField(host: VillageHost, instant: boolean): Structure | null {
    const n = FARM.fieldSize;
    // Prefer spots near water (irrigated); fall back to anything.
    const nearWater = (x0: number, z0: number) => this.waterNear(x0 + n / 2, z0 + n / 2, FARM.riverReach + n / 2);
    const site =
      this.findSite(this.center.x, this.center.z, n, n, this.maxRadius, 2, nearWater) ??
      this.findSite(this.center.x, this.center.z, n, n, this.maxRadius, 2) ??
      this.findSite(this.center.x, this.center.z, n, n, B.maxRadius, 2);
    if (!site) return null;
    const s = this.newStructure('field', 'plot', host.tick);
    s.x0 = site.x0;
    s.z0 = site.z0;
    s.w = n;
    s.d = n;
    s.baseY = site.hMax + 1;
    s.nearWater = nearWater(site.x0, site.z0);
    for (let z = s.z0; z < s.z0 + n; z++)
      for (let x = s.x0; x < s.x0 + n; x++)
        s.tiles.push({ x, z, y: this.nav.at(x, z), state: 0, progress: 0, health: 1, reservedBy: -1 });
    s.door = { x: s.x0 + (n >> 1), z: s.z0 + (n >> 1) };
    this.structures.push(s);
    this.markOccupied(s, s.id);
    if (instant) {
      for (const t of s.tiles) this.till(t);
      s.complete = true;
    }
    return s;
  }

  private waterNear(x: number, z: number, r: number): boolean {
    for (let dz = -r; dz <= r; dz += 1)
      for (let dx = -r; dx <= r; dx += 1) {
        const wx = Math.round(x + dx);
        const wz = Math.round(z + dz);
        if (this.nav.inBounds(wx, wz) && this.nav.at(wx, wz) < 0) {
          const top = this.world.topY(wx, wz, (id) => id !== M.AIR);
          if (top >= 0 && this.world.get(wx, top, wz) === M.WATER) return true;
        }
      }
    return false;
  }

  private finishInstantly(host: VillageHost, s: Structure): void {
    for (const st of s.steps) this.world.set(st.x, st.y, st.z, st.mat);
    s.next = s.steps.length;
    s.complete = true;
    host.emitBuilt(s);
  }

  /** Walkable cells bordering a structure's footprint. */
  accessCells(s: Structure): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (let z = s.z0 - 1; z <= s.z0 + s.d; z++)
      for (let x = s.x0 - 1; x <= s.x0 + s.w; x++) {
        const inside = x >= s.x0 && x < s.x0 + s.w && z >= s.z0 && z < s.z0 + s.d;
        if (!inside && this.nav.walkable(x, z)) out.push({ x, z });
      }
    return out;
  }

  // ---------------------------------------------------------------- building

  /** Cost of a build step in stores; null if free. */
  stepCost(mat: number): 'wood' | 'stone' | null {
    if (mat === M.PLANK || mat === M.THATCH || mat === M.WOOD) return 'wood';
    if (mat === M.STONE) return 'stone';
    return null;
  }

  /**
   * Place the structure's next block if stores allow. Returns false when it
   * can't (out of materials) or the structure is done.
   */
  buildNext(host: VillageHost, s: Structure): boolean {
    while (s.next < s.steps.length) {
      const st = s.steps[s.next]!;
      if (this.world.get(st.x, st.y, st.z) === st.mat) {
        s.next++;
        continue;
      }
      const cost = this.stepCost(st.mat);
      if (cost && this.store[cost] < 1) return false;
      if (cost) this.store[cost] -= 1;
      this.world.set(st.x, st.y, st.z, st.mat);
      s.next++;
      s.progressTick = host.tick;
      break;
    }
    if (s.next >= s.steps.length && !s.complete) {
      s.complete = true;
      if (s.destroyed) s.destroyed = false;
      host.emitBuilt(s);
    }
    return true;
  }

  /** Structures with blocks left to place, oldest first. */
  constructionSites(): Structure[] {
    return this.structures.filter((s) => s.kind !== 'field' && s.kind !== 'grave' && !s.complete);
  }

  // ---------------------------------------------------------------- farming

  till(t: FieldTile): void {
    const h = this.nav.at(t.x, t.z);
    if (h < 0) return;
    t.y = h;
    if (this.world.get(t.x, h, t.z) !== M.ASH) this.world.set(t.x, h, t.z, M.DIRT);
    t.state = 1;
    t.progress = 0;
  }

  plant(t: FieldTile, progress = 0): void {
    t.state = 2;
    t.progress = progress;
    t.health = 1;
    this.world.set(t.x, t.y + 1, t.z, CROP_STAGES[this.stageOf(progress) - 1]!);
  }

  harvest(t: FieldTile): number {
    const soil = material(this.world.get(t.x, t.y, t.z));
    const food = FARM.yieldPerTile * (0.7 + 0.6 * soil.fertility);
    this.world.set(t.x, t.y + 1, t.z, M.AIR);
    t.state = 1;
    t.progress = 0;
    return food;
  }

  private stageOf(progress: number): number {
    return Math.min(4, 1 + Math.floor(progress * 4));
  }

  /** What a farmer should do to this tile now, if anything. */
  tileWork(t: FieldTile, season: number): 'till' | 'plant' | 'harvest' | null {
    if (t.state === 0) return 'till';
    if (t.state === 1) return FARM.seasonGrowth[season]! > 0 ? 'plant' : null;
    if (t.progress >= 1) return 'harvest';
    return null;
  }

  /** Daily: drop field tiles whose ground can no longer be stood on (buried, flooded, built over). */
  pruneFieldTiles(): void {
    for (const f of this.fields) {
      f.tiles = f.tiles.filter((t) => t.state !== 0 || this.nav.walkable(t.x, t.z));
    }
  }

  /** Per tick: field moisture and crop growth. */
  growCrops(host: VillageHost): void {
    const season = host.seasonIndex;
    // Each field updates every CROP_STEP ticks (staggered by id), with rates scaled to match.
    const decay = (FARM.moistureDecayPerDay[season]! / TICKS_PER_DAY) * CROP_STEP;
    const seasonRate = FARM.seasonGrowth[season]!;
    for (const f of this.structures) {
      if (f.kind !== 'field' || (host.tick + f.id) % CROP_STEP !== 0) continue;
      f.moisture = Math.max(0, f.moisture - decay);
      if (host.raining) f.moisture = Math.min(1, f.moisture + FARM.rainMoisturePerTick * CROP_STEP);
      if (f.nearWater) f.moisture = Math.max(f.moisture, FARM.riverMoisture);
      const wet = Math.min(1, Math.max(0, (f.moisture - 0.04) / 0.3));
      let untilled = 0;
      for (const t of f.tiles) {
        if (t.state === 0) untilled++;
        if (t.state !== 2) continue;
        if (!material(this.world.get(t.x, t.y + 1, t.z)).cropStage) {
          // Burned, trampled by a builder or otherwise gone.
          t.state = this.nav.at(t.x, t.z) === t.y ? 1 : 0;
          continue;
        }
        if (f.moisture < FARM.witherBelow) {
          t.health -= (FARM.witherPerDay / TICKS_PER_DAY) * CROP_STEP;
          if (t.health <= 0) {
            this.world.set(t.x, t.y + 1, t.z, M.AIR);
            t.state = 1;
            continue;
          }
        }
        if (t.progress >= 1) continue;
        const soil = material(this.world.get(t.x, t.y, t.z)).fertility;
        const before = this.stageOf(t.progress);
        t.progress = Math.min(1, t.progress + FARM.growthPerTick * CROP_STEP * seasonRate * wet * (0.7 + 0.6 * soil));
        const after = this.stageOf(t.progress);
        if (after !== before) this.world.set(t.x, t.y + 1, t.z, CROP_STAGES[after - 1]!);
      }
      if (!f.complete && untilled <= f.tiles.length * 0.2) f.complete = true;
    }
  }

  // ---------------------------------------------------------------- trees

  treeAlive(t: Tree): boolean {
    if (!t.alive) return false;
    if (this.world.get(t.x, t.y, t.z) !== M.WOOD) t.alive = false;
    return t.alive;
  }

  /** Fell a tree: remove its trunk and the foliage attached to it. Returns wood gained. */
  fell(t: Tree): number {
    let trunk = 0;
    const stack: [number, number, number][] = [[t.x, t.y, t.z]];
    const seen = new Set<number>();
    while (stack.length) {
      const [x, y, z] = stack.pop()!;
      const k = x + 200 * (z + 200 * y);
      if (seen.has(k)) continue;
      seen.add(k);
      if (Math.abs(x - t.x) > 3 || Math.abs(z - t.z) > 3 || y < t.y || y > t.y + 9) continue;
      const id = this.world.get(x, y, z);
      if (id !== M.WOOD && id !== M.LEAVES && id !== M.PINE_LEAVES) continue;
      if (id === M.WOOD) trunk++;
      this.world.set(x, y, z, M.AIR);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const)
        stack.push([x + dx, y + dy, z + dz]);
    }
    t.alive = false;
    t.reservedBy = -1;
    return trunk * WORK.woodPerTrunkBlock + WORK.woodPerTreeBonus;
  }

  /** Daily: a few new trees sprout near existing ones, away from the village core. */
  sproutTrees(): void {
    let n = Math.floor(WORK.treeSproutPerDay) + (this.rng.chance(WORK.treeSproutPerDay % 1) ? 1 : 0);
    const living = this.trees.filter((t) => t.alive);
    for (let tries = 0; n > 0 && tries < 20 && living.length; tries++) {
      const parent = this.rng.pick(living);
      const x = parent.x + this.rng.int(-7, 7);
      const z = parent.z + this.rng.int(-7, 7);
      const h = this.nav.at(x, z);
      if (h < 0 || this.world.get(x, h, z) !== M.GRASS) continue;
      if (Math.hypot(x - this.center.x, z - this.center.z) < 9) continue;
      let blocked = false;
      for (let dz = -3; dz <= 3 && !blocked; dz++)
        for (let dx = -3; dx <= 3 && !blocked; dx++) {
          if (this.occupied(x + dx, z + dz)) blocked = true;
          else if (!this.clearAbove(x + dx, z + dz, Math.max(h, this.nav.at(x + dx, z + dz)), 8)) blocked = true;
        }
      if (blocked) continue;
      plantTree(this.world, x, h + 1, z, h > TUNING.terrain.valleyHeight + 7, this.rng);
      this.trees.push({ x, y: h + 1, z, alive: true, reservedBy: -1 });
      n--;
    }
    // Drop long-dead entries so the list stays small.
    if (this.trees.length > 600) {
      const keep = this.trees.filter((t) => t.alive);
      this.trees.length = 0;
      this.trees.push(...keep);
    }
  }

  // ---------------------------------------------------------------- graves

  private reserveGraveyard(): void {
    const site = this.findSite(this.center.x, this.center.z, 5, 5, this.maxRadius + 6, 2, (x0, z0) => {
      const d = Math.hypot(x0 + 2.5 - this.center.x, z0 + 2.5 - this.center.z);
      return d >= 12;
    });
    if (!site) return;
    this.graveyard = { x0: site.x0, z0: site.z0, w: 5, d: 5, used: 0 };
    this.markOccupied(this.graveyard, GRAVEYARD);
  }

  /** Put a grave mound in the graveyard (next free plot). */
  placeGrave(host: VillageHost): Structure | null {
    if (!this.graveyard || this.graveyard.used >= 9) {
      this.reserveGraveyard();
      if (!this.graveyard) return null;
    }
    const g = this.graveyard;
    // Plots on every other cell so mounds don't merge.
    const i = g.used++;
    const x = g.x0 + (i % 3) * 2;
    const z = g.z0 + Math.floor(i / 3) * 2;
    const h = this.nav.at(x, z);
    if (h < 0) return null;
    const s = this.newStructure('grave', 'mound', host.tick);
    s.x0 = x;
    s.z0 = z;
    s.w = 1;
    s.d = 1;
    s.baseY = h + 1;
    s.steps = [{ x, y: h + 1, z, mat: M.DIRT }];
    s.door = { x, z };
    this.structures.push(s);
    this.finishInstantly(host, s);
    return s;
  }

  // ---------------------------------------------------------------- daily

  /** Daily: surplus food beyond a reserve per person spoils. */
  spoil(): void {
    const free = WORK.spoilFreePerCapita * Math.max(1, this.population);
    if (this.store.food > free) this.store.food -= (this.store.food - free) * WORK.spoilagePerDay;
  }

  /** Daily: decide what to build next. */
  plan(host: VillageHost): void {
    this.region = this.nav.regions();
    this.refreshWalkDist();
    this.refreshBuildMask();
    this.pruneFieldTiles();
    this.abandonStalled(host);
    const pop = this.population;
    const sites = this.constructionSites();
    const hutsBuilding = sites.filter((s) => s.kind === 'hut').length;
    // Failed searches are expensive (the whole radius), so back off for a few days after one.
    if (this.bedCapacity(true) < pop + B.spareBeds && hutsBuilding < (pop > 40 ? 2 : 1) && host.tick >= this.retryHutAt) {
      if (!this.placePrefab(host, 'hut', this.center.x, this.center.z, false)) this.retryHutAt = host.tick + SITE_RETRY_DAYS * TICKS_PER_DAY;
    }
    const fields = this.fields;
    const fieldTarget = Math.ceil(pop * FARM.fieldsPerPerson) + 1;
    const fieldsInProgress = fields.filter((f) => !f.complete).length;
    if (fields.length < fieldTarget && fieldsInProgress < 2 && host.tick >= this.retryFieldAt) {
      if (!this.placeField(host, false)) this.retryFieldAt = host.tick + SITE_RETRY_DAYS * TICKS_PER_DAY;
    }
    if (pop >= B.wellAtPopulation && !this.structures.some((s) => s.kind === 'well')) {
      this.placePrefab(host, 'well', this.center.x, this.center.z, false);
    }
  }

  /** Give up on construction sites nobody has managed to work on for a while. */
  private abandonStalled(host: VillageHost): void {
    const limit = B.abandonAfterDays * TICKS_PER_DAY;
    for (const s of [...this.structures]) {
      if (s.complete || s.kind === 'grave' || host.tick - s.progressTick < limit) continue;
      if (s.kind === 'field' ? s.tiles.some((t) => t.state !== 0) : s.next > 0 && !s.destroyed) continue; // started: keep going
      this.structures.splice(this.structures.indexOf(s), 1);
      for (let z = s.z0 - 1; z <= s.z0 + s.d; z++)
        for (let x = s.x0 - 1; x <= s.x0 + s.w; x++) {
          const k = x + z * this.world.sizeX;
          if (this.nav.inBounds(x, z) && (this.occupancy[k] === s.id || (this.occupancy[k] === PLAZA && x === s.door.x && z === s.door.z))) this.occupancy[k] = 0;
        }
    }
  }

  /** Daily: notice damage. Damaged buildings reopen for repair; badly damaged ones count as destroyed. */
  inspect(host: VillageHost): void {
    for (const s of this.structures) {
      if (s.kind === 'field' || s.kind === 'grave' || !s.complete) continue;
      const bad = firstDamagedStep(this.world, s);
      if (bad < 0) continue;
      if (!s.destroyed && integrity(this.world, s) < B.destroyedBelow) {
        s.destroyed = true;
        s.residents = [];
        host.emitDestroyed(s);
      }
      s.complete = false;
      s.next = bad;
    }
  }

  /** Are any of the 8 cells around (x, z) walkable? Used to unstick agents. */
  nearestWalkable(x: number, z: number): { x: number; z: number } | null {
    if (this.nav.walkable(x, z)) return { x, z };
    for (let r = 1; r < 6; r++)
      for (const [dx, dz] of NEIGHBORS8) {
        const nx = x + dx * r;
        const nz = z + dz * r;
        if (this.nav.walkable(nx, nz)) return { x: nx, z: nz };
      }
    return null;
  }
}
