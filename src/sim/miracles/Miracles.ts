import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import { CROP_STAGES, M, material, type MaterialId } from '../world/materials';
import { plantTree } from '../world/terrain';
import { DREAM_SYMBOLS, miracleDef, type DreamSymbol, type MiracleId } from './defs';

const G = TUNING.grace;
const MT = TUNING.miracles;

/**
 * Player input. Everything the player does to the world goes through these
 * commands, applied at the start of a tick and recorded in the input log, so a
 * seed plus an input log reproduces a game exactly.
 */
export type Command =
  | { type: 'cast'; miracle: 'rain' | 'lightning' | 'bloom'; x: number; z: number }
  | { type: 'stroke'; x: number; z: number; raise: boolean }
  | { type: 'moveCloud'; cloudId: number; x: number; z: number }
  | { type: 'dream'; villagerId: number; symbols: DreamSymbol[] };

export type CastFailure = 'grace' | 'cooldown' | 'night' | 'target' | 'interval';

export interface RainCloud {
  id: number;
  x: number;
  z: number;
  radius: number;
  ticksLeft: number;
}

/** Ground column top for reshaping: the highest terrain voxel, ignoring water, plants and decor. */
const NOT_GROUND = new Set<MaterialId>([
  M.AIR,
  M.WATER,
  M.LEAVES,
  M.PINE_LEAVES,
  M.WOOD,
  M.CROP_1,
  M.CROP_2,
  M.CROP_3,
  M.CROP_4,
  M.FLOWER_RED,
  M.FLOWER_GOLD,
]);

/**
 * The god's side of the sim: Grace, cooldowns, and the five miracles (SPEC §6, §10).
 */
export class Miracles {
  grace: number = G.start;
  /** Tick at which each miracle is ready again. */
  readonly readyAt: Record<MiracleId, number> = { rain: 0, lightning: 0, shapeEarth: 0, bloom: 0, dream: 0 };
  readonly clouds: RainCloud[] = [];
  private nextCloudId = 1;
  private lastStrokeTick = -Infinity;
  /** Most recent outcome per command, for UI feedback. */
  lastFailure: CastFailure | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  get cap(): number {
    const believers = this.sim.villagers.alive.filter((v) => v.faith.love + v.faith.fear >= 0.1).length;
    return G.capBase + G.capPerBeliever * believers;
  }

  /** Grace per day at the current level of faith. */
  get regenPerDay(): number {
    let faith = 0;
    for (const v of this.sim.villagers.alive) faith += v.faith.love + v.faith.fear;
    return G.regenBasePerDay + G.regenPerFaithPerDay * faith;
  }

  isNight(): boolean {
    const f = this.sim.calendar.dayFraction;
    return f >= TUNING.villagers.gatheringEndsAt || f < TUNING.time.dawnAt;
  }

  /** Why a miracle can't be cast right now, or null if it can. */
  check(id: MiracleId): CastFailure | null {
    const def = miracleDef(id);
    if (this.sim.tick < this.readyAt[id]) return 'cooldown';
    if (this.grace < def.cost) return 'grace';
    if (def.nightOnly && !this.isNight()) return 'night';
    return null;
  }

  /** Cooldown progress 0..1 (1 = ready), for the miracle bar. */
  readiness(id: MiracleId): number {
    const def = miracleDef(id);
    if (def.cooldownTicks <= 0) return 1;
    const left = this.readyAt[id] - this.sim.tick;
    return left <= 0 ? 1 : 1 - left / def.cooldownTicks;
  }

  private spend(id: MiracleId): void {
    const def = miracleDef(id);
    this.grace -= def.cost;
    this.readyAt[id] = this.sim.tick + def.cooldownTicks;
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    // Grace regenerates with faith, up to a cap that grows with the number of believers.
    const cap = this.cap;
    if (this.grace < cap) this.grace = Math.min(cap, this.grace + this.regenPerDay / TICKS_PER_DAY);
    if (sim.mode === 'sandbox' && this.grace < G.sandboxFloor) {
      this.grace = Math.min(G.sandboxFloor, this.grace + (G.regenBasePerDay * 3) / TICKS_PER_DAY);
    }

    // Rain clouds water the ground beneath them and douse fires.
    for (const c of this.clouds) {
      c.ticksLeft--;
      for (const f of sim.village.fields) {
        const fx = f.x0 + f.w / 2;
        const fz = f.z0 + f.d / 2;
        if (Math.hypot(fx - c.x, fz - c.z) <= c.radius + 1) f.moisture = Math.min(1, f.moisture + MT.rain.moisturePerTick);
      }
      for (const k of [...sim.fire.burning.keys()]) {
        const [bx, , bz] = sim.fire.unkey(k);
        if (Math.hypot(bx + 0.5 - c.x, bz + 0.5 - c.z) <= c.radius && this.rng.chance(MT.rain.dousePerTick))
          sim.fire.burning.delete(k);
      }
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) if (this.clouds[i]!.ticksLeft <= 0) this.clouds.splice(i, 1);
  }

