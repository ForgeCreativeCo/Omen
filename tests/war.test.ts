import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

const W = TUNING.war;
const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

function days(s: Sim, n: number): void {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) s.step();
}

describe('War', () => {
  it('bitter enough, two peoples go to war; a war party marches, fights at the enemy fire, and comes home', () => {
    const s = new Sim({ seed: 'war', tribes: 2 });
    s.war.relations.set('0:1', -0.95);
    s.war.dawn();
    expect(s.war.atWar(0, 1)).toBe(true);
    expect(events(s, 'war').at(-1)).toMatchObject({ a: 0, b: 1 });
    // Sooner or later one side sends a party.
    for (let d = 0; d < 60 && !events(s, 'raid').length; d++) {
      s.war.relations.set('0:1', -0.95);
      days(s, 1);
    }
    const raid = events(s, 'raid').at(-1);
    expect(raid).toBeDefined();
    if (raid?.type !== 'raid') return;
    for (const id of raid.ids) expect(s.villagers.byId(id)!.tribeId).toBe(raid.from);
    // It reaches the enemy fire, fights, and ends.
    for (let d = 0; d < 10 && !events(s, 'raidEnd').length; d++) days(s, 1);
    expect(events(s, 'battle').length).toBeGreaterThan(0);
    const end = events(s, 'raidEnd').at(-1);
    expect(end).toMatchObject({ from: raid.from, to: raid.to });
    expect(s.war.raids.length).toBe(0);
    for (const id of raid.ids) {
      const v = s.villagers.byId(id)!;
      if (v.alive) expect(s.war.engaged(v)).toBe(false);
    }
  }, 120_000);

  it('the dead weary a war into peace', () => {
    const s = new Sim({ seed: 'war', tribes: 2 });
    s.war.relations.set('0:1', -0.95);
    s.war.dawn();
    s.war.weariness.set('0:1', W.peaceWeariness);
    s.war.dawn();
    expect(s.war.atWar(0, 1)).toBe(false);
    expect(events(s, 'peace').at(-1)).toMatchObject({ a: 0, b: 1 });
    expect(s.war.relation(0, 1)).toBeGreaterThanOrEqual(W.afterPeace);
  });

  it('a people born of a schism starts out bitter toward the one it left', () => {
    const s = new Sim({ seed: 'war', tribes: 1 });
    const people = s.tribes[0]!.members.filter((v) => v.lifeStage === 'adult').slice(0, 6);
    const c = s.village.center;
    const spot = s.village.nearestWalkable(c.x + 50, c.z) ?? { x: c.x + 50, z: c.z };
    s.foundTribe(people, { x: spot.x, y: s.nav.at(spot.x, spot.z), z: spot.z }, { reason: 'schism', leaderId: people[0]!.id });
    s.step();
    expect(s.war.relation(0, 1)).toBeCloseTo(W.schismStart, 5);
  });

  it('the last of a dying people are taken in by a neighbor', () => {
    const s = new Sim({ seed: 'war', tribes: 3 });
    const dying = s.tribes[2]!;
    for (const v of dying.members.slice(2)) s.villagers.kill(v, 'oldAge');
    s.step();
    const left = dying.members.map((v) => v.id);
    expect(left.length).toBeLessThanOrEqual(W.absorbAtOrBelow);
    s.war.dawn();
    const e = events(s, 'absorbed').at(-1);
    expect(e).toMatchObject({ from: 2 });
    for (const id of left) expect(s.villagers.byId(id)!.tribeId).not.toBe(2);
  });

  it('one people alone is at war with no one', () => {
    const s = new Sim({ seed: 'war' });
    days(s, 30);
    expect(s.war.relations.size).toBe(0);
    expect(events(s, 'war').length).toBe(0);
  });
});
