import { describe, expect, it } from 'vitest';
import { MILESTONES } from '../src/sim/milestones';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import { CROP_STAGES, M } from '../src/sim/world/materials';

const MT = TUNING.miracles;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LONG = env.LONG === '1';

function sim(seed = 'powers'): Sim {
  const s = new Sim({ seed });
  s.miracles.grace = 500;
  return s;
}

function cast(s: Sim, cmd: Command): void {
  s.enqueue(cmd);
  s.step();
}

/** Step to mid-morning, when people are up and about. */
function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

function omensOf(s: Sim, kind: string) {
  return s.belief.omens.filter((o) => o.kind === kind);
}

describe('Holy Light', () => {
  it('stands for a while, is seen from afar, and does nothing else', () => {
    const s = sim();
    morning(s);
    const c = s.village.center;
    const food = s.village.store.food;
    cast(s, { type: 'cast', miracle: 'light', x: c.x + 3, z: c.z + 3 });
    expect(s.lastFailures).toEqual([]);
    expect(s.miracles.beams).toHaveLength(1);
    s.step();
    const o = omensOf(s, 'light');
    expect(o).toHaveLength(1);
    expect(o[0]!.witnesses.length).toBeGreaterThan(3);
    expect(s.village.store.food).toBeCloseTo(food, 0);
    for (let i = 0; i < MT.light.durationTicks; i++) s.step();
    expect(s.miracles.beams).toHaveLength(0);
  });

  it('read as a blessing on the place: shone repeatedly on a landmark, it becomes holy', () => {
    const s = sim('holy-hill');
    const hill = s.island.landmarks.eastHill;
    let made = false;
    for (let day = 0; day < 12 && !made; day++) {
      morning(s);
      s.miracles.readyAt.light = 0;
      cast(s, { type: 'cast', miracle: 'light', x: hill.x, z: hill.z });
      for (let i = 0; i < TICKS_PER_DAY / 2; i++) s.step();
      made = s.belief.active('SACRED_PLACE', 0.05).length > 0;
    }
    expect(made).toBe(true);
  });
});

describe('Bless', () => {
  it('restores the one touched and only works on someone awake', () => {
    const s = sim();
    morning(s);
    const v = s.villagers.alive.find((p) => p.lifeStage === 'adult' && !p.inside)!;
    v.needs.hunger = 0.9;
    v.needs.energy = 0.1;
    const love = v.faith.love;
    cast(s, { type: 'bless', villagerId: v.id });
    expect(s.lastFailures).toEqual([]);
    expect(v.needs.hunger).toBeLessThan(0.05);
    expect(v.needs.energy).toBeGreaterThan(0.9);
    expect(v.faith.love).toBeGreaterThan(love);
    s.step();
    const o = omensOf(s, 'blessing')[0]!;
    expect(o.witnesses).toContain(v.id);
    expect(o.outcomes[0]).toMatchObject({ type: 'blessed', entity: `person:${v.id}` });

    s.miracles.readyAt.bless = 0;
    cast(s, { type: 'bless', villagerId: 99999 });
    expect(s.lastFailures).toEqual(['target']);
  });
});

describe('Blight', () => {
  it('withers crops and grass in the area and reads as harm', () => {
    const s = sim();
    const f = s.village.fields[0]!;
    for (const t of f.tiles) {
      s.village.plant(t);
      s.world.set(t.x, t.y + 1, t.z, CROP_STAGES[2]!);
    }
    const cx = f.x0 + f.w / 2;
    const cz = f.z0 + f.d / 2;
    morning(s);
    cast(s, { type: 'cast', miracle: 'blight', x: cx, z: cz });
    expect(s.lastFailures).toEqual([]);
    const growing = f.tiles.filter((t) => t.state === 2 && Math.hypot(t.x + 0.5 - cx, t.z + 0.5 - cz) <= MT.blight.radius);
    expect(growing).toHaveLength(0);
    s.step();
    const o = omensOf(s, 'blight')[0]!;
    expect(o.outcomes.some((x) => x.type === 'cropsWithered')).toBe(true);
  });
});

