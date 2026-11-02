import type { BeliefSystem } from './belief/BeliefSystem';
import type { BeliefEffects } from './belief/effects';
import { EventLog, type DeathCause, type TribeFoundedReason } from './events';
import type { MythSystem } from './myth/Myth';
import type { Milestones } from './milestones';
import type { Dissent } from './dissent';
import { Society } from './society';
import { War } from './war';
import { Plague } from './plague';
import { Boats } from './boats';
import { Castaways } from './castaways';
import { Paths } from './paths';
import { Branching } from './branching';
import { Prayers } from './prayers';
import { Messiah } from './messiah';
import type { Justice } from './justice';
import type { Exodus } from './exodus';
import type { Appeasement } from './appease';
import { Tribe, tribeName } from './tribe';
import { findSettlement } from './exodus';
import { WarningScenario } from './disaster/Warning';
import { OmenRecorder } from './omens/OmenRecorder';
import { Miracles, type CastFailure, type Command } from './miracles/Miracles';
import { Rng } from './rng';
import { calendarAt, SEASONS, TICKS_PER_DAY, type Calendar } from './time';
import { TUNING } from './tuning';
import type { Villager } from './villagers/types';
import type { Tree, Village, VillageHost } from './villagers/village';
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
  /** The Warning: years until the disaster (default TUNING.warning.floodInYears). */
  floodInYears?: number;
  /** Peoples on the island at the start (default 1). */
  tribes?: number;
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
  readonly villagers: Villagers;
  readonly miracles: Miracles;
  readonly society: Society;
  readonly war: War;
  /** The god's sickness, wherever it has spread. */
  readonly plague: Plague;
  /** Settlers sailing for the islets. */
  readonly boats: Boats;
  /** Strangers wrecked on the coast. */
  readonly castaways: Castaways;
  /** Paths worn by feet. */
  readonly paths: Paths;
  /** Hallowed ground, and believers leaving to found daughter peoples there. */
  readonly branching: Branching;
  /** People asking the god for things. */
  readonly prayers: Prayers;
  /** The god's anointed, alive or lately dead. */
  readonly messiah: Messiah;
  /** The island's trees, shared by every village. */
  readonly trees: Tree[];
  /** Shared counters (mutated through any people's view, so kept in one object). */
  readonly counters = { omen: 1, structure: 1 };
  /** The peoples of the island; the first is the one that was here first. */
  readonly tribes: Tribe[] = [];
  /** The Warning's countdown, disaster and verdict (null in sandbox). */
  readonly warning: WarningScenario | null;
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
    // The Warning is one people on one island: no islets to settle or to scatter the story.
    this.island = generateIsland(this.rng.fork('terrain'), { islets: opts.mode !== 'warning' });
    this.nav = new NavGrid(this.island.world);
    this.weather = new Weather(this.rng.fork('weather'));
    this.fire = new Fire(this.island.world, this.rng.fork('fire'));
    this.lightningRng = this.rng.fork('lightning');
    this.trees = this.island.trees.map((t) => ({ ...t, alive: true, reservedBy: -1 }));
    this.villagers = new Villagers(this, this.rng.fork('villagers'));
    this.miracles = new Miracles(this, this.rng.fork('miracles'));
    this.recorder = new OmenRecorder(this, this.rng.fork('omens'));
    this.society = new Society(this, this.rng.fork('society'));
    this.war = new War(this, this.rng.fork('war'));
    this.plague = new Plague(this, this.rng.fork('plague'));
    this.boats = new Boats(this, this.rng.fork('boats'));
    this.paths = new Paths(this);
    this.branching = new Branching(this, this.rng.fork('branching'));
    this.prayers = new Prayers(this, this.rng.fork('prayers'));
    this.messiah = new Messiah(this, this.rng.fork('messiah'));
    this.castaways = new Castaways(this, this.rng.fork('castaways'));
    this.tribes.push(new Tribe(this, 0, 'the first people', this.island.landmarks.villageSite));
    this.mode = opts.mode ?? 'sandbox';
    this.warning = this.mode === 'warning' ? new WarningScenario(this, opts.floodInYears) : null;
    if (!opts.noVillage) this.found(Math.max(1, opts.tribes ?? 1));
  }

  // The first people's systems (single-people code and the UI read these).
  get village(): Village {
    return this.tribes[0]!.village;
  }
  get belief(): BeliefSystem {
    return this.tribes[0]!.belief;
  }
  get effects(): BeliefEffects {
    return this.tribes[0]!.effects;
  }
  get myth(): MythSystem {
    return this.tribes[0]!.myth;
  }
  get milestones(): Milestones {
    return this.tribes[0]!.milestones;
  }
  get dissent(): Dissent {
    return this.tribes[0]!.dissent;
  }
  get justice(): Justice {
    return this.tribes[0]!.justice;
  }
  get exodus(): Exodus {
    return this.tribes[0]!.exodus;
  }
  get appease(): Appeasement {
    return this.tribes[0]!.appease;
  }
  /** Every people's village. */
  get villages(): Village[] {
    return this.tribes.map((t) => t.village);
  }
  /** Any village's structure at a cell (buildings belong to whoever built them). */
  structureAt(x: number, z: number): Structure | undefined {
    for (const t of this.tribes) {
      const s = t.village.structureAt(x, z);
      if (s) return s;
    }
    return undefined;
  }
  structureById(id: number): Structure | undefined {
    for (const t of this.tribes) {
      const s = t.village.byId(id);
      if (s) return s;
    }
    return undefined;
  }
  /** Every field and every hut on the island, whoever's. */
  get fields(): Structure[] {
    return this.tribes.flatMap((t) => t.village.fields);
  }
  get huts(): Structure[] {
    return this.tribes.flatMap((t) => t.village.huts);
  }

  /** The people a view belongs to (the first, for the sim itself). */
  get tribe(): Tribe {
    return this.tribes[0]!;
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

  private found(tribes: number): void {
    this.settle(this.tribes[0]!, this.rng.fork('founding'), TUNING.villagers.startCount, 4, 5);
    // Among several peoples, the first has a name of its own too.
    if (tribes > 1) {
      const c = this.village.center;
      this.tribes[0]!.name = tribeName(this.rng.fork('tribe:0'), this.island.region[c.x + c.z * this.world.sizeX] ?? 0);
    }
    // Other peoples already live elsewhere on the island, out of sight of the first.
    for (let i = 1; i < tribes; i++) {
      const rng = this.rng.fork(`founding:${i}`);
      const first = this.village.center;
      const site = findSettlement(this, [], first, TUNING.exodus.startMin, TUNING.exodus.startMax, rng);
      if (!site) break;
      const t = new Tribe(this, i, tribeName(rng, this.island.region[site.x + site.z * this.world.sizeX] ?? 0, undefined, this.tribes.map((x) => x.name)), site);
      this.tribes.push(t);
      this.settle(t, rng, Math.round(TUNING.villagers.startCount * 0.65), 3, 3);
    }
    this.villagers.newDayRolesAndHomes();
  }

  /** A people's first village: fire, huts and fields built at once, and its families. */
  private settle(t: Tribe, rng: Rng, target: number, huts: number, fields: number): void {
    const v = t.village;
    v.population = target;
    // A people settling somewhere new clears the trees first (the first people's valley is already open).
    if (t.id > 0) v.clearLand();
    v.found(t.view, huts, fields);
    const people = this.villagers;
    const c = v.center;
    const spot = () => v.nearestWalkable(c.x + rng.int(-4, 4), c.z + rng.int(-4, 4)) ?? { x: c.x, z: c.z };
    const tribeId = t.id;
    let n = 0;
    const spawn = (o: Parameters<Villagers['spawn']>[0]) => (n++, people.spawn({ ...o, tribeId }));
    // Five couples with a few children, two elders, the rest young singles.
    for (let i = 0; i < 5 && n < target; i++) {
      const s = spot();
      const a = spawn({ age: rng.range(20, 34), sex: 'f', ...s });
      const b = spawn({ age: a.age + rng.range(-4, 5), sex: 'm', ...s });
      a.partnerId = b.id;
      b.partnerId = a.id;
      const kids = rng.int(0, 2);
      for (let k = 0; k < kids && n < target - 2; k++) spawn({ age: rng.range(1, Math.min(12, a.age - 16)), ...s, parents: [a.id, b.id] });
    }
    for (let i = 0; i < 2; i++) spawn({ age: rng.range(40, 47), ...spot() });
    while (n < target) spawn({ age: rng.range(15, 24), ...spot() });
  }

  /**
   * A new people: these villagers leave their own and settle at `site`, taking
   * a share of the stores and the beliefs they hold. They camp around a new fire
   * and raise homes. Returns the new tribe.
   */
  foundTribe(
    people: Villager[],
    site: { x: number; y: number; z: number },
    opts: { reason: TribeFoundedReason; leaderId?: number; priestId?: number; strangers?: boolean },
  ): Tribe {
    // Through a people's view this runs on that view; the tribes and the world are the real sim's.
    const root = this.tribes[0]!.sim;
    // Strangers (castaways, the god's made people) come from no people here: no stores, no faith, no name for the god.
    const from = opts.strangers ? null : (root.tribes[people[0]?.tribeId ?? 0] ?? root.tribes[0]!);
    const id = root.tribes.length;
    const leader = opts.leaderId !== undefined ? root.villagers.byId(opts.leaderId) : undefined;
    const t = new Tribe(root, id, tribeName(root.rng.fork(`tribe:${id}`), root.island.region[site.x + site.z * root.world.sizeX] ?? 0, leader?.name, root.tribes.map((x) => x.name)), site);
    root.tribes.push(t);
    // Their share of the stores.
    if (from) {
      const share = people.length / Math.max(1, from.members.length);
      for (const k of ['food', 'wood', 'stone'] as const) {
        const take = from.village.store[k] * share;
        from.village.store[k] -= take;
        t.village.store[k] = take;
      }
      t.belief.adopt(from.belief, people);
      t.myth.godName = from.myth.godName;
    }
    for (const p of people) {
      const home = from && p.homeId >= 0 ? from.village.byId(p.homeId) : undefined;
      if (home) home.residents = home.residents.filter((r) => r !== p.id);
      p.homeId = -1;
      p.inside = false;
      p.tribeId = id;
      if (p.role === 'priest') p.role = 'gatherer';
      p.nextThink = root.tick;
    }
    if (opts.priestId !== undefined) {
      const priest = root.villagers.byId(opts.priestId);
      if (priest) priest.role = 'priest';
    }
    t.village.population = people.length;
    t.village.clearLand();
    // They set out with enough to start: a first home and two planted fields.
    t.village.found(t.view, 1, 2);
    t.village.rebuilding = true;
    root.villagers.newDayRolesAndHomes();
    root.events.push(root.tick, { type: 'tribeFounded', id, name: t.name, from: from?.id ?? -1, reason: opts.reason, leaderId: opts.leaderId ?? -1, x: site.x, z: site.z });
    return t;
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
    // Every people's crops grow, not just the first's.
    for (const t of this.tribes) t.village.growCrops(this);
    this.villagers.step();
    this.recorder.step();
    for (const t of this.tribes) {
      t.effects.step();
      t.myth.step();
    }
    this.warning?.step();
    for (const t of this.tribes) {
      t.milestones.step();
      t.dissent.step();
      t.appease.step();
    }
    this.society.step();
    this.war.step();
    this.plague.step();
    this.boats.step();
    this.branching.step();
    this.prayers.step();
    this.messiah.step();
    this.paths.step();
    for (const t of this.tribes) {
      t.justice.step();
      t.exodus.step();
    }

    // Late in the evening gathering, people talk: beliefs spread around the fire.
    const duskMark = TUNING.villagers.gatheringEndsAt - 0.04;
    if (prevFrac < duskMark && this.cal.dayFraction >= duskMark) {
      for (const t of this.tribes) t.effects.dusk();
      this.messiah.dusk();
    }

    if (newDay) {
      this.villagers.newDay();
      for (const t of this.tribes) {
        t.belief.newDay();
        t.effects.dawn();
        t.dissent.dawn();
        t.appease.dawn();
      }
      this.society.dawn();
      this.war.dawn();
      this.plague.dawn();
      this.boats.dawn();
      this.castaways.dawn();
      this.branching.dawn();
      this.prayers.dawn();
      this.messiah.dawn();
      this.paths.dawn();
      for (const t of this.tribes) t.myth.dawn();
      this.warning?.dawn();
      for (const t of this.tribes) {
        t.village.population = t.members.length;
        t.village.inspect(t.view);
        t.exodus.dawn();
        t.village.plan(t.view);
      }
      // The trees are everyone's: they sprout once.
      this.tribes[0]!.village.sproutTrees();
      for (const t of this.tribes) t.village.spoil();
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
    this.events.push(this.tick, { type: 'built', structureId: s.id, kind: s.kind, ...(s.variant === 'longhouse' ? { variant: s.variant } : {}) });
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
    // The god's bolt blasts a pit; a storm's just scorches a spot.
    const L = TUNING.miracles.lightning;
    const R = divine ? L.blastRadius : 1;
    const ri = Math.ceil(R);
    if (y >= 0) {
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx, dz);
          if (d > R + 0.5) continue;
          const depth = divine ? Math.max(0, Math.round(2 * (1 - d / (R + 1)))) : dx === 0 && dz === 0 ? 1 : 0;
          for (let dy = divine ? 1 : 0; dy >= -depth; dy--) {
            const id = w.get(x + dx, y + dy, z + dz);
            if (id === M.AIR || id === M.WATER) continue;
            const center = dx === 0 && dz === 0;
            if (center || divine || (dy === 0 && rng.chance(0.4))) w.set(x + dx, y + dy, z + dz, M.AIR);
          }
        }
      const ig = divine ? ri + 1 : 1;
      for (let dz = -ig; dz <= ig; dz++)
        for (let dx = -ig; dx <= ig; dx++)
          for (let dy = divine ? -3 : -2; dy <= (divine ? 2 : 1); dy++) {
            const id = w.get(x + dx, y + dy, z + dz);
            if (material(id).flammable && rng.chance(divine ? TUNING.fire.divineIgniteChance : TUNING.fire.lightningIgniteChance * this.dryness)) {
              if (this.fire.ignite(x + dx, y + dy, z + dz)) fire = true;
            }
          }
      const killR = divine ? L.killRadius : TUNING.villagers.lightningKillRadius;
      for (const v of [...this.villagers.alive]) {
        if (Math.hypot(v.x - (x + 0.5), v.z - (z + 0.5)) <= killR && !v.inside) {
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
