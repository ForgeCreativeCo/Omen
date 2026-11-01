import type { VillagerId } from '../villagers/types';

/** What happened (SPEC §7). Natural and divine variants are distinct kinds. */
export type OmenKind =
  | 'rain'
  | 'lightning'
  | 'shapeEarth'
  | 'bloom'
  | 'dream'
  | 'light'
  | 'hallow'
  | 'blessing'
  | 'blight'
  | 'meteor'
  | 'quake'
  | 'firestorm'
  | 'wave'
  | 'plague'
  | 'swarm'
  | 'hand'
  | 'naturalRain'
  | 'storm'
  | 'naturalLightning'
  | 'drought';

/** The "response" a ritual expects: natural and divine versions look the same to villagers. */
export function responseOf(kind: OmenKind): string {
  switch (kind) {
    case 'naturalRain':
    case 'storm':
    case 'rain':
      return 'rain';
    case 'naturalLightning':
    case 'lightning':
      return 'lightning';
    default:
      return kind;
  }
}

export type FeatureCategory = 'activity' | 'place' | 'person' | 'deed' | 'time' | 'event' | 'condition' | 'object';

export interface ContextFeature {
  /** e.g. 'activity:dance', 'place:eastHill', 'person:12', 'deed:theft', 'time:dawn'. */
  key: string;
  category: FeatureCategory;
  /** Emotional weight 0..1. */
  intensity: number;
  /** Voxels from the omen's center. */
  distance: number;
  /** Ticks since it happened (deeds, events); 0 for things ongoing. */
  recency: number;
  /** Villagers involved (actors of a deed, people present, the newborn...). */
  people?: VillagerId[];
}

export type OutcomeType =
  | 'died'
  | 'injured'
  | 'cropsSaved'
  | 'cropsRipened'
  | 'fireStarted'
  | 'fireDoused'
  | 'hutDamaged'
  | 'landRaised'
  | 'landLowered'
  | 'cropsWithered'
  | 'sickened'
  | 'blessed';

export interface Outcome {
  type: OutcomeType;
  /** 'person:<id>' or 'structure:<id>' when it concerns someone/something specific. */
  entity?: string;
  /** Owners/residents affected (for huts). */
  people?: VillagerId[];
  amount?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Omen {
  id: string;
  tick: number;
  kind: OmenKind;
  /** Debug only: villagers never see this. */
  isDivine: boolean;
  position: Vec3;
  radius: number;
  /** 0..1, how dramatic it looked. */
  magnitude: number;
  outcomes: Outcome[];
  context: ContextFeature[];
  witnesses: VillagerId[];
  /** Where the god aimed, when it differs from where it landed (lightning). */
  aim?: { x: number; z: number };
  /** Dream symbols (dream omens only). */
  symbols?: string[];
}

/** A villager's own copy of an omen, as they understood it. Retelling mutates it (SPEC §12). */
export interface OmenMemoryRecord {
  omenId: string;
  tick: number;
  kind: OmenKind;
  /** The feature they blamed / credited, or '' if nothing stood out. */
  cause: string;
  /** Where they think it happened ('' once the detail is lost). */
  place: string;
  valence: number;
  /** Grows with each retelling, so it can exceed 1. */
  magnitude: number;
  hearsay: boolean;
  /** How many tellings away from a witness (0 = saw it). */
  retold: number;
  /** Already passed on at the fire (each memory is told once per teller). */
  told?: boolean;
}
