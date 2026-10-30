import { featureLabel } from '../omens/context';
import type { Sim } from '../Sim';
import { TICKS_PER_YEAR } from '../time';
import { TUNING } from '../tuning';
import { FloodDisaster } from './Flood';
import type { Disaster, WarningOutcome } from './types';

const W = TUNING.warning;

/**
 * The Warning (SPEC §14): a disaster is coming at a known tick; the villagers never
 * learn of it. Ends in survival judged against `survivalToWin`, or early if faith
 * collapses or everyone dies.
 */
export class WarningScenario {
  readonly disaster: Disaster;
  outcome: WarningOutcome | null = null;
  /** Consecutive days of collapsed faith. */
  faithlessDays = 0;
  /** The holy places when it struck, and whether their ground stayed dry (for the end screen). */
  holyAtStrike: { label: string; strength: number; height: number }[] | null = null;

  constructor(
    private readonly sim: Sim,
    years: number = W.floodInYears,
  ) {
    // Only the flood exists; other kinds plug in here.
    this.disaster = new FloodDisaster(sim, Math.round(years * TICKS_PER_YEAR));
  }

  /** Years until it strikes (fractional; 0 once it has). */
  get yearsLeft(): number {
    return Math.max(0, (this.disaster.strikesAt - this.sim.tick) / TICKS_PER_YEAR);
  }

  /** Mean love + fear over the living (0..1). */
  faith(): number {
    const alive = this.sim.villagers.alive;
    let sum = 0;
    for (const v of alive) sum += v.faith.love + v.faith.fear;
    return alive.length ? sum / alive.length : 0;
  }

  step(): void {
    // The disaster runs its course even after the verdict ("keep watching").
    this.disaster.step();
    if (this.outcome) return;
    const sim = this.sim;
    if (!this.holyAtStrike && this.disaster.phase !== 'waiting') {
      this.holyAtStrike = sim.belief
        .active('SACRED_PLACE', 0.1)
        .sort((a, b) => b.strength - a.strength)
        .map((b) => {
          const a = b.area!;
          let h = -1;
          for (let z = Math.floor(a.z - a.r); z <= a.z + a.r; z++) for (let x = Math.floor(a.x - a.r); x <= a.x + a.r; x++) if (Math.hypot(x - a.x, z - a.z) <= a.r) h = Math.max(h, sim.nav.at(x, z));
          return { label: featureLabel(sim, b.subject), strength: b.strength, height: h };
        });
    }
    const alive = sim.villagers.alive.length;
    // Everyone gone: before the disaster the village died out; during it, the disaster took them.
    if (alive === 0) return this.end(false, this.disaster.phase === 'waiting' ? 'extinct' : 'perished');
    if (this.disaster.phase === 'done') {
      const ratio = alive / Math.max(1, this.disaster.startPopulation);
      this.end(ratio >= W.survivalToWin, ratio >= W.survivalToWin ? 'survived' : 'perished');
    }
  }

  /** Daily: has faith collapsed (before the disaster)? */
  dawn(): void {
    if (this.outcome || this.disaster.phase !== 'waiting') return;
    if (this.sim.tick < W.faithGraceYears * TICKS_PER_YEAR) return;
    this.faithlessDays = this.faith() < W.faithCollapseBelow ? this.faithlessDays + 1 : 0;
    if (this.faithlessDays >= W.faithCollapseDays) this.end(false, 'faithless');
  }

  private end(won: boolean, reason: WarningOutcome['reason']): void {
    const sim = this.sim;
    const start = this.disaster.startPopulation;
    const survivors = sim.villagers.alive.length;
    this.outcome = { won, reason, tick: sim.tick, startPopulation: start, survivors, ratio: start ? survivors / start : 0 };
    sim.events.push(sim.tick, { type: 'outcome', won, reason });
  }
}
