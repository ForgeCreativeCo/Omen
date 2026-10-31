import type { FeatureCategory } from '../omens/types';

/** The ten belief types (SPEC §9). */
export type BeliefType =
  | 'RITUAL'
  | 'TABOO_ACT'
  | 'SACRED_PLACE'
  | 'CURSED_PLACE'
  | 'CHOSEN_ONE'
  | 'OUTCAST'
  | 'OFFERING'
  | 'PORTENT'
  | 'DEPICTION'
  | 'TEMPERAMENT';

export interface BeliefTypeDef {
  type: BeliefType;
  label: string;
  /** One glyph for compact UI. */
  icon: string;
  /** A sentence in the villagers' voice; {s} = subject, {r} = response. */
  statement: string;
  /** How the belief shows itself (for UI help). */
  effect: string;
}

export const BELIEF_TYPES: Record<BeliefType, BeliefTypeDef> = {
  RITUAL: {
    type: 'RITUAL',
    label: 'Ritual',
    icon: '◎',
    statement: 'After {s}, the god sends {r}.',
    effect: 'They perform it when they want what it brings, and at festivals once it is doctrine.',
  },
  TABOO_ACT: {
    type: 'TABOO_ACT',
    label: 'Taboo',
    icon: '⊘',
    statement: 'The god punishes {s}.',
    effect: 'They avoid it, and shun those who do it.',
  },
  SACRED_PLACE: {
    type: 'SACRED_PLACE',
    label: 'Sacred place',
    icon: '△',
    statement: '{s} is holy.',
    effect: 'Pilgrimages, burials and a cairn there; they prefer to live nearby.',
  },
  CURSED_PLACE: {
    type: 'CURSED_PLACE',
    label: 'Cursed place',
    icon: '✕',
    statement: 'The god hates {s}.',
    effect: 'Nobody farms, builds or walks there; marker-stones ring it.',
  },
  CHOSEN_ONE: {
    type: 'CHOSEN_ONE',
    label: 'Chosen',
    icon: '✦',
    statement: 'The god favors {s}.',
    effect: 'Raised standing; their words and dreams carry weight; likely to lead.',
  },
  OUTCAST: {
    type: 'OUTCAST',
    label: 'Outcast',
    icon: '⨯',
    statement: 'The god has turned from {s}.',
    effect: 'Shunned at the fire; at full strength, sent away.',
  },
  OFFERING: {
    type: 'OFFERING',
    label: 'Offering',
    icon: '◇',
    statement: 'The god must be fed.',
    effect: 'Food is left at the fire each evening, more after every misfortune.',
  },
  PORTENT: {
    type: 'PORTENT',
    label: 'Portent',
    icon: '☽',
    statement: '{s} foretells {r}.',
    effect: 'When it comes, they prepare: hoarding for harm, feasting for good.',
  },
  DEPICTION: {
    type: 'DEPICTION',
    label: 'Depiction',
    icon: '☉',
    statement: 'The god is {s}.',
    effect: 'Shapes their images of the god and the name they use.',
  },
  TEMPERAMENT: {
    type: 'TEMPERAMENT',
    label: 'Temperament',
    icon: '≈',
    statement: 'The god is {s}.',
    effect: 'Colors whether they love or fear, and which beliefs come easily.',
  },
};

/**
 * Attribution (SPEC §8 step 3): what kind of belief an omen becomes, given whether it
 * helped or harmed and what kind of thing got the credit or blame.
 */
export const ATTRIBUTION: Record<'good' | 'bad', Record<FeatureCategory, BeliefType>> = {
  good: {
    activity: 'RITUAL',
    place: 'SACRED_PLACE',
    person: 'CHOSEN_ONE',
    deed: 'RITUAL',
    event: 'CHOSEN_ONE',
    time: 'PORTENT',
    condition: 'PORTENT',
    object: 'DEPICTION',
  },
  bad: {
    activity: 'TABOO_ACT',
    place: 'CURSED_PLACE',
    person: 'OUTCAST',
    deed: 'TABOO_ACT',
    event: 'PORTENT',
    time: 'PORTENT',
    condition: 'PORTENT',
    object: 'TABOO_ACT',
  },
};

