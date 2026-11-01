import { describe, expect, it } from 'vitest';
import type { PrayerEnd, PrayerKind } from '../src/sim/prayers';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';

function days(s: Sim, n: number): void {
  for (let i = 0; i < TICKS_PER_DAY * n; i++) s.step();
}

function setup(tribes = 1): Sim {
  const s = new Sim({ seed: 'omen', tribes, mode: 'sandbox' });
  days(s, 6);
  s.miracles.unlimited = true;
  return s;
}

/** Raise a prayer by hand (the needs that raise them are tested on their own). */
function pray(s: Sim, kind: PrayerKind, extra: { for?: number; against?: number } = {}) {
  const t = s.tribes[0]!;
  const asker = t.members.find((v) => v.lifeStage === 'adult' && !s.prayers.byAsker(v.id))!;
  (s.prayers as unknown as { raise: (t: unknown, w: unknown) => void }).raise(t, { kind, asker: asker.id, for: extra.for ?? -1, against: extra.against ?? -1 });
  return { asker, p: s.prayers.open[s.prayers.open.length - 1]! };
}

/** Step until this prayer ends; how it ended. */
function until(s: Sim, id: number, maxDays = 6): PrayerEnd | null {
  let seq = s.events.lastSeq;
  for (let i = 0; i < TICKS_PER_DAY * maxDays; i++) {
    s.step();
    for (const e of s.events.since(seq)) if (e.type === 'prayerEnd' && e.id === id) return e.end;
    seq = s.events.lastSeq;
  }
  return null;
}

describe('Prayers', () => {
  it('the kin of the sick pray for healing; Bless heals them and answers it', () => {
    const s = setup();
    const t = s.tribes[0]!;
    const sick = t.members.find((v) => v.partnerId >= 0 && s.villagers.byId(v.partnerId)?.alive)!;
    expect(sick).toBeDefined();
    s.plague.infect(sick, -1);
    s.plague.immune.add(sick.partnerId);
    let prayer = null;
    for (let d = 0; d < 12 && !prayer; d++) {
      days(s, 1);
      prayer = s.prayers.open.find((p) => p.kind === 'heal' && p.for === sick.id) ?? null;
      if (!s.plague.isSick(sick)) s.plague.infect(sick, -1);
    }
    expect(prayer).not.toBeNull();
    const asker = s.villagers.byId(prayer!.asker)!;
    expect(asker.id).not.toBe(sick.id);
    const love = asker.faith.love;
    // Bless touches only the waking.
    while (sick.action?.kind === 'sleep' && sick.action.phase === 'work') s.step();
    expect(s.plague.isSick(sick)).toBe(true);
    s.enqueue({ type: 'bless', villagerId: sick.id });
    expect(until(s, prayer!.id, 1)).toBe('answered');
    expect(s.plague.isSick(sick)).toBe(false);
    expect(asker.faith.love).toBeGreaterThan(love);
  });

  it('Rain over the village answers a prayer for rain', () => {
    const s = setup();
    const { p } = pray(s, 'rain');
    const c = s.tribes[0]!.village.center;
    s.enqueue({ type: 'cast', miracle: 'rain', x: c.x, z: c.z });
    expect(until(s, p.id, 1)).toBe('answered');
  });

  it('a prayer left unanswered closes when its days run out, and the one who asked loves the god less', () => {
    const s = setup();
    const { asker, p } = pray(s, 'guidance');
    asker.faith.love = 0.6;
    asker.faith.fear = 0;
    const end = until(s, p.id, TUNING.prayers.days.guidance + 1);
    expect(end).toBe('unheard');
    expect(asker.faith.love).toBeLessThan(0.6);
  });

  it('harm to their people while they pray is taken as the answer', () => {
    const s = setup();
    const { asker, p } = pray(s, 'mercy');
    const fear = asker.faith.fear;
    const c = s.tribes[0]!.village.center;
    s.enqueue({ type: 'cast', miracle: 'plague', x: c.x, z: c.z });
    expect(until(s, p.id, 1)).toBe('defied');
    expect(asker.faith.fear).toBeGreaterThan(fear);
  });

  it('vengeance: harm the enemy and the prayer is answered', () => {
    const s = setup(3);
    const { p } = pray(s, 'vengeance', { against: 1 });
    const c = s.tribes[1]!.village.center;
    s.enqueue({ type: 'cast', miracle: 'plague', x: c.x, z: c.z });
    expect(until(s, p.id, 1)).toBe('answered');
  });

  it('in an ordinary game people pray on their own, and the prayers end', () => {
    const s = new Sim({ seed: 'omen', tribes: 3, mode: 'sandbox' });
    const raised = new Set<number>();
    const ended = new Set<number>();
    let seq = s.events.lastSeq;
    for (let i = 0; i < TICKS_PER_DAY * 36; i++) {
      s.step();
      for (const e of s.events.since(seq)) {
        if (e.type === 'prayer') raised.add(e.id);
        if (e.type === 'prayerEnd') ended.add(e.id);
      }
      seq = s.events.lastSeq;
      expect(s.prayers.open.length).toBeLessThanOrEqual(TUNING.prayers.maxOpen);
    }
    expect(raised.size).toBeGreaterThan(3);
    expect(ended.size).toBeGreaterThan(0);
  }, 120_000);
});
