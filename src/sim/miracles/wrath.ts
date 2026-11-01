import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';
import type { Tree } from '../villagers/village';
import type { Villager } from '../villagers/types';
import { M, material, type MaterialId } from '../world/materials';
import { blessed, type Structure } from '../world/structures';

const MT = TUNING.miracles;

/** An earthquake shaking an area. */
export interface Quake {
  id: number;
  x: number;
  z: number;
  radius: number;
  ticksLeft: number;
  wrecked: number[];
  killed: number[];
  trees: number;
}

/** Fire raining on an area. `hits`: where it landed this tick (for the renderer). */
export interface Firestorm {
  id: number;
  x: number;
  z: number;
  radius: number;
  ticksLeft: number;
  killed: number[];
  wrecked: number[];
  fires: number;
  hits: { x: number; y: number; z: number }[];
}

/** A locust swarm eating one people's crops. */
export interface Swarm {
  id: number;
  x: number;
  z: number;
  tribe: number;
  ticksLeft: number;
  /** The field it's heading to or eating, or -1. */
  fieldId: number;
  eaten: number;
  food: number;
  /** Already raided the village store. */
  robbed: boolean;
}

/** The sea surging inland along a line from the shore. */
export interface Wave {
  id: number;
  /** Where it leaves the sea, the unit direction it runs, and how far. */
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  length: number;
  /** How far from the sea the god pointed, and the water level the crest holds until there. */
  aim: number;
  crest: number;
  /** How far the front has come. */
  front: number;
  /** Voxel keys turned to water, to drain afterwards. */
  placed: number[];
  /** Tick it starts to drain (-1 while still running), and blocks it sinks by per tick once draining. */
  drainAt: number;
  drainPer: number;
  wrecked: number[];
  crops: number;
  carried: number[];
}

const NOT_GROUND = (id: MaterialId) => id !== M.AIR && id !== M.WATER && !material(id).decor && !material(id).cropStage && id !== M.LEAVES && id !== M.PINE_LEAVES && id !== M.WOOD;

/**
 * The destructive powers: earthquake, firestorm, tidal wave and swarm. Each
 * runs for a while after it's cast and announces itself twice: when it starts
 * (for the renderer and the sound) and when it's done (with everything it did,
 * for the omen recorder).
 */
export class Wrath {
  readonly quakes: Quake[] = [];
  readonly firestorms: Firestorm[] = [];
  readonly swarms: Swarm[] = [];
  readonly waves: Wave[] = [];
  private nextId = 1;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  /** Anything still going on (the HUD and tests wait on this). */
  get active(): boolean {
    return this.quakes.length + this.firestorms.length + this.swarms.length + this.waves.length > 0;
  }

  step(): void {
    for (const q of [...this.quakes]) this.shake(q);
    for (const f of [...this.firestorms]) this.burn(f);
    for (const s of [...this.swarms]) this.fly(s);
    for (const w of [...this.waves]) this.surge(w);
  }

  private treeAt(x: number, z: number): Tree | undefined {
    return this.sim.trees.find((t) => t.alive && t.x === x && t.z === z);
  }

  /** Knock a block off whatever structure covers (x, z) at or below `maxY`, with chance `p` each. */
  private knock(s: Structure, x: number, z: number, p: number, out: number[], maxY = Infinity): number {
    const w = this.sim.world;
    let n = 0;
    for (const st of s.steps) {
      if (st.x !== x || st.z !== z || st.mat === M.AIR || st.y > maxY) continue;
      if (w.get(st.x, st.y, st.z) === st.mat && this.rng.chance(p)) {
        w.set(st.x, st.y, st.z, M.AIR);
        n++;
      }
    }
    if (n && !out.includes(s.id)) out.push(s.id);
    return n;
  }

  // ------------------------------------------------------------------ earthquake

  quake(x: number, z: number): void {
    const sim = this.sim;
    const Q = MT.quake;
    const q: Quake = { id: this.nextId++, x, z, radius: Q.radius, ticksLeft: Q.durationTicks, wrecked: [], killed: [], trees: 0 };
    this.quakes.push(q);
    const cracks = this.rng.int(Q.cracks[0]!, Q.cracks[1]!);
    for (let i = 0; i < cracks; i++) this.crack(q, this.rng.range(0, Math.PI * 2), this.rng.range(0.6, 1) * Q.radius);
    // Everyone near runs from the shaking ground.
    for (const v of sim.villagers.alive) {
      const d = Math.hypot(v.x - x, v.z - z);
      if (d > Q.radius * 1.4) continue;
      v.needs.safety = 0;
      if (!v.inside) sim.villagers.scare(v, x, z);
    }
    sim.events.push(sim.tick, { type: 'quake', id: q.id, x, z, radius: q.radius, durationTicks: Q.durationTicks, cracks });
  }

