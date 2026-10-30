import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/miracles/Miracles';
import { godName } from '../src/sim/myth/godName';
import type { Legend, OmenFact } from '../src/sim/myth/Myth';
import { TemplateScriptureWriter } from '../src/sim/myth/scripture';
import { BODIES, depictionDistance, depictionOf, statueBlueprint } from '../src/sim/myth/statues';
import type { Omen, OmenMemoryRecord } from '../src/sim/omens/types';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import type { Villager } from '../src/sim/villagers/types';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const LONG = env.LONG === '1';

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

function toDaytime(sim: Sim): void {
  for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
    const f = sim.calendar.dayFraction;
    if (f > 0.35 && f < 0.45) return;
    sim.step();
  }
}

function gatherAt(sim: Sim, people: Villager[], x: number, z: number): void {
  people.forEach((v, i) => {
    const cell = sim.village.nearestWalkable(x + (i % 5) - 2, z + Math.floor(i / 5) - 2) ?? { x, z };
    v.x = v.px = cell.x + 0.5;
    v.z = v.pz = cell.z + 0.5;
    v.y = v.py = sim.nav.at(cell.x, cell.z) + 1;
    v.inside = false;
  });
}

function memory(omenId: string, over: Partial<OmenMemoryRecord> = {}): OmenMemoryRecord {
  return { omenId, tick: 0, kind: 'lightning', cause: 'activity:dance', place: 'place:well', valence: -0.8, magnitude: 0.8, hearsay: false, retold: 0, ...over };
}

/** A teller without the gossip trait, and everyone else's own stories already told. */
function quietCircle(sim: Sim): { teller: Villager; present: Villager[] } {
  const adults = sim.villagers.alive.filter((v) => v.lifeStage !== 'child');
  const teller = adults.find((v) => !v.traits.includes('gossip'))!;
  for (const v of sim.villagers.alive) for (const m of v.memories) m.told = true;
  return { teller, present: sim.villagers.alive };
}

function fakeOmen(sim: Sim, witnesses: number[]): Omen {
  return {
    id: sim.belief.nextOmenId(),
    tick: sim.tick,
    kind: 'naturalLightning',
    isDivine: false,
    position: { x: sim.island.landmarks.eastHill.x, y: 20, z: sim.island.landmarks.eastHill.z },
    radius: 2,
    magnitude: 0.7,
    outcomes: [],
    context: [],
    witnesses,
  };
}

