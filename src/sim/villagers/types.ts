import type { DeathCause } from '../events';
import type { OmenMemoryRecord } from '../omens/types';

export type VillagerId = number;
export type Sex = 'f' | 'm';
export type LifeStage = 'child' | 'adult' | 'elder';
export type Role = 'child' | 'farmer' | 'gatherer' | 'builder' | 'elder' | 'priest';
export type Trait = 'devout' | 'skeptic' | 'fearful' | 'curious' | 'gossip';

export const TRAITS: readonly Trait[] = ['devout', 'skeptic', 'fearful', 'curious', 'gossip'];
/** Pairs that can't both appear on one villager. */
export const TRAIT_CONFLICTS: readonly [Trait, Trait][] = [['devout', 'skeptic']];

export type ActionKind =
  | 'idle'
  | 'wander'
  | 'sleep'
  | 'eat'
  | 'farm'
  | 'chop'
  | 'quarry'
  | 'forage'
  | 'build'
  | 'gathering'
  | 'flee'
  /** Performing a believed ritual (dance, prayer) somewhere specific. */
  | 'ritual'
  | 'pilgrimage'
  | 'offering'
  /** Leaving the island for good (OUTCAST at full strength). */
  | 'exile';

export interface Action {
  kind: ActionKind;
  /** Cell to walk to. */
  tx: number;
  tz: number;
  /** Stop next to the target instead of on it (trees, structures). */
  adjacent: boolean;
  phase: 'path' | 'walk' | 'work' | 'deliver';
  workLeft: number;
  /** Structure / tree / tile this action is about. */
  structureId: number;
  tileIndex: number;
  treeIndex: number;
  /** For rituals: the activity performed ('dance', 'pray'...). */
  ritual?: string;
}

/** A dream the god sent (SPEC §6); interpreted in M4. */
export interface DreamRecord {
  tick: number;
  symbols: string[];
}

export interface Villager {
  id: VillagerId;
  name: string;
  /** Years. */
  age: number;
  /** Personal lifespan in years. */
  lifespan: number;
  sex: Sex;
  lifeStage: LifeStage;
  role: Role;
  traits: Trait[];
  needs: { hunger: number; energy: number; safety: number };
  faith: { love: number; fear: number };
  homeId: number;
  partnerId: VillagerId;
  parentIds: VillagerId[];
  childIds: VillagerId[];
  memories: OmenMemoryRecord[];
  /** Social standing 0..1: taboo-breaking and being outcast lower it. */
  standing: number;
  beliefStrengths: Map<string, number>;
  dreams: DreamRecord[];

  alive: boolean;
  bornTick: number;
  deathTick: number;
  deathCause: DeathCause | null;
  /** Ticks spent fully starving. */
  starvingTicks: number;

  // Position: feet at y. Previous tick kept for render interpolation.
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  /** Indoors (asleep at home): not drawn. */
  inside: boolean;
  /** Lying down outdoors (sleeping without a home). */
  lying: boolean;

  action: Action | null;
  path: number[];
  pathPos: number;
  navVersionAtPath: number;
  nextThink: number;
  carrying: { kind: 'wood' | 'stone' | 'food'; amount: number } | null;
}
