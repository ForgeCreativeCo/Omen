import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

const W = TUNING.war;
const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

function days(s: Sim, n: number): void {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) s.step();
}

describe('Deeper war', () => {
  it('a winning raid carries off captives, who live with their captors and go home at peace', () => {
    let found = false;
    for (const seed of ['captives', 'captives-2', 'captives-3']) {
      const s = new Sim({ seed, tribes: 2 });
      for (let d = 0; d < 80 && !events(s, 'captured').length; d++) {
        s.war.relations.set('0:1', -0.95);
        if (!s.war.atWar(0, 1)) s.war.dawn();
        days(s, 1);
      }
      const e = events(s, 'captured').at(-1);
      if (e?.type !== 'captured') continue;
      found = true;
      for (const id of e.ids) {
        expect(s.villagers.byId(id)!.tribeId).toBe(e.by);
        expect(s.war.captives.has(id)).toBe(true);
      }
      // Peace sends them home.
      s.war.weariness.set('0:1', W.peaceWeariness);
      s.war.relations.set('0:1', 0);
      for (let i = 0; i < 4 && s.war.atWar(0, 1); i++) s.war.dawn();
      const peace = events(s, 'peace').at(-1);
      expect(peace?.type === 'peace' && peace.freed?.length).toBeTruthy();
      for (const id of e.ids) {
        const v = s.villagers.byId(id)!;
        if (v.alive) expect(v.tribeId).toBe(e.from);
      }
      break;
    }
    expect(found).toBe(true);
  }, 240_000);

  it('captives held long enough become one of their captors', () => {
    const s = new Sim({ seed: 'captive-years', tribes: 2 });
    const v = s.tribes[1]!.members.find((p) => p.lifeStage === 'adult')!;
    v.tribeId = 0;
    s.war.captives.set(v.id, { from: 1, by: 0, tick: s.tick - W.captiveYears * TICKS_PER_YEAR });
    s.war.dawn();
    expect(s.war.captives.has(v.id)).toBe(false);
    expect(events(s, 'captiveJoined').at(-1)).toMatchObject({ id: v.id });
  });

  it('a broken people is conquered: taken in, or driven from its land', () => {
    for (const hate of [-0.5, -0.95]) {
      const s = new Sim({ seed: 'conquest', tribes: 2 });
      s.war.relations.set('0:1', -0.95);
      s.war.dawn();
      expect(s.war.atWar(0, 1)).toBe(true);
      const loser = s.tribes[1]!;
      const before = { ...loser.village.center };
      // Their fighters fall.
      for (const v of loser.members.filter((p) => p.lifeStage === 'adult').slice(1)) s.villagers.kill(v, 'battle');
      s.step();
      // Different gods, so the feeling decides.
      s.tribes[0]!.myth.godName = 'A';
      loser.myth.godName = 'B';
      s.war.relations.set('0:1', hate);
      // Stay at war (keep the feeling below peace) through the check.
      s.war.weariness.set('0:1', 0);
      s.war.dawn();
      const e = events(s, 'conquest').at(-1);
      expect(e).toMatchObject({ winner: 0, loser: 1 });
      if (e?.type !== 'conquest') continue;
      if (e.outcome === 'absorbed') expect(loser.members.length).toBe(0);
      else expect(Math.hypot(loser.village.center.x - before.x, loser.village.center.z - before.z)).toBeGreaterThan(10);
      expect(s.war.atWar(0, 1)).toBe(false);
    }
  });

  it('two peoples who hate the same third make an alliance, and join each other’s wars', () => {
    const s = new Sim({ seed: 'alliance', tribes: 3 });
    s.war.relations.set('0:1', 0.4);
    s.war.relations.set('0:2', -0.95);
    s.war.relations.set('1:2', -0.5);
    s.war.dawn();
    expect(s.war.allied(0, 1)).toBe(true);
    expect(events(s, 'alliance').at(-1)).toMatchObject({ a: 0, b: 1, against: 2 });
    expect(s.war.atWar(0, 2)).toBe(true);
    s.war.relations.set('0:2', -0.95);
    s.war.dawn();
    expect(s.war.atWar(1, 2)).toBe(true);
  });

  it('a people prays for victory; the god striking their enemy answers it', () => {
    const s = new Sim({ seed: 'prayer', tribes: 2 });
    s.war.relations.set('0:1', -0.95);
    s.war.dawn();
    s.war.prayers.set(0, { against: 1, until: s.tick + TICKS_PER_DAY * 3, answered: 'none' });
    const love = s.tribes[0]!.members.reduce((n, v) => n + v.faith.love, 0);
    // Strike the enemy's village.
    const c = s.tribes[1]!.village.center;
    s.enqueue({ type: 'cast', miracle: 'meteor', x: c.x, z: c.z });
    days(s, 1);
    const e = events(s, 'prayerAnswered').at(-1);
    expect(e).toMatchObject({ tribe: 0, against: 1, answered: true });
    expect(s.tribes[0]!.members.reduce((n, v) => n + v.faith.love, 0)).toBeGreaterThan(love);
  });
});
