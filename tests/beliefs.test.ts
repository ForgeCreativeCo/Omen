import { describe, expect, it } from 'vitest';
import type { PriestPersonality } from '../src/sim/belief/catalog';
import type { Command } from '../src/sim/miracles/Miracles';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';

const T = TUNING.belief;

// ------------------------------------------------------------------ scenario helpers

function setup(seed: string, personality?: PriestPersonality): Sim {
  const sim = new Sim({ seed });
  sim.miracles.grace = 10_000;
  if (personality) sim.belief.setPersonality(personality, false);
  return sim;
}

/** Step until mid-morning so everyone is up and about. */
function toDaytime(sim: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = sim.calendar.dayFraction;
    if (f > 0.35 && f < 0.45) return;
    sim.step();
  }
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

function cast(sim: Sim, cmd: Command): void {
  sim.enqueue(cmd);
  sim.step();
}

function well(sim: Sim) {
  const c = sim.village.center;
  return sim.village.structures.find((s) => s.kind === 'well') ?? sim.village.placePrefab(sim, 'well', c.x, c.z, true)!;
}

/** Put villagers at a spot (on walkable ground), standing still. */
function gatherAt(sim: Sim, people: Villager[], x: number, z: number): void {
  people.forEach((v, i) => {
    const cell = sim.village.nearestWalkable(x + (i % 5) - 2, z + Math.floor(i / 5) - 2) ?? { x, z };
    v.x = v.px = cell.x + 0.5;
    v.z = v.pz = cell.z + 0.5;
    v.y = v.py = sim.nav.at(cell.x, cell.z) + 1;
    v.inside = false;
  });
}

/** n adults dance by the well while everyone else watches from nearby. */
function danceAtWell(sim: Sim, n: number): { x: number; z: number } {
  const w = well(sim);
  const x = w.x0 + 1;
  const z = w.z0 + 1;
  const adults = sim.villagers.alive.filter((v) => v.lifeStage !== 'child');
  const dancers = adults.slice(0, n);
  gatherAt(sim, sim.villagers.alive, x, z);
  for (const v of dancers) {
    sim.villagers.startRitual(v, 'dance', Math.floor(v.x), Math.floor(v.z), null);
    v.action!.phase = 'work';
  }
  return { x, z };
}

function belief(sim: Sim, type: string, subject: string, response?: string) {
  return sim.belief.beliefs.get(sim.belief.key(type as never, subject, response));
}

function strengths(sim: Sim): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of sim.belief.beliefs.values()) out[b.id] = Math.round(b.strength * 1e4) / 1e4;
  return out;
}

// ------------------------------------------------------------------ SPEC M4 acceptance

