import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import type { Villager, VillagerId } from '../villagers/types';
import { M, material, type MaterialId } from '../world/materials';

const H = TUNING.miracles.hand;

/** What the hand can take hold of. */
export type HandWhat = 'villager' | 'tree' | 'earth';

export type GrabTarget = { what: 'villager'; id: VillagerId } | { what: 'tree' } | { what: 'earth' } | { what: 'body' };

export interface Held {
  what: HandWhat;
  /** The villager held (villager only). */
  id: VillagerId;
  /** Voxels torn up (earth): carried along and dropped where it lands. */
  voxels: MaterialId[];
  x: number;
  y: number;
  z: number;
}

export interface Thrown extends Held {
  vx: number;
  vy: number;
  vz: number;
}

/**
 * The god's hand: take hold of a villager, a tree or a handful of earth, carry
 * it through the air, and let go. Let go gently and a villager is set down
 * unharmed; flick and whatever is held flies, landing hard enough to kill, crush
 * and smash. Everything it does goes through commands (grab, carry, release),
 * so it replays like any other miracle.
 */
export class Hand {
  held: Held | null = null;
  readonly thrown: Thrown[] = [];
  /** Where the hand is going (voxel x, z). */
  tx = 0;
  tz = 0;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** A villager in the hand or in the air: their own feet aren't theirs right now. */
  holds(v: Villager): boolean {
    return (this.held?.what === 'villager' && this.held.id === v.id) || this.thrown.some((t) => t.what === 'villager' && t.id === v.id);
  }

  private carryY(x: number, z: number): number {
    return Math.max(TUNING.terrain.seaLevel, this.sim.world.topY(Math.floor(x), Math.floor(z))) + H.carryHeight;
  }

  // ------------------------------------------------------------------ commands

  grab(target: GrabTarget, x: number, z: number): boolean {
    if (this.held) return false;
    const sim = this.sim;
    this.tx = x;
    this.tz = z;
    if (target.what === 'body') {
      // The messiah's body: taken up, they rise in the hand.
      const b = sim.messiah.body;
      if (!b || Math.hypot(b.x - x, b.z - z) > H.reach + 1) return false;
      const v = sim.messiah.raise();
      if (!v) return false;
      sim.villagers.lift(v);
      this.held = { what: 'villager', id: v.id, voxels: [], x: v.x, y: v.y, z: v.z };
    } else if (target.what === 'villager') {
      const v = sim.villagers.byId(target.id);
      if (!v?.alive || v.inside || this.holds(v)) return false;
      sim.villagers.lift(v);
      this.held = { what: 'villager', id: v.id, voxels: [], x: v.x, y: v.y, z: v.z };
    } else if (target.what === 'tree') {
      const t = sim.village.trees.filter((tr) => sim.village.treeAlive(tr) && Math.hypot(tr.x + 0.5 - x, tr.z + 0.5 - z) <= H.reach).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      if (!t) return false;
      const y = sim.world.topY(t.x, t.z);
      sim.village.fell(t);
      this.held = { what: 'tree', id: -1, voxels: [], x: t.x + 0.5, y, z: t.z + 0.5 };
    } else {
      const voxels = this.tearUp(Math.floor(x), Math.floor(z));
      if (!voxels.length) return false;
      this.held = { what: 'earth', id: -1, voxels, x, y: sim.world.topY(Math.floor(x), Math.floor(z)) + 1, z };
    }
    sim.events.push(sim.tick, { type: 'handGrab', what: this.held.what, id: this.held.id, x: Math.floor(x), z: Math.floor(z) });
    return true;
  }

  carry(x: number, z: number): void {
    this.tx = Math.max(1, Math.min(this.sim.world.sizeX - 2, x));
    this.tz = Math.max(1, Math.min(this.sim.world.sizeZ - 2, z));
  }

