import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time';
import { blessed } from '../world/structures';
import { TUNING } from '../tuning';
import { CROP_STAGES, M, material, type MaterialId } from '../world/materials';
import { plantTree } from '../world/terrain';
import { Hand, type GrabTarget } from './hand';
import { Wrath } from './wrath';
import { DREAM_SYMBOLS, miracleDef, type DreamSymbol, type MiracleId, type PointMiracle } from './defs';

const G = TUNING.grace;
const MT = TUNING.miracles;

/**
 * Player input. Everything the player does to the world goes through these
 * commands, applied at the start of a tick and recorded in the input log, so a
 * seed plus an input log reproduces a game exactly.
 */
export type Command =
  | { type: 'cast'; miracle: PointMiracle; x: number; z: number }
  | { type: 'stroke'; x: number; z: number; raise: boolean }
  | { type: 'moveCloud'; cloudId: number; x: number; z: number }
  | { type: 'dream'; villagerId: number; symbols: DreamSymbol[] }
  | { type: 'bless'; villagerId: number }
  /** Bless a field or a home: whatever building stands at (x, z). */
  | { type: 'blessPlace'; x: number; z: number }
  | { type: 'grab'; target: GrabTarget; x: number; z: number }
  | { type: 'carry'; x: number; z: number }
  | { type: 'release'; vx: number; vz: number };

export type CastFailure = 'grace' | 'cooldown' | 'night' | 'target' | 'interval' | 'shore';

export interface RainCloud {
  id: number;
  x: number;
  z: number;
  radius: number;
  ticksLeft: number;
}

/** A pillar of Holy Light, standing for a while. */
export interface LightBeam {
  id: number;
  x: number;
  z: number;
  radius: number;
  ticksLeft: number;
}

/** Hallowed ground, glowing while it lasts. */
export interface Hallowed {
  id: number;
  x: number;
  z: number;
  radius: number;
  ticksLeft: number;
}

/** A Falling Star on its way down. */
export interface FallingStar {
  x: number;
  z: number;
  impactTick: number;
  /** The extinction asteroid, not a falling star. */
  big?: boolean;
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
  M.STAR_STONE,
  M.FENCE,
]);

/**
 * The god's side of the sim: Grace, cooldowns, and the miracles (SPEC §6, §10).
 */
export class Miracles {
  grace: number = G.start;
  /** No cooldowns, no Grace cost (tests turn it off to check the limits). */
  unlimited: boolean = MT.unlimited;
  /** Tick at which each miracle is ready again. */
  readonly readyAt: Record<MiracleId, number> = {
    rain: 0,
    lightning: 0,
    shapeEarth: 0,
    bloom: 0,
    dream: 0,
    light: 0,
    hallow: 0,
    bless: 0,
    blight: 0,
    meteor: 0,
    cataclysm: 0,
    quake: 0,
    firestorm: 0,
    wave: 0,
    plague: 0,
    swarm: 0,
    hand: 0,
  };
  readonly clouds: RainCloud[] = [];
  readonly hand: Hand;
  /** Earthquakes, firestorms, tidal waves and swarms in progress. */
  readonly wrath: Wrath;
  readonly beams: LightBeam[] = [];
  readonly hallows: Hallowed[] = [];
  readonly falling: FallingStar[] = [];
  private nextCloudId = 1;
  private lastStrokeTick = -Infinity;
  /** Most recent outcome per command, for UI feedback. */
  lastFailure: CastFailure | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {
    this.hand = new Hand(sim, rng.fork('hand'));
    this.wrath = new Wrath(sim, rng.fork('wrath'));
  }

  get cap(): number {
    const believers = this.sim.villagers.alive.filter((v) => v.faith.love + v.faith.fear >= 0.1).length;
    return G.capBase + G.capPerBeliever * believers;
  }

  /** Grace per day at the current level of faith. */
  get regenPerDay(): number {
    let faith = 0;
    for (const v of this.sim.villagers.alive) faith += (v.faith.love + v.faith.fear) * (this.sim.tribes[v.tribeId] ?? this.sim.tribe).dissent.graceShare(v);
    return G.regenBasePerDay + G.regenPerFaithPerDay * faith;
  }

