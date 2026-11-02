import { describe, expect, it } from 'vitest';
import { Sim, type GameMode } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

function days(s: Sim, n: number): void {
  for (let i = 0; i < TICKS_PER_DAY * n; i++) s.step();
}

function sim(mode: GameMode = 'sandbox', tribes = 1): Sim {
  const s = new Sim({ seed: 'omen', tribes, mode });
  days(s, 5);
  s.miracles.unlimited = true;
  return s;
}

function wipeOut(s: Sim): void {
  for (const v of [...s.villagers.alive]) s.villagers.kill(v, 'oldAge');
}

/** Walkable ground about `d` from the first people's fire. */
function groundAt(s: Sim, d: number): { x: number; z: number } {
  const t = s.tribes[0]!;
  const c = t.village.center;
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    const p = t.village.nearestWalkable(Math.round(c.x + Math.cos(a) * d), Math.round(c.z + Math.sin(a) * d));
    if (p && s.nav.regions()[p.x + p.z * s.world.sizeX] === t.village.centerRegion && !s.structureAt(p.x, p.z)) return p;
  }
  throw new Error('no ground');
}

const create = (s: Sim, p: { x: number; z: number }) => {
  s.enqueue({ type: 'cast', miracle: 'create', x: p.x, z: p.z });
  s.step();
};

describe('Castaways', { timeout: 120_000 }, () => {
  it('come ashore and go to live with the people there', () => {
    const s = sim();
    const before = s.tribes[0]!.members.length;
    const came = s.castaways.wreck();
    expect(came.length).toBeGreaterThanOrEqual(TUNING.castaways.partyMin);
    expect(came.some((v) => v.sex === 'f' && v.age < 30) && came.some((v) => v.sex === 'm' && v.age < 32)).toBe(true);
    expect(came.every((v) => v.tribeId === 0)).toBe(true);
    expect(s.tribes[0]!.members.length).toBe(before + came.length);
    expect(s.tribes).toHaveLength(1);
    const e = s.events.since(0).find((x) => x.type === 'castaways');
    expect(e).toMatchObject({ tribe: 0, founded: false });
  });

  it('on an empty island, make a people of their own', () => {
    const s = sim();
    wipeOut(s);
    const came = s.castaways.wreck();
    expect(came.length).toBeGreaterThanOrEqual(2);
    expect(s.tribes).toHaveLength(2);
    const t = s.tribes[1]!;
    expect(t.members.map((v) => v.id).sort()).toEqual(came.map((v) => v.id).sort());
    expect(t.village.store.food).toBeGreaterThan(0);
    // Strangers: no faith carried over from the dead, no name for the god.
    expect(t.belief.beliefs.size).toBe(0);
    expect(s.events.since(0).find((x) => x.type === 'tribeFounded')).toMatchObject({ reason: 'castaways', from: -1 });
    days(s, 10);
    expect(t.members.length).toBeGreaterThanOrEqual(2);
  });

  it('come soon to an island with no one left', () => {
    const s = sim();
    wipeOut(s);
    for (let d = 0; d < 60 && !s.villagers.alive.length; d++) days(s, 1);
    expect(s.villagers.alive.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Create', { timeout: 120_000 }, () => {
  it('raises a couple from the earth near a village, who join it and saw it done', () => {
    const s = sim();
    const before = s.tribes[0]!.members.length;
    create(s, groundAt(s, 8));
    expect(s.lastFailures).toEqual([]);
    const t = s.tribes[0]!;
    expect(t.members.length).toBe(before + 2);
    const e = s.events.since(0).find((x) => x.type === 'created');
    expect(e).toMatchObject({ tribe: 0, founded: false });
    const [a, b] = (e as { ids: number[] }).ids.map((id) => s.villagers.byId(id)!);
    expect(a!.partnerId).toBe(b!.id);
    expect(b!.partnerId).toBe(a!.id);
    expect(new Set([a!.sex, b!.sex])).toEqual(new Set(['f', 'm']));
    expect(a!.faith.love).toBeGreaterThan(0.5);
    days(s, 1);
    const omen = t.belief.omens.find((o) => o.kind === 'created');
    expect(omen).toBeDefined();
    expect(omen!.witnesses).toContain(a!.id);
  });

  it('far from any village, founds a new people', () => {
    const s = sim();
    create(s, groundAt(s, TUNING.miracles.create.joinRadius + 15));
    expect(s.lastFailures).toEqual([]);
    expect(s.tribes).toHaveLength(2);
    const t = s.tribes[1]!;
    expect(t.members).toHaveLength(2);
    expect(t.village.store.food).toBeGreaterThan(0);
    days(s, 2);
    // Their first omen is their own making.
    expect(t.belief.omens.some((o) => o.kind === 'created')).toBe(true);
  });

  it('begins again on an island with no one left', () => {
    const s = sim();
    wipeOut(s);
    const spot = groundAt(s, 5);
    create(s, spot);
    expect(s.lastFailures).toEqual([]);
    expect(s.villagers.alive).toHaveLength(2);
    expect(s.tribes[1]!.members).toHaveLength(2);
  });

  it('needs open ground', () => {
    const s = sim();
    const c = s.tribes[0]!.village.center;
    // The fire's own cell is taken.
    create(s, { x: c.x, z: c.z });
    expect(s.lastFailures).toEqual(['target']);
  });

  it('in the Warning, always joins the one people', () => {
    const s = sim('warning');
    create(s, groundAt(s, TUNING.miracles.create.joinRadius + 15));
    expect(s.lastFailures).toEqual([]);
    expect(s.tribes).toHaveLength(1);
    expect(s.events.since(0).find((x) => x.type === 'created')).toMatchObject({ tribe: 0, founded: false });
  });
});