describe('rumor', () => {
  it('a retold story is hearsay, one telling further on, and grows', () => {
    const sim = new Sim({ seed: 'rumor' });
    const { teller, present } = quietCircle(sim);
    teller.memories.push(memory('o-test', { tick: sim.tick }));
    sim.belief.tellRumors(present);
    const heard = present.flatMap((v) => v.memories.filter((m) => m.omenId === 'o-test' && m.hearsay));
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.length).toBeLessThanOrEqual(TUNING.rumor.listeners);
    for (const m of heard) {
      expect(m.retold).toBe(1);
      expect(m.magnitude).toBeGreaterThanOrEqual(0.8 * TUNING.rumor.magnitudeGrowthMin - 1e-9);
      expect(m.magnitude).toBeLessThanOrEqual(0.8 * TUNING.rumor.magnitudeGrowthMax + 1e-9);
    }
    // Listeners believe what they heard, at hearsay weight.
    const taboo = sim.belief.beliefs.get(sim.belief.key('TABOO_ACT', 'activity:dance', 'wrath'));
    expect(taboo).toBeDefined();
    expect(taboo!.heard).toBeGreaterThan(0);
    expect(taboo!.seen).toBe(0);
    // The next evening the listeners pass it on: a second telling, further from the truth.
    // (The original teller has told it already and doesn't again.)
    sim.belief.tellRumors(present);
    const later = present.flatMap((v) => v.memories.filter((m) => m.omenId === 'o-test' && m.hearsay));
    expect(later.length).toBeGreaterThan(heard.length);
    expect(Math.max(...later.map((m) => m.retold))).toBe(2);
    expect(teller.memories.find((m) => m.omenId === 'o-test')!.told).toBe(true);
  });

  it('retellings swap details (~15%) and drop places (~10%)', () => {
    const sim = new Sim({ seed: 'mutation' });
    let total = 0;
    let swapped = 0;
    let dropped = 0;
    for (let i = 0; i < 160; i++) {
      const { teller, present } = quietCircle(sim);
      const id = `o-m${i}`;
      teller.memories.push(memory(id, { tick: sim.tick }));
      sim.belief.tellRumors(present);
      for (const v of present)
        for (const m of v.memories)
          if (m.omenId === id && m.hearsay) {
            total++;
            if (m.cause !== 'activity:dance') swapped++;
            if (!m.place) dropped++;
          }
      // Keep memory lists short so old copies don't crowd the new.
      for (const v of present) v.memories = v.memories.filter((m) => !m.omenId.startsWith('o-m'));
    }
    expect(total).toBeGreaterThan(300);
    expect(swapped / total).toBeGreaterThan(0.08);
    expect(swapped / total).toBeLessThan(0.24);
    expect(dropped / total).toBeGreaterThan(0.04);
    expect(dropped / total).toBeLessThan(0.17);
  });

  it('a lightning strike seen by a few is known to many after a few evenings', () => {
    const sim = new Sim({ seed: 'chain' });
    toDaytime(sim);
    const hill = sim.island.landmarks.eastHill;
    const few = sim.villagers.alive.filter((v) => v.lifeStage !== 'child').slice(0, 4);
    gatherAt(sim, few, hill.x - 4, hill.z);
    for (const v of sim.villagers.alive) if (!few.includes(v)) v.inside = true;
    sim.miracles.grace = 1000;
    sim.enqueue({ type: 'cast', miracle: 'lightning', x: hill.x, z: hill.z });
    sim.step();
    for (const v of sim.villagers.alive) v.inside = false;
    run(sim, TICKS_PER_DAY * 4);
    const copies = sim.villagers.alive.flatMap((v) => v.memories.filter((m) => m.kind === 'lightning'));
    const witnesses = copies.filter((m) => !m.hearsay).length;
    expect(witnesses).toBeGreaterThan(0);
    expect(copies.filter((m) => m.hearsay).length).toBeGreaterThan(witnesses);
  });
});

describe('traditions', () => {
  it('once every witness is dead a belief becomes tradition and its verse goes vague', () => {
    const sim = new Sim({ seed: 'tradition' });
    const people = sim.villagers.alive;
    const witnesses = people.slice(0, 3).map((v) => v.id);
    const omen = fakeOmen(sim, witnesses);
    for (const v of people) sim.belief.hold(v, 'CURSED_PLACE', 'place:eastHill', 'wrath', 0.95, omen);
    sim.belief.refreshStrengths();
    sim.myth.step();
    const b = sim.belief.beliefs.get(sim.belief.key('CURSED_PLACE', 'place:eastHill', 'wrath'))!;
    const verse = sim.myth.book.forBelief(b.id)[0];
    expect(verse).toBeDefined();
    const before = verse!.text;

    // Not yet: witnesses live.
    b.bornTick = sim.tick - TICKS_PER_YEAR - 1;
    sim.belief.newDay();
    expect(b.isTradition).toBe(false);

    for (const id of witnesses) sim.villagers.kill(sim.villagers.byId(id)!, 'oldAge');
    sim.belief.newDay();
    sim.myth.step();
    expect(b.isTradition).toBe(true);
    expect(verse!.drift).toContain('tradition');
    expect(verse!.original).toBe(before);
    expect(verse!.text).not.toBe(before);
    expect(verse!.truth.at(-1)).toMatch(/nobody alive saw it begin/);
  });

  it('traditions fade far more slowly than living beliefs', () => {
    const sim = new Sim({ seed: 'tradition-decay' });
    const omen = fakeOmen(sim, []);
    const a = sim.belief.hold(sim.villagers.alive[0]!, 'SACRED_PLACE', 'place:ridge', 'favor', 0.8, omen);
    const t = sim.belief.hold(sim.villagers.alive[0]!, 'SACRED_PLACE', 'place:well', 'favor', 0.8, omen);
    t.isTradition = true;
    for (let d = 0; d < 20; d++) sim.belief.newDay();
    const id = sim.villagers.alive[0]!.id;
    expect(1 - t.holders.get(id)! / 0.8).toBeLessThan((1 - a.holders.get(id)! / 0.8) * 0.5);
  });
});