/** Activities villagers can deliberately perform as a ritual, and how. */
export const PERFORMABLE: Record<string, 'dance' | 'pray' | 'gather' | 'work'> = {
  'activity:dance': 'dance',
  'activity:praying': 'pray',
  'activity:gathering': 'gather',
  'activity:offering': 'pray',
  'activity:pilgrimage': 'pray',
  'activity:farming': 'work',
  'activity:building': 'work',
  'activity:woodcutting': 'work',
  'activity:foraging': 'work',
  'activity:quarrying': 'work',
};

// ---------------------------------------------------------------- priests

export type PriestPersonality = 'fearful' | 'ambitious' | 'mystic' | 'pragmatic';
export const PERSONALITIES: readonly PriestPersonality[] = ['fearful', 'ambitious', 'mystic', 'pragmatic'];

export interface PriestBias {
  /** Harm readings are multiplied by this. */
  harm: number;
  /** Belief types this priest steers toward (salience ×prefer for categories that map to them). */
  prefers: BeliefType[];
  prefer: number;
  /** Chance a contradiction is explained away. */
  explainAway: number;
  /** Extra decay for beliefs that keep failing. */
  failedDecay: number;
  /** Below this top salience, harm is read as hunger (OFFERING). */
  offeringBar: number;
  /** Dream interpretation generosity. */
  dreams: number;
  /** Credit for positive omens shifts to the priest and family. */
  selfCredit: number;
}

/** SPEC §8 priest table. */
export const PRIEST_BIAS: Record<PriestPersonality, PriestBias> = {
  fearful: {
    harm: 1.5,
    prefers: ['TABOO_ACT', 'CURSED_PLACE', 'OFFERING'],
    prefer: 1.45,
    explainAway: 0.3,
    failedDecay: 1,
    offeringBar: 0.3,
    dreams: 1,
    selfCredit: 1,
  },
  ambitious: {
    harm: 1,
    prefers: ['CHOSEN_ONE'],
    prefer: 1.2,
    explainAway: 0.6,
    failedDecay: 1,
    offeringBar: 0.12,
    dreams: 1,
    selfCredit: 2.2,
  },
  mystic: {
    harm: 1,
    prefers: ['DEPICTION', 'PORTENT'],
    prefer: 1.6,
    explainAway: 0.4,
    failedDecay: 1,
    offeringBar: 0.12,
    dreams: 1.6,
    selfCredit: 1,
  },
  pragmatic: {
    harm: 1,
    prefers: ['RITUAL'],
    prefer: 1.5,
    explainAway: 0.1,
    failedDecay: 2,
    offeringBar: 0.1,
    dreams: 0.8,
    selfCredit: 1,
  },
};

// ---------------------------------------------------------------- depiction

export type DepictionAxis = 'body' | 'element' | 'feature';

/** Traits each omen kind suggests about what the god looks like. */
export const DEPICTION_FROM_OMEN: Record<string, [DepictionAxis, string][]> = {
  lightning: [['element', 'fire'], ['body', 'bird'], ['feature', 'raisedHand']],
  naturalLightning: [['element', 'fire'], ['body', 'bird']],
  rain: [['element', 'water'], ['body', 'humanoid']],
  naturalRain: [['element', 'water']],
  storm: [['element', 'water'], ['body', 'bird'], ['feature', 'wings']],
  shapeEarth: [['element', 'stone'], ['body', 'serpent'], ['feature', 'manyArms']],
  bloom: [['element', 'growth'], ['body', 'humanoid'], ['feature', 'raisedHand']],
  drought: [['element', 'fire'], ['body', 'sunDisc']],
  dream: [['feature', 'eyes']],
  light: [['body', 'sunDisc'], ['feature', 'wings']],
  blessing: [['body', 'humanoid'], ['feature', 'raisedHand']],
  blight: [['element', 'fire'], ['body', 'serpent'], ['feature', 'horns']],
  meteor: [['element', 'stone'], ['body', 'sunDisc'], ['feature', 'eyes']],
  hand: [['body', 'humanoid'], ['feature', 'raisedHand']],
};