  isNight(): boolean {
    const f = this.sim.calendar.dayFraction;
    return f >= TUNING.villagers.gatheringEndsAt || f < TUNING.time.dawnAt;
  }

  /** Why a miracle can't be cast right now, or null if it can. */
  check(id: MiracleId): CastFailure | null {
    const def = miracleDef(id);
    if (!this.unlimited) {
      if (this.sim.tick < this.readyAt[id]) return 'cooldown';
      if (this.grace < def.cost) return 'grace';
    }
    if (def.nightOnly && !this.isNight()) return 'night';
    return null;
  }

  /** Cooldown progress 0..1 (1 = ready), for the miracle bar. */
  readiness(id: MiracleId): number {
    const def = miracleDef(id);
    if (this.unlimited || def.cooldownTicks <= 0) return 1;
    const left = this.readyAt[id] - this.sim.tick;
    return left <= 0 ? 1 : 1 - left / def.cooldownTicks;
  }

  private spend(id: MiracleId): void {
    if (this.unlimited) return;
    const def = miracleDef(id);
    this.grace -= def.cost;
    this.readyAt[id] = this.sim.tick + def.cooldownTicks;
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    this.hand.step();
    this.wrath.step();
    // Grace regenerates with faith, up to a cap that grows with the number of believers.
    const cap = this.cap;
    if (this.grace < cap) this.grace = Math.min(cap, this.grace + this.regenPerDay / TICKS_PER_DAY);
    if (sim.mode === 'sandbox' && this.grace < G.sandboxFloor) {
      this.grace = Math.min(G.sandboxFloor, this.grace + (G.regenBasePerDay * 3) / TICKS_PER_DAY);
    }

    if (sim.tick % TICKS_PER_DAY === 0) this.blessedHomes();

    // Rain clouds water the ground beneath them and douse fires.
    for (const c of this.clouds) {
      c.ticksLeft--;
      for (const f of sim.fields) {
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

    for (const b of this.beams) b.ticksLeft--;
    for (let i = this.beams.length - 1; i >= 0; i--) if (this.beams[i]!.ticksLeft <= 0) this.beams.splice(i, 1);
    for (const h of this.hallows) h.ticksLeft--;
    for (let i = this.hallows.length - 1; i >= 0; i--) if (this.hallows[i]!.ticksLeft <= 0) this.hallows.splice(i, 1);

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i]!;
      if (sim.tick < f.impactTick) continue;
      this.falling.splice(i, 1);
      this.impact(f.x, f.z, !!f.big);
    }
  }

  // ------------------------------------------------------------------ commands

