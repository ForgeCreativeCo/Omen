import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';

const J = TUNING.justice;
const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

function sim(): Sim {
  const s = new Sim({ seed: 'justice' });
  s.miracles.grace = 500;
  return s;
}

function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

/** A thief and a victim household (adults, not related). */
function pair(s: Sim, n = 0): [Villager, Villager] {
  const adults = s.villagers.alive.filter((v) => v.lifeStage === 'adult' && v.id !== s.belief.priestId && !s.belief.chosenIds().has(v.id));
  const thief = adults[n]!;
  const victim = adults.find((v) => v.homeId !== thief.homeId && !s.villagers.related(v, thief) && v.id !== thief.id)!;
  return [thief, victim];
}

function steal(s: Sim, thief: Villager, victim: Villager, known = true): void {
  s.events.push(s.tick, { type: 'theft', id: thief.id, hutId: victim.homeId, victims: [victim.id], x: 0, z: 0, known });
  s.step();
}

function days(s: Sim, n: number): void {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) s.step();
}

describe('Justice', () => {
  it('a known theft is judged at the fire after a day and a night', () => {
    const s = sim();
    const [thief, victim] = pair(s);
    steal(s, thief, victim);
    expect(s.justice.pending(thief)).toBeDefined();
    expect(events(s, 'accused').at(-1)).toMatchObject({ accused: thief.id, crime: 'theft' });
    days(s, J.windowDays + 1);
    expect(s.justice.pending(thief)).toBeUndefined();
    expect(events(s, 'verdict').at(-1)).toMatchObject({ accused: thief.id, by: 'village' });
  });

  it('a blessing on the accused is a pardon', () => {
    const s = sim();
    const [thief, victim] = pair(s);
    steal(s, thief, victim);
    s.events.push(s.tick, { type: 'blessing', villagerId: thief.id, x: 0, z: 0 });
    s.step();
    expect(events(s, 'verdict').at(-1)).toMatchObject({ accused: thief.id, by: 'godPardoned', sentence: 'forgiven' });
  });

  it('lightning beside the accused is the god’s own sentence', () => {
    const s = sim();
    morning(s);
    const [thief, victim] = pair(s);
    steal(s, thief, victim);
    const cmd: Command = { type: 'cast', miracle: 'lightning', x: Math.round(thief.x) + 3, z: Math.round(thief.z) };
    s.enqueue(cmd);
    for (let i = 0; i < 5; i++) s.step();
    expect(events(s, 'verdict').at(-1)).toMatchObject({ accused: thief.id, by: 'godPunished' });
  });

  it('nobody saw: the wronged accuse someone they already resent, guilty or not', () => {
    const s = sim();
    const [thief, victim] = pair(s);
    const [scapegoat] = pair(s, 1);
    s.society.shift(victim, scapegoat, -0.7);
    for (let n = 0; n < 60 && !events(s, 'accused').length; n++) steal(s, thief, victim, false);
    const e = events(s, 'accused').at(-1);
    expect(e).toMatchObject({ accused: scapegoat.id, actual: thief.id });
  });

  it('a killer is at least sent away', () => {
    const s = sim();
    const [killer, victim] = pair(s);
    s.society.kill(killer, victim, true);
    s.step();
    expect(s.justice.pending(killer)?.crime).toBe('murder');
    days(s, J.windowDays + 1);
    const v = events(s, 'verdict').at(-1);
    expect(v).toMatchObject({ accused: killer.id, crime: 'murder' });
    expect(['exiled', 'executed']).toContain(v?.type === 'verdict' ? v.sentence : '');
  });

  it('the same sentence, again and again, becomes written law in the Holy Book', () => {
    const s = sim();
    for (let n = 0; n < 8 && !events(s, 'law').length; n++) {
      const [thief, victim] = pair(s, n % 4);
      s.justice.convictions.clear();
      steal(s, thief, victim);
      days(s, J.windowDays + 1);
    }
    expect(events(s, 'law').length).toBe(1);
    expect(s.myth.book.verses().some((v) => v.kind === "law")).toBe(true);
  });
});