describe('myth compression', () => {
  function legend(sim: Sim, id: number, family: string, place: string, names: string[]): Legend {
    const fact: OmenFact = { id: `o-l${id}`, tick: id * 10, kind: 'storm', isDivine: false, x: 0, z: 0, where: 'the fire', whereKey: place, deaths: names.length, witnesses: 9, magnitude: 0.6 };
    sim.myth.facts.set(fact.id, fact);
    return { id: 1000 + id, family, count: 1, trueCount: 1, divine: 0, place, names, deaths: names.length, magnitude: 0.6, omenIds: [fact.id], firstTick: fact.tick };
  }

  it('similar legends merge, numbers inflate, side characters are forgotten', () => {
    const sim = new Sim({ seed: 'compress' });
    sim.myth.legends.length = 0;
    sim.myth.legends.push(legend(sim, 1, 'storm', 'place:fire', ['Orra']), legend(sim, 2, 'storm', 'place:fire', ['Korrin']), legend(sim, 3, 'storm', 'place:river', []));
    const versesBefore = sim.myth.book.verses().length;
    const changed = sim.myth.compress();
    const storms = sim.myth.legends.filter((l) => l.family === 'storm');
    expect(storms).toHaveLength(1);
    const great = storms[0]!;
    expect(changed).toContain(great);
    expect(great.trueCount).toBe(3);
    expect(great.count).toBeGreaterThan(great.trueCount);
    expect(great.place).toBe('place:fire');
    expect(great.names).toEqual(['Orra']);
    expect(great.title).toMatch(/Storm/);
    const verse = sim.myth.book.verses().slice(versesBefore).find((v) => v.kind === 'legend')!;
    expect(verse.drift).toContain('compressed');
    expect(verse.truth[0]).toMatch(new RegExp(`Really 3 separate events.*they now say ${great.count}`));

    // At the next succession the great legend swallows new ones and grows again.
    sim.myth.legends.push(legend(sim, 4, 'storm', 'place:fire', []));
    sim.myth.compress();
    const again = sim.myth.legends.filter((l) => l.family === 'storm');
    expect(again).toHaveLength(1);
    expect(again[0]!.trueCount).toBe(4);
    expect(again[0]!.count).toBeGreaterThan(great.count);
    expect(again[0]!.title).toBe(great.title);
  });

  it('a new high priest opens a new chapter and the record is compressed', () => {
    const sim = new Sim({ seed: 'succession' });
    run(sim, 2);
    expect(sim.myth.book.chapters).toHaveLength(1);
    const first = sim.myth.book.chapters[0]!;
    expect(first.title).toBe(`The Book of ${sim.villagers.byId(sim.belief.priestId)!.name}`);
    sim.myth.legends.push(legend(sim, 1, 'lightning', 'place:eastHill', []), legend(sim, 2, 'lightning', 'place:eastHill', []));
    const priest = sim.villagers.byId(sim.belief.priestId)!;
    sim.villagers.kill(priest, 'oldAge');
    run(sim, TICKS_PER_DAY + 2);
    expect(sim.myth.book.chapters.length).toBeGreaterThanOrEqual(2);
    const next = sim.myth.book.chapters[1]!;
    expect(next.title).toBe(`The Book of ${sim.villagers.byId(sim.belief.priestId)!.name}`);
    expect(first.verses.at(-1)!.kind).toBe('priest');
    expect(next.verses.some((v) => v.kind === 'legend' && v.drift.includes('compressed'))).toBe(true);
  });
});

