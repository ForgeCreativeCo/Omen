import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { FixedLoop } from '../src/loop';
import { calendarAt, formatCalendar, TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

describe('calendar', () => {
  it('starts at dawn, spring, year 1', () => {
    const c = calendarAt(0);
    expect(c.timeOfDay).toBe('dawn');
    expect(c.season).toBe('spring');
    expect(formatCalendar(c)).toBe('Year 1 · Spring');
  });

  it('a year is 4 seasons × 3 days ≈ 8 min at 1× (half the base rate)', () => {
    expect(TICKS_PER_YEAR / TUNING.time.ticksPerSecond).toBe(240);
    expect(TICKS_PER_YEAR / (TUNING.time.ticksPerSecond * TUNING.time.speeds[1]!)).toBe(480);
    expect(calendarAt(TICKS_PER_YEAR).year).toBe(2);
    expect(calendarAt(TICKS_PER_DAY * 3).season).toBe('summer');
  });
});

describe('FixedLoop', () => {
  it('runs ticksPerSecond × speed ticks per real second', () => {
    const sim = new Sim({ seed: 1 });
    const loop = new FixedLoop(sim);
    loop.setSpeedIndex(2); // 4×
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(sim.tick).toBeGreaterThanOrEqual(39);
    expect(sim.tick).toBeLessThanOrEqual(40);
  });

  it('does not advance while paused', () => {
    const sim = new Sim({ seed: 1 });
    const loop = new FixedLoop(sim);
    loop.togglePause();
    loop.advance(1);
    expect(sim.tick).toBe(0);
    loop.togglePause();
    // Back to 1×: half the base rate.
    expect(loop.speed).toBe(0.5);
  });
});
