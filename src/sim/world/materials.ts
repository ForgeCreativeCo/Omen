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
  /** Rendered as a cube and hides neighbor faces. */
  solid: boolean;
  liquid: boolean;
  /** Can be stood on top of. */
  walkable: boolean;
  /** Villagers can walk through it (air, foliage, crops). */
  passable: boolean;
  flammable: boolean;
  /** 0..1, how readily it catches from a burning neighbor. */
  flammability: number;
  /** 0..1, how well crops grow on it. */
  fertility: number;
  /** What it becomes after burning, or null if it doesn't burn. */
  burnsTo: MaterialId | null;
  /** 0..1, how strongly the season foliage tint applies when rendered. */
  seasonTint: number;
  /** Growth stage for crop materials (1-based), 0 otherwise. */
  cropStage: number;
  /** Small decorative voxel (flowers): drawn as a little cube, never blocks anything. */
  decor: boolean;
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
  EMBER: 19,
  FLOWER_RED: 20,
  FLOWER_GOLD: 21,
  STATUE_FIRE: 22,
  STATUE_WATER: 23,
  STATUE_GROWTH: 24,
  STATUE_GOLD: 25,
  RUIN_STONE: 26,
} as const;

type Props = Partial<Omit<MaterialDef, 'id' | 'name' | 'color'>>;

const DEFAULTS: Omit<MaterialDef, 'id' | 'name' | 'color'> = {
  solid: true,
  liquid: false,
  walkable: true,
  passable: false,
  flammable: false,
  flammability: 0,
  fertility: 0,
  burnsTo: null,
  seasonTint: 0,
  cropStage: 0,
  decor: false,
};

function def(id: MaterialId, name: string, color: number, props: Props = {}): MaterialDef {
  const m = { ...DEFAULTS, ...props, id, name, color };
  m.flammable = m.flammability > 0;
  return m;
}

const crop = (stage: number, color: number) =>
  def(M.CROP_1 + stage - 1, `crop${stage}`, color, {
    walkable: false,
    passable: true,
    flammability: 0.4,
    burnsTo: M.AIR,
    seasonTint: 0.3,
    cropStage: stage,
  });

export const MATERIALS: readonly MaterialDef[] = [
  def(M.AIR, 'air', 0x000000, { solid: false, walkable: false, passable: true }),
  def(M.GRASS, 'grass', 0x7da453, { flammability: 0.15, burnsTo: M.ASH, fertility: 0.6, seasonTint: 1 }),
  def(M.DIRT, 'dirt', 0x8a6646, { fertility: 0.5 }),
  def(M.STONE, 'stone', 0x8e8b86),
  def(M.SAND, 'sand', 0xdcc995, { fertility: 0.1 }),
  def(M.WATER, 'water', 0x4f8fb3, { solid: false, liquid: true, walkable: false }),
  def(M.WOOD, 'wood', 0x6b4a2f, { walkable: false, flammability: 0.45, burnsTo: M.ASH }),
  def(M.LEAVES, 'leaves', 0x5f9440, { walkable: false, passable: true, flammability: 0.6, burnsTo: M.AIR, seasonTint: 1.2 }),
  def(M.PINE_LEAVES, 'pineLeaves', 0x3f6b45, { walkable: false, passable: true, flammability: 0.5, burnsTo: M.AIR, seasonTint: 0.25 }),
  crop(1, 0x8fae5a),
  crop(2, 0x9fbf4f),
  crop(3, 0xc9c25a),
  crop(4, 0xe0b94a),
  def(M.THATCH, 'thatch', 0xc8a964, { flammability: 0.8, burnsTo: M.ASH }),
  def(M.PLANK, 'plank', 0xa47b52, { flammability: 0.5, burnsTo: M.ASH }),
  def(M.ASH, 'ash', 0x5b5652, { fertility: 1 }),
  def(M.MARKER_STONE, 'markerStone', 0xb3aea3),
  def(M.SHRINE_STONE, 'shrineStone', 0xd8cdb4),
  def(M.STATUE_STONE, 'statueStone', 0xc4c0b8, { walkable: false }),
  def(M.EMBER, 'ember', 0xff7a2a, { walkable: false }),
  def(M.FLOWER_RED, 'flowerRed', 0xe0607a, { solid: false, walkable: false, passable: true, decor: true, flammability: 0.3, burnsTo: M.AIR }),
  def(M.FLOWER_GOLD, 'flowerGold', 0xf2c94c, { solid: false, walkable: false, passable: true, decor: true, flammability: 0.3, burnsTo: M.AIR }),
  // Statue accents (SPEC §11): element colors and gold eyes; ruins weather to mossy stone.
  def(M.STATUE_FIRE, 'statueFire', 0xd0613a, { walkable: false }),
  def(M.STATUE_WATER, 'statueWater', 0x5b8fc4, { walkable: false }),
  def(M.STATUE_GROWTH, 'statueGrowth', 0x6f9f4e, { walkable: false }),
  def(M.STATUE_GOLD, 'statueGold', 0xf0c64a, { walkable: false }),
  def(M.RUIN_STONE, 'ruinStone', 0x8d9278),
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

export const CROP_STAGES: readonly MaterialId[] = [M.CROP_1, M.CROP_2, M.CROP_3, M.CROP_4];
