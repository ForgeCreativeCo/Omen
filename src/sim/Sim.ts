import { BeliefSystem } from './belief/BeliefSystem';
import { BeliefEffects } from './belief/effects';
import { EventLog, type DeathCause } from './events';
import { OmenRecorder } from './omens/OmenRecorder';
import { Miracles, type CastFailure, type Command } from './miracles/Miracles';
import { Rng } from './rng';
import { calendarAt, SEASONS, TICKS_PER_DAY, type Calendar } from './time';
import { TUNING } from './tuning';
import type { Villager } from './villagers/types';
import { Village, type VillageHost } from './villagers/village';
import { Villagers } from './villagers/Villagers';
import { Fire, type FireHost } from './world/fire';
import { material, M } from './world/materials';
import { NavGrid } from './world/nav';
import type { Structure } from './world/structures';
import { generateIsland, type Island } from './world/terrain';
import type { VoxelWorld } from './world/VoxelWorld';
import { Weather, type WeatherHost } from './world/weather';

export interface SimOptions {
  seed: number | string;
  /** Skip founding the village (terrain-only tests). */
  noVillage?: boolean;
  /** Game mode; sandbox keeps a Grace floor (SPEC §14). */
  mode?: GameMode;
}

export type GameMode = 'sandbox' | 'warning';

/** A player command as recorded: replaying these against the same seed reproduces the game. */
export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

export interface LightningResult {
  x: number;
  y: number;
  z: number;
  killed: number[];
  fire: boolean;
}

/**
 * Top-level simulation. Pure TypeScript: no rendering, no DOM, no wall-clock time.
 * Advancing is only ever done through `step()`, one fixed tick at a time, with
 * systems ticked in a fixed order.
 */