  /** A fissure: a wobbling line from the epicenter, the ground dropping away along it. */
  private crack(q: Quake, angle: number, length: number): void {
    const sim = this.sim;
    const w = sim.world;
    const sea = TUNING.terrain.seaLevel;
    let a = angle;
    let px = q.x;
    let pz = q.z;
    for (let s = 0; s < length; s++) {
      a += this.rng.jitter(0.35);
      px += Math.cos(a);
      pz += Math.sin(a);
      const wide = s < length * 0.6 && this.rng.chance(0.4) ? 1 : 0;
      for (let k = -wide; k <= wide; k++) {
        const x = Math.round(px + Math.cos(a + Math.PI / 2) * k);
        const z = Math.round(pz + Math.sin(a + Math.PI / 2) * k);
        if (x < 1 || z < 1 || x >= w.sizeX - 1 || z >= w.sizeZ - 1) continue;
        const st = sim.structureAt(x, z);
        if (st && st.kind !== 'field') {
          this.knock(st, x, z, 0.9, q.wrecked);
          continue;
        }
        const tree = this.treeAt(x, z);
        if (tree) (sim.village.fell(tree), q.trees++);
        const g = w.topY(x, z, NOT_GROUND);
        if (g < 0) continue;
        for (let y = g + 1; y <= g + 2; y++) if (material(w.get(x, y, z)).decor || material(w.get(x, y, z)).cropStage) w.set(x, y, z, M.AIR);
        const depth = Math.max(1, Math.round(MT.quake.crackDepth * (1 - s / (length + 2))));
        for (let d = 0; d < depth && g - d > MT.shapeEarth.minY; d++) {
          const y = g - d;
          const wet = y <= sea && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, az]) => w.get(x + ax!, y, z + az!) === M.WATER);
          w.set(x, y, z, wet ? M.WATER : M.AIR);
        }
      }
    }
  }

  private shake(q: Quake): void {
    const sim = this.sim;
    const Q = MT.quake;
    q.ticksLeft--;
    // Every block in the area has its chance to fall over the length of the quake, more near the middle.
    const per = Q.topple / Q.durationTicks;
    for (const s of [...sim.huts, ...sim.tribes.flatMap((t) => t.village.structures.filter((x) => x.kind !== 'hut' && x.kind !== 'field'))]) {
      const cx = s.x0 + s.w / 2;
      const cz = s.z0 + s.d / 2;
      const d = Math.hypot(cx - q.x, cz - q.z);
      if (d > q.radius) continue;
      const p = per * (1 - (d / q.radius) * 0.7);
      let lost = 0;
      for (let x = s.x0; x < s.x0 + s.w; x++) for (let z = s.z0; z < s.z0 + s.d; z++) lost += this.knock(s, x, z, p, q.wrecked);
      if (!lost || s.kind !== 'hut') continue;
      // Those asleep inside may be caught under it.
      for (const id of s.residents) {
        const v = sim.villagers.byId(id);
        if (!v?.alive || !v.inside || !this.rng.chance(Q.crushChance * Math.min(1, lost / 3))) continue;
        q.killed.push(v.id);
        sim.villagers.kill(v, 'quake');
      }
    }
    // Trees sway and some go down.
    if (sim.tick % 4 === 0) {
      for (const t of sim.trees) {
        if (!t.alive || Math.hypot(t.x - q.x, t.z - q.z) > q.radius || !this.rng.chance((Q.treeFall * 4) / Q.durationTicks)) continue;
        sim.village.fell(t);
        q.trees++;
      }
    }
    if (q.ticksLeft > 0) return;
    this.quakes.splice(this.quakes.indexOf(q), 1);
    sim.events.push(sim.tick, { type: 'quakeEnd', id: q.id, x: q.x, z: q.z, radius: q.radius, wrecked: q.wrecked, killed: q.killed, trees: q.trees });
  }

  // ------------------------------------------------------------------ firestorm

  firestorm(x: number, z: number): void {
    const F = MT.firestorm;
    const f: Firestorm = { id: this.nextId++, x, z, radius: F.radius, ticksLeft: F.durationTicks, killed: [], wrecked: [], fires: 0, hits: [] };
    this.firestorms.push(f);
    this.sim.events.push(this.sim.tick, { type: 'firestorm', id: f.id, x, z, radius: f.radius, durationTicks: F.durationTicks });
  }

  private burn(f: Firestorm): void {
    const sim = this.sim;
    const w = sim.world;
    const F = MT.firestorm;
    f.ticksLeft--;
    f.hits = [];
    for (let i = 0; i < F.perTick; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * f.radius;
      const x = Math.round(f.x + Math.cos(a) * r);
      const z = Math.round(f.z + Math.sin(a) * r);
      if (x < 1 || z < 1 || x >= w.sizeX - 1 || z >= w.sizeZ - 1) continue;
      const y = w.topY(x, z);
      if (y < 0 || w.get(x, y, z) === M.WATER) continue;
      f.hits.push({ x, y, z });
      // Whatever it lands on catches, and the ground around it is scorched.
      let lit = false;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -2; dy <= 1; dy++) {
            const id = w.get(x + dx, y + dy, z + dz);
            if (material(id).flammable && this.rng.chance(dx === 0 && dz === 0 ? 0.9 : 0.35) && sim.fire.ignite(x + dx, y + dy, z + dz)) lit = true;
          }
      if (lit) f.fires++;
      const g = w.topY(x, z, NOT_GROUND);
      if (g >= 0 && w.get(x, g, z) === M.GRASS) w.set(x, g, z, M.ASH);
      const s = sim.structureAt(x, z);
      if (s && s.kind !== 'field') this.knock(s, x, z, 0.25, f.wrecked);
      for (const v of [...sim.villagers.alive]) {
        if (v.inside || Math.hypot(v.x - (x + 0.5), v.z - (z + 0.5)) > F.killRadius) continue;
        f.killed.push(v.id);
        sim.villagers.kill(v, 'firestorm');
      }
    }
    if (sim.tick % 10 === 0) {
      for (const v of sim.villagers.alive) {
        if (Math.hypot(v.x - f.x, v.z - f.z) > F.fearRadius) continue;
        v.needs.safety = 0;
        if (!v.inside && Math.hypot(v.x - f.x, v.z - f.z) <= f.radius + 4) sim.villagers.scare(v, f.x, f.z);
      }
    }
    if (f.fires && sim.tick % 15 === 0) sim.emitFireStarted(f.x, w.topY(Math.round(f.x), Math.round(f.z)), f.z);
    if (f.ticksLeft > 0) return;
    this.firestorms.splice(this.firestorms.indexOf(f), 1);
    sim.events.push(sim.tick, { type: 'firestormEnd', id: f.id, x: f.x, z: f.z, radius: f.radius, killed: f.killed, wrecked: f.wrecked, fires: f.fires });
  }

  // ------------------------------------------------------------------ swarm

  swarm(x: number, z: number): void {
    const sim = this.sim;
    const S = MT.swarm;
    // It goes for the people whose fields are nearest where the god points.
    let tribe = -1;
    let best = Infinity;
    for (const t of sim.tribes) {
      if (!t.members.length) continue;
      for (const f of t.village.fields) {
        const d = Math.hypot(f.x0 + f.w / 2 - x, f.z0 + f.d / 2 - z);
        if (d < best) (best = d), (tribe = t.id);
      }
      const c = t.village.center;
      const d = Math.hypot(c.x - x, c.z - z) + 10;
      if (d < best) (best = d), (tribe = t.id);
    }
    const s: Swarm = { id: this.nextId++, x, z, tribe: Math.max(0, tribe), ticksLeft: S.durationTicks, fieldId: -1, eaten: 0, food: 0, robbed: false };
    this.swarms.push(s);
    sim.events.push(sim.tick, { type: 'swarm', id: s.id, x, z, tribe: s.tribe });
  }

  private fly(s: Swarm): void {
    const sim = this.sim;
    const S = MT.swarm;
    s.ticksLeft--;
    const t = sim.tribes[s.tribe];
    // The locusts pass a blessed field by.
    const fields = t ? t.village.fields.filter((f) => !f.destroyed && !blessed(f, sim.tick)) : [];
    const ripe = (f: Structure) => f.tiles.some((tile) => tile.state === 2);
    let field = fields.find((f) => f.id === s.fieldId);
    if (!field || !ripe(field)) {
      // The nearest field still green.
      field = fields.filter(ripe).sort((a, b) => Math.hypot(a.x0 - s.x, a.z0 - s.z) - Math.hypot(b.x0 - s.x, b.z0 - s.z))[0];
      s.fieldId = field?.id ?? -1;
    }
    // Over the village it gets into the stores too.
    const c = t?.village.center;
    if (t && c && !s.robbed && Math.hypot(c.x - s.x, c.z - s.z) < 8) {
      s.robbed = true;
      const take = t.village.store.food * S.storeShare;
      t.village.store.food -= take;
      s.food += take;
    }
    const goal = field ? { x: field.x0 + field.w / 2, z: field.z0 + field.d / 2 } : c;
    if (goal) {
      const d = Math.hypot(goal.x - s.x, goal.z - s.z);
      if (d > 1.5) {
        s.x += ((goal.x - s.x) / d) * Math.min(d, S.speed);
        s.z += ((goal.z - s.z) / d) * Math.min(d, S.speed);
      }
    }
    if (field) {
      let n = 0;
      for (const tile of field.tiles) {
        if (n >= S.eatPerTick) break;
        if (tile.state !== 2 || Math.hypot(tile.x + 0.5 - s.x, tile.z + 0.5 - s.z) > S.radius + Math.max(field.w, field.d) / 2) continue;
        sim.world.set(tile.x, tile.y + 1, tile.z, M.AIR);
        tile.state = 1;
        tile.progress = 0;
        s.eaten++;
        n++;
      }
    }
    if (sim.tick % 10 === 0) {
      for (const v of sim.villagers.alive) if (!v.inside && Math.hypot(v.x - s.x, v.z - s.z) <= S.radius + 2) v.needs.safety = Math.max(0, v.needs.safety - 0.3);
    }
    if (s.ticksLeft > 0 && (field || !s.robbed)) return;
    this.swarms.splice(this.swarms.indexOf(s), 1);
    sim.events.push(sim.tick, { type: 'swarmEnd', id: s.id, x: s.x, z: s.z, tribe: s.tribe, eaten: s.eaten, food: Math.round(s.food) });
  }

  // ------------------------------------------------------------------ tidal wave

  /** Is there open sea within reach of the point? */
  shoreNear(x: number, z: number): boolean {
    return this.shore(x, z) !== null;
  }

  /** The nearest open water at sea level, searching outward from (tx, tz). */
  private shore(tx: number, tz: number): { x: number; z: number } | null {
    const w = this.sim.world;
    const W = MT.wave;
    const sea = TUNING.terrain.seaLevel;
    // The nearest open water at sea level.
    let shore: { x: number; z: number } | null = null;
    for (let r = 1; r <= W.searchRadius && !shore; r++) {
      let best = Infinity;
      for (let k = 0; k < r * 8; k++) {
        const a = (k / (r * 8)) * Math.PI * 2;
        const x = Math.round(tx + Math.cos(a) * r);
        const z = Math.round(tz + Math.sin(a) * r);
        if (x < 0 || z < 0 || x >= w.sizeX || z >= w.sizeZ) continue;
        if (w.get(x, sea, z) !== M.WATER || w.get(x, sea - 2, z) !== M.WATER) continue;
        const d = Math.hypot(x - tx, z - tz);
        if (d < best) (best = d), (shore = { x, z });
      }
    }
    return shore;
  }

  /** False if there's no sea within reach of the point. */
  wave(tx: number, tz: number): boolean {
    const sim = this.sim;
    const W = MT.wave;
    const shore = this.shore(tx, tz);
    if (!shore) return false;
    const d = Math.max(1, Math.hypot(tx - shore.x, tz - shore.z));
    // However far it has to come, it stands over the ground where the god pointed.
    const ground = this.sim.world.topY(Math.round(tx), Math.round(tz), NOT_GROUND);
    const sea = TUNING.terrain.seaLevel;
    const crest = Math.min(sea + W.maxRise, Math.max(sea + W.height, ground + W.depth));
    const wave: Wave = {
      id: this.nextId++,
      ox: shore.x,
      oz: shore.z,
      dx: (tx - shore.x) / d,
      dz: (tz - shore.z) / d,
      length: d + W.overrun,
      aim: d,
      crest,
      front: 0,
      placed: [],
      drainAt: -1,
      drainPer: 0,
      wrecked: [],
      crops: 0,
      carried: [],
    };
    this.waves.push(wave);
    sim.events.push(sim.tick, { type: 'wave', id: wave.id, x: shore.x, z: shore.z, tx, tz, dx: wave.dx, dz: wave.dz, length: wave.length, width: W.width });
    return true;
  }

  private surge(wv: Wave): void {
    const sim = this.sim;
    const w = sim.world;
    const W = MT.wave;
    const sea = TUNING.terrain.seaLevel;
    if (wv.drainAt >= 0) {
      if (sim.tick < wv.drainAt) return;
      // The sea draws back: the level sinks, top layer first.
      if (!wv.drainPer) {
        const y = (k: number) => sim.fire.unkey(k)[1];
        wv.placed.sort((a, b) => y(b) - y(a));
        wv.drainPer = Math.max(1, Math.ceil(wv.placed.length / W.drainTicks));
      }
      for (const k of wv.placed.splice(0, wv.drainPer)) {
        const [x, y, z] = sim.fire.unkey(k);
        if (w.get(x, y, z) === M.WATER) w.set(x, y, z, M.AIR);
      }
      if (!wv.placed.length) this.waves.splice(this.waves.indexOf(wv), 1);
      return;
    }
    const from = wv.front;
    wv.front = Math.min(wv.length, wv.front + W.speed);
    const px = -wv.dz;
    const pz = wv.dx;
    const done = new Set<number>();
    for (let s = from; s <= wv.front; s += 0.5) {
      // Level to the point the god chose, then spending itself past it.
      const crest = s <= wv.aim ? wv.crest : wv.crest - ((s - wv.aim) / W.overrun) * (wv.crest - sea);
      if (crest <= sea + 0.5) continue;
      for (let k = -W.width / 2; k <= W.width / 2; k += 0.5) {
        // The wave's edges are lower than its middle.
        const h = Math.floor(crest - Math.abs(k / (W.width / 2)) ** 2 * 2.5);
        if (h <= sea) continue;
        const x = Math.round(wv.ox + wv.dx * s + px * k);
        const z = Math.round(wv.oz + wv.dz * s + pz * k);
        if (x < 1 || z < 1 || x >= w.sizeX - 1 || z >= w.sizeZ - 1) continue;
        const cell = x + z * w.sizeX;
        if (done.has(cell)) continue;
        done.add(cell);
        this.flood(wv, x, z, h);
      }
    }
    if (wv.front < wv.length) return;
    wv.drainAt = sim.tick + W.holdTicks;
    const tx = Math.round(wv.ox + wv.dx * (wv.length - W.overrun));
    const tz = Math.round(wv.oz + wv.dz * (wv.length - W.overrun));
    sim.events.push(sim.tick, { type: 'waveEnd', id: wv.id, x: tx, z: tz, wrecked: wv.wrecked, crops: wv.crops, carried: wv.carried });
  }

  /** Water up to `h` over one column: crops drowned, blocks torn off, people swept along. */
  private flood(wv: Wave, x: number, z: number, h: number): void {
    const sim = this.sim;
    const w = sim.world;
    const W = MT.wave;
    const g = w.topY(x, z, NOT_GROUND);
    if (g < 0 || g >= h) return;
    const s = sim.structureAt(x, z);
    if (s?.kind === 'field') {
      const tile = s.tiles.find((t) => t.x === x && t.z === z);
      if (tile?.state === 2) {
        tile.state = 1;
        tile.progress = 0;
        wv.crops++;
      }
    } else if (s) this.knock(s, x, z, W.wreck, wv.wrecked, h);
    if (this.rng.chance(0.3)) {
      const tree = this.treeAt(x, z);
      if (tree) sim.village.fell(tree);
    }
    for (let y = g + 1; y <= h; y++) {
      const id = w.get(x, y, z);
      if (id !== M.AIR && !material(id).decor && !material(id).cropStage) continue;
      w.set(x, y, z, M.WATER);
      wv.placed.push(sim.fire.key(x, y, z));
    }
    for (const v of sim.villagers.alive) {
      if (Math.floor(v.x) !== x || Math.floor(v.z) !== z || wv.carried.includes(v.id) || !this.rng.chance(W.carry)) continue;
      this.sweep(v, wv);
    }
  }

  /** Carried inland on the wave and dropped in the water. */
  private sweep(v: Villager, wv: Wave): void {
    const sim = this.sim;
    wv.carried.push(v.id);
    v.inside = false;
    const n = this.rng.range(3, 7);
    const x = Math.max(1, Math.min(sim.world.sizeX - 2, v.x + wv.dx * n));
    const z = Math.max(1, Math.min(sim.world.sizeZ - 2, v.z + wv.dz * n));
    v.x = x;
    v.z = z;
    v.y = sim.world.topY(Math.floor(x), Math.floor(z), NOT_GROUND) + 1;
    v.needs.safety = 0;
    sim.villagers.lift(v);
    v.nextThink = sim.tick + Math.round(TICKS_PER_DAY * 0.02);
  }
}
