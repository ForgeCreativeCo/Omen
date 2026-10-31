import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';

/** The miracles (SPEC §6, plus the later powers), as data: UI and casting both read from here. */
export type MiracleId = 'rain' | 'lightning' | 'shapeEarth' | 'bloom' | 'dream' | 'light' | 'bless' | 'blight' | 'meteor' | 'hand';

/** Miracles cast by tapping a point on the ground. */
export type PointMiracle = 'rain' | 'lightning' | 'bloom' | 'light' | 'blight' | 'meteor';

export type Targeting =
  /** Tap a point on the ground. */
  | 'point'
  /** Press and drag to paint strokes. */
  | 'brush'
  /** Tap a sleeping villager, then choose symbols. */
  | 'sleeper'
  /** Tap a villager who is awake. */
  | 'person'
  /** Press on someone or something to take hold, drag to carry, let go or flick. */
  | 'hand';

export interface MiracleDef {
  id: MiracleId;
  name: string;
  blurb: string;
  targeting: Targeting;
  /** Grace per cast (per stroke for brushes). */
  cost: number;
  cooldownTicks: number;
  radius: number;
  nightOnly: boolean;
  /** Keyboard shortcut (the letter; KeyboardEvent.code is `Key${key}`). */
  key: string;
}

const MT = TUNING.miracles;

export const MIRACLES: readonly MiracleDef[] = [
  {
    id: 'rain',
    name: 'Rain',
    blurb: 'A cloud waters the ground and puts out fires. Drag it while it lasts.',
    targeting: 'point',
    cost: MT.rain.cost,
    cooldownTicks: MT.rain.cooldown,
    radius: MT.rain.radius,
    nightOnly: false,
    key: 'R',
  },
  {
    id: 'lightning',
    name: 'Lightning',
    blurb: 'Strikes near where you aim. Scorches, burns, kills.',
    targeting: 'point',
    cost: MT.lightning.cost,
    cooldownTicks: MT.lightning.cooldown,
    radius: MT.lightning.radius,
    nightOnly: false,
    key: 'L',
  },
  {
    id: 'shapeEarth',
    name: 'Shape Earth',
    blurb: 'Drag to raise the land (hold Shift or toggle to lower). Structures shake.',
    targeting: 'brush',
    cost: MT.shapeEarth.cost,
    cooldownTicks: MT.shapeEarth.cooldown,
    radius: MT.shapeEarth.radius,
    nightOnly: false,
    key: 'G',
  },
  {
    id: 'bloom',
    name: 'Bloom',
    blurb: 'Crops ripen and flowers open at once.',
    targeting: 'point',
    cost: MT.bloom.cost,
    cooldownTicks: MT.bloom.cooldown,
    radius: MT.bloom.radius,
    nightOnly: false,
    key: 'B',
  },
  {
    id: 'light',
    name: 'Holy Light',
    blurb: 'A pillar of light stands on the ground for a while, seen from far away. The surest way to make a place holy.',
    targeting: 'point',
    cost: MT.light.cost,
    cooldownTicks: MT.light.cooldown,
    radius: MT.light.radius,
    nightOnly: false,
    key: 'I',
  },
  {
    id: 'bless',
    name: 'Bless',
    blurb: 'Touch one person who is awake: fed, rested, unafraid, glowing. Those who see it may decide they are chosen.',
    targeting: 'person',
    cost: MT.bless.cost,
    cooldownTicks: MT.bless.cooldown,
    radius: MT.bless.witnessRadius,
    nightOnly: false,
    key: 'K',
  },
  {
    id: 'blight',
    name: 'Blight',
    blurb: 'Crops wither and the grass dies back. Seen, it reads as a curse on the place.',
    targeting: 'point',
    cost: MT.blight.cost,
    cooldownTicks: MT.blight.cooldown,
    radius: MT.blight.radius,
    nightOnly: false,
    key: 'X',
  },
  {
    id: 'meteor',
    name: 'Falling Star',
    blurb: 'A star falls where you point, seen by everyone awake. It leaves a crater and a glowing stone, and kills anyone beneath.',
    targeting: 'point',
    cost: MT.meteor.cost,
    cooldownTicks: MT.meteor.cooldownDays * TICKS_PER_DAY,
    radius: MT.meteor.craterRadius,
    nightOnly: false,
    key: 'O',
  },
  {
    id: 'hand',
    name: 'The Hand',
    blurb: 'Press on a villager, a tree or the ground to take hold. Drag to carry. Let go gently to set them down, or flick to throw.',
    targeting: 'hand',
    cost: MT.hand.cost,
    cooldownTicks: MT.hand.cooldown,
    radius: 0,
    nightOnly: false,
    key: 'F',
  },
  {
    id: 'dream',
    name: 'Dream',
    blurb: 'At night, send a sleeper three symbols. They will make of it what they will.',
    targeting: 'sleeper',
    cost: MT.dream.cost,
    cooldownTicks: MT.dream.cooldownDays * TICKS_PER_DAY,
    radius: 0,
    nightOnly: true,
    key: 'N',
  },
];

export function miracleDef(id: MiracleId): MiracleDef {
  return MIRACLES.find((m) => m.id === id)!;
}

/** Dream symbol palette (SPEC §6). */
export const DREAM_SYMBOLS = [
  'water',
  'fire',
  'mountain',
  'boat',
  'child',
  'sun',
  'moon',
  'bird',
  'snake',
  'hand',
  'eye',
  'house',
] as const;
export type DreamSymbol = (typeof DREAM_SYMBOLS)[number];