export class Sim implements WeatherHost, FireHost, VillageHost {
  readonly seed: number;
  /** Root stream; systems take `rng.fork('<system>')` rather than share this. */
  readonly rng: Rng;
  readonly island: Island;
  readonly nav: NavGrid;
  readonly events = new EventLog();
  readonly weather: Weather;
  readonly fire: Fire;
  readonly village: Village;
  readonly villagers: Villagers;
  readonly miracles: Miracles;
  readonly belief: BeliefSystem;
  readonly effects: BeliefEffects;
  private readonly recorder: OmenRecorder;
  readonly mode: GameMode;
  /** Every command applied, in order (SPEC §0 determinism). */
  readonly inputLog: LoggedCommand[] = [];
  private pending: Command[] = [];
  private readonly lightningRng: Rng;
  tick = 0;
  private cal: Calendar = calendarAt(0);

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.seed = this.rng.seed;
    this.island = generateIsland(this.rng.fork('terrain'));
    this.nav = new NavGrid(this.island.world);
    this.weather = new Weather(this.rng.fork('weather'));
    this.fire = new Fire(this.island.world, this.rng.fork('fire'));
    this.lightningRng = this.rng.fork('lightning');
    this.village = new Village(
      this.island.world,
      this.nav,
      this.rng.fork('village'),
      this.island.landmarks.villageSite,
      this.island.trees,
    );
    this.villagers = new Villagers(this, this.rng.fork('villagers'));
    this.miracles = new Miracles(this, this.rng.fork('miracles'));
    this.belief = new BeliefSystem(this, this.rng.fork('belief'));
    this.effects = new BeliefEffects(this, this.rng.fork('effects'));
    this.recorder = new OmenRecorder(this, this.rng.fork('omens'));
    this.village.forbidden = (x, z) => this.effects.isCursed(x, z);
    this.village.attraction = () => this.effects.sacredArea();
    this.mode = opts.mode ?? 'sandbox';
    if (!opts.noVillage) this.found();
  }

  get world(): VoxelWorld {
    return this.island.world;
  }

  get calendar(): Calendar {
    return this.cal;
  }

  get seasonIndex(): number {
    return SEASONS.indexOf(this.cal.season);
  }

  // Host views used by subsystems.
  get raining(): boolean {
    return this.weather.raining;
  }
  get dryness(): number {
    return this.weather.dryness;
  }
  get windAngle(): number {
    return this.weather.windAngle;
  }
  get windStrength(): number {
    return this.weather.windStrength;
  }

  private found(): void {
    const v = this.village;
    v.population = TUNING.villagers.startCount;
    v.found(this, 4, 5);
    const rng = this.rng.fork('founding');
    const people = this.villagers;
    const c = v.center;
    const spot = () => v.nearestWalkable(c.x + rng.int(-4, 4), c.z + rng.int(-4, 4)) ?? { x: c.x, z: c.z };

    // Five couples with a few children, two elders, the rest young singles.
    const target = TUNING.villagers.startCount;
    for (let i = 0; i < 5 && people.alive.length < target; i++) {
      const s = spot();
      const a = people.spawn({ age: rng.range(20, 34), sex: 'f', ...s });
      const b = people.spawn({ age: a.age + rng.range(-4, 5), sex: 'm', ...s });
      a.partnerId = b.id;
      b.partnerId = a.id;
      const kids = rng.int(0, 2);
      for (let k = 0; k < kids && people.alive.length < target - 2; k++)
        people.spawn({ age: rng.range(1, Math.min(12, a.age - 16)), ...s, parents: [a.id, b.id] });
    }
    for (let i = 0; i < 2; i++) people.spawn({ age: rng.range(40, 47), ...spot() });
    while (people.alive.length < target) people.spawn({ age: rng.range(15, 24), ...spot() });
    people.newDayRolesAndHomes();
  }

  /** Queue a player command; it takes effect at the start of the next tick. */
  enqueue(cmd: Command): void {
    this.pending.push(cmd);
  }

  /** Failures of the commands applied on the most recent tick (for UI feedback). */
  lastFailures: CastFailure[] = [];

  /** Advance exactly one fixed tick. */
  step(): void {
    const prevFrac = this.cal.dayFraction;
    this.tick++;
    this.cal = calendarAt(this.tick);
    const newDay = this.tick % TICKS_PER_DAY === 0;

    // Player input first, so a replayed log lands on exactly the same tick.
    this.lastFailures = [];
    if (this.pending.length) {
      for (const cmd of this.pending) {
        this.inputLog.push({ tick: this.tick, cmd });
        const fail = this.miracles.apply(cmd);
        if (fail) this.lastFailures.push(fail);
      }
      this.pending = [];
    }
    this.miracles.step();

    this.weather.step(this);
    this.fire.step(this);
    this.village.growCrops(this);
    this.villagers.step();
    this.recorder.step();
    this.effects.step();

    // Late in the evening gathering, people talk: beliefs spread around the fire.
    const duskMark = TUNING.villagers.gatheringEndsAt - 0.04;
    if (prevFrac < duskMark && this.cal.dayFraction >= duskMark) this.effects.dusk();

    if (newDay) {
      this.villagers.newDay();
      this.belief.newDay();
      this.effects.dawn();
      this.village.population = this.villagers.alive.length;
      this.village.inspect(this);
      this.village.plan(this);
      this.village.sproutTrees();
      this.village.spoil();
    }
  }

  // ------------------------------------------------------------------ hosts

  emitRainStart(storm: boolean): void {
    this.events.push(this.tick, { type: 'rainStart', storm, divine: false });
  }
  emitRainEnd(): void {
    this.events.push(this.tick, { type: 'rainEnd' });
  }
  emitDrought(start: boolean): void {
    this.events.push(this.tick, { type: start ? 'droughtStart' : 'droughtEnd' });
  }
  emitFireStarted(x: number, y: number, z: number): void {
    this.events.push(this.tick, { type: 'fireStarted', x, y, z });
  }
  emitBuilt(s: Structure): void {
    this.events.push(this.tick, { type: 'built', structureId: s.id, kind: s.kind });
  }
  emitDestroyed(s: Structure): void {
    this.events.push(this.tick, { type: 'destroyed', structureId: s.id, kind: s.kind });
  }

  naturalLightning(): void {
    // Lightning favors high points: sample a few land cells and take the tallest.
    const rng = this.lightningRng;
    const { sizeX, sizeZ } = this.world;
    let best: { x: number; z: number; y: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const x = rng.int(4, sizeX - 5);
      const z = rng.int(4, sizeZ - 5);
      const y = this.world.topY(x, z);
      if (y < 0 || this.world.get(x, y, z) === M.WATER) continue;
      if (!best || y > best.y) best = { x, z, y };
    }
    if (best) this.strikeLightning(best.x, best.z, false);
  }

  /**
   * A lightning strike at column (x, z): blasts a few voxels, may start a fire,
   * kills anyone right there. Shared by storms and (M3) the Lightning miracle.
   */
  strikeLightning(x: number, z: number, divine: boolean, aimX?: number, aimZ?: number): LightningResult {
    const w = this.world;
    const rng = this.lightningRng;
    const y = w.topY(x, z);
    const killed: number[] = [];
    let fire = false;
    if (y >= 0) {
      for (let dy = -1; dy <= 0; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const id = w.get(x + dx, y + dy, z + dz);
            if (id === M.AIR || id === M.WATER) continue;
            const center = dx === 0 && dz === 0;
            if (center || (dy === 0 && rng.chance(0.4))) w.set(x + dx, y + dy, z + dz, M.AIR);
          }
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -2; dy <= 1; dy++) {
            const id = w.get(x + dx, y + dy, z + dz);
            if (material(id).flammable && rng.chance(TUNING.fire.lightningIgniteChance * this.dryness)) {
              if (this.fire.ignite(x + dx, y + dy, z + dz)) fire = true;
            }
          }
      for (const v of [...this.villagers.alive]) {
        if (Math.hypot(v.x - (x + 0.5), v.z - (z + 0.5)) <= TUNING.villagers.lightningKillRadius && !v.inside) {
          killed.push(v.id);
          this.villagers.kill(v, 'lightning');
        }
      }
    }
    this.events.push(this.tick, { type: 'lightning', x, y, z, divine, killed, fire, aimX, aimZ });
    if (fire) this.emitFireStarted(x, y, z);
    return { x, y, z, killed, fire };
  }

  onDeath(v: Villager, cause: DeathCause): void {
    this.events.push(this.tick, { type: 'death', id: v.id, cause, x: Math.floor(v.x), z: Math.floor(v.z) });
    this.village.placeGrave(this);
  }
}