  // ------------------------------------------------------------------ commands

  apply(cmd: Command): CastFailure | null {
    let fail: CastFailure | null = null;
    switch (cmd.type) {
      case 'cast':
        fail = this.check(cmd.miracle);
        if (!fail) {
          this.spend(cmd.miracle);
          if (cmd.miracle === 'rain') this.rain(cmd.x, cmd.z);
          else if (cmd.miracle === 'lightning') this.lightning(cmd.x, cmd.z);
          else this.bloom(cmd.x, cmd.z);
        }
        break;
      case 'stroke':
        if (this.sim.tick - this.lastStrokeTick < MT.shapeEarth.strokeInterval) fail = 'interval';
        else fail = this.check('shapeEarth');
        if (!fail) {
          this.spend('shapeEarth');
          this.lastStrokeTick = this.sim.tick;
          this.shapeEarth(cmd.x, cmd.z, cmd.raise);
        }
        break;
      case 'moveCloud': {
        const c = this.clouds.find((o) => o.id === cmd.cloudId);
        if (c) {
          c.x = cmd.x;
          c.z = cmd.z;
        } else fail = 'target';
        break;
      }
      case 'dream':
        fail = this.check('dream') ?? this.dreamCheck(cmd.villagerId, cmd.symbols);
        if (!fail) {
          this.spend('dream');
          this.dream(cmd.villagerId, cmd.symbols);
        }
        break;
    }
    this.lastFailure = fail;
    return fail;
  }

  // ------------------------------------------------------------------ the miracles

  private rain(x: number, z: number): void {
    const c: RainCloud = { id: this.nextCloudId++, x, z, radius: MT.rain.radius, ticksLeft: MT.rain.durationTicks };
    this.clouds.push(c);
    this.sim.events.push(this.sim.tick, { type: 'miracleRain', cloudId: c.id, x, z, radius: c.radius });
  }

