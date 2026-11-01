import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import { M } from '../src/sim/world/materials';
import { plantTree } from '../src/sim/world/terrain';

const B = TUNING.building;

function days(s: Sim, n: number, each?: () => void): void {
  for (let i = 0; i < TICKS_PER_DAY * n; i++) {
    s.step();
    if (each && s.tick % TICKS_PER_DAY === 0) each();
  }
}

/** Fill every open patch around the village with close-set trees (crowns touching). */
function forest(s: Sim): void {
  const v = s.village;
  const c = v.center;
  const rng = new Rng('forest');
  for (let z = c.z - B.maxRadius; z <= c.z + B.maxRadius; z += 3)
    for (let x = c.x - B.maxRadius; x <= c.x + B.maxRadius; x += 3) {
      if (Math.hypot(x - c.x, z - c.z) < 9) continue;
      const h = s.nav.at(x, z);
      if (h < 0 || s.world.get(x, h, z) !== M.GRASS || s.world.get(x, h + 1, z) !== M.AIR) continue;
      let built = false;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (v.structureAt(x + dx, z + dz)) built = true;
      if (built) continue;
      plantTree(s.world, x, h + 1, z, false, rng);
      s.trees.push({ x, y: h + 1, z, alive: true, reservedBy: -1 });
    }
}

/** Stores deep enough to count as prosperous. */
function enrich(s: Sim): void {
  const st = s.village.store;
  st.wood = Math.max(st.wood, 400);
  st.stone = Math.max(st.stone, 200);
  st.food = Math.max(st.food, 40 * Math.max(1, s.village.population));
}

describe('Clearing land', () => {
  it('a village boxed in by forest marks trees, fells them, and builds where they stood', () => {
    const s = new Sim({ seed: 'clearing' });
    days(s, 1);
    forest(s);
    const spare = B.spareBeds;
    // Everyone wants another home at once.
    (B as { spareBeds: number }).spareBeds = 25;
    try {
      const huts = s.village.huts.length;
      const marked = new Set<(typeof s.trees)[number]>();
      days(s, 30, () => {
        for (const t of s.village.clearing) marked.add(t);
      });
      expect(marked.size).toBeGreaterThan(0);
      // The woodcutters took the marked trees down.
      expect([...marked].filter((t) => !t.alive).length).toBeGreaterThan(marked.size / 2);
      expect(s.village.huts.length).toBeGreaterThan(huts);
    } finally {
      (B as { spareBeds: number }).spareBeds = spare;
    }
  });
});

describe('Building on surplus', () => {
  it('a prosperous village builds a storehouse, fences its fields, and its food keeps longer', () => {
    const s = new Sim({ seed: 'surplus' });
    days(s, 1);
    expect(s.village.prosperous).toBe(false);
    days(s, 40, () => enrich(s));
    expect(s.village.prosperous).toBe(true);
    const store = s.village.structures.find((x) => x.kind === 'storehouse');
    expect(store?.complete).toBe(true);
    const fences = s.village.structures.filter((x) => x.kind === 'fence');
    expect(fences.length).toBeGreaterThan(0);
    expect(fences.some((f) => f.complete)).toBe(true);
    // Posts stand on the ground around a field, never on it.
    const f = fences.find((x) => x.complete)!;
    for (const p of f.steps) {
      expect(s.world.get(p.x, p.y, p.z)).toBe(M.FENCE);
      expect(s.village.structureAt(p.x, p.z)?.kind).toBe('fence');
    }
    // A storehouse keeps twice the food from spoiling.
    s.village.store.food = 1000;
    s.village.spoil();
    const withStore = s.village.store.food;
    store!.destroyed = true;
    s.village.store.food = 1000;
    s.village.spoil();
    expect(withStore).toBeGreaterThan(s.village.store.food);
  });

  it('a large prosperous village builds longhouses, which sleep more', () => {
    const s = new Sim({ seed: 'surplus', tribes: 1 });
    const spare = B.spareBeds;
    (B as { spareBeds: number }).spareBeds = 25;
    try {
      days(s, 30, () => {
        enrich(s);
        s.village.population = Math.max(s.village.population, B.surplus.longhouseAt);
      });
    } finally {
      (B as { spareBeds: number }).spareBeds = spare;
    }
    const long = s.village.huts.find((h) => h.variant === 'longhouse' && h.complete);
    expect(long).toBeDefined();
    expect(s.village.bedsIn(long!)).toBe(B.surplus.longhouseBeds);
    expect(s.village.bedsIn(long!)).toBeGreaterThan(B.hutCapacity);
  });

  it("a poor village doesn't build for its own sake", () => {
    const s = new Sim({ seed: 'surplus' });
    days(s, 20, () => {
      s.village.store.wood = 20;
      s.village.store.stone = 5;
    });
    expect(s.village.structures.some((x) => x.kind === 'storehouse' || x.kind === 'fence')).toBe(false);
  });
});

describe('Worn paths', () => {
  it('feet wear paths near the village, and grass grows back where nobody walks', () => {
    const s = new Sim({ seed: 'paths' });
    days(s, 30);
    const c = s.village.center;
    const cells = s.paths.cells;
    expect(cells.length).toBeGreaterThan(10);
    const W = s.world.sizeX;
    for (const k of cells) {
      const x = k % W;
      const z = (k - x) / W;
      expect(s.world.get(x, s.nav.at(x, z), z)).toBe(M.PATH);
      expect(Math.hypot(x - c.x, z - c.z)).toBeLessThan(B.maxRadius + 20);
    }
    // Everyone gone: the paths heal.
    for (const v of s.villagers.alive) s.villagers.kill(v, 'oldAge');
    days(s, TUNING.paths.regrowDays + 5);
    expect(s.paths.cells.length).toBe(0);
  });
});

describe('Stone', () => {
  it('every people finds stone to quarry, even settled far from bare rock', () => {
    for (const seed of ['omen', 'c']) {
      const s = new Sim({ seed, tribes: 3 });
      for (const t of s.tribes) expect(t.village.stoneSpots.length, `${seed} people ${t.id}`).toBeGreaterThan(0);
    }
  });
});