describe('statues and names', () => {
  it('depictions become different statue blueprints', () => {
    const keys = new Set<string>();
    for (const body of BODIES)
      for (const element of ['fire', 'water', 'stone', 'growth']) {
        const p = statueBlueprint({ body, element, features: ['wings'] });
        keys.add(p.layers.map((l) => l.join('/')).join('|'));
        for (const layer of p.layers) {
          expect(layer).toHaveLength(5);
          for (const row of layer) expect(row).toHaveLength(5);
        }
        expect(p.layers.length).toBeGreaterThan(4);
      }
    expect(keys.size).toBe(BODIES.length * 4);
    const plain = statueBlueprint({ body: 'humanoid', element: 'stone', features: [] });
    const fancy = statueBlueprint({ body: 'humanoid', element: 'stone', features: ['horns', 'eyes'] });
    expect(fancy.layers.join()).not.toBe(plain.layers.join());
  });

  it('reads the strongest traits, and measures how far the image has moved', () => {
    const d = depictionOf({ 'body:bird': 3, 'body:serpent': 1, 'element:fire': 2, 'element:water': 1.9, 'feature:wings': 2, 'feature:eyes': 1.5, 'feature:horns': 0.4 });
    expect(d).toEqual({ body: 'bird', element: 'fire', features: ['eyes', 'wings'] });
    expect(depictionDistance(d, d)).toBe(0);
    expect(depictionDistance(d, { ...d, body: 'serpent' })).toBeGreaterThanOrEqual(TUNING.myth.statueShift);
    expect(depictionDistance(d, { ...d, features: ['wings'] })).toBeLessThan(TUNING.myth.statueShift);
  });

  it('the god\'s name follows the image and the most famous deeds, deterministically', () => {
    const d = { body: 'humanoid', element: 'fire', features: ['raisedHand'] };
    expect(godName(d, 'lightning', false, 1)).toBe(godName(d, 'lightning', false, 1));
    expect(godName(d, 'lightning', false, 1)).toMatch(/^the (Burning|Flame|Ember) Hand$/);
    expect(godName(d, 'earth', true, 1)).toMatch(/^(She|He|It)-Who-/);
    expect(godName({ ...d, element: 'water' }, 'lightning', false, 1)).not.toBe(godName(d, 'lightning', false, 1));
  });

  it('two lightning strikes on the east hill give it a name the villagers use', () => {
    const sim = new Sim({ seed: 'hill' });
    const hill = sim.island.landmarks.eastHill;
    for (let i = 0; i < 2; i++) {
      toDaytime(sim);
      gatherAt(sim, sim.villagers.alive, sim.village.center.x, sim.village.center.z);
      sim.miracles.grace = 1000;
      sim.miracles.readyAt.lightning = 0;
      sim.enqueue({ type: 'cast', miracle: 'lightning', x: hill.x, z: hill.z });
      run(sim, TICKS_PER_DAY / 3);
    }
    const name = sim.myth.places.name('place:eastHill');
    expect(name).toMatch(/^the \w+(-\w+)? Hill$/);
    expect(sim.belief.placeName('place:eastHill')).toBe(name);
    expect(sim.myth.book.verses().some((v) => v.kind === 'place' && v.text.includes(name!))).toBe(true);
  });
});