  apply(cmd: Command): CastFailure | null {
    let fail: CastFailure | null = null;
    switch (cmd.type) {
      case 'cast':
        fail = this.check(cmd.miracle) ?? this.castCheck(cmd.miracle, cmd.x, cmd.z);
        if (!fail) {
          this.spend(cmd.miracle);
          if (cmd.miracle === 'rain') this.rain(cmd.x, cmd.z);
          else if (cmd.miracle === 'lightning') this.lightning(cmd.x, cmd.z);
          else if (cmd.miracle === 'bloom') this.bloom(cmd.x, cmd.z);
          else if (cmd.miracle === 'light') this.light(cmd.x, cmd.z);
          else if (cmd.miracle === 'hallow') this.hallow(cmd.x, cmd.z);
          else if (cmd.miracle === 'blight') this.blight(cmd.x, cmd.z);
          else if (cmd.miracle === 'quake') this.wrath.quake(cmd.x, cmd.z);
          else if (cmd.miracle === 'firestorm') this.wrath.firestorm(cmd.x, cmd.z);
          else if (cmd.miracle === 'wave') this.wrath.wave(cmd.x, cmd.z);
          else if (cmd.miracle === 'plague') this.sim.plague.outbreak(cmd.x, cmd.z);
          else if (cmd.miracle === 'swarm') this.wrath.swarm(cmd.x, cmd.z);
          else if (cmd.miracle === 'cataclysm') this.meteor(cmd.x, cmd.z, true);
          else this.meteor(cmd.x, cmd.z);
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
      case 'grab':
        fail = this.check('hand') ?? (this.hand.grab(cmd.target, cmd.x, cmd.z) ? null : 'target');
        break;
      case 'carry':
        this.hand.carry(cmd.x, cmd.z);
        break;
      case 'release':
        this.hand.release(cmd.vx, cmd.vz);
        break;
      case 'bless':
        fail = this.check('bless') ?? this.blessCheck(cmd.villagerId);
        if (!fail) {
          this.spend('bless');
          this.bless(cmd.villagerId);
        }
        break;
      case 'blessPlace':
        fail = this.check('bless') ?? (this.blessable(cmd.x, cmd.z) ? null : 'target');
        if (!fail) {
          this.spend('bless');
          this.blessPlace(cmd.x, cmd.z);
        }
        break;
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

  /** Point miracles that need something there: a sea to send, someone to sicken. */
  private castCheck(id: PointMiracle, x: number, z: number): CastFailure | null {
    if (id === 'wave' && !this.wrath.shoreNear(x, z)) return 'shore';
    if (id === 'plague' && !this.sim.villagers.alive.some((v) => Math.hypot(v.x - x, v.z - z) <= MT.plague.radius * 3)) return 'target';
    return null;
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

        const s = sim.structureAt(x, z);
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
    for (const f of sim.fields) {
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
        if (sim.structureAt(x, z)) continue;
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

  /** A pillar of light. It does nothing at all, except be seen. */
  private light(x: number, z: number): void {
    const L = MT.light;
    const b: LightBeam = { id: this.nextCloudId++, x, z, radius: L.radius, ticksLeft: L.durationTicks };
    this.beams.push(b);
    this.sim.events.push(this.sim.tick, { type: 'holyLight', beamId: b.id, x, z, radius: b.radius });
  }

  /** Ground marked out as holy: a glow that lasts for days. What it means is for the people to decide. */
  private hallow(x: number, z: number): void {
    const H = MT.hallow;
    const h: Hallowed = { id: this.nextCloudId++, x, z, radius: H.radius, ticksLeft: H.durationDays * TICKS_PER_DAY };
    this.hallows.push(h);
    this.sim.events.push(this.sim.tick, { type: 'hallow', id: h.id, x, z, radius: h.radius });
  }

  /** The opposite of Bloom: crops wither, flowers go, grass dies back to bare earth. */
  private blight(cx: number, cz: number): void {
    const sim = this.sim;
    const w = sim.world;
    const B = MT.blight;
    let crops = 0;
    for (const f of sim.fields) {
      // A blessed field doesn't wither.
      if (blessed(f, sim.tick)) continue;
      for (const t of f.tiles) {
        if (t.state !== 2 || Math.hypot(t.x + 0.5 - cx, t.z + 0.5 - cz) > B.radius) continue;
        // As if withered by drought, all at once.
        w.set(t.x, t.y + 1, t.z, M.AIR);
        t.state = 1;
        t.progress = 0;
        crops++;
      }
    }
    const r = Math.ceil(B.radius);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dz) > B.radius) continue;
        const x = Math.round(cx) + dx;
        const z = Math.round(cz) + dz;
        const g = this.groundY(x, z);
        if (g < 0) continue;
        if (material(w.get(x, g + 1, z)).decor) w.set(x, g + 1, z, M.AIR);
        if (w.get(x, g, z) === M.GRASS && !sim.structureAt(x, z) && this.rng.chance(B.grassChance)) w.set(x, g, z, M.DIRT);
      }
    sim.events.push(sim.tick, { type: 'blight', x: cx, z: cz, radius: B.radius, crops });
  }

  /** A star (or the extinction asteroid) starts to fall; it lands a few ticks later. */
  private meteor(x: number, z: number, big = false): void {
    const sim = this.sim;
    const impactTick = sim.tick + (big ? MT.cataclysm : MT.meteor).fallTicks;
    this.falling.push({ x, z, impactTick, ...(big ? { big } : {}) });
    sim.events.push(sim.tick, { type: 'meteorFall', x, z, impactTick, ...(big ? { big } : {}) });
  }

  /**
   * The star lands: a crater with star-stone at its heart, wrecked buildings, fire.
   * The extinction asteroid is the same, writ large: everyone near dies and every
   * building near is flattened.
   */
  private impact(cx: number, cz: number, big = false): void {
    const sim = this.sim;
    const w = sim.world;
    const S = big ? { ...MT.cataclysm, wreckChance: 1 } : MT.meteor;
    const sea = TUNING.terrain.seaLevel;
    const ix = Math.max(2, Math.min(w.sizeX - 3, Math.round(cx)));
    const iz = Math.max(2, Math.min(w.sizeZ - 3, Math.round(cz)));
    const wrecked = new Set<number>();
    const r = Math.ceil(S.craterRadius);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > S.craterRadius) continue;
        const x = ix + dx;
        const z = iz + dz;
        const s = sim.structureAt(x, z);
        if (s && s.kind !== 'field') {
          for (const st of s.steps) {
            if (st.x !== x || st.z !== z || st.mat === M.AIR) continue;
            if (w.get(st.x, st.y, st.z) === st.mat && this.rng.chance(S.wreckChance)) {
              w.set(st.x, st.y, st.z, M.AIR);
              wrecked.add(s.id);
            }
          }
          continue;
        }
        const tree = sim.village.trees.find((t) => t.alive && t.x === x && t.z === z);
        if (tree) sim.village.fell(tree);
        const g = this.groundY(x, z);
        if (g < 0) continue;
        // Clear whatever stands on the ground, then dig the bowl.
        for (let y = g + 1; y <= g + 2; y++) if (w.get(x, y, z) !== M.WATER) w.set(x, y, z, M.AIR);
        const dig = Math.round(S.depth * (1 - d / (S.craterRadius + 0.5)));
        let y = g;
        for (let k = 0; k < dig && y > MT.shapeEarth.minY; k++, y--) w.set(x, y, z, y <= sea ? M.WATER : M.AIR);
        const floor = w.get(x, y, z);
        if (y > sea && floor !== M.WATER && floor !== M.AIR) w.set(x, y, z, d < 1.2 ? M.STAR_STONE : this.rng.chance(0.6) ? M.ASH : M.STONE);
      }
    // The shockwave: past the rim, huts lose blocks and trees go down, less with distance.
    const b = Math.ceil(S.blastRadius);
    for (let dz = -b; dz <= b; dz++)
      for (let dx = -b; dx <= b; dx++) {
        const d = Math.hypot(dx, dz);
        if (d <= S.craterRadius || d > S.blastRadius) continue;
        const x = ix + dx;
        const z = iz + dz;
        const k = S.blastWreckChance * (1 - (d - S.craterRadius) / (S.blastRadius - S.craterRadius));
        const s = sim.structureAt(x, z);
        if (s && s.kind !== 'field') {
          for (const st of s.steps) {
            if (st.x !== x || st.z !== z || st.mat === M.AIR) continue;
            if (w.get(st.x, st.y, st.z) === st.mat && this.rng.chance(k)) {
              w.set(st.x, st.y, st.z, M.AIR);
              wrecked.add(s.id);
            }
          }
          continue;
        }
        const tree = sim.village.trees.find((t) => t.alive && t.x === x && t.z === z);
        if (tree && this.rng.chance(k * 1.5)) sim.village.fell(tree);
      }
    const top = Math.max(0, w.topY(ix, iz));

    const killed: number[] = [];
    for (const v of [...sim.villagers.alive]) {
      const d = Math.hypot(v.x - (ix + 0.5), v.z - (iz + 0.5));
      if (d <= S.killRadius) {
        killed.push(v.id);
        sim.villagers.kill(v, 'meteor');
      } else if (d <= S.fearRadius) v.needs.safety = 0;
    }

    // Fire catches around the rim, where there's anything to burn.
    let fire = false;
    let lit = 0;
    for (let i = 0; i < S.fires * 4 && lit < S.fires; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const rr = S.craterRadius + this.rng.range(0, S.blastRadius - S.craterRadius);
      const x = Math.round(ix + Math.cos(a) * rr);
      const z = Math.round(iz + Math.sin(a) * rr);
      const y = w.topY(x, z);
      if (y >= 0 && material(w.get(x, y, z)).flammable && sim.fire.ignite(x, y, z)) {
        fire = true;
        lit++;
      }
    }
    if (big) {
      // The villages it fell on: their fires were within the blast.
      const villages = sim.tribes.filter((t) => Math.hypot(t.village.center.x - ix, t.village.center.z - iz) <= S.blastRadius).map((t) => t.id);
      sim.events.push(sim.tick, { type: 'cataclysm', x: ix, y: top, z: iz, killed, wrecked: [...wrecked], fire, villages });
    } else sim.events.push(sim.tick, { type: 'meteor', x: ix, y: top, z: iz, killed, wrecked: [...wrecked], fire });
    if (fire) sim.emitFireStarted(ix, top, iz);
  }

