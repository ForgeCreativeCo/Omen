import type { Villager } from '../villagers/types';

/**
 * The Warning's disasters (SPEC §14). Only the flood exists; a volcano or comet
 * would implement the same shape with its own survival behavior (where people
 * run, what kills them) and be picked by `TUNING.warning.disaster`.
 */
export type DisasterKind = 'flood';

/** waiting → striking (the event unfolds) → settling (it has peaked) → done (judge survival). */
export type DisasterPhase = 'waiting' | 'striking' | 'settling' | 'done';

export interface Disaster {
  readonly kind: DisasterKind;
  /** Tick it strikes. */
  readonly strikesAt: number;
  readonly phase: DisasterPhase;
  /** Ground above this y stays safe (for the flood, its final water level). */
  readonly safeAbove: number;
  /** People alive when it struck (the base for survival). */
  readonly startPopulation: number;
  step(): void;
  /** Where this villager runs while it unfolds, or null for ordinary behavior. */
  refugeFor(v: Villager): { x: number; z: number } | null;
  /** If it struck today, would this villager run somewhere safe? (The player's gauge.) */
  wouldReachSafety(v: Villager): boolean;
}

export type OutcomeReason = 'survived' | 'perished' | 'faithless' | 'extinct';

export interface WarningOutcome {
  won: boolean;
  reason: OutcomeReason;
  tick: number;
  startPopulation: number;
  survivors: number;
  /** survivors / startPopulation (0 before the disaster). */
  ratio: number;
}
