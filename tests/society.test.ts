import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';

const S = TUNING.society;
const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

/** A married adult, their partner, and an unrelated adult of the other sex. */
function triangle(s: Sim): [Villager, Villager, Villager] {
  for (const a of s.villagers.alive) {
    if (a.lifeStage !== 'adult' || a.partnerId < 0) continue;
    const p = s.villagers.byId(a.partnerId)!;
    const b = s.villagers.alive.find((o) => o.lifeStage === 'adult' && o.sex !== a.sex && o.id !== p.id && !s.villagers.related(a, o));
    if (b) return [a, p, b];
  }
  throw new Error('no triangle');
}

describe('Society', () => {
  it('partners start warm, strangers neutral; quarrels and known thefts make grudges', () => {
    const s = new Sim({ seed: 'society' });
    const [a, p, b] = triangle(s);
    expect(s.society.bond(a, p)).toBe(S.partnerStart);
    expect(s.society.bond(a, b)).toBe(0);
    s.events.push(s.tick, { type: 'quarrel', a: a.id, b: b.id, x: 0, z: 0 });
    s.events.push(s.tick, { type: 'theft', id: b.id, hutId: a.homeId, victims: [a.id], x: 0, z: 0, known: true });
    s.step();
    expect(s.society.bond(a, b)).toBeCloseTo(-S.quarrelGrudge - S.theftGrudge, 5);
  });

  it('a cold marriage and a warm neighbor make an affair, which is found out in time', () => {
    const s = new Sim({ seed: 'society' });
    const [a, p, b] = triangle(s);
    let exposed = false;
    for (let day = 0; day < 400 && !exposed; day++) {
      s.society.bonds.set(`${Math.min(a.id, p.id)}:${Math.max(a.id, p.id)}`, -0.2);
      if (!s.society.affairOf(a)) s.society.bonds.set(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`, 0.8);
      s.society.dawn();
      exposed = events(s, 'affairExposed').some((e) => e.type === 'affairExposed' && e.a === a.id);
    }
    expect(events(s, 'affair').length).toBeGreaterThan(0);
    expect(exposed).toBe(true);
    expect(s.society.bond(p, b)).toBeLessThan(-0.3);
    expect(s.belief.deeds.deeds.some((d) => d.key === 'deed:adultery' && d.actorId === a.id)).toBe(true);
  });

  it('bitter enemies at the fire come to blows, and the struck may be hurt', () => {
    const s = new Sim({ seed: 'society' });
    const [a, , b] = triangle(s);
    s.society.shift(a, b, -0.95);
    for (let n = 0; n < 200 && !events(s, 'fight').length; n++) s.society.dusk([a, b]);
    expect(events(s, 'fight').length).toBeGreaterThan(0);
  });

  it('a killing: the victim dies, the deed is remembered, and their family hates the killer', () => {
    const s = new Sim({ seed: 'society' });
    const [a, p, b] = triangle(s);
    s.society.kill(b, a, true);
    s.step();
    expect(a.alive).toBe(false);
    expect(a.deathCause).toBe('killed');
    expect(s.society.bond(p, b)).toBeLessThanOrEqual(-S.bloodGrudge + 0.01);
    expect(s.belief.deeds.deeds.some((d) => d.key === 'deed:murder' && d.actorId === b.id)).toBe(true);
    expect(events(s, 'killing').at(-1)).toMatchObject({ killer: b.id, victim: a.id, seen: true });
  });

  it('the injured rest', () => {
    const s = new Sim({ seed: 'society' });
    const [a] = triangle(s);
    s.society.hurt.set(a.id, s.tick + 1000);
    expect(s.society.isHurt(a)).toBe(true);
  });
});
