import type { DeathCause } from '../events';
import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import { M } from '../world/materials';
import type { Structure } from '../world/structures';
import { makeName } from './names';
import { Pathfinder } from './pathfinding';
import {
  TRAIT_CONFLICTS,
  TRAITS,
  type Action,
  type ActionKind,
  type Role,
  type Sex,
  type Trait,
  type Villager,
  type VillagerId,
} from './types';

const V = TUNING.villagers;
const WK = TUNING.work;
const T = TUNING.time;

/** Kinds that count as "work" for the schedule. */
const WORK_KINDS: ReadonlySet<ActionKind> = new Set(['farm', 'chop', 'quarry', 'forage', 'build']);

/**
 * All villagers: needs, utility-AI decisions, job execution, movement and the
 * daily lifecycle (aging, roles, couples, births, deaths, homes). SPEC §5.
 */
export class Villagers {
  readonly all: Villager[] = [];
  alive: Villager[] = [];
  private readonly byIdMap = new Map<VillagerId, Villager>();
  /** No new ritual for this villager before this tick. */
  private readonly ritualRest = new Map<VillagerId, number>();
  readonly pathfinder: Pathfinder;
  private nextId = 1;
  private pathBudget = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {
    this.pathfinder = new Pathfinder(sim.nav);
  }

  /** The sim as this villager's people see it (their village, their beliefs). */
  t(v: Villager): Sim {
    return this.sim.tribes[v.tribeId]?.view ?? this.sim;
  }

  byId(id: VillagerId): Villager | undefined {
    return this.byIdMap.get(id);
  }

  // ------------------------------------------------------------------ creation

  private rollTraits(): Trait[] {
    const traits: Trait[] = [this.rng.pick(TRAITS)];
    if (this.rng.chance(0.45)) {
      const second = this.rng.pick(TRAITS);
      const clash = TRAIT_CONFLICTS.some(([a, b]) => (a === traits[0] && b === second) || (b === traits[0] && a === second));
      if (second !== traits[0] && !clash) traits.push(second);
    }
    return traits;
  }

  spawn(opts: { age: number; sex?: Sex; x: number; z: number; parents?: VillagerId[]; tribeId?: number }): Villager {
    const sex = opts.sex ?? (this.rng.chance(0.5) ? 'f' : 'm');
    // A child is of their mother's people.
    const tribeId = opts.tribeId ?? this.byId(opts.parents?.[0] ?? -1)?.tribeId ?? 0;
    const h = this.sim.nav.at(opts.x, opts.z);
    const v: Villager = {
      id: this.nextId++,
      name: makeName(this.rng),
      tribeId,
      age: opts.age,
      lifespan: V.lifespanYears + this.rng.jitter(V.lifespanJitter),
      sex,
      lifeStage: 'child',
      role: 'child',
      traits: this.rollTraits(),
      needs: { hunger: this.rng.range(0, 0.3), energy: this.rng.range(0.7, 1), safety: 1 },
      faith: { love: this.rng.range(0.05, 0.2), fear: this.rng.range(0.02, 0.1) },
      homeId: -1,
      partnerId: -1,
      parentIds: opts.parents ?? [],
      childIds: [],
      memories: [],
      standing: 1,
      beliefStrengths: new Map(),
      dreams: [],
      alive: true,
      bornTick: this.sim.tick - Math.round(opts.age * DAYS_PER_YEAR * TICKS_PER_DAY),
      deathTick: -1,
      deathCause: null,
      starvingTicks: 0,
      drowningTicks: 0,
      wade: null,
      x: opts.x + 0.5,
      y: h + 1,
      z: opts.z + 0.5,
      px: opts.x + 0.5,
      py: h + 1,
      pz: opts.z + 0.5,
      inside: false,
      lying: false,
      action: null,
      path: [],
      pathPos: -1,
      navVersionAtPath: 0,
      nextThink: this.sim.tick + this.rng.int(0, 10),
      carrying: null,
    };
    this.updateLifeStage(v);
    for (const pid of v.parentIds) this.byId(pid)?.childIds.push(v.id);
    this.all.push(v);
    this.alive.push(v);
    this.byIdMap.set(v.id, v);
    return v;
  }

