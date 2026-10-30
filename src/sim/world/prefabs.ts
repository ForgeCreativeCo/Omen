import { M, type MaterialId } from './materials';

/**
 * Structure blueprints (SPEC §5), as layer maps. Rows run back (first) to front
 * (last); the front faces the village center after rotation. `yOffset` is the
 * layer index of the first map relative to the structure's base (first layer
 * above ground), so a well can sink into the ground with -1.
 *
 * Legend: P plank, T thatch, W wood, S stone, E ember, D dirt, A water, H shrine-stone, K marker-stone,
 * '.' clear to air, ' ' leave untouched.
 */

export type PrefabKind = 'hut' | 'well' | 'firePit' | 'grave' | 'cairn';

export interface PrefabDef {
  kind: PrefabKind;
  variant: string;
  yOffset: number;
  layers: readonly (readonly string[])[];
  /** Door column (local x) on the front row; the cell just outside is the entrance. */
  doorX?: number;
}

export const LEGEND: Record<string, MaterialId> = {
  P: M.PLANK,
  T: M.THATCH,
  W: M.WOOD,
  S: M.STONE,
  E: M.EMBER,
  D: M.DIRT,
  A: M.WATER,
  H: M.SHRINE_STONE,
  K: M.MARKER_STONE,
  '.': M.AIR,
};

const hutWalls = ['WPPPW', 'P...P', 'P...P', 'P...P', 'WP.PW'];
const hutLintel = ['WPPPW', 'P...P', 'P...P', 'P...P', 'WPPPW'];
const roofFull = ['TTTTT', 'TTTTT', 'TTTTT', 'TTTTT', 'TTTTT'];

export const PREFABS: readonly PrefabDef[] = [
  {
    kind: 'hut',
    variant: 'hipped',
    yOffset: 0,
    doorX: 2,
    layers: [hutWalls, hutWalls, hutLintel, roofFull, ['.....', '.TTT.', '.TTT.', '.TTT.', '.....']],
  },
  {
    kind: 'hut',
    variant: 'ridged',
    yOffset: 0,
    doorX: 2,
    layers: [
      ['SSSSS', 'S...S', 'S...S', 'S...S', 'SS.SS'],
      hutWalls,
      hutLintel,
      roofFull,
      ['.....', '.....', 'TTTTT', '.....', '.....'],
    ],
  },
  {
    kind: 'hut',
    variant: 'post',
    yOffset: 0,
    doorX: 2,
    layers: [
      ['WPPPW', 'P...P', 'P...P', 'P...P', 'WP.PW'],
      ['WPPPW', 'P...P', 'P...P', 'P...P', 'WP.PW'],
      ['WTTTW', 'T...T', 'T...T', 'T...T', 'WTTTW'],
      roofFull,
      ['.....', '.TTT.', '.T.T.', '.TTT.', '.....'],
    ],
  },
  {
    kind: 'firePit',
    variant: 'ring',
    yOffset: 0,
    layers: [['.S.', 'SES', '.S.']],
  },
  {
    kind: 'well',
    variant: 'roofed',
    yOffset: -1,
    layers: [
      ['SSS', 'SAS', 'SSS'],
      ['SSS', 'S.S', 'SSS'],
      ['W.W', '...', 'W.W'],
      ['TTT', 'TTT', 'TTT'],
    ],
  },
  {
    kind: 'cairn',
    variant: 'stack',
    yOffset: 0,
    layers: [['.H.', 'HHH', '.H.'], ['...', '.H.', '...'], ['...', '.K.', '...']],
  },
  {
    kind: 'grave',
    variant: 'mound',
    yOffset: 0,
    layers: [['D']],
  },
];

export function prefabsOf(kind: PrefabKind): PrefabDef[] {
  return PREFABS.filter((p) => p.kind === kind);
}

/** Footprint size (unrotated). */
export function prefabSize(p: PrefabDef): { w: number; d: number } {
  const first = p.layers[0]!;
  return { w: first[0]!.length, d: first.length };
}
