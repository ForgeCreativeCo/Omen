import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/Sim';
import { TICKS_PER_DAY } from '../src/sim/time';
import { TUNING } from '../src/sim/tuning';
import { M } from '../src/sim/world/materials';

const events = (s: Sim, type: string) => s.events.all().filter((e) => e.type === type);

describe('Islets', () => {
  it('small islands stand in the sea off the coast, apart from the main island', () => {
    for (const seed of ['omen', 'islets', 'archipelago']) {
      const s = new Sim({ seed, noVillage: true });
      const { islets } = s.island.landmarks;
      expect(islets.length).toBeGreaterThanOrEqual(1);
      const regions = s.nav.regions();
      const W = s.world.sizeX;
      const main = regions[s.island.landmarks.villageSite.x + s.island.landmarks.villageSite.z * W];
      for (const l of islets) {
        const top = s.world.topY(l.x, l.z);
        expect(top).toBeGreaterThan(TUNING.terrain.seaLevel);
        expect(s.world.get(l.x, top, l.z)).not.toBe(M.WATER);
        // You can't walk there from home.
        expect(regions[l.x + l.z * W]).not.toBe(main);
      }
    }
  });
});

describe('Boats', () => {
  it('settlers walk to the shore, sail, and found a people on an islet', () => {
    const s = new Sim({ seed: 'boats' });
    for (let i = 0; i < TICKS_PER_DAY; i++) s.step();
    const t = s.tribes[0]!;
    const boat = s.boats.send(t);
    expect(boat).not.toBeNull();
    const ids = [...boat!.members];
    for (let i = 0; i < TICKS_PER_DAY * 8 && !events(s, 'landfall').length; i++) s.step();
    expect(events(s, 'setSail').length).toBe(1);
    const land = events(s, 'landfall')[0];
    expect(land).toBeDefined();
    if (land?.type !== 'landfall') return;
    const nt = s.tribes[land.tribe]!;
    expect(nt.members.length).toBeGreaterThan(1);
    for (const id of land.ids) expect(ids).toContain(id);
    const l = s.island.landmarks.islets[boat!.islet]!;
    expect(Math.hypot(nt.village.center.x - l.x, nt.village.center.z - l.z)).toBeLessThan(l.r + 6);
    // Nobody can march on them.
    s.war.relations.set(`0:${nt.id}`, -1);
    for (let d = 0; d < 20; d++) {
      s.war.relations.set(`0:${nt.id}`, -1);
      for (let i = 0; i < TICKS_PER_DAY; i++) s.step();
    }
    expect(events(s, 'raid').filter((e) => e.type === 'raid' && (e.to === nt.id || e.from === nt.id)).length).toBe(0);
  }, 120_000);
});
