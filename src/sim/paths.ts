import type { Sim } from './Sim';
import { TUNING } from './tuning';
import { M } from './world/materials';

const T = TUNING.paths;

/**
 * Paths worn by feet. Every so often each villager on the move leaves a mark on
 * the cell under them; marks fade a little each day. Where the marks stay deep,
 * between the huts, the fields and the fire, the grass wears through to bare
 * ground. Where nobody walks any more, the grass comes back within a month or
 * so: a village that moves leaves its old ways to heal.
 */
export class Paths {
  /** Footfall per cell (fades daily). */
  readonly traffic: Uint16Array;
  /** Cells worn to path so far (ever). */
  worn = 0;
  /** Cells that are path now. */
  readonly cells: number[] = [];
  /** Where the daily look for regrowth picks up. */
  private look = 0;

  constructor(private readonly sim: Sim) {
    this.traffic = new Uint16Array(sim.world.sizeX * sim.world.sizeZ);
  }

  step(): void {
    const sim = this.sim;
    if (sim.tick % T.everyTicks !== 0) return;
    const W = sim.world.sizeX;
    for (const v of sim.villagers.alive) {
      const a = v.action;
      if (v.inside || !a || (a.phase !== 'path' && a.phase !== 'deliver')) continue;
      const k = Math.floor(v.x) + Math.floor(v.z) * W;
      const n = this.traffic[k];
      if (n !== undefined && n < 65535) this.traffic[k] = n + 1;
    }
  }

  /** Each morning: grass under deep footfall wears through; the rest fades. */
  dawn(): void {
    const sim = this.sim;
    const w = sim.world;
    const W = w.sizeX;
    const t = this.traffic;
    for (let k = 0; k < t.length; k++) {
      const n = t[k]!;
      if (!n) continue;
      if (n >= T.wearAt) {
        const x = k % W;
        const z = (k - x) / W;
        const h = sim.nav.at(x, z);
        if (h >= 0 && w.get(x, h, z) === M.GRASS && !sim.tribes.some((tr) => tr.village.structureAt(x, z))) {
          w.set(x, h, z, M.PATH);
          // Flowers don't survive being walked on.
          if (w.get(x, h + 1, z) === M.FLOWER_RED || w.get(x, h + 1, z) === M.FLOWER_GOLD) w.set(x, h + 1, z, M.AIR);
          this.worn++;
          this.cells.push(k);
        }
      }
      t[k] = n - Math.ceil(n * T.fadePerDay);
    }
    // Grass creeps back over paths nobody walks.
    const cells = this.cells;
    const count = Math.max(4, Math.ceil(cells.length / T.regrowDays));
    for (let i = 0; i < count && cells.length; i++) {
      this.look %= cells.length;
      const k = cells[this.look]!;
      const x = k % W;
      const z = (k - x) / W;
      const h = sim.nav.at(x, z);
      const still = h >= 0 && w.get(x, h, z) === M.PATH;
      if (still && t[k]! >= T.regrowBelow) {
        this.look++;
        continue;
      }
      if (still) w.set(x, h, z, M.GRASS);
      cells[this.look] = cells[cells.length - 1]!;
      cells.pop();
    }
  }
}