  private blessCheck(villagerId: number): CastFailure | null {
    const v = this.sim.villagers.byId(villagerId);
    if (!v?.alive || (v.action?.kind === 'sleep' && v.action.phase === 'work')) return 'target';
    return null;
  }

  /** One person made whole. Being touched by a god is wonderful; seeing it, a little. */
  private bless(villagerId: number): void {
    const sim = this.sim;
    const B = MT.bless;
    const v = sim.villagers.byId(villagerId)!;
    v.needs.hunger = 0;
    v.needs.energy = 1;
    v.needs.safety = 1;
    // The touch heals the sick.
    sim.plague.cure(v);
    v.faith.love = Math.min(1, v.faith.love + B.love);
    v.faith.fear = Math.min(v.faith.fear, 1 - v.faith.love);
    for (const o of sim.villagers.alive) {
      if (o === v || o.inside || Math.hypot(o.x - v.x, o.z - v.z) > B.onlookerRadius) continue;
      o.faith.love = Math.min(1 - o.faith.fear, o.faith.love + B.onlookerLove);
    }
    sim.events.push(sim.tick, { type: 'blessing', villagerId, x: v.x, z: v.z });
  }

  /** A field or a home, standing, at (x, z). */
  blessable(x: number, z: number): boolean {
    const s = this.sim.structureAt(Math.floor(x), Math.floor(z));
    return !!s && (s.kind === 'field' || s.kind === 'hut') && !s.destroyed && !s.abandoned && (s.kind === 'field' || s.complete);
  }

