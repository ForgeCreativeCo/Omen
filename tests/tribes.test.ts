import { describe, expect, it } from 'vitest';
import { restoreGame, saveGame } from '../src/sim/save';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

const X = TUNING.exodus;

function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

describe('Tribes', () => {
  it('several peoples settle far apart, each with its own village, priest and families', () => {
    const s = new Sim({ seed: 'tribes', tribes: 3 });
    expect(s.tribes.length).toBe(3);
    const centers = s.tribes.map((t) => t.village.center);
    for (let i = 0; i < centers.length; i++)
      for (let j = i + 1; j < centers.length; j++) expect(Math.hypot(centers[i]!.x - centers[j]!.x, centers[i]!.z - centers[j]!.z)).toBeGreaterThanOrEqual(X.apart);
    for (const t of s.tribes) {
      expect(t.members.length).toBeGreaterThan(5);
      expect(t.village.huts.length).toBeGreaterThan(0);
      expect(t.members.some((v) => v.role === 'priest')).toBe(true);
      expect(t.belief.priestId).toBeGreaterThanOrEqual(0);
      expect(t.members.map((v) => v.id)).toContain(t.belief.priestId);
      expect(new Set(t.name.split(' ')).size).toBeGreaterThan(0);
    }
    // Two years on: each people lives at home, children are of their mother's people.
    for (let i = 0; i < 2 * TICKS_PER_YEAR; i++) s.step();
    for (const t of s.tribes) {
      expect(t.members.length).toBeGreaterThan(3);
      for (const v of t.members) {
        if (v.homeId >= 0) expect(t.village.byId(v.homeId)).toBeDefined();
        const mother = s.villagers.byId(v.parentIds[0] ?? -1);
        if (mother) expect(v.tribeId).toBe(mother.tribeId);
        if (v.partnerId >= 0) expect(s.villagers.byId(v.partnerId)!.tribeId).toBe(t.id);
      }
    }
  }, 120_000);

  it('each people reads an omen from its own witnesses', () => {
    const s = new Sim({ seed: 'tribes', tribes: 3 });
    morning(s);
    const t = s.tribes[1]!;
    const c = t.village.center;
    s.enqueue({ type: 'cast', miracle: 'light', x: c.x + 2, z: c.z });
    for (let i = 0; i < 3; i++) s.step();
    const theirs = t.belief.omens.filter((o) => o.kind === 'light').at(-1)!;
    expect(theirs).toBeDefined();
    expect(theirs.witnesses.length).toBeGreaterThan(0);
    for (const id of theirs.witnesses) expect(s.villagers.byId(id)!.tribeId).toBe(1);
    // Every people's copy holds only its own witnesses (a pillar of light is seen from far off).
    for (const other of s.tribes) {
      const copy = other.belief.omens.find((o) => o.id === theirs.id);
      for (const id of copy?.witnesses ?? []) expect(s.villagers.byId(id)!.tribeId).toBe(other.id);
    }
  });

  it('two runs of a three-people island are the same', () => {
    const run = () => {
      const s = new Sim({ seed: 'twins', tribes: 3 });
      for (let i = 0; i < TICKS_PER_YEAR; i++) s.step();
      return s.tribes.map((t) => [t.name, t.members.length, Math.round(t.village.store.food), t.belief.beliefs.size]);
    };
    expect(run()).toEqual(run());
  }, 120_000);

  it('a people founded mid-game survives a save and load', () => {
    const s = new Sim({ seed: 'tribes', tribes: 2 });
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) s.step();
    const leaving = s.tribes[0]!.members.filter((v) => v.lifeStage === 'adult').slice(0, 5);
    const site = { ...s.tribes[0]!.village.center };
    site.x += 50;
    const spot = s.tribes[0]!.village.nearestWalkable(site.x, site.z) ?? site;
    const t = s.foundTribe(leaving, { x: spot.x, y: s.nav.at(spot.x, spot.z), z: spot.z }, { reason: 'schism', leaderId: leaving[0]!.id });
    for (let i = 0; i < TICKS_PER_DAY; i++) s.step();
    const text = saveGame(s, { seed: 'tribes', mode: 'sandbox', tribes: 2, label: 'x' });
    const r = new Sim({ seed: 'tribes', tribes: 2 });
    restoreGame(r, text);
    expect(r.tribes.length).toBe(3);
    const rt = r.tribes[t.id]!;
    expect(rt.members.map((v) => v.id).sort()).toEqual(t.members.map((v) => v.id).sort());
    // Its view of the world is live again: it sees its own village and people.
    expect(rt.view.village).toBe(rt.village);
    expect(rt.view.villagers.alive.every((v) => v.tribeId === t.id)).toBe(true);
    for (let i = 0; i < TICKS_PER_DAY; i++) r.step();
    expect(rt.members.length).toBeGreaterThan(0);
  }, 120_000);
});
