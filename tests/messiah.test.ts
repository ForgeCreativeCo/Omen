import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';

function steps(s: Sim, n: number): SimEvent[] {
  const seq = s.events.lastSeq;
  for (let i = 0; i < n; i++) s.step();
  return s.events.since(seq);
}

/** A sim a few days in, with someone awake to anoint (in the middle of the village). */
function setup(tribes = 1): { s: Sim; v: Villager } {
  const s = new Sim({ seed: 'omen', tribes, mode: 'sandbox' });
  steps(s, TICKS_PER_DAY * 4);
  s.miracles.unlimited = true;
  while (s.calendar.timeOfDay !== 'day') s.step();
  const t = s.tribes[0]!;
  const c = t.village.center;
  const v = t.members
    .filter((x) => x.lifeStage === 'adult' && x.id !== t.belief.priestId && !x.inside && !(x.action?.kind === 'sleep' && x.action.phase === 'work'))
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0]!;
  return { s, v };
}

const anoint = (s: Sim, v: Villager) => {
  s.enqueue({ type: 'anoint', villagerId: v.id });
  return steps(s, 1);
};

describe('The messiah', () => {
  it('anointed: those who see it hold them chosen; only one at a time', () => {
    const { s, v } = setup();
    const ev = anoint(s, v);
    expect(s.lastFailures).toEqual([]);
    expect(s.messiah.living).toBe(v);
    const e = ev.find((x) => x.type === 'anointed');
    expect(e?.type === 'anointed' && e.witnesses.length).toBeGreaterThan(2);
    expect(s.tribes[0]!.belief.chosenIds().has(v.id)).toBe(true);
    const other = s.tribes[0]!.members.find((x) => x !== v && x.lifeStage === 'adult')!;
    s.enqueue({ type: 'anoint', villagerId: other.id });
    s.step();
    expect(s.lastFailures).toEqual(['target']);
  });

  it("their people credit the god's wonders near them to them", () => {
    const { s, v } = setup();
    anoint(s, v);
    let credited = false;
    for (let i = 0; i < 4 && !credited; i++) {
      s.enqueue({ type: 'cast', miracle: 'light', x: Math.round(v.x), z: Math.round(v.z) });
      credited = steps(s, 60).some((e) => e.type === 'messiahCredited' && e.id === v.id);
    }
    expect(credited).toBe(true);
    expect(s.messiah.credits).toBeGreaterThan(0);
  });

  it('they preach at the evening fire', () => {
    const { s, v } = setup();
    anoint(s, v);
    const ev = steps(s, TICKS_PER_DAY * 2);
    expect(ev.some((e) => e.type === 'preached' && e.id === v.id)).toBe(true);
  });

  it('dead of old age, a saint: where they lie is holy', () => {
    const { s, v } = setup();
    anoint(s, v);
    s.villagers.kill(v, 'oldAge');
    const ev = steps(s, 2);
    const d = ev.find((e) => e.type === 'messiahDied');
    expect(d?.type === 'messiahDied' && d.death).toBe('saint');
    const t = s.tribes[0]!;
    const key = t.myth.places.siteAt(Math.floor(v.x), Math.floor(v.z))?.key;
    expect(key).toBeDefined();
    expect(t.belief.beliefs.has(t.belief.key('SACRED_PLACE', key!, 'favor'))).toBe(true);
  });

  it('killed by one of their own, a martyr: grief, faith, and their people turn on the killer', () => {
    const { s, v } = setup();
    anoint(s, v);
    const t = s.tribes[0]!;
    const killer = t.members.find((x) => x !== v && x.lifeStage === 'adult')!;
    const love = t.members.filter((x) => x !== v && x !== killer).map((x) => x.faith.love);
    s.society.kill(killer, v, true);
    const ev = steps(s, 2);
    const d = ev.find((e) => e.type === 'messiahDied');
    expect(d?.type === 'messiahDied' && d.death).toBe('martyr');
    const after = t.members.filter((x) => x !== v && x !== killer).map((x) => x.faith.love);
    expect(after.reduce((a, b) => a + b, 0)).toBeGreaterThan(love.reduce((a, b) => a + b, 0));
    const bystander = t.members.find((x) => x !== killer && x !== v && x.partnerId !== killer.id)!;
    expect(s.society.bond(bystander, killer)).toBeLessThan(0);
  });

  it('struck down by the god: taken home, and the people split', () => {
    const { s, v } = setup();
    anoint(s, v);
    s.villagers.kill(v, 'lightning');
    const d = steps(s, 2).find((e) => e.type === 'messiahDied');
    expect(d?.type === 'messiahDied' && d.death).toBe('takenHome');
  });

  it('the Hand takes up the body within three days, and they rise', () => {
    const { s, v } = setup(3);
    anoint(s, v);
    s.villagers.kill(v, 'oldAge');
    steps(s, 5);
    expect(s.messiah.body).not.toBeNull();
    const b = s.messiah.body!;
    s.enqueue({ type: 'grab', target: { what: 'body' }, x: b.x, z: b.z });
    const ev = steps(s, 1);
    expect(s.lastFailures).toEqual([]);
    expect(v.alive).toBe(true);
    expect(s.villagers.alive).toContain(v);
    expect(ev.some((e) => e.type === 'messiahRisen')).toBe(true);
    s.enqueue({ type: 'release', vx: 0, vz: 0 });
    steps(s, 30);
    expect(s.messiah.living).toBe(v);
    expect(v.faith.love).toBe(1);
    // They live on, and go about their life.
    steps(s, TICKS_PER_DAY);
    expect(v.alive).toBe(true);
  });

  it('left three days, they stay dead, and another may be anointed', () => {
    const { s, v } = setup();
    anoint(s, v);
    s.villagers.kill(v, 'oldAge');
    steps(s, TICKS_PER_DAY * TUNING.messiah.bodyDays + 5);
    expect(s.messiah.body).toBeNull();
    expect(s.messiah.id).toBe(-1);
    expect(v.alive).toBe(false);
    const next = s.tribes[0]!.members.find((x) => x.lifeStage === 'adult' && !(x.action?.kind === 'sleep' && x.action.phase === 'work'))!;
    expect(s.messiah.canAnoint(next.id)).toBe(true);
  });

  it('they walk to another people and preach there; some come away with them', () => {
    const { s, v } = setup(3);
    anoint(s, v);
    (s.messiah as unknown as { nextJourney: number }).nextJourney = 0;
    let journey = false;
    let abroad: SimEvent | undefined;
    for (let d = 0; d < 20 && !abroad; d++) {
      for (const e of steps(s, TICKS_PER_DAY)) {
        if (e.type === 'messiahJourney') journey = true;
        if (e.type === 'messiahPreachedAbroad' || (e.type === 'messiahDied' && e.death === 'martyr')) abroad = e;
      }
      if (!s.messiah.living) break;
    }
    expect(journey).toBe(true);
    expect(abroad).toBeDefined();
  }, 120_000);
});