describe('interpretation scenarios (SPEC M4)', () => {
  it('rain during a dance at the well, twice → RITUAL(dance→rain) ≥ 0.3, and they dance in the next drought', () => {
    const sim = setup('ritual', 'pragmatic');
    for (let i = 0; i < 2; i++) {
      toDaytime(sim);
      const p = danceAtWell(sim, 6);
      sim.miracles.readyAt.rain = 0;
      cast(sim, { type: 'cast', miracle: 'rain', x: p.x, z: p.z });
      run(sim, TICKS_PER_DAY / 2);
    }
    const b = belief(sim, 'RITUAL', 'activity:dance', 'rain');
    expect(b).toBeDefined();
    expect(b!.strength).toBeGreaterThanOrEqual(T.behaviorThreshold);
    expect(b!.place).toBe('place:well');

    // The next drought: dry fields, no rain coming. Someone goes to dance.
    toDaytime(sim);
    sim.weather.startDrought(sim);
    for (const f of sim.village.fields) (f.moisture = 0), (f.nearWater = false);
    let danced = 0;
    for (let i = 0; i < TICKS_PER_DAY / 2; i++) {
      sim.step();
      danced = Math.max(danced, sim.villagers.alive.filter((v) => v.action?.kind === 'ritual' && v.action.ritual === 'dance').length);
    }
    expect(danced).toBeGreaterThan(0);
  });

  it('lightning on a hut shortly after a theft → TABOO_ACT(theft) and/or OUTCAST(thief)', () => {
    const sim = setup('theft', 'fearful');
    toDaytime(sim);
    const huts = sim.village.huts.filter((h) => h.residents.length >= 2);
    const thiefHut = huts[0]!;
    const victimHut = huts[1]!;
    const thief = sim.villagers.byId(thiefHut.residents.find((id) => sim.villagers.byId(id)!.lifeStage !== 'child')!)!;
    sim.belief.deeds.add({
      key: 'deed:theft',
      actorId: thief.id,
      victimIds: [...victimHut.residents],
      x: victimHut.door.x,
      z: victimHut.door.z,
      tick: sim.tick,
    });
    run(sim, 20);
    // Everyone is around the village; the bolt hits the thief's roof.
    gatherAt(sim, sim.villagers.alive.filter((v) => v.id !== thief.id), sim.village.center.x, sim.village.center.z);
    sim.strikeLightning(thiefHut.x0 + 2, thiefHut.z0 + 2, true, thiefHut.x0 + 2, thiefHut.z0 + 2);
    sim.step();
    const taboo = belief(sim, 'TABOO_ACT', 'deed:theft', 'wrath');
    const outcast = belief(sim, 'OUTCAST', `person:${thief.id}`, 'wrath');
    expect((taboo?.strength ?? 0) + (outcast?.strength ?? 0)).toBeGreaterThan(0.1);
  });

  it('two lightning strikes on the east hill → CURSED_PLACE(eastHill); nobody farms or builds there', () => {
    const sim = setup('hill', 'fearful');
    const hill = sim.island.landmarks.eastHill;
    for (let i = 0; i < 2; i++) {
      toDaytime(sim);
      gatherAt(sim, sim.villagers.alive, sim.village.center.x, sim.village.center.z);
      sim.miracles.readyAt.lightning = 0;
      cast(sim, { type: 'cast', miracle: 'lightning', x: hill.x, z: hill.z });
      run(sim, TICKS_PER_DAY / 3);
    }
    const b = belief(sim, 'CURSED_PLACE', 'place:eastHill', 'wrath');
    expect(b).toBeDefined();
    expect(b!.strength).toBeGreaterThanOrEqual(T.behaviorThreshold);

    // After the next dawn the curse is in effect.
    run(sim, TICKS_PER_DAY);
    expect(sim.effects.isCursed(hill.x, hill.z)).toBe(true);
    const before = new Set(sim.village.structures.map((s) => s.id));
    // A field or hut that happened to be there is abandoned; nothing new goes there.
    for (let i = 0; i < TICKS_PER_DAY * 4; i++) {
      sim.step();
      for (const v of sim.villagers.alive) {
        const a = v.action;
        if (a?.kind === 'farm' || a?.kind === 'build') expect(sim.effects.isCursed(a.tx, a.tz)).toBe(false);
      }
    }
    for (const s of sim.village.structures) {
      if (before.has(s.id)) continue;
      expect(sim.effects.isCursed(s.x0 + s.w / 2, s.z0 + s.d / 2)).toBe(false);
    }
  });

  it('the same omens read by a Fearful and a Pragmatic priest give different beliefs', () => {
    const play = (p: PriestPersonality) => {
      const sim = setup('priests', p);
      const hill = sim.island.landmarks.eastHill;
      toDaytime(sim);
      const at = danceAtWell(sim, 5);
      cast(sim, { type: 'cast', miracle: 'rain', x: at.x, z: at.z });
      run(sim, TICKS_PER_DAY / 2);
      toDaytime(sim);
      gatherAt(sim, sim.villagers.alive, sim.village.center.x, sim.village.center.z);
      cast(sim, { type: 'cast', miracle: 'lightning', x: hill.x, z: hill.z });
      run(sim, TICKS_PER_DAY);
      return sim;
    };
    const fearful = play('fearful');
    const pragmatic = play('pragmatic');
    const curse = (s: Sim) => belief(s, 'CURSED_PLACE', 'place:eastHill', 'wrath')?.strength ?? 0;
    const ritual = (s: Sim) => belief(s, 'RITUAL', 'activity:dance', 'rain')?.strength ?? 0;
    // Fearful priests make more of harm; pragmatic ones more of rituals.
    expect(curse(fearful)).toBeGreaterThan(curse(pragmatic) + 0.03);
    expect(ritual(pragmatic)).toBeGreaterThan(ritual(fearful) + 0.03);
    expect(strengths(fearful)).not.toEqual(strengths(pragmatic));
  });

  it('contradictions weaken a belief, more slowly than confirmations strengthen it', () => {
    const sim = setup('bias', 'pragmatic');
    const make = () => {
      sim.belief.beliefs.clear();
      const b = sim.belief.hold(sim.villagers.alive[0]!, 'RITUAL', 'activity:dance', 'rain', 0, null);
      for (const v of sim.villagers.alive) b.holders.set(v.id, 0.25);
      sim.belief.refreshStrengths();
      return b;
    };
    let b = make();
    const start = b.strength;
    for (let i = 0; i < 3; i++) sim.belief.confirm(b);
    sim.belief.refreshStrengths();
    const up = b.strength - start;
    b = make();
    for (let i = 0; i < 3; i++) sim.belief.contradict(b);
    sim.belief.refreshStrengths();
    const down = start - b.strength;
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThan(up * 0.5);

    // And in play: dancing that brings no rain wears the belief down over days.
    // (Weather off, so no shower happens to answer the dance.)
    (sim.weather as unknown as { step: () => void }).step = () => {};
    b = make();
    for (const v of sim.villagers.alive) b.holders.set(v.id, 0.5);
    sim.belief.refreshStrengths();
    const high = b.strength;
    for (let d = 0; d < 4; d++) {
      sim.belief.notePerformance('activity:dance');
      run(sim, TICKS_PER_DAY + 1);
      if (sim.weather.raining) sim.weather.precipitation = 'none';
    }
    expect(b.contradictions).toBeGreaterThan(0);
    expect(b.strength).toBeLessThan(high);
  });

  it('same seed + same input log → identical belief state', () => {
    const play = () => {
      const sim = setup('det');
      const hill = sim.island.landmarks.eastHill;
      const c = sim.village.center;
      const script: [number, Command][] = [
        [90, { type: 'cast', miracle: 'lightning', x: hill.x, z: hill.z }],
        [140, { type: 'cast', miracle: 'rain', x: c.x, z: c.z }],
        [300, { type: 'cast', miracle: 'bloom', x: c.x + 5, z: c.z }],
        [520, { type: 'stroke', x: c.x - 10, z: c.z, raise: true }],
      ];
      for (let t = 0; t < TICKS_PER_DAY * 6; t++) {
        for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
        sim.step();
      }
      const beliefs = [...sim.belief.beliefs.values()].map((b) => ({
        id: b.id,
        strength: b.strength.toFixed(6),
        holders: [...b.holders].map(([k, v]) => [k, v.toFixed(6)]),
        c: b.confirmations,
        x: b.contradictions,
      }));
      return JSON.stringify({ beliefs, omens: sim.belief.omens.map((o) => [o.id, o.kind, o.witnesses.length]) });
    };
    const a = play();
    expect(a).toBe(play());
    expect(JSON.parse(a).omens.length).toBeGreaterThan(3);
  });
});

