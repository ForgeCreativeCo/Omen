import { TICKS_PER_DAY } from '../time';
import { TUNING } from '../tuning';

/** The five miracles (SPEC §6), as data: UI and casting both read from here. */
export type MiracleId = 'rain' | 'lightning' | 'shapeEarth' | 'bloom' | 'dream';

export type Targeting =
  /** Tap a point on the ground. */
  | 'point'
  /** Press and drag to paint strokes. */
  | 'brush'
  /** Tap a sleeping villager, then choose symbols. */
  | 'sleeper';

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
