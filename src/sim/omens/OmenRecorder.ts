import { interpretDream } from '../belief/dreams';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import type { Sim } from '../Sim';
import { TUNING } from '../tuning';
import type { Villager, VillagerId } from '../villagers/types';
import { MATERIALS, M } from '../world/materials';
import { snapshot, surfaceY } from './context';
import type { Omen, OmenKind, Outcome, Vec3 } from './types';

const BLOCKS_VIEW = MATERIALS.map((m) => m.solid && m.id !== M.LEAVES && m.id !== M.PINE_LEAVES);
/** Shape Earth strokes this close in time merge into one omen. */
const SHAPING_QUIET = 25;

interface Shaping {
  x: number;
  z: number;
  n: number;
  columns: number;
  raised: number;
  lowered: number;
  shaken: number;
  last: number;
}

/**
 * Turns notable happenings into omens (SPEC §7): who saw it, what it did, and what
 * was going on at the time, then hands them to the interpretation engine.
 */
export class OmenRecorder {
  private lastSeq = 0;
  private shaping: Shaping | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly rng: Rng,
  ) {}

  step(): void {
    const sim = this.sim;
    for (const e of sim.events.since(this.lastSeq)) this.onEvent(e);
    this.lastSeq = sim.events.lastSeq;
    if (this.shaping && sim.tick - this.shaping.last > SHAPING_QUIET) this.finishShaping();
  }

  private onEvent(e: SimEvent): void {
    const sim = this.sim;
    switch (e.type) {
      case 'lightning': {
        const killed = e.killed;
        const injured = sim.villagers.alive
          .filter((v) => Math.hypot(v.x - (e.x + 0.5), v.z - (e.z + 0.5)) <= TUNING.miracles.lightning.injureRadius)
          .map((v) => v.id);
        const outcomes: Outcome[] = [
          ...killed.map((id): Outcome => ({ type: 'died', entity: `person:${id}`, people: [id] })),
          ...injured.map((id): Outcome => ({ type: 'injured', entity: `person:${id}`, people: [id] })),
          ...this.hutsHit(e.x, e.z, 2.5),
        ];
        if (e.fire) outcomes.push({ type: 'fireStarted' });
        this.record({
          kind: e.divine ? 'lightning' : 'naturalLightning',
          isDivine: e.divine,
          position: { x: e.x, y: e.y, z: e.z },
          radius: 3,
          magnitude: e.divine ? 0.8 : 0.65,
          outcomes,
          affected: [...killed, ...injured, ...outcomes.flatMap((o) => (o.type === 'hutDamaged' ? (o.people ?? []) : []))],
          range: 50,
          sky: 10,
          aim: e.aimX !== undefined && e.aimZ !== undefined ? { x: e.aimX, z: e.aimZ } : undefined,
        });
        break;
      }
      case 'miracleRain': {
        const dry = this.dryFieldsNear(e.x, e.z, e.radius + 1);
        const burning = [...sim.fire.burning.keys()].some((k) => {
          const [bx, , bz] = sim.fire.unkey(k);
          return Math.hypot(bx - e.x, bz - e.z) <= e.radius;
        });
        const outcomes: Outcome[] = [];
        if (dry || sim.weather.drought) outcomes.push({ type: 'cropsSaved' });
        if (burning) outcomes.push({ type: 'fireDoused' });
        this.record({
          kind: 'rain',
          isDivine: true,
          position: { x: e.x, y: surfaceY(sim, Math.round(e.x), Math.round(e.z)), z: e.z },
          radius: e.radius,
          magnitude: 0.5 + (outcomes.length ? 0.2 : 0),
          outcomes,
          range: 36,
          sky: 11,
        });
        break;
      }
      case 'rainStart': {
        const c = sim.village.center;
        const drought = sim.weather.drought || this.dryFieldsNear(c.x, c.z, 40);
        this.record({
          kind: e.storm ? 'storm' : 'naturalRain',
          isDivine: false,
          position: { x: c.x, y: c.y, z: c.z },
          radius: 60,
          magnitude: (e.storm ? 0.55 : 0.3) + (drought ? 0.25 : 0),
          outcomes: drought ? [{ type: 'cropsSaved' }] : [],
          range: 80,
          everywhere: true,
        });
        break;
      }
      case 'droughtStart': {
        const c = sim.village.center;
        this.record({
          kind: 'drought',
          isDivine: false,
          position: { x: c.x, y: c.y, z: c.z },
          radius: 60,
          magnitude: 0.45,
          outcomes: [],
          range: 80,
          everywhere: true,
        });
        break;
      }
      case 'earthShaped': {
        const s = this.shaping;
        if (s && Math.hypot(s.x / s.n - e.x, s.z / s.n - e.z) < 20) {
          s.x += e.x;
          s.z += e.z;
          s.n++;
          s.columns += e.columns;
          if (e.raise) s.raised += e.columns;
          else s.lowered += e.columns;
          s.shaken += e.shaken;
          s.last = sim.tick;
        } else {
          if (s) this.finishShaping();
          this.shaping = {
            x: e.x,
            z: e.z,
            n: 1,
            columns: e.columns,
            raised: e.raise ? e.columns : 0,
            lowered: e.raise ? 0 : e.columns,
            shaken: e.shaken,
            last: sim.tick,
          };
        }
        break;
      }
      case 'bloom':
        this.record({
          kind: 'bloom',
          isDivine: true,
          position: { x: e.x, y: surfaceY(sim, Math.round(e.x), Math.round(e.z)), z: e.z },
          radius: e.radius,
          magnitude: 0.4 + Math.min(0.3, e.crops / 60),
          outcomes: e.crops > 0 ? [{ type: 'cropsRipened', amount: e.crops }] : [],
          range: 30,
          sky: 2,
        });
        break;
      case 'holyLight':
        this.record({
          kind: 'light',
          isDivine: true,
          position: { x: e.x, y: surfaceY(sim, Math.round(e.x), Math.round(e.z)), z: e.z },
          radius: e.radius,
          magnitude: 0.6,
          outcomes: [],
          range: TUNING.miracles.light.range,
          // The pillar reaches the sky: hills hide its foot, not its top.
          sky: 16,
        });
        break;
      case 'blight':
        this.record({
          kind: 'blight',
          isDivine: true,
          position: { x: e.x, y: surfaceY(sim, Math.round(e.x), Math.round(e.z)), z: e.z },
          radius: e.radius,
          magnitude: 0.4 + Math.min(0.3, e.crops / 40),
          outcomes: e.crops > 0 ? [{ type: 'cropsWithered', amount: e.crops }] : [],
          range: 30,
          sky: 2,
        });
        break;
      case 'blessing': {
        const v = sim.villagers.byId(e.villagerId);
        if (!v) break;
        this.record({
          kind: 'blessing',
          isDivine: true,
          position: { x: Math.floor(e.x), y: Math.floor(v.y), z: Math.floor(e.z) },
          radius: TUNING.miracles.bless.witnessRadius,
          magnitude: 0.5,
          outcomes: [{ type: 'blessed', entity: `person:${v.id}`, people: [v.id] }],
          range: 24,
          sky: 1,
          affected: [v.id],
          // The one who was touched knows, whatever they could see.
          also: [v.id],
        });
        break;
      }
      case 'meteor': {
        const r = TUNING.miracles.meteor;
        const shaken = sim.villagers.alive.filter((v) => Math.hypot(v.x - (e.x + 0.5), v.z - (e.z + 0.5)) <= r.fearRadius).map((v) => v.id);
        const outcomes: Outcome[] = [
          ...e.killed.map((id): Outcome => ({ type: 'died', entity: `person:${id}`, people: [id] })),
          ...e.wrecked.flatMap((id): Outcome[] => {
            const h = sim.village.byId(id);
            return h && h.kind === 'hut' ? [{ type: 'hutDamaged', entity: `structure:${id}`, people: [...h.residents] }] : [];
          }),
          { type: 'landLowered', amount: 20 },
        ];
        if (e.fire) outcomes.push({ type: 'fireStarted' });
        // A falling star crosses the whole sky: anyone awake and outdoors sees it.
        this.record({
          kind: 'meteor',
          isDivine: true,
          position: { x: e.x, y: e.y, z: e.z },
          radius: r.craterRadius + 1,
          magnitude: 1,
          outcomes,
          range: 200,
          everywhere: true,
          affected: [...e.killed, ...shaken],
        });
        break;
      }
      case 'dream': {
        const v = sim.villagers.byId(e.villagerId);
        if (!v) break;
        const omen: Omen = {
          id: sim.belief.nextOmenId(),
          tick: sim.tick,
          kind: 'dream',
          isDivine: true,
          position: { x: v.x, y: v.y, z: v.z },
          radius: 0,
          magnitude: 0.6,
          outcomes: [],
          context: [],
          witnesses: [v.id],
          symbols: e.symbols,
        };
        sim.belief.omens.push(omen);
        sim.events.push(sim.tick, { type: 'omen', omenId: omen.id });
        interpretDream(sim, this.rng, omen, v);
        break;
      }
      default:
        break;
    }
  }

  private finishShaping(): void {
    const s = this.shaping!;
    this.shaping = null;
    const x = s.x / s.n;
    const z = s.z / s.n;
    const outcomes: Outcome[] = [];
    if (s.raised) outcomes.push({ type: 'landRaised', amount: s.raised });
    if (s.lowered) outcomes.push({ type: 'landLowered', amount: s.lowered });
    if (s.shaken) outcomes.push(...this.hutsHit(Math.round(x), Math.round(z), 6));
    this.record({
      kind: 'shapeEarth',
      isDivine: true,
      position: { x, y: surfaceY(this.sim, Math.round(x), Math.round(z)), z },
      radius: TUNING.miracles.shapeEarth.radius + 2,
      magnitude: Math.min(1, 0.25 + s.columns / 80),
      outcomes,
      range: 32,
      sky: 2,
    });
  }

  private hutsHit(x: number, z: number, r: number): Outcome[] {
    return this.sim.village.huts
      .filter((h) => {
        const dx = Math.max(h.x0 - x, 0, x - (h.x0 + h.w - 1));
        const dz = Math.max(h.z0 - z, 0, z - (h.z0 + h.d - 1));
        return Math.hypot(dx, dz) <= r;
      })
      .map((h): Outcome => ({ type: 'hutDamaged', entity: `structure:${h.id}`, people: [...h.residents] }));
  }

  private dryFieldsNear(x: number, z: number, r: number): boolean {
    return this.sim.village.fields.some((f) => f.moisture < 0.2 && Math.hypot(f.x0 + 2 - x, f.z0 + 2 - z) <= r);
  }

  private record(o: {
    kind: OmenKind;
    isDivine: boolean;
    position: Vec3;
    radius: number;
    magnitude: number;
    outcomes: Outcome[];
    range: number;
    /** Height above the ground point that witnesses need to see (a bolt in the sky, a cloud). */
    sky?: number;
    /** Weather: everyone outdoors and awake notices; no line of sight needed. */
    everywhere?: boolean;
    affected?: VillagerId[];
    aim?: { x: number; z: number };
    /** Witnesses regardless of sight (the one it happened to). */
    also?: VillagerId[];
  }): void {
    const sim = this.sim;
    const target = { x: o.position.x + 0.5, y: o.position.y + 1 + (o.sky ?? 0), z: o.position.z + 0.5 };
    const witnesses = sim.villagers.alive
      .filter((v) => o.also?.includes(v.id) || this.sees(v, target, o.range, o.everywhere === true))
      .map((v) => v.id);
    const omen: Omen = {
      id: sim.belief.nextOmenId(),
      tick: sim.tick,
      kind: o.kind,
      isDivine: o.isDivine,
      position: o.position,
      radius: o.radius,
      magnitude: o.magnitude,
      outcomes: o.outcomes,
      // An omen isn't explained by itself ("the drought foretells drought").
      context: snapshot(sim, o.position.x, o.position.z, o.affected ?? []).filter(
        (f) => !(o.kind === 'drought' && f.key === 'condition:drought') && !(o.kind === 'storm' && f.key === 'condition:storm'),
      ),
      witnesses,
      aim: o.aim,
    };
    sim.events.push(sim.tick, { type: 'omen', omenId: omen.id });
    sim.belief.interpret(omen);
  }

  /** Awake, outdoors, in range (curious villagers look further) and, unless it's weather, in sight. */
  private sees(v: Villager, t: Vec3, range: number, everywhere: boolean): boolean {
    if (v.inside || (v.action?.kind === 'sleep' && v.action.phase === 'work')) return false;
    const r = range * (v.traits.includes('curious') ? 1.5 : 1);
    const d = Math.hypot(v.x - t.x, v.z - t.z);
    if (d > r) return false;
    if (everywhere) return true;
    // Sample the sight line every half voxel; foliage doesn't block, terrain and walls do.
    const ex = v.x;
    const ey = v.y + 1.5;
    const ez = v.z;
    const len = Math.hypot(t.x - ex, t.y - ey, t.z - ez);
    const steps = Math.ceil(len / 0.5);
    for (let i = 1; i < steps - 2; i++) {
      const k = i / steps;
      const id = this.sim.world.get(Math.floor(ex + (t.x - ex) * k), Math.floor(ey + (t.y - ey) * k), Math.floor(ez + (t.z - ez) * k));
      if (BLOCKS_VIEW[id]) return false;
    }
    return true;
  }
}