  /** A field or a home blessed for a year. Those who see the light settle on it may make of it what they will. */
  private blessPlace(x: number, z: number): void {
    const sim = this.sim;
    const s = sim.structureAt(Math.floor(x), Math.floor(z))!;
    s.blessedUntil = sim.tick + Math.round(MT.bless.years * TICKS_PER_YEAR);
    const tribe = sim.tribes.findIndex((t) => t.village.byId(s.id) === s);
    sim.events.push(sim.tick, {
      type: 'blessPlace',
      structureId: s.id,
      kind: s.kind === 'field' ? 'field' : 'hut',
      x: s.x0 + s.w / 2,
      z: s.z0 + s.d / 2,
      w: s.w,
      d: s.d,
      residents: [...s.residents],
      tribe: Math.max(0, tribe),
    });
  }

  /** Each midnight: whoever sleeps in a blessed home wakes rested, and loves the god a little more. */
  private blessedHomes(): void {
    const sim = this.sim;
    for (const t of sim.tribes)
      for (const s of t.village.structures) {
        if (s.kind !== 'hut' || !blessed(s, sim.tick)) continue;
        for (const id of s.residents) {
          const v = sim.villagers.byId(id);
          if (!v?.alive) continue;
          v.needs.energy = 1;
          v.needs.safety = 1;
          v.faith.love = Math.min(1 - v.faith.fear, v.faith.love + MT.bless.homeLovePerDay);
        }
      }
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