describe('belief mechanics', () => {
  it('omens record witnesses, context and outcomes; villagers remember them', () => {
    const sim = setup('record');
    toDaytime(sim);
    gatherAt(sim, sim.villagers.alive, sim.village.center.x, sim.village.center.z);
    const c = sim.village.center;
    cast(sim, { type: 'cast', miracle: 'bloom', x: c.x + 3, z: c.z });
    const omen = sim.belief.omens.at(-1)!;
    expect(omen.kind).toBe('bloom');
    expect(omen.isDivine).toBe(true);
    expect(omen.witnesses.length).toBeGreaterThan(10);
    expect(omen.context.some((f) => f.category === 'place')).toBe(true);
    expect(omen.context.some((f) => f.category === 'time')).toBe(true);
    const w = sim.villagers.byId(omen.witnesses[0]!)!;
    expect(w.memories.at(-1)?.omenId).toBe(omen.id);
    expect(sim.belief.lastAnalysis?.rows.length).toBeGreaterThan(2);
  });

  it('unwitnessed acts build no faith', () => {
    const sim = setup('secret');
    // Deep night, everyone indoors. Strike somewhere remote.
    for (let i = 0; i < TICKS_PER_DAY * 2 && !(sim.calendar.dayFraction > 0.02 && sim.calendar.dayFraction < 0.12); i++) sim.step();
    for (const v of sim.villagers.alive) v.inside = true;
    const faith = () => sim.villagers.alive.reduce((s, v) => s + v.faith.love + v.faith.fear, 0);
    const before = faith();
    const L = sim.island.landmarks;
    sim.strikeLightning(L.ridgePeak.x, L.ridgePeak.z, true);
    sim.step();
    const omen = sim.belief.omens.at(-1)!;
    expect(omen.witnesses.length).toBe(0);
    expect(faith()).toBeCloseTo(before, 6);
  });

  it('dreams become the dreamer\'s beliefs and spread at the fire', () => {
    const sim = setup('dreams', 'mystic');
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      sim.step();
      const f = sim.calendar.dayFraction;
      if (f > 0.02 && f < 0.1) break;
    }
    const sleeper = sim.villagers.alive.find((v) => v.lifeStage === 'adult' && v.action?.kind === 'sleep' && v.action.phase === 'work')!;
    cast(sim, { type: 'dream', villagerId: sleeper.id, symbols: ['mountain', 'mountain' as never, 'house'].slice(0, 2).concat('house') as never });
    // Fallback if duplicate symbols aren't allowed: send three distinct ones.
    if (!sleeper.dreams.length) cast(sim, { type: 'dream', villagerId: sleeper.id, symbols: ['mountain', 'bird', 'house'] });
    expect(sleeper.dreams.length).toBe(1);
    const held = [...sim.belief.beliefs.values()].filter((b) => (b.holders.get(sleeper.id) ?? 0) > 0.1);
    expect(held.length).toBeGreaterThan(0);
    const others = () => held.reduce((n, b) => n + [...b.holders.keys()].filter((id) => id !== sleeper.id).length, 0);
    run(sim, TICKS_PER_DAY);
    expect(others()).toBeGreaterThan(0);
  });

  it('a new priest re-reads doctrine through their own bias', () => {
    const sim = setup('reread', 'pragmatic');
    const curse = sim.belief.hold(sim.villagers.alive[0]!, 'CURSED_PLACE', 'place:eastHill', 'wrath', 0, null);
    const rite = sim.belief.hold(sim.villagers.alive[0]!, 'RITUAL', 'activity:dance', 'rain', 0, null);
    for (const v of sim.villagers.alive) curse.holders.set(v.id, 0.5), rite.holders.set(v.id, 0.5);
    sim.belief.refreshStrengths();
    sim.belief.setPersonality('fearful');
    expect(curse.strength).toBeGreaterThan(rite.strength);
  });
});
