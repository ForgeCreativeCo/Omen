/**
 * Voxel material table (SPEC §4). Data only: systems look up properties here
 * rather than switching on material IDs.
 */

export type MaterialId = number;

export interface MaterialDef {
  id: MaterialId;
  name: string;
  /** Base color, sRGB hex. */
  color: number;
  /** Occupies space and blocks movement and light. */
  solid: boolean;
  liquid: boolean;
  /** Can be stood on top of. */
  walkable: boolean;
  flammable: boolean;
  /** 0..1, how well crops grow on or next to it. */
  fertility: number;
  /** What it becomes after burning, or null if it doesn't burn. */
  burnsTo: MaterialId | null;
  /** 0..1, how strongly the season foliage tint applies when rendered. */
  seasonTint: number;
  /** Growth stage for crop materials (1-based), 0 otherwise. */
  cropStage: number;
}

export const M = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  WOOD: 6,
  LEAVES: 7,
  PINE_LEAVES: 8,
  CROP_1: 9,
  CROP_2: 10,
  CROP_3: 11,
  CROP_4: 12,
  THATCH: 13,
  PLANK: 14,
  ASH: 15,
  MARKER_STONE: 16,
  SHRINE_STONE: 17,
  STATUE_STONE: 18,
} as const;

type Partial0 = Partial<Omit<MaterialDef, 'id' | 'name' | 'color'>>;

const DEFAULTS: Omit<MaterialDef, 'id' | 'name' | 'color'> = {
  solid: true,
  liquid: false,
  walkable: true,
  flammable: false,
  fertility: 0,
  burnsTo: null,
  seasonTint: 0,
  cropStage: 0,
};

function def(id: MaterialId, name: string, color: number, props: Partial0 = {}): MaterialDef {
  return { ...DEFAULTS, ...props, id, name, color };
}

const crop = (stage: number, color: number) =>
  def(M.CROP_1 + stage - 1, `crop${stage}`, color, {
    flammable: true,
    burnsTo: M.ASH,
    fertility: 0.8,
    seasonTint: 0.3,
    cropStage: stage,
  });

export const MATERIALS: readonly MaterialDef[] = [
  def(M.AIR, 'air', 0x000000, { solid: false, walkable: false }),
  def(M.GRASS, 'grass', 0x7da453, { flammable: true, burnsTo: M.ASH, fertility: 0.6, seasonTint: 1 }),
  def(M.DIRT, 'dirt', 0x8a6646, { fertility: 0.5 }),
  def(M.STONE, 'stone', 0x8e8b86),
  def(M.SAND, 'sand', 0xdcc995, { fertility: 0.1 }),
  def(M.WATER, 'water', 0x4f8fb3, { solid: false, liquid: true, walkable: false }),
  def(M.WOOD, 'wood', 0x6b4a2f, { walkable: false, flammable: true, burnsTo: M.ASH }),
  def(M.LEAVES, 'leaves', 0x5f9440, { walkable: false, flammable: true, burnsTo: M.AIR, seasonTint: 1.2 }),
  def(M.PINE_LEAVES, 'pineLeaves', 0x3f6b45, { walkable: false, flammable: true, burnsTo: M.AIR, seasonTint: 0.25 }),
  crop(1, 0x8fae5a),
  crop(2, 0x9fbf4f),
  crop(3, 0xc9c25a),
  crop(4, 0xe0b94a),
  def(M.THATCH, 'thatch', 0xc8a964, { flammable: true, burnsTo: M.ASH }),
  def(M.PLANK, 'plank', 0xa47b52, { flammable: true, burnsTo: M.ASH }),
  def(M.ASH, 'ash', 0x5b5652, { fertility: 1 }),
  def(M.MARKER_STONE, 'markerStone', 0xb3aea3),
  def(M.SHRINE_STONE, 'shrineStone', 0xd8cdb4),
  def(M.STATUE_STONE, 'statueStone', 0xc4c0b8),
];

// Catch table/ID drift at load time.
MATERIALS.forEach((m, i) => {
  if (m.id !== i) throw new Error(`materials: ${m.name} has id ${m.id} at index ${i}`);
});

export function material(id: MaterialId): MaterialDef {
  return MATERIALS[id] ?? (MATERIALS[M.AIR] as MaterialDef);
}

export const isSolid = (id: MaterialId) => material(id).solid;
export const isLiquid = (id: MaterialId) => material(id).liquid;