describe('scripture', () => {
  it('fills every slot and never leaves braces behind', () => {
    const w = new TemplateScriptureWriter();
    const rng = new Rng('verses');
    const slots = { god: 'the Burning Hand', place: 'the Burned Hill', season: 'the Dry Moon', clause: 'the people danced', base: 'dance', noun: 'dancing', response: 'sent the rain', future: 'send rain', sign: 'the full moon', person: 'Korrin', actor: 'Korrin', count: 'twice', depiction: 'a burning bird', temper: 'wrathful', priest: 'Orra', cause: 'theft', deaths: '', raised: 'raised', title: 'the Great Storm', name: 'the Sky-Father', old: 'the east hill', new: 'Tamuli', why: 'it weeps' };
    const kinds = ['creation', 'doctrine', 'omen', 'priest', 'tradition', 'name', 'legend', 'place', 'works', 'statue'] as const;
    const topics = ['*', 'RITUAL', 'TABOO_ACT', 'SACRED_PLACE', 'CURSED_PLACE', 'CHOSEN_ONE', 'OUTCAST', 'OFFERING', 'PORTENT', 'DEPICTION', 'TEMPERAMENT', 'lightning', 'storm', 'rain', 'earth', 'bloom', 'drought', 'died', 'succeeded', 'first', 'changed', 'new', 'named', 'cairn', 'shrine', 'temple'];
    const seen = new Set<string>();
    for (const kind of kinds)
      for (const topic of topics)
        for (let i = 0; i < 6; i++) {
          const text = w.write({ kind, topic, slots }, rng);
          expect(text).not.toMatch(/[{}]/);
          expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
          seen.add(text);
        }
    expect(seen.size).toBeGreaterThan(60);
  });

  it('same seed + same inputs → the same Holy Book', () => {
    const play = () => {
      const sim = new Sim({ seed: 'scripture' });
      const hill = sim.island.landmarks.eastHill;
      const script: [number, Command][] = [];
      for (let k = 0; k < 8; k++) script.push([TICKS_PER_DAY * (3 * k + 1) + 80, { type: 'cast', miracle: 'lightning', x: hill.x, z: hill.z }]);
      for (let t = 0; t < TICKS_PER_YEAR * 2; t++) {
        for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
        sim.miracles.grace = Math.max(sim.miracles.grace, 60);
        sim.step();
      }
      return { god: sim.myth.god, book: sim.myth.book.chapters.map((c) => [c.title, c.verses.map((v) => v.text)]) };
    };
    const a = play();
    expect(a.book.flatMap((c) => c[1]).length).toBeGreaterThan(2);
    expect(play()).toEqual(a);
  });
});

describe.skipIf(!LONG)('M5 acceptance (long)', () => {
  it('after ~3 generations the Holy Book has drifted from the truth, and the statues have changed', () => {
    const sim = new Sim({ seed: 'omen' });
    const L = sim.island.landmarks;
    // A god with eras: fire on the east hill, then green around the village, then reshaping the ridge.
    for (let y = 0; y < 75; y++)
      for (let d = 0; d < 12; d++) {
        if (d % 3 !== 1) {
          run(sim, TICKS_PER_DAY);
          continue;
        }
        sim.miracles.grace = Math.max(sim.miracles.grace, 60);
        run(sim, TICKS_PER_DAY * 0.4);
        const c = sim.village.center;
        if (y < 25) sim.enqueue({ type: 'cast', miracle: 'lightning', x: L.eastHill.x, z: L.eastHill.z });
        else if (y < 50) sim.enqueue({ type: 'cast', miracle: 'bloom', x: c.x + 6, z: c.z + 2 });
        else for (let k = 0; k < 6; k++) sim.enqueue({ type: 'stroke', x: L.ridgePeak.x + k, z: L.ridgePeak.z, raise: true });
        run(sim, TICKS_PER_DAY * 0.6);
      }
    const m = sim.myth;
    const verses = m.book.verses();
    expect(sim.villagers.alive.length).toBeGreaterThan(10);
    expect(m.book.chapters.length).toBeGreaterThanOrEqual(4);

    // Stated reasons have clearly drifted: merged and inflated legends, reasons gone vague,
    // and natural events credited to the god's will.
    const inflated = verses.filter((v) => v.drift.includes('compressed')).filter((v) => {
      const [, real, said] = /Really (\d+) .*they now say (\d+)/.exec(v.truth[0] ?? '') ?? [];
      return real && said && Number(said) > Number(real);
    });
    expect(inflated.length).toBeGreaterThan(0);
    expect(verses.some((v) => v.drift.includes('tradition') && v.original && v.original !== v.text)).toBe(true);
    expect(verses.some((v) => v.drift.includes('misread'))).toBe(true);

    // The statues changed at least once; the old one stands as a ruin.
    expect(m.statues.filter((s) => s.done).length).toBeGreaterThanOrEqual(2);
    expect(m.statues.some((s) => s.ruined)).toBe(true);
    expect(new Set(m.statues.map((s) => s.depiction.body + s.depiction.element)).size).toBeGreaterThanOrEqual(2);

    // The god and the land have names.
    expect(m.godName).not.toBe('');
    expect(m.places.all.length).toBeGreaterThan(0);
  }, 600_000);
});