  private updateLifeStage(v: Villager): void {
    const stage = v.age < V.adultAge ? 'child' : v.age < V.elderAge ? 'adult' : 'elder';
    if (stage === v.lifeStage) return;
    v.lifeStage = stage;
    if (stage === 'child') v.role = 'child';
    else if (stage === 'elder' && v.role !== 'priest') v.role = 'elder';
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    this.pathBudget = V.pathBudgetPerTick;
    const sim = this.sim;
    const hungerTick = V.hungerPerDay / TICKS_PER_DAY;
    for (const v of this.alive) {
      if (!v.alive) continue;
      v.px = v.x;
      v.py = v.y;
      v.pz = v.z;
      // In the god's hand or in the air: the hand moves them.
      if (sim.miracles.hand.holds(v)) continue;

      // Needs
      v.needs.hunger = Math.min(1, v.needs.hunger + hungerTick * (v.lifeStage === 'child' ? V.childHungerFactor : 1));
      const sleeping = v.action?.kind === 'sleep' && v.action.phase === 'work';
      v.needs.energy = sleeping
        ? Math.min(1, v.needs.energy + V.sleepRecoverPerDay / TICKS_PER_DAY)
        : Math.max(0, v.needs.energy - V.energyPerDay / TICKS_PER_DAY);
      v.needs.safety = Math.min(1, v.needs.safety + 0.002);
      // Nobody starves in the few days a disaster lasts; hunger waits.
      const enduring = sim.warning && (sim.warning.disaster.phase === 'striking' || sim.warning.disaster.phase === 'settling');
      if (v.needs.hunger >= 1 && !enduring) {
        if (++v.starvingTicks > V.starveDays * TICKS_PER_DAY) {
          this.kill(v, 'starvation');
          continue;
        }
      } else v.starvingTicks = 0;

      // Fire danger (checked every few ticks, staggered)
      if ((sim.tick + v.id) % 5 === 0 && sim.fire.burning.size > 0) {
        const near = sim.fire.nearby(Math.floor(v.x), Math.floor(v.z), V.fleeFireRadius);
        if (near) {
          v.needs.safety = Math.max(0, v.needs.safety - 0.3);
          if (Math.abs(near.x + 0.5 - v.x) <= 1.2 && Math.abs(near.z + 0.5 - v.z) <= 1.2 && Math.abs(near.y - v.y) <= 3) {
            if (this.rng.chance(V.fireDeathChancePerTick * 5)) {
              this.kill(v, 'fire');
              continue;
            }
          }
          if (v.action?.kind !== 'flee') this.setAction(v, this.fleeAction(v, near.x, near.z));
        }
      }

      // Water: over the head for long, they drown; at the feet, they wade for dry ground.
      const cx = Math.floor(v.x);
      const cz = Math.floor(v.z);
      const feet = Math.floor(v.y + 0.05);
      if (sim.world.get(cx, feet + 1, cz) === M.WATER) {
        if (++v.drowningTicks > V.drownTicks) {
          this.kill(v, 'flood');
          continue;
        }
      } else v.drowningTicks = 0;
      if (sim.world.get(cx, feet, cz) === M.WATER) {
        this.wade(v);
        continue;
      }

      // Unstick: if the ground under us changed into a wall, step out.
      if (!v.inside && !sim.nav.walkable(cx, cz)) {
        const out = this.t(v).village.nearestWalkable(cx, cz);
        if (out) {
          v.x = v.px = out.x + 0.5;
          v.z = v.pz = out.z + 0.5;
          v.y = v.py = sim.nav.at(out.x, out.z) + 1;
          v.pathPos = -1;
        }
      }

      if (!v.action || sim.tick >= v.nextThink) this.think(v);
      if (v.action) this.perform(v);
    }
    if (this.alive.some((v) => !v.alive)) this.alive = this.alive.filter((v) => v.alive);
  }