  /** Let go: gently, a villager is set down; with a flick, whatever is held is thrown. */
  release(vx: number, vz: number): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    const sim = this.sim;
    const speed = Math.hypot(vx, vz);
    if (h.what === 'villager' && speed < H.placeSpeed) {
      const v = sim.villagers.byId(h.id);
      if (!v) return;
      const spot = sim.village.nearestWalkable(Math.floor(h.x), Math.floor(h.z)) ?? { x: Math.floor(h.x), z: Math.floor(h.z) };
      sim.villagers.setDown(v, spot.x, spot.z);
      sim.events.push(sim.tick, { type: 'handPlace', id: v.id, x: spot.x, z: spot.z });
      return;
    }
    const k = speed > H.maxThrowSpeed ? H.maxThrowSpeed / speed : 1;
    this.thrown.push({ ...h, vx: vx * k, vz: vz * k, vy: H.throwLift * Math.min(1, speed / H.maxThrowSpeed) });
  }

  // ------------------------------------------------------------------ per tick

  step(): void {
    const sim = this.sim;
    const h = this.held;
    if (h) {
      // The hand glides after the pointer, high above the ground.
      const dx = this.tx - h.x;
      const dz = this.tz - h.z;
      const d = Math.hypot(dx, dz);
      const k = d > H.carrySpeed ? H.carrySpeed / d : 1;
      h.x += dx * k;
      h.z += dz * k;
      const ty = this.carryY(h.x, h.z);
      h.y += Math.max(-1, Math.min(1, ty - h.y)) * 0.6;
      if (h.what === 'villager') this.pin(h);
    }
    for (const t of [...this.thrown]) {
      t.vy -= H.gravity;
      t.x += t.vx;
      t.y += t.vy;
      t.z += t.vz;
      const x = Math.floor(t.x);
      const z = Math.floor(t.z);
      if (x < 1 || z < 1 || x >= sim.world.sizeX - 1 || z >= sim.world.sizeZ - 1) {
        // Out over the open sea: gone.
        this.thrown.splice(this.thrown.indexOf(t), 1);
        if (t.what === 'villager') {
          const v = sim.villagers.byId(t.id);
          if (v?.alive) sim.villagers.kill(v, 'thrown');
        }
        continue;
      }
      if (t.what === 'villager') this.pin(t);
      const ground = sim.world.topY(x, z);
      const water = sim.world.get(x, Math.floor(t.y), z) === M.WATER;
      if (t.y <= ground + 1 || water) {
        this.thrown.splice(this.thrown.indexOf(t), 1);
        this.land(t, x, Math.max(ground, Math.floor(t.y) - 1), z, water);
      }
    }
  }

  /** A held or flying villager goes where the hand (or the throw) takes them. */
  private pin(p: Held): void {
    const v = this.sim.villagers.byId(p.id);
    if (!v?.alive) return;
    v.x = p.x;
    v.y = p.y - 1.4;
    v.z = p.z;
  }

  // ------------------------------------------------------------------ impact

  private land(t: Thrown, x: number, y: number, z: number, water: boolean): void {
    const sim = this.sim;
    const speed = Math.hypot(t.vx, t.vy, t.vz);
    const killed: number[] = [];
    const wrecked = new Set<number>();
    let survived = false;
    if (t.what === 'villager') {
      const v = sim.villagers.byId(t.id);
      if (v?.alive) {
        const spot = water ? { x, z } : (sim.village.nearestWalkable(x, z) ?? { x, z });
        sim.villagers.setDown(v, spot.x, spot.z, water ? y + 1 : undefined);
        if (!water && speed > H.survivableSpeed) {
          killed.push(v.id);
          sim.villagers.kill(v, 'thrown');
        } else {
          survived = true;
          if (!water) sim.society.hurt.set(v.id, sim.tick + H.bruisedDays * TICKS_PER_DAY);
        }
      }
    } else if (!water) {
      // A tree or a clod of earth: whoever it lands on, whatever it lands on.
      const r = t.what === 'tree' ? H.treeRadius : Math.min(H.maxEarthRadius, 0.9 + Math.cbrt(t.voxels.length) * 0.5);
      for (const v of [...sim.villagers.alive]) {
        if (this.holds(v) || v.inside) continue;
        if (Math.hypot(v.x - (x + 0.5), v.z - (z + 0.5)) <= r) {
          killed.push(v.id);
          sim.villagers.kill(v, 'crushed');
        }
      }
      this.smash(x, z, r, wrecked);
      if (t.what === 'earth') this.pile(x, z, t.voxels);
      else this.logs(x, z, t.vx, t.vz);
    }
    sim.events.push(sim.tick, { type: 'handImpact', what: t.what, id: t.id, x, y, z, speed, killed, wrecked: [...wrecked], survived, water });
  }

  /** Knock blocks off structures in a circle. */
  private smash(cx: number, cz: number, r: number, wrecked: Set<number>): void {
    const sim = this.sim;
    const w = sim.world;
    const ri = Math.ceil(r);
    for (let dz = -ri; dz <= ri; dz++)
      for (let dx = -ri; dx <= ri; dx++) {
        if (Math.hypot(dx, dz) > r) continue;
        const s = sim.structureAt(cx + dx, cz + dz);
        if (!s || s.kind === 'field') continue;
        for (const st of s.steps) {
          if (st.x !== cx + dx || st.z !== cz + dz || st.mat === M.AIR) continue;
          if (w.get(st.x, st.y, st.z) === st.mat && this.rng.chance(H.smashChance)) {
            w.set(st.x, st.y, st.z, M.AIR);
            wrecked.add(s.id);
          }
        }
      }
  }

  /** Tear up a handful of ground: the top couple of layers, a few voxels across. */
  private tearUp(cx: number, cz: number): MaterialId[] {
    const w = this.sim.world;
    const out: MaterialId[] = [];
    const sea = TUNING.terrain.seaLevel;
    for (let dz = -H.earthRadius; dz <= H.earthRadius; dz++)
      for (let dx = -H.earthRadius; dx <= H.earthRadius; dx++) {
        if (Math.hypot(dx, dz) > H.earthRadius + 0.3) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (this.sim.structureAt(x, z)) continue;
        if (this.sim.village.trees.some((t) => t.x === x && t.z === z && this.sim.village.treeAlive(t))) continue;
        for (let k = 0; k < H.earthDepth; k++) {
          const y = w.topY(x, z, (id) => id !== M.AIR && id !== M.LEAVES && id !== M.PINE_LEAVES);
          if (y <= sea || y <= 1) break;
          const id = w.get(x, y, z);
          const m = material(id);
          if (!m.solid || id === M.WATER) break;
          out.push(m.cropStage || m.decor || id === M.LEAVES || id === M.PINE_LEAVES ? M.DIRT : id);
          w.set(x, y, z, M.AIR);
        }
      }
    return out;
  }

  /** Where a clod lands, its earth piles up. */
  private pile(cx: number, cz: number, voxels: MaterialId[]): void {
    const w = this.sim.world;
    let i = 0;
    for (let r = 0; i < voxels.length && r <= 3; r++)
      for (let dz = -r; dz <= r && i < voxels.length; dz++)
        for (let dx = -r; dx <= r && i < voxels.length; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 1 || z < 1 || x >= w.sizeX - 1 || z >= w.sizeZ - 1 || this.sim.structureAt(x, z)) continue;
          const y = w.topY(x, z) + 1;
          if (w.get(x, y, z) !== M.AIR) continue;
          w.set(x, y, z, voxels[i++]!);
        }
  }

  /** A thrown tree lies where it falls: a few logs along its flight. */
  private logs(cx: number, cz: number, vx: number, vz: number): void {
    const w = this.sim.world;
    const d = Math.hypot(vx, vz) || 1;
    for (let k = 0; k < 3; k++) {
      const x = Math.round(cx + (vx / d) * k);
      const z = Math.round(cz + (vz / d) * k);
      if (x < 1 || z < 1 || x >= w.sizeX - 1 || z >= w.sizeZ - 1 || this.sim.structureAt(x, z)) continue;
      const y = w.topY(x, z) + 1;
      if (w.get(x, y, z) === M.AIR) w.set(x, y, z, M.WOOD);
    }
  }
}

