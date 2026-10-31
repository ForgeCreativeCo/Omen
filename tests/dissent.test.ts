import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';

const D = TUNING.dissent;

function sim(seed = 'dissent'): Sim {
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

/** An adult who is outdoors and awake. */
function someoneOut(s: Sim): Villager {
  const v = s.villagers.alive.find((p) => p.lifeStage === 'adult' && !p.inside && p.action?.kind !== 'sleep' && p.id !== s.belief.priestId);
  if (!v) throw new Error('nobody about');
  return v;
}

const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

describe('Turning away', () => {
  it('a neglected village notices the silence, then someone speaks in the god’s place', () => {
    const s = sim('b');
    for (let i = 0; i < (D.leaderAfterDays + 1) * TICKS_PER_DAY; i++) s.step();
    expect(events(s, 'silence').length).toBe(1);
    expect(s.dissent.leader).not.toBeNull();
    expect(events(s, 'dissent').length).toBe(1);
  });

  it('a wonder seen keeps the silence away', () => {
    const s = sim('b');
    for (let day = 0; day < D.leaderAfterDays + 2; day++) {
      if (day % 8 === 0) {
        morning(s);
        const v = someoneOut(s);
        cast(s, { type: 'cast', miracle: 'light', x: Math.round(v.x) + 1, z: Math.round(v.z) });
      }
      for (let i = 0; i < TICKS_PER_DAY; i++) s.step();
    }
    expect(s.dissent.leader).toBeNull();
  });

  it('a doubter who sees a wonder is converted', () => {
    const s = sim();
    morning(s);
    const v = someoneOut(s);
    s.dissent.raise({ v, kind: 'doubter' });
    const love = v.faith.love;
    cast(s, { type: 'cast', miracle: 'light', x: Math.round(v.x) + 1, z: Math.round(v.z) });
    for (let i = 0; i < 5; i++) s.step();
    expect(s.dissent.leader).toBeNull();
    expect(events(s, 'dissentEnd').at(-1)).toMatchObject({ id: v.id, reason: 'converted' });
    expect(v.faith.love).toBeGreaterThan(love);
  });

  it('a prophet claims ordinary wonders, but lightning near them discredits them', () => {
    const s = sim();
    morning(s);
    const v = someoneOut(s);
    s.dissent.raise({ v, kind: 'prophet' });
    cast(s, { type: 'cast', miracle: 'light', x: Math.round(v.x) + 1, z: Math.round(v.z) });
    for (let i = 0; i < 5; i++) s.step();
    expect(s.dissent.leader?.id).toBe(v.id);
    expect(events(s, 'prophetClaims').length).toBe(1);
    s.miracles.readyAt.lightning = 0;
    cast(s, { type: 'cast', miracle: 'lightning', x: Math.round(v.x) + 3, z: Math.round(v.z) });
    for (let i = 0; i < 5; i++) s.step();
    expect(s.dissent.leader).toBeNull();
    expect(events(s, 'dissentEnd').at(-1)).toMatchObject({ id: v.id, reason: 'discredited' });
  });

  it('a dream makes the leader recant', () => {
    const s = sim();
    const v = s.villagers.alive.find((p) => p.lifeStage === 'adult')!;
    s.dissent.raise({ v, kind: 'prophet' });
    s.events.push(s.tick, { type: 'dream', villagerId: v.id, symbols: [] });
    s.step();
    expect(events(s, 'dissentEnd').at(-1)).toMatchObject({ id: v.id, reason: 'recanted' });
  });

  it('doubters skip rites, give no Grace, and get more done', () => {
    const s = sim();
    const v = s.villagers.alive.find((p) => p.lifeStage === 'adult')!;
    v.faith.love = 0.8;
    const withFaith = s.miracles.regenPerDay;
    s.dissent.raise({ v, kind: 'doubter' });
    expect(s.dissent.isDoubter(v)).toBe(true);
    expect(s.dissent.yieldFor(v)).toBe(D.doubterYield);
    expect(s.miracles.regenPerDay).toBeLessThan(withFaith);
    expect(s.dissent.graceShare(v)).toBe(0);
  });

  it('a prophet’s followers take on the prophet’s law', () => {
    const s = sim();
    const v = s.villagers.alive.find((p) => p.lifeStage === 'adult')!;
    s.dissent.raise({ v, kind: 'prophet' });
    const rule = s.dissent.leader!.rule!;
    for (const p of s.villagers.alive) if (p.id !== v.id) s.dissent.pull.set(p.id, 0.9);
    for (let n = 0; n < 6; n++) s.dissent.dusk(s.villagers.alive);
    const taboo = [...s.belief.beliefs.values()].find((b) => b.type === 'TABOO_ACT' && b.subject === rule);
    expect(taboo?.strength ?? 0).toBeGreaterThan(0.2);
  });

  it('with a faithful side, a large following splits the village; a small one is driven out', () => {
    for (const big of [true, false]) {
      const s = sim('split');
      // Big enough to split (small villages hold together).
      const c = s.village.center;
      while (s.villagers.alive.length < D.schismMinPopulation + 2) s.villagers.spawn({ age: 25, x: c.x, z: c.z });
      const adults = s.villagers.alive.filter((p) => p.lifeStage !== 'child');
      const leader = adults[0]!;
      s.dissent.raise({ v: leader, kind: 'doubter' });
      s.dissent.leader!.since = -TICKS_PER_YEAR;
      const nFollow = big ? Math.ceil(adults.length * 0.45) : Math.ceil(adults.length * D.schismShare);
      adults.forEach((p, i) => {
        if (i === 0) return;
        if (i < nFollow) s.dissent.pull.set(p.id, 0.9);
        else p.faith.love = 0.6;
      });
      // Big: too few loyal to drive the leader out. Small: loyal outnumber them.
      if (big) adults.slice(nFollow + Math.max(D.schismMinLoyal, Math.ceil(adults.length * D.schismMinLoyalShare))).forEach((p) => (p.faith.love = 0));
      const before = s.villagers.alive.length;
      s.dissent.dawn();
      const e = events(s, 'schism').at(-1);
      expect(e, big ? 'split' : 'driven out').toMatchObject({ leaderId: leader.id, outcome: big ? 'split' : 'drivenOut' });
      for (let i = 0; i < TICKS_PER_DAY * 2; i++) s.step();
      if (big) {
        // The followers become a people of their own, settled elsewhere on the island.
        expect(s.tribes.length).toBe(2);
        const t = s.tribes[1]!;
        expect(events(s, 'tribeFounded').at(-1)).toMatchObject({ id: 1, from: 0, reason: 'schism', leaderId: leader.id });
        expect(leader.tribeId).toBe(1);
        expect(t.members.length).toBeGreaterThanOrEqual(Math.min(nFollow, Math.floor(before * D.maxLeaving)));
        // Nobody left the island.
        expect(events(s, 'exiled').some((x) => x.type === 'exiled' && x.left)).toBe(false);
        const c = t.village.center;
        expect(Math.hypot(c.x - s.village.center.x, c.z - s.village.center.z)).toBeGreaterThanOrEqual(TUNING.exodus.splitMin - 2);
      } else expect(leader.alive).toBe(false);
      expect(s.dissent.leader).toBeNull();
    }
  });
});