  /** Caught by water: head for the nearest dry ground in reach, or stay and hope. */
  private wade(v: Villager): void {
    const sim = this.t(v);
    if (v.action) this.setAction(v, null);
    if (!v.wade || !sim.nav.walkable(v.wade.x, v.wade.z)) {
      v.wade = null;
      const R = V.panicRadius;
      let best = Infinity;
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          const x = Math.floor(v.x) + dx;
          const z = Math.floor(v.z) + dz;
          const d = Math.hypot(dx, dz);
          if (d <= R && d < best && sim.nav.walkable(x, z)) (best = d), (v.wade = { x, z });
        }
      if (!v.wade) return;
    }
    const tx = v.wade.x + 0.5;
    const tz = v.wade.z + 0.5;
    const d = Math.hypot(tx - v.x, tz - v.z);
    const step = V.wadeSpeed * (v.lifeStage === 'child' ? V.childSpeedFactor : 1);
    if (d <= step) {
      v.x = tx;
      v.z = tz;
      v.y = sim.nav.at(v.wade.x, v.wade.z) + 1;
      v.wade = null;
      v.nextThink = sim.tick;
      return;
    }
    v.x += ((tx - v.x) / d) * step;
    v.z += ((tz - v.z) / d) * step;
  }

  // ------------------------------------------------------------------ decisions

  private think(v: Villager): void {
    const sim = this.t(v);
    v.nextThink = sim.tick + V.thinkInterval + (v.id % 11);
    // A disaster is unfolding: those who trust a holy place run to its highest ground.
    const refuge = sim.warning?.disaster.refugeFor(v);
    if (refuge) {
      const a = v.action;
      if (a?.kind !== 'flee' || a.tx !== refuge.x || a.tz !== refuge.z) this.setAction(v, this.make('flee', refuge.x, refuge.z, false, TICKS_PER_DAY));
      return;
    }
    const f = sim.calendar.dayFraction;
    const night = f >= V.gatheringEndsAt || f < T.dawnAt;
    const workTime = !night && f < V.workEndsAt;
    const gatherTime = !night && f >= V.workEndsAt;
    const store = sim.village.store;

    // Utility scores.
    let best = 'wander' as ActionKind;
    let score = 0.1;
    const consider = (kind: ActionKind, s: number) => {
      if (s > score) {
        best = kind;
        score = s;
      }
    };
    if (night) consider('sleep', 1.5);
    else if (v.needs.energy < 0.12) consider('sleep', 0.9);
    // Meals happen around work: on waking and at the evening fire. Only real hunger breaks off work.
    if (v.needs.hunger > V.eatWhenHungerAbove && store.food >= V.mealFood) {
      const mealtime = !workTime || f < T.dawnAt + 0.04;
      if (mealtime || v.needs.hunger > V.hungryEnoughToStopWork) consider('eat', 0.6 + v.needs.hunger + (mealtime ? 0.4 : 0));
    }
    if (gatherTime) consider('gathering', 1.0);
    // 'farm' stands for "work" here; workAction picks the actual job. Older children help forage when food is short.
    const shortOfFood = store.food / Math.max(1, this.alive.length) < WK.forageBelowFoodPerCapita * 0.5;
    // The injured rest instead of working.
    if (workTime && !sim.society.isHurt(v) && (v.lifeStage !== 'child' || (shortOfFood && v.age >= WK.childForageAge))) consider('farm', 0.8);

    // Keep doing the same kind of thing rather than re-planning; finish deliveries, escapes and rites.
    const cur = v.action?.kind;
    if (cur === 'flee' || cur === 'exile' || cur === 'ritual' || cur === 'pilgrimage' || v.action?.phase === 'deliver') return;

    // Beliefs (SPEC §9): perform a ritual when the village wants what it brings, or at a festival.
    if ((workTime || gatherTime) && v.lifeStage !== 'child' && (this.ritualRest.get(v.id) ?? 0) <= sim.tick && best !== 'eat' && !sim.dissent.isDoubter(v)) {
      const plan = sim.effects.ritualFor(v, gatherTime);
      if (plan) {
        this.startRitual(v, plan.activity === 'gather' ? 'pray' : plan.activity, plan.x, plan.z, plan.belief.id);
        return;
      }
    }
    if (cur && (cur === best || (best === 'farm' && WORK_KINDS.has(cur)))) {
      this.scheduleWindowEnd(v, f, night);
      return;
    }

    let action: Action | null = null;
    switch (best as ActionKind) {
      case 'sleep':
        action = this.sleepAction(v);
        break;
      case 'eat':
        action = this.make('eat', sim.village.center.x, sim.village.center.z, true, 6);
        break;
      case 'gathering':
        action = this.gatheringAction(v);
        break;
      case 'farm':
        action = this.workAction(v);
        break;
      default:
        break;
    }
    this.setAction(v, action ?? this.wanderAction(v));
    this.scheduleWindowEnd(v, f, night);
  }

  /** Wake at dawn / leave the fire when the gathering ends, rather than at the next routine re-think. */
  private scheduleWindowEnd(v: Villager, f: number, night: boolean): void {
    const until = (frac: number) => Math.round(((((frac - f) % 1) + 1) % 1) * TICKS_PER_DAY);
    const kind = v.action?.kind;
    if (kind === 'sleep' && night) v.nextThink = this.sim.tick + until(T.dawnAt) + (v.id % 5);
    else if (kind === 'gathering') v.nextThink = this.sim.tick + until(V.gatheringEndsAt) + (v.id % 5);
  }

  private make(kind: ActionKind, tx: number, tz: number, adjacent: boolean, work: number): Action {
    return { kind, tx, tz, adjacent, phase: 'path', workLeft: work, structureId: -1, tileIndex: -1, treeIndex: -1 };
  }

  private setAction(v: Villager, a: Action | null): void {
    this.release(v);
    v.action = a;
    v.path = [];
    v.pathPos = -1;
    v.inside = false;
    v.lying = false;
  }

  /** Drop reservations held by the current action. */
  /** Taken up by the god's hand: whatever they were doing stops. */
  lift(v: Villager): void {
    this.setAction(v, null);
    v.lying = false;
    v.inside = false;
    v.path = [];
    v.pathPos = -1;
  }

  /** Back on the ground (set down, or landed) at a cell; `y` overrides the surface (water). */
  setDown(v: Villager, x: number, z: number, y?: number): void {
    v.x = x + 0.5;
    v.z = z + 0.5;
    v.y = y ?? this.t(v).nav.at(x, z) + 1;
    v.pathPos = -1;
    v.nextThink = this.t(v).tick;
  }

  private release(v: Villager): void {
    const a = v.action;
    if (!a) return;
    if (a.tileIndex >= 0) {
      const f = this.t(v).village.byId(a.structureId);
      const t = f?.tiles[a.tileIndex];
      if (t && t.reservedBy === v.id) t.reservedBy = -1;
    }
    if (a.treeIndex >= 0) {
      const t = this.t(v).village.trees[a.treeIndex];
      if (t && t.reservedBy === v.id) t.reservedBy = -1;
    }
  }

  private home(v: Villager): Structure | undefined {
    const h = v.homeId >= 0 ? this.t(v).village.byId(v.homeId) : undefined;
    return h && this.t(v).village.usableHut(h) ? h : undefined;
  }

  private sleepAction(v: Villager): Action {
    const h = this.home(v);
    if (h) return this.make('sleep', h.door.x, h.door.z, true, Infinity);
    const c = this.t(v).village.center;
    const a = this.ringCell(v, 3, 5);
    return this.make('sleep', a?.x ?? c.x, a?.z ?? c.z, a === null, Infinity);
  }

  private gatheringAction(v: Villager): Action {
    const c = this.t(v).village.center;
    if (v.role === 'priest') return this.make('gathering', c.x, c.z, true, Infinity);
    // Outcasts keep to the edge of the firelight.
    const outcast = this.t(v).effects.outcastIds().has(v.id);
    const a = outcast ? this.ringCell(v, 6, 8) : this.ringCell(v, 2, 4);
    return this.make('gathering', a?.x ?? c.x, a?.z ?? c.z, a === null, Infinity);
  }

  /** A walkable cell on a ring around the fire, spread by villager id. */
  private ringCell(v: Villager, rMin: number, rMax: number): { x: number; z: number } | null {
    const c = this.t(v).village.center;
    for (let i = 0; i < 8; i++) {
      const ang = v.id * 2.399 + i * 0.7;
      const r = rMin + ((v.id * 7 + i) % (rMax - rMin + 1));
      const x = Math.round(c.x + Math.cos(ang) * r);
      const z = Math.round(c.z + Math.sin(ang) * r);
      if (this.t(v).nav.walkable(x, z)) return { x, z };
    }
    return null;
  }

  private wanderAction(v: Villager): Action {
    // Idle time is when people visit holy ground.
    const holy = v.lifeStage !== 'child' && !this.t(v).dissent.isDoubter(v) ? this.t(v).effects.pilgrimageFor(v) : null;
    if (holy) {
      const a = this.make('pilgrimage', holy.x, holy.z, false, 30);
      a.ritual = 'pray';
      return a;
    }
    const h = this.home(v);
    const ax = h ? h.door.x : this.t(v).village.center.x;
    const az = h ? h.door.z : this.t(v).village.center.z;
    for (let i = 0; i < 6; i++) {
      const x = ax + this.rng.int(-6, 6);
      const z = az + this.rng.int(-6, 6);
      if (this.t(v).nav.walkable(x, z)) return this.make('wander', x, z, false, this.rng.int(10, 40));
    }
    return this.make('idle', Math.floor(v.x), Math.floor(v.z), false, 20);
  }

  private fleeAction(v: Villager, fx: number, fz: number): Action {
    let dx = v.x - (fx + 0.5);
    let dz = v.z - (fz + 0.5);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    for (const dist of [10, 7, 5]) {
      const x = Math.floor(v.x + dx * dist);
      const z = Math.floor(v.z + dz * dist);
      const cell = this.t(v).village.nearestWalkable(x, z);
      if (cell) return this.make('flee', cell.x, cell.z, false, 30);
    }
    return this.make('flee', Math.floor(v.x), Math.floor(v.z), false, 30);
  }

  /** Pick a job: own role first, then whatever's useful. */
  private workAction(v: Villager): Action | null {
    const order: Role[] =
      v.role === 'farmer'
        ? ['farmer', 'gatherer', 'builder']
        : v.role === 'builder'
          ? ['builder', 'gatherer', 'farmer']
          : v.role === 'gatherer'
            ? ['gatherer', 'farmer', 'builder']
            : ['farmer', 'gatherer'];
    const store = this.t(v).village.store;
    const foodPerHead = store.food / Math.max(1, this.alive.length);
    // When food is short (or a portent says hard times are coming), everyone forages first,
    // except farmers with a harvest waiting.
    const hoarding = this.t(v).tick < this.t(v).effects.prepareUntil && v.role === 'gatherer';
    if (foodPerHead < WK.forageBelowFoodPerCapita * 0.5 || hoarding) {
      const harvestWaiting = v.role === 'farmer' && this.t(v).village.fields.some((f) => f.tiles.some((t) => t.reservedBy === -1 && t.state === 2 && t.progress >= 1));
      if (!harvestWaiting || v.lifeStage === 'child') {
        const a = this.forageJob(v);
        if (a) return a;
      }
    }
    for (const r of order) {
      // A taboo on the work itself makes people shy away from it (never entirely: they must eat).
      const activity = r === 'farmer' ? 'activity:farming' : r === 'builder' ? 'activity:building' : 'activity:woodcutting';
      const taboo = this.t(v).effects.taboo(activity);
      if (taboo > 0 && this.rng.chance(Math.min(0.8, taboo))) continue;
      const a =
        r === 'farmer' ? this.farmJob(v) : r === 'builder' ? this.buildJob(v) : this.gatherJob(v, foodPerHead);
      if (a) return a;
    }
    return null;
  }

  private farmJob(v: Villager): Action | null {
    const village = this.t(v).village;
    const season = this.t(v).seasonIndex;
    let best: Action | null = null;
    let bestD = Infinity;
    for (const f of village.fields) {
      const d0 = Math.abs(f.x0 - v.x) + Math.abs(f.z0 - v.z);
      if (d0 > bestD + 8) continue;
      f.tiles.forEach((t, i) => {
        if (t.reservedBy !== -1 || this.t(v).effects.isCursed(t.x, t.z)) return;
        const work = village.tileWork(t, season);
        if (!work) return;
        // Harvest first, then till, then plant.
        const pri = work === 'harvest' ? 0 : work === 'till' ? 4 : 6;
        const d = Math.abs(t.x + 0.5 - v.x) + Math.abs(t.z + 0.5 - v.z) + pri;
        if (d < bestD) {
          bestD = d;
          best = this.make('farm', t.x, t.z, false, TUNING.work.farmOpTicks);
          best.structureId = f.id;
          best.tileIndex = i;
        }
      });
    }
    if (best) {
      const a = best as Action;
      village.byId(a.structureId)!.tiles[a.tileIndex]!.reservedBy = v.id;
    }
    return best;
  }

  private buildJob(v: Villager): Action | null {
    const village = this.t(v).village;
    for (const s of village.constructionSites()) {
      const next = s.steps[s.next];
      const cost = next ? village.stepCost(next.mat) : null;
      if (cost && village.store[cost] < 1) continue;
      const cells = village.accessCells(s).filter((c) => !this.t(v).effects.isCursed(c.x, c.z));
      if (!cells.length) continue;
      let cell = cells[0]!;
      let bd = Infinity;
      for (const c of cells) {
        const d = Math.abs(c.x + 0.5 - v.x) + Math.abs(c.z + 0.5 - v.z);
        if (d < bd) {
          bd = d;
          cell = c;
        }
      }
      const a = this.make('build', cell.x, cell.z, false, Infinity);
      a.structureId = s.id;
      return a;
    }
    return null;
  }

  private gatherJob(v: Villager, foodPerHead: number): Action | null {
    const village = this.t(v).village;
    if (foodPerHead < WK.forageBelowFoodPerCapita) {
      const a = this.forageJob(v);
      if (a) return a;
    }
    // Stone when it's what's missing, wood while below target, otherwise food.
    const { wood, stone } = village.store;
    if (stone < WK.stoneTarget && (stone < 10 || wood >= WK.woodTarget) && village.stoneSpots.length) return this.quarryJob(v);
    if (wood < WK.woodTarget) {
      const a = this.chopJob(v);
      if (a) return a;
    }
    return foodPerHead < WK.forageAboveCapitaStops ? this.forageJob(v) : null;
  }

  private nearestTree(v: Villager, reserve: boolean): number {
    const trees = this.t(v).village.trees;
    let best = -1;
    let bd = Infinity;
    const c = this.t(v).village.center;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i]!;
      if (!t.alive || (reserve && t.reservedBy !== -1) || this.t(v).effects.isCursed(t.x, t.z)) continue;
      if (!this.t(v).village.reachable(Math.floor(v.x), Math.floor(v.z), t.x, t.z, true)) continue;
      // Favor trees near both the worker and the village store.
      const d = Math.hypot(t.x - v.x, t.z - v.z) + 0.5 * Math.hypot(t.x - c.x, t.z - c.z);
      if (d < bd && this.t(v).village.treeAlive(t)) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private chopJob(v: Villager): Action | null {
    const i = this.nearestTree(v, true);
    if (i < 0) return null;
    const t = this.t(v).village.trees[i]!;
    t.reservedBy = v.id;
    const a = this.make('chop', t.x, t.z, true, WK.chopTicks);
    a.treeIndex = i;
    return a;
  }

  private forageJob(v: Villager): Action | null {
    const i = this.nearestTree(v, false);
    if (i < 0) return null;
    const t = this.t(v).village.trees[i]!;
    return this.make('forage', t.x, t.z, true, WK.forageTicks);
  }

  private quarryJob(v: Villager): Action | null {
    const spots = this.t(v).village.stoneSpots;
    const s = spots[this.rng.int(0, Math.min(5, spots.length) - 1)];
    return s ? this.make('quarry', s.x, s.z, false, WK.quarryTicks) : null;
  }

  // ------------------------------------------------------------------ doing

  private perform(v: Villager): void {
    const a = v.action!;
    if (a.phase === 'path' || a.phase === 'deliver') {
      if (v.pathPos < 0) {
        // Needs a path. Searches are budgeted per tick; wait our turn if spent.
        if (this.pathBudget <= 0) return;
        this.pathBudget--;
        const deliver = a.phase === 'deliver';
        const c = this.t(v).village.center;
        const tx = deliver ? c.x : a.tx;
        const tz = deliver ? c.z : a.tz;
        // The fire pit itself is closed off, so "at the fire" means within two cells of it.
        const radius = tx === c.x && tz === c.z ? 2 : 1;
        const ok = this.t(v).village.reachable(Math.floor(v.x), Math.floor(v.z), tx, tz, deliver || a.adjacent, radius);
        const p = ok && this.pathfinder.find(Math.floor(v.x), Math.floor(v.z), tx, tz, {
          adjacent: deliver || a.adjacent,
          radius,
          maxExpand: V.pathMaxExpand,
        });
        if (!p) {
          // Unreachable: drop it (goods included) and re-think shortly.
          v.carrying = null;
          this.setAction(v, null);
          v.nextThink = this.t(v).tick + 10 + (v.id % 7);
          return;
        }
        v.path = p;
        v.pathPos = 0;
        v.navVersionAtPath = this.t(v).nav.version;
      }
      if (this.walk(v)) {
        if (a.phase === 'deliver') this.deliver(v);
        else a.phase = 'work';
      }
      return;
    }
    this.work(v, a);
  }

  /** Advance along the path. Returns true on arrival. */
  private walk(v: Villager): boolean {
    const nav = this.t(v).nav;
    const speed = V.speed * (v.lifeStage === 'child' ? V.childSpeedFactor : 1) * (v.lifeStage === 'elder' ? 0.85 : 1);
    let budget = speed;
    while (budget > 0 && v.pathPos < v.path.length) {
      const cell = v.path[v.pathPos]!;
      const cx = cell % nav.sizeX;
      const cz = (cell / nav.sizeX) | 0;
      // Terrain changed under the path? Re-plan if the next step is no longer possible.
      if (nav.version !== v.navVersionAtPath && !nav.canStep(Math.floor(v.x), Math.floor(v.z), cx, cz)) {
        const here = Math.floor(v.x) === cx && Math.floor(v.z) === cz;
        if (!here) {
          v.pathPos = -1;
          return false;
        }
      }
      const tx = cx + 0.5;
      const tz = cz + 0.5;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const d = Math.hypot(dx, dz);
      if (d <= budget) {
        v.x = tx;
        v.z = tz;
        budget -= d;
        v.pathPos++;
      } else {
        v.x += (dx / d) * budget;
        v.z += (dz / d) * budget;
        budget = 0;
      }
      const h = nav.at(Math.floor(v.x), Math.floor(v.z));
      if (h >= 0) v.y = h + 1;
    }
    return v.pathPos >= v.path.length;
  }

  private work(v: Villager, a: Action): void {
    const sim = this.t(v);
    const village = sim.village;
    switch (a.kind) {
      case 'sleep':
        if (a.adjacent && this.home(v)) v.inside = true;
        else v.lying = true;
        return; // until re-think wakes them
      case 'gathering':
      case 'idle':
        if (--a.workLeft <= 0 && a.kind === 'idle') this.setAction(v, null);
        return;
      case 'ritual':
      case 'pilgrimage': {
        if (a.workLeft === TUNING.belief.ritualTicks || a.workLeft === 30) {
          sim.events.push(sim.tick, { type: 'ritual', beliefId: '', activity: a.ritual ?? 'pray', x: a.tx, z: a.tz, villagerId: v.id });
        }
        if (--a.workLeft > 0) return;
        // The rite is done: now the god is expected to answer (SPEC §8 step 5).
        const act = a.kind === 'pilgrimage' ? 'activity:pilgrimage' : a.ritual === 'pray' ? 'activity:praying' : `activity:${a.ritual ?? 'dance'}`;
        sim.belief.notePerformance(act);
        this.ritualRest.set(v.id, sim.tick + TICKS_PER_DAY / 2);
        this.setAction(v, null);
        v.nextThink = sim.tick;
        return;
      }
      case 'exile':
        this.remove(v);
        return;
      case 'wander':
        if (--a.workLeft <= 0) this.setAction(v, null);
        return;
      case 'flee':
        if (--a.workLeft <= 0) {
          this.setAction(v, null);
          v.nextThink = sim.tick;
        }
        return;
      case 'eat':
        if (--a.workLeft > 0) return;
        if (village.store.food > 0) {
          const amt = Math.min(V.mealFood, village.store.food);
          village.store.food -= amt;
          village.stats.eaten += amt;
          v.needs.hunger = Math.max(0, v.needs.hunger - V.mealRelief * (amt / V.mealFood));
        }
        this.setAction(v, null);
        v.nextThink = sim.tick;
        return;
      case 'farm': {
        if (--a.workLeft > 0) return;
        const f = village.byId(a.structureId);
        const t = f?.tiles[a.tileIndex];
        if (f && t) {
          const job = village.tileWork(t, sim.seasonIndex);
          if (job === 'till') village.till(t);
          else if (job === 'plant') village.plant(t);
          else if (job === 'harvest') {
            const food = village.harvest(t) * sim.dissent.yieldFor(v);
            village.store.food += food;
            village.stats.harvested += food;
            // Re-sow in the same visit while the season allows.
            if (village.tileWork(t, sim.seasonIndex) === 'plant') village.plant(t);
          }
          // Move straight on to the nearest tile in this field that needs work.
          t.reservedBy = -1;
          let next = -1;
          let nd = Infinity;
          f.tiles.forEach((o, i) => {
            if (o.reservedBy !== -1 || !village.tileWork(o, sim.seasonIndex) || sim.effects.isCursed(o.x, o.z)) return;
            const d = Math.abs(o.x - t.x) + Math.abs(o.z - t.z);
            if (d < nd) {
              nd = d;
              next = i;
            }
          });
          if (next >= 0 && sim.calendar.dayFraction < V.workEndsAt) {
            const o = f.tiles[next]!;
            o.reservedBy = v.id;
            a.tileIndex = next;
            a.tx = o.x;
            a.tz = o.z;
            a.phase = 'path';
            a.workLeft = WK.farmOpTicks;
            v.pathPos = -1;
            return;
          }
        }
        this.setAction(v, null);
        v.nextThink = sim.tick;
        return;
      }
      case 'chop': {
        if (--a.workLeft > 0) return;
        const t = village.trees[a.treeIndex];
        const wood = t && village.treeAlive(t) ? village.fell(t) : 0;
        a.treeIndex = -1;
        if (wood > 0) this.startDelivery(v, a, 'wood', wood);
        else this.setAction(v, null);
        return;
      }
      case 'quarry':
        if (--a.workLeft > 0) return;
        this.startDelivery(v, a, 'stone', WK.stonePerTrip);
        return;
      case 'forage':
        if (--a.workLeft > 0) return;
        this.startDelivery(v, a, 'food', WK.foodPerForage);
        return;
      case 'build': {
        const s = village.byId(a.structureId);
        if (!s || s.complete) {
          this.setAction(v, null);
          v.nextThink = sim.tick;
          return;
        }
        if ((sim.tick + v.id) % WK.buildTicksPerBlock !== 0) return;
        if (!village.buildNext(sim, s)) {
          this.setAction(v, null);
          v.nextThink = sim.tick;
        }
        return;
      }
      default:
        return;
    }
  }

  /** Go and perform a rite (dance, prayer) at a spot. */
  startRitual(v: Villager, activity: string, x: number, z: number, _beliefId: string | null): void {
    const a = this.make('ritual', x, z, false, TUNING.belief.ritualTicks);
    a.ritual = activity;
    this.setAction(v, a);
    v.nextThink = this.t(v).tick + TUNING.belief.ritualTicks * 3;
  }

  /** Send someone away for good: they walk to the shore and are gone (SPEC §9 OUTCAST). */
  exile(v: Villager): void {
    const L = this.t(v).island.landmarks;
    const shore = this.t(v).village.nearestWalkable(Math.round(L.riverMouth.x), Math.round(L.riverMouth.z)) ?? { x: Math.floor(v.x), z: Math.floor(v.z) };
    this.setAction(v, this.make('exile', shore.x, shore.z, true, 1));
  }

  /** Leave the village without dying (exile). */
  private remove(v: Villager): void {
    this.release(v);
    v.alive = false;
    v.deathTick = this.t(v).tick;
    v.deathCause = 'exiled';
    v.action = null;
    const partner = this.byId(v.partnerId);
    if (partner) partner.partnerId = -1;
    const home = v.homeId >= 0 ? this.t(v).village.byId(v.homeId) : undefined;
    if (home) home.residents = home.residents.filter((id) => id !== v.id);
    const left = this.t(v).dissent.departing.delete(v.id);
    this.t(v).events.push(this.t(v).tick, { type: 'exiled', id: v.id, left });
  }

  private startDelivery(v: Villager, a: Action, kind: 'wood' | 'stone' | 'food', amount: number): void {
    v.carrying = { kind, amount: amount * this.t(v).dissent.yieldFor(v) };
    a.phase = 'deliver';
    v.pathPos = -1;
  }

  private deliver(v: Villager): void {
    const village = this.t(v).village;
    if (v.carrying) {
      village.store[v.carrying.kind] += v.carrying.amount;
      const key = v.carrying.kind === 'food' ? 'foraged' : v.carrying.kind === 'wood' ? 'chopped' : 'quarried';
      village.stats[key] += v.carrying.amount;
    }
    v.carrying = null;
    this.setAction(v, null);
    v.nextThink = this.t(v).tick;
  }

  // ------------------------------------------------------------------ death

  kill(v: Villager, cause: DeathCause): void {
    if (!v.alive) return;
    this.release(v);
    v.alive = false;
    v.deathTick = this.t(v).tick;
    v.deathCause = cause;
    v.action = null;
    v.carrying = null;
    const partner = this.byId(v.partnerId);
    if (partner) partner.partnerId = -1;
    const home = v.homeId >= 0 ? this.t(v).village.byId(v.homeId) : undefined;
    if (home) home.residents = home.residents.filter((id) => id !== v.id);
    this.t(v).onDeath(v, cause);
  }

  // ------------------------------------------------------------------ daily

  newDay(): void {
    for (const v of this.alive) {
      if (!v.alive) continue;
      v.age += 1 / DAYS_PER_YEAR;
      this.updateLifeStage(v);
      if (v.age >= v.lifespan) this.kill(v, 'oldAge');
    }
    this.alive = this.alive.filter((v) => v.alive);
    for (const t of this.sim.tribes) {
      const people = this.alive.filter((v) => v.tribeId === t.id);
      this.assignRoles(t.view, people);
      this.formCouples(t.view, people);
      this.births(t.view, people);
      this.assignHomes(t.view, people);
    }
  }

  /** Initial roles and beds for a freshly founded village. */
  newDayRolesAndHomes(): void {
    for (const t of this.sim.tribes) {
      const people = this.alive.filter((v) => v.tribeId === t.id);
      this.assignRoles(t.view, people);
      this.assignHomes(t.view, people);
    }
  }

  private assignRoles(sim: Sim, people: Villager[]): void {
    const village = sim.village;
    let priest = people.find((v) => v.role === 'priest');
    if (!priest) {
      // Succession: someone the god is believed to favor, else the most devout, else the eldest.
      const chosen = sim.belief.chosenIds();
      const outcast = sim.effects.outcastIds();
      const candidates = people
        .filter((v) => v.lifeStage !== 'child' && !outcast.has(v.id))
        .sort(
          (a, b) =>
            Number(chosen.has(b.id)) - Number(chosen.has(a.id)) ||
            Number(b.traits.includes('devout')) - Number(a.traits.includes('devout')) ||
            b.age - a.age ||
            a.id - b.id,
        );
      priest = candidates[0];
      if (priest) priest.role = 'priest';
    }
    if (priest?.id !== sim.belief.priestId) sim.belief.setPriest(priest);
    const adults = people.filter((v) => v.lifeStage === 'adult' && v.role !== 'priest').sort((a, b) => a.id - b.id);
    const sites = village.constructionSites().length;
    const tiles = village.fields.reduce((n, f) => n + f.tiles.length, 0);
    const builders = sites > 0 ? Math.min(adults.length, Math.max(1, Math.min(sites + 1, Math.ceil(adults.length * 0.25)))) : 0;
    const farmers = Math.min(adults.length - builders, Math.max(1, Math.ceil(tiles / 28)));
    adults.forEach((v, i) => {
      v.role = i < builders ? 'builder' : i < builders + farmers ? 'farmer' : 'gatherer';
    });
  }

  related(a: Villager, b: Villager): boolean {
    if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
    return a.parentIds.some((p) => b.parentIds.includes(p));
  }

  /** Partners part: the one who strayed moves out if there's somewhere to go. */
  separate(strayed: Villager, other: Villager): void {
    strayed.partnerId = -1;
    other.partnerId = -1;
    const village = this.t(strayed).village;
    const empty = village.huts.find((h) => village.usableHut(h) && h.residents.length === 0);
    if (empty) this.moveHome(strayed, empty);
  }

  /** Two people become a couple (outside the usual matchmaking). */
  pair(a: Villager, b: Villager): void {
    a.partnerId = b.id;
    b.partnerId = a.id;
    this.sim.events.push(this.sim.tick, { type: 'couple', a: a.id, b: b.id });
  }

  private formCouples(sim: Sim, people: Villager[]): void {
    const singles = people.filter((v) => v.lifeStage !== 'child' && v.age >= 16 && v.partnerId === -1);
    for (const a of singles) {
      if (a.sex !== 'f' || a.partnerId !== -1 || !this.rng.chance(V.pairChancePerDay)) continue;
      const b = singles.find(
        (o) => o.sex === 'm' && o.partnerId === -1 && Math.abs(o.age - a.age) <= V.pairMaxAgeGap && !this.related(a, o),
      );
      if (!b) continue;
      a.partnerId = b.id;
      b.partnerId = a.id;
      this.sim.events.push(this.sim.tick, { type: 'couple', a: a.id, b: b.id });
      // Newlyweds take an empty hut if there is one.
      const empty = sim.village.huts.find((h) => sim.village.usableHut(h) && h.residents.length === 0);
      if (empty) {
        this.moveHome(a, empty);
        this.moveHome(b, empty);
      }
    }
  }

  private births(sim: Sim, people: Villager[]): void {
    const village = sim.village;
    const pop = people.length;
    if (pop >= V.softCap) return;
    if (village.store.food / Math.max(1, pop) < V.birthFoodPerCapita) return;
    let freeBeds = village.bedCapacity() - pop;
    // SPEC §10: a village that loves its god grows faster; one that fears it, slower.
    let love = 0;
    let fear = 0;
    for (const v of people) (love += v.faith.love), (fear += v.faith.fear);
    const mood = Math.max(V.moodBirthMin, Math.min(V.moodBirthMax, 1 + V.moodBirthEffect * ((love - fear) / Math.max(1, pop))));
    for (const mother of people.filter((v) => v.sex === 'f' && v.partnerId !== -1)) {
      if (freeBeds <= 0) break;
      if (mother.age < V.fertileMinAge || mother.age > V.fertileMaxAge) continue;
      const father = this.byId(mother.partnerId);
      if (!father?.alive) continue;
      const kids = mother.childIds.filter((c) => father.childIds.includes(c)).length;
      if (kids >= V.maxChildrenPerCouple || !this.rng.chance(V.birthChancePerDay * mood)) continue;
      const home = this.home(mother);
      const spot = home?.door ?? { x: Math.floor(mother.x), z: Math.floor(mother.z) };
      const cell = village.nearestWalkable(spot.x, spot.z) ?? spot;
      const child = this.spawn({ age: 0, x: cell.x, z: cell.z, parents: [mother.id, father.id] });
      if (home) this.moveHome(child, home);
      freeBeds--;
      sim.belief.inherit(child);
      this.sim.events.push(this.sim.tick, { type: 'birth', id: child.id, parents: [mother.id, father.id] });
    }
  }

  private moveHome(v: Villager, h: Structure): void {
    const old = v.homeId >= 0 ? this.t(v).village.byId(v.homeId) : undefined;
    if (old) old.residents = old.residents.filter((id) => id !== v.id);
    v.homeId = h.id;
    if (!h.residents.includes(v.id)) h.residents.push(v.id);
  }

  /** Give everyone without a usable home a bed: partner's or parent's home first, then any space. */
  private assignHomes(sim: Sim, people: Villager[]): void {
    const village = sim.village;
    const cap = TUNING.building.hutCapacity;
    for (const h of village.huts) h.residents = h.residents.filter((id) => this.byId(id)?.alive && this.byId(id)?.homeId === h.id);
    for (const v of people) {
      if (this.home(v)) continue;
      const prefer = [this.byId(v.partnerId), ...v.parentIds.map((p) => this.byId(p))]
        .map((o) => (o ? this.home(o) : undefined))
        .find((h): h is Structure => !!h && h.residents.length < cap);
      const any = village.huts
        .filter((h) => village.usableHut(h) && h.residents.length < cap)
        .sort((a, b) => a.residents.length - b.residents.length || a.id - b.id)[0];
      const target = prefer ?? any;
      if (target) this.moveHome(v, target);
      else v.homeId = -1;
    }
  }
}