/** How much each omen kind shapes the image: everyday weather barely registers. */
export const DEPICTION_WEIGHT: Record<string, number> = {
  naturalRain: 0.15,
  storm: 0.5,
  drought: 0.5,
  naturalLightning: 0.7,
};

export const DEPICTION_WORDS: Record<string, string> = {
  fire: 'burning',
  water: 'weeping',
  stone: 'stone',
  growth: 'green',
  bird: 'bird',
  serpent: 'serpent',
  humanoid: 'giant',
  sunDisc: 'sun',
  manyArmed: 'many-armed one',
  wings: 'winged',
  eyes: 'many-eyed',
  raisedHand: 'with a raised hand',
  manyArms: 'many-armed',
  horns: 'horned',
};

// ---------------------------------------------------------------- dreams

/** What a dream symbol might mean (SPEC §8): candidate beliefs with base weights. */
export interface DreamMeaning {
  type: BeliefType;
  /** Subject feature key; 'self' = the dreamer, 'child' = the dreamer's youngest child. */
  subject: string;
  response?: string;
  weight: number;
  /** Depiction trait this reading adds. */
  depiction?: [DepictionAxis, string];
}

export const DREAM_MEANINGS: Record<string, DreamMeaning[]> = {
  water: [
    { type: 'SACRED_PLACE', subject: 'place:river', weight: 1 },
    { type: 'RITUAL', subject: 'activity:dance', response: 'rain', weight: 0.8 },
    { type: 'DEPICTION', subject: 'god', weight: 0.6, depiction: ['element', 'water'] },
  ],
  fire: [
    { type: 'SACRED_PLACE', subject: 'place:fire', weight: 1 },
    { type: 'DEPICTION', subject: 'god', weight: 0.8, depiction: ['element', 'fire'] },
    { type: 'TABOO_ACT', subject: 'deed:theft', weight: 0.4 },
  ],
  mountain: [
    { type: 'SACRED_PLACE', subject: 'place:ridge', weight: 1 },
    { type: 'SACRED_PLACE', subject: 'place:eastHill', weight: 0.8 },
    { type: 'DEPICTION', subject: 'god', weight: 0.5, depiction: ['element', 'stone'] },
  ],
  boat: [
    { type: 'SACRED_PLACE', subject: 'place:coast', weight: 0.9 },
    { type: 'PORTENT', subject: 'condition:storm', response: 'rain', weight: 0.7 },
  ],
  child: [
    { type: 'CHOSEN_ONE', subject: 'child', weight: 1 },
    { type: 'RITUAL', subject: 'event:birth', response: 'favor', weight: 0.6 },
  ],
  sun: [
    { type: 'RITUAL', subject: 'activity:praying', response: 'favor', weight: 0.9 },
    { type: 'DEPICTION', subject: 'god', weight: 0.8, depiction: ['body', 'sunDisc'] },
  ],
  moon: [
    { type: 'PORTENT', subject: 'time:fullMoon', response: 'wrath', weight: 0.9 },
    { type: 'DEPICTION', subject: 'god', weight: 0.5, depiction: ['feature', 'eyes'] },
  ],
  bird: [
    { type: 'DEPICTION', subject: 'god', weight: 1, depiction: ['body', 'bird'] },
    { type: 'SACRED_PLACE', subject: 'place:ridge', weight: 0.5 },
  ],
  snake: [
    { type: 'DEPICTION', subject: 'god', weight: 0.9, depiction: ['body', 'serpent'] },
    { type: 'CURSED_PLACE', subject: 'place:river', weight: 0.7 },
  ],
  hand: [
    { type: 'CHOSEN_ONE', subject: 'self', weight: 1 },
    { type: 'OFFERING', subject: 'god', weight: 0.7 },
    { type: 'DEPICTION', subject: 'god', weight: 0.5, depiction: ['feature', 'raisedHand'] },
  ],
  eye: [
    { type: 'TABOO_ACT', subject: 'deed:theft', weight: 1 },
    { type: 'DEPICTION', subject: 'god', weight: 0.7, depiction: ['feature', 'eyes'] },
  ],
  house: [
    { type: 'SACRED_PLACE', subject: 'place:fire', weight: 0.6 },
    { type: 'CHOSEN_ONE', subject: 'self', weight: 0.5 },
  ],
};
