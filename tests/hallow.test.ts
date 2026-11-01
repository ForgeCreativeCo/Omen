import { describe, expect, it } from 'vitest';
import { Sim, type GameMode } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

const T = TUNING.branching;

function days(s: Sim, n: number): void {
  for (let i = 0; i < TICKS_PER_DAY * n; i++) s.step();
}

/** A sim a month in (the first people crowded), and walkable ground about `d` from its fire, clear of the other villages. */
function setup(d: number, mode: GameMode = 'sandbox', tribes = 3): { s: Sim; spot: { x: number; z: number } } {
  const s = new Sim({ seed: 'omen', tribes, mode });
  days(s, 30);
  s.miracles.unlimited = true;
  const t = s.tribes[0]!;
  const c = t.village.center;
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    const p = t.village.nearestWalkable(Math.round(c.x + Math.cos(a) * d), Math.round(c.z + Math.sin(a) * d));
    if (!p || s.nav.regions()[p.x + p.z * s.world.sizeX] !== t.village.centerRegion) continue;
    if (s.tribes.some((o) => o.id !== 0 && Math.hypot(o.village.center.x - p.x, o.village.center.z - p.z) < 30)) continue;
    return { s, spot: p };
  }
  throw new Error('no ground');
}

const hallow = (s: Sim, p: { x: number; z: number }) => {
  s.enqueue({ type: 'cast', miracle: 'hallow', x: p.x, z: p.z });
  s.step();
};

describe('Hallow', { timeout: 120_000 }, () => {
  it('glows for days; those who see it name the place and hold it holy', () => {
    const { s, spot } = setup(45);
    hallow(s, spot);
    expect(s.lastFailures).toEqual([]);
    expect(s.miracles.hallows).toHaveLength(1);
    days(s, 1);
    const t = s.tribes[0]!;
    const key = t.myth.places.siteAt(spot.x, spot.z)?.key;
    expect(key).toBeDefined();
    expect(t.myth.places.name(key!)).toMatch(/^the /);
    const b = t.belief.beliefs.get(t.belief.key('SACRED_PLACE', key!, 'favor'));
    expect(b).toBeDefined();
    expect(b!.holders.size).toBeGreaterThan(3);
    expect(b!.area).toMatchObject({ x: spot.x, z: spot.z });
    // It fades after its days.
    days(s, TUNING.miracles.hallow.durationDays + 1);
    expect(s.miracles.hallows).toHaveLength(0);
  });

  it('far from a crowded village, believers leave and found a daughter people there', () => {
    const { s, spot } = setup(45);
    const home = s.tribes[0]!;
    const before = home.members.length;
    expect(before).toBeGreaterThanOrEqual(T.crowdedAt);
    hallow(s, spot);
    let calling = 0;
    let founded: { id: number; reason: string; from: number; x: number; z: number } | null = null;
    let seq = s.events.lastSeq;
    for (let i = 0; i < TICKS_PER_DAY * 12 && !founded; i++) {
      s.step();
      for (const e of s.events.since(seq)) {
        if (e.type === 'calling' && e.tribe === 0) calling = e.ids.length;
        if (e.type === 'tribeFounded' && e.reason === 'hallowed') founded = e;
      }
      seq = s.events.lastSeq;
    }
    expect(calling).toBeGreaterThanOrEqual(3);
    expect(founded).not.toBeNull();
    expect(founded!.from).toBe(0);
    // They settled at the hallowed ground, kin on good terms, keeping its name and the faith in it.
    expect(Math.hypot(founded!.x - spot.x, founded!.z - spot.z)).toBeLessThan(16);
    const kin = s.tribes[founded!.id]!;
    expect(kin.members.length).toBeGreaterThanOrEqual(3);
    expect(home.members.length).toBeLessThan(before);
    expect(s.war.relation(0, kin.id)).toBeGreaterThan(0.3);
    const key = home.myth.places.siteAt(spot.x, spot.z)!.key;
    expect(kin.myth.places.name(key)).toBe(home.myth.places.name(key));
    expect(kin.belief.beliefs.has(kin.belief.key('SACRED_PLACE', key, 'favor'))).toBe(true);
    expect(kin.myth.godName).toBe(home.myth.godName);
  });

  it('ground close to home is a holy place nearby, not a reason to leave', () => {
    const { s, spot } = setup(T.minDistance - 10);
    hallow(s, spot);
    days(s, 10);
    expect(s.events.all().some((e) => e.type === 'calling')).toBe(false);
    expect(s.tribes.some((t) => t.members.length && Math.hypot(t.village.center.x - spot.x, t.village.center.z - spot.z) < 5)).toBe(false);
  });

  it('nobody leaves in the Warning', () => {
    const w = setup(45, 'warning', 1);
    hallow(w.s, w.spot);
    days(w.s, 10);
    expect(w.s.events.all().some((e) => e.type === 'calling')).toBe(false);
  });

  it('nobody leaves once the island holds its most peoples', () => {
    const full = setup(45);
    const max = T.maxPeoples;
    (T as { maxPeoples: number }).maxPeoples = full.s.tribes.filter((t) => t.members.length).length;
    try {
      hallow(full.s, full.spot);
      days(full.s, 10);
      expect(full.s.events.all().some((e) => e.type === 'calling')).toBe(false);
    } finally {
      (T as { maxPeoples: number }).maxPeoples = max;
    }
  });
});
