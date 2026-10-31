import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

const A = TUNING.appease;

function cast(s: Sim, cmd: Command): void {
  s.enqueue(cmd);
  s.step();
}

function morning(s: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = s.calendar.dayFraction;
    if (f >= 0.35 && f < 0.45) return;
    s.step();
  }
}

const days = (s: Sim, n: number) => {
  for (let i = 0; i < TICKS_PER_DAY * n; i++) s.step();
};
const eventsOf = (s: Sim, type: string) => s.events.all().filter((e) => e.type === type);

describe('A cruel god', () => {
  it('a disaster fills them with dread and they burn a great offering', () => {
    const s = new Sim({ seed: 'appease' });
    morning(s);
    const c = s.village.center;
    cast(s, { type: 'cast', miracle: 'meteor', x: c.x + 2, z: c.z + 2 });
    days(s, 1);
    expect(s.appease.dread).toBeGreaterThan(0);
    expect(eventsOf(s, 'disaster').length).toBeGreaterThan(0);
    expect(eventsOf(s, 'greatOffering').length).toBeGreaterThan(0);
  });

  it('deep enough dread ends in a sacrifice at the fire, and dread eases after', () => {
    const s = new Sim({ seed: 'sacrifice' });
    days(s, 1);
    s.appease.dread = 1;
    days(s, 2);
    const sac = eventsOf(s, 'sacrifice');
    expect(sac.length).toBe(1);
    const e = sac[0]!;
    if (e.type !== 'sacrifice') throw new Error();
    expect(s.villagers.byId(e.id)?.deathCause).toBe('sacrificed');
    expect(s.appease.dread).toBeLessThan(A.sacrificeAt);
  });

  it('kin of those the god kills may defy it; struck down, the rest are cowed', () => {
    const s = new Sim({ seed: 'defy' });
    morning(s);
    // Kill someone with a family, again and again, until a relative defies.
    for (let tries = 0; tries < 12 && !s.appease.defiers.length; tries++) {
      const victim = s.villagers.alive.find((v) => !v.inside && v.lifeStage === 'adult' && (v.partnerId >= 0 || v.childIds.length));
      if (!victim) break;
      s.miracles.readyAt.lightning = 0;
      s.strikeLightning(Math.floor(victim.x), Math.floor(victim.z), true);
      s.step();
      s.step();
    }
    expect(s.appease.defiers.length).toBeGreaterThan(0);
    const d = s.villagers.byId(s.appease.defiers[0]!.id)!;
    expect(d.faith.fear).toBe(0);
    // Strike the defier.
    for (let i = 0; i < 6 && d.alive; i++) {
      s.strikeLightning(Math.floor(d.x), Math.floor(d.z), true);
      s.step();
      s.step();
    }
    expect(eventsOf(s, 'defianceEnd').length).toBeGreaterThan(0);
  });

  it("other peoples read one people's disaster as a warning", () => {
    const s = new Sim({ seed: 'rivals', tribes: 3 });
    morning(s);
    const t = s.tribes[1]!;
    const c = t.village.center;
    const before = s.war.relation(0, 1);
    cast(s, { type: 'cast', miracle: 'meteor', x: c.x, z: c.z });
    days(s, 1);
    const scorn = eventsOf(s, 'rivalry').filter((e) => e.type === 'rivalry' && e.kind === 'scorn' && e.other === 1);
    expect(scorn.length).toBeGreaterThan(0);
    expect(s.war.relation(0, 1)).toBeLessThan(before + 0.01);
  });
});