  /** Lightning lands near, not exactly on, the aim point. */
  private lightning(aimX: number, aimZ: number): void {
    const sim = this.sim;
    const L = MT.lightning;
    let x = aimX + this.rng.gaussian() * L.spread;
    let z = aimZ + this.rng.gaussian() * L.spread;
    if (this.rng.chance(L.wildMissChance)) {
      const a = this.rng.range(0, Math.PI * 2);
      x += Math.cos(a) * L.wildMissDistance;
      z += Math.sin(a) * L.wildMissDistance;
    }
    const sx = Math.max(1, Math.min(sim.world.sizeX - 2, Math.round(x)));
    const sz = Math.max(1, Math.min(sim.world.sizeZ - 2, Math.round(z)));
    sim.strikeLightning(sx, sz, true, aimX, aimZ);

    // A god's bolt leaves its mark: scorched ground, and everyone nearby shaken.
    const r = L.scorchRadius;
    for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dz);
        if (d > r || !this.rng.chance(1 - d / (r + 0.5))) continue;
        const gx = sx + dx;
        const gz = sz + dz;
        const top = sim.world.topY(gx, gz, (id) => !NOT_GROUND.has(id));
        if (top >= 0 && sim.world.get(gx, top, gz) === M.GRASS) sim.world.set(gx, top, gz, M.ASH);
      }
    for (const v of sim.villagers.alive) {
      if (Math.hypot(v.x - (sx + 0.5), v.z - (sz + 0.5)) <= L.injureRadius) v.needs.safety = 0;
    }
  }

  /** Topmost ground voxel y in a column, or -1. */
  groundY(x: number, z: number): number {
    return this.sim.world.topY(x, z, (id) => !NOT_GROUND.has(id));
  }

  /** One brush stroke: raise or lower ground columns in a circle; structures there shake. */
  private shapeEarth(cx: number, cz: number, raise: boolean): void {
    const sim = this.sim;
    const w = sim.world;
    const S = MT.shapeEarth;
    const r = S.radius;
    let columns = 0;
    const shaken = new Set<number>();
    const sea = TUNING.terrain.seaLevel;

    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > r + 0.25) continue;
        // Soft edge: the rim only sometimes moves.
        if (d > r - 1 && !this.rng.chance(0.5)) continue;
        const x = Math.round(cx) + dx;
        const z = Math.round(cz) + dz;
        if (x < 1 || z < 1 || x >= w.sizeX - 1 || z >= w.sizeZ - 1) continue;

        const s = sim.village.structureAt(x, z);
        if (s && s.kind !== 'field') {
          // Don't lift buildings bodily; shake them instead.
          for (const st of s.steps) {
            if (st.x !== x || st.z !== z || st.mat === M.AIR) continue;
            if (w.get(st.x, st.y, st.z) === st.mat && this.rng.chance(S.collapseChance)) {
              w.set(st.x, st.y, st.z, M.AIR);
              shaken.add(s.id);
            }
          }
          continue;
        }

        const g = this.groundY(x, z);
        if (g < 0) continue;
        // Trees standing here topple.
        const tree = sim.village.trees.find((t) => t.alive && t.x === x && t.z === z);
        if (tree) sim.village.fell(tree);

        const top = w.get(x, g, z);
        if (raise) {
          if (g + 1 > S.maxY) continue;
          const above = g + 1 > sea ? (top === M.SAND && g + 1 <= sea + 2 ? M.SAND : top === M.STONE ? M.STONE : M.GRASS) : M.SAND;
          if (top === M.GRASS) w.set(x, g, z, M.DIRT);
          w.set(x, g + 1, z, above);
          // Whatever sat on the old surface (crops, flowers) is buried or knocked off.
          const deco = w.get(x, g + 2, z);
          if (material(deco).cropStage || material(deco).decor) w.set(x, g + 2, z, M.AIR);
        } else {
          if (g - 1 < S.minY) continue;
          const deco = w.get(x, g + 1, z);
          if (material(deco).cropStage || material(deco).decor) w.set(x, g + 1, z, M.AIR);
          // Below the waterline, the hole floods if water is next to it.
          const wet =
            w.get(x, g + 1, z) === M.WATER ||
            (g <= sea && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, az]) => w.get(x + ax!, g, z + az!) === M.WATER));
          w.set(x, g, z, wet ? M.WATER : M.AIR);
          const under = w.get(x, g - 1, z);
          if (!wet && under === M.DIRT) w.set(x, g - 1, z, g - 1 > sea ? M.GRASS : M.SAND);
        }
        columns++;
      }

    sim.events.push(sim.tick, {
      type: 'earthShaped',
      x: cx,
      z: cz,
      radius: r,
      raise,
      columns,
      shaken: shaken.size,
    });
  }

  /** Crops ripen, flowers open, a few saplings spring up. */
  private bloom(cx: number, cz: number): void {
    const sim = this.sim;
    const w = sim.world;
    const B = MT.bloom;
    let crops = 0;
    let flowers = 0;
    for (const f of sim.village.fields) {
      for (const t of f.tiles) {
        if (Math.hypot(t.x + 0.5 - cx, t.z + 0.5 - cz) > B.radius) continue;
        if (t.state === 1) sim.village.plant(t);
        if (t.state === 2) {
          t.progress = 1;
          t.health = 1;
          w.set(t.x, t.y + 1, t.z, CROP_STAGES[3]!);
          crops++;
        }
      }
      if (Math.hypot(f.x0 + f.w / 2 - cx, f.z0 + f.d / 2 - cz) <= B.radius + 2) f.moisture = Math.max(f.moisture, 0.6);
    }
    const r = Math.ceil(B.radius);
    const grassSpots: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dz) > B.radius) continue;
        const x = Math.round(cx) + dx;
        const z = Math.round(cz) + dz;
        const g = this.groundY(x, z);
        if (g < 0 || w.get(x, g, z) !== M.GRASS || w.get(x, g + 1, z) !== M.AIR) continue;
        if (sim.village.structureAt(x, z)) continue;
        grassSpots.push([x, g, z]);
        if (this.rng.chance(B.flowerChance)) {
          w.set(x, g + 1, z, this.rng.chance(0.5) ? M.FLOWER_RED : M.FLOWER_GOLD);
          flowers++;
        }
      }
    // A couple of saplings, where there's room.
    let planted = 0;
    this.rng.shuffle(grassSpots);
    for (const [x, g, z] of grassSpots) {
      if (planted >= B.saplings) break;
      if (!sim.village.canPlantTree(x, z)) continue;
      plantTree(w, x, g + 1, z, false, this.rng);
      sim.village.trees.push({ x, y: g + 1, z, alive: true, reservedBy: -1 });
      planted++;
    }
    sim.events.push(sim.tick, { type: 'bloom', x: cx, z: cz, radius: B.radius, crops, flowers });
  }

  private dreamCheck(villagerId: number, symbols: DreamSymbol[]): CastFailure | null {
    const v = this.sim.villagers.byId(villagerId);
    if (!v?.alive || v.action?.kind !== 'sleep' || v.action.phase !== 'work') return 'target';
    if (symbols.length !== MT.dream.symbols || symbols.some((s) => !DREAM_SYMBOLS.includes(s))) return 'target';
    return null;
  }

  private dream(villagerId: number, symbols: DreamSymbol[]): void {
    const v = this.sim.villagers.byId(villagerId)!;
    v.dreams.push({ tick: this.sim.tick, symbols: [...symbols] });
    // Being dreamt at is unsettling and wonderful; M4 turns the content into belief.
    v.faith.love = Math.min(1 - v.faith.fear, v.faith.love + 0.05);
    this.sim.events.push(this.sim.tick, { type: 'dream', villagerId, symbols: [...symbols] });
  }
}