describe('Falling Star', () => {
  it('lands after a short fall, digs a crater with star-stone, and everyone awake sees it', () => {
    const s = sim();
    morning(s);
    const hill = s.island.landmarks.eastHill;
    const before = s.miracles.groundY(hill.x, hill.z);
    cast(s, { type: 'cast', miracle: 'meteor', x: hill.x, z: hill.z });
    expect(s.lastFailures).toEqual([]);
    expect(s.miracles.falling).toHaveLength(1);
    for (let i = 0; i < MT.meteor.fallTicks + 2; i++) s.step();
    expect(s.miracles.falling).toHaveLength(0);
    const hit = s.events.all().find((e) => e.type === 'meteor');
    expect(hit).toBeTruthy();
    if (hit?.type !== 'meteor') return;
    expect(s.miracles.groundY(hit.x, hit.z)).toBeLessThan(before);
    let star = false;
    for (let y = 0; y < 60; y++) if (s.world.get(hit.x, y, hit.z) === M.STAR_STONE) star = true;
    expect(star).toBe(true);
    const o = omensOf(s, 'meteor')[0]!;
    const awake = s.villagers.alive.filter((v) => !v.inside && !(v.action?.kind === 'sleep' && v.action.phase === 'work'));
    expect(o.witnesses.length).toBeGreaterThanOrEqual(Math.floor(awake.length * 0.8));
  });

  it('names the crater it makes', () => {
    const s = sim('star-name');
    morning(s);
    const hill = s.island.landmarks.eastHill;
    cast(s, { type: 'cast', miracle: 'meteor', x: hill.x + 4, z: hill.z + 4 });
    for (let i = 0; i < MT.meteor.fallTicks + 5; i++) s.step();
    expect(s.myth.places.all.some(([, n]) => /Crater|Star-Pit|Hollow/.test(n))).toBe(true);
  });

  it('kills anyone right beneath it', () => {
    const s = sim('star-kill');
    morning(s);
    const v = s.villagers.alive.find((p) => !p.inside)!;
    cast(s, { type: 'cast', miracle: 'meteor', x: v.x, z: v.z });
    // Hold them still for the fall.
    const x = v.x;
    const z = v.z;
    for (let i = 0; i < MT.meteor.fallTicks + 1; i++) {
      v.x = x;
      v.z = z;
      s.step();
    }
    expect(v.alive).toBe(false);
    expect(v.deathCause).toBe('meteor');
  });
});

describe('purposes', () => {
  it('the first ones are reached by playing, in order of the list', () => {
    const s = sim('purpose');
    expect(s.milestones.next(1)[0]!.id).toBe(MILESTONES[0]!.id);
    morning(s);
    const c = s.village.center;
    cast(s, { type: 'cast', miracle: 'bloom', x: c.x + 3, z: c.z + 2 });
    for (let i = 0; i < 20; i++) s.step();
    expect(s.milestones.has('seen')).toBe(true);
    expect(s.events.all().some((e) => e.type === 'milestone' && e.id === 'seen')).toBe(true);
  });

  it.skipIf(!LONG)('a long game with an attentive god reaches most of them', { timeout: 300_000 }, () => {
    const s = sim('purpose-long');
    const hill = s.island.landmarks.eastHill;
    for (let day = 0; day < 12 * 30; day++) {
      morning(s);
      s.miracles.grace = 500;
      for (const k of Object.keys(s.miracles.readyAt) as (keyof typeof s.miracles.readyAt)[]) s.miracles.readyAt[k] = 0;
      if (day % 3 === 0) cast(s, { type: 'cast', miracle: 'light', x: hill.x, z: hill.z });
      const fields = s.village.fields[0];
      if (fields && day % 5 === 1) cast(s, { type: 'cast', miracle: 'bloom', x: fields.x0 + 2, z: fields.z0 + 2 });
      for (let i = 0; i < TICKS_PER_DAY - 10; i++) s.step();
    }
    const got = MILESTONES.filter((m) => s.milestones.has(m.id)).map((m) => m.id);
    expect(got.length).toBeGreaterThanOrEqual(8);
  });
});
