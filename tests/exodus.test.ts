import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

const X = TUNING.exodus;
const events = (s: Sim, type: string) => s.events.since(0).filter((e) => e.type === type);

function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

function days(s: Sim, n: number): void {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) s.step();
}

describe('Exodus', () => {
  it.each(['exodus', 'omen'])('seed %s: a falling star on the village: the survivors leave, light a new fire elsewhere, and rebuild', (seed) => {
    const s = new Sim({ seed });
    morning(s);
    const old = { ...s.village.center };
    const oldHuts = s.village.huts.map((h) => h.id);
    s.enqueue({ type: 'cast', miracle: 'meteor', x: old.x, z: old.z });
    days(s, 2);
    const e = events(s, 'exodus').at(-1);
    expect(e).toBeDefined();
    const c = s.village.center;
    const moved = Math.hypot(c.x - old.x, c.z - old.z);
    expect(moved).toBeGreaterThanOrEqual(X.minMove - 2);
    expect(moved).toBeLessThanOrEqual(X.maxMove + 2);
    // The old homes are ruins now; a new fire burns at the new site.
    for (const id of oldHuts) expect(s.village.byId(id)?.abandoned).toBe(true);
    expect(s.village.structures.some((x) => x.kind === 'firePit' && !x.abandoned)).toBe(true);
    // A few days on, they're building homes there, and the living are gathered near it.
    days(s, 8);
    const huts = s.village.huts;
    // Homes going up (even where the new site was forest: they clear it first).
    expect(huts.length).toBeGreaterThan(0);
    for (const h of huts) expect(Math.hypot(h.x0 - c.x, h.z0 - c.z)).toBeLessThan(TUNING.building.maxRadius + 4);
    const near = s.villagers.alive.filter((v) => Math.hypot(v.x - c.x, v.z - c.z) < 30).length;
    expect(near).toBeGreaterThanOrEqual(s.villagers.alive.length * 0.7);
    // The Holy Book remembers the going-out.
    expect(s.myth.book.verses().some((v) => v.kind === 'exodus')).toBe(true);
  }, 120_000);

  it('they will not live on ground they believe cursed', () => {
    const s = new Sim({ seed: 'exodus' });
    const old = { ...s.village.center };
    s.village.forbidden = (x, z) => Math.hypot(x - old.x, z - old.z) < 12;
    expect(s.exodus.reason()).toBe('cursed');
    s.exodus.dawn();
    expect(events(s, 'exodus').at(-1)).toMatchObject({ reason: 'cursed' });
    expect(s.village.forbidden(s.village.center.x, s.village.center.z)).toBe(false);
  });

  it('ruin without the god in it is rebuilt where it stands', () => {
    const s = new Sim({ seed: 'exodus' });
    for (const h of s.village.huts) h.destroyed = true;
    expect(s.exodus.reason()).toBeNull();
  });

  it('a village left alone stays put', () => {
    const s = new Sim({ seed: 'exodus' });
    const old = { ...s.village.center };
    for (let i = 0; i < 3 * TICKS_PER_YEAR; i++) s.step();
    expect(events(s, 'exodus').length).toBe(0);
    expect(s.village.center.x).toBe(old.x);
  });
});
