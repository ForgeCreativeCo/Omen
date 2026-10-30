/**
 * Every gameplay number lives here. Systems import TUNING and never hard-code values.
 * Sections are filled in as milestones land; values marked from SPEC.md are its defaults.
 */

export const TUNING = {
  time: {
    /** Sim ticks per in-game second-equivalent at 1× speed (SPEC §3). */
    ticksPerSecond: 10,
    /** Real seconds per in-game day at 1× (SPEC §12). */
    secondsPerDay: 20,
    daysPerSeason: 3,
    seasonsPerYear: 4,
    /** Available speed multipliers; index 0 is pause. */
    speeds: [0, 1, 4, 16],
    /** Safety valve: max sim ticks run in one rendered frame before dropping time. */
    maxTicksPerFrame: 40,
    /** Fraction of the day where dawn/dusk begin, 0 = midnight. */
    dawnAt: 0.22,
    duskAt: 0.78,
  },

  world: {
    sizeX: 128,
    sizeZ: 128,
    sizeY: 48,
    chunkSize: 16,
    /** Max chunk-column re-meshes per rendered frame (~3 ms each; SPEC §4). */
    remeshBudgetPerFrame: 2,
  },

  /** Island generation (SPEC §4). Heights are in voxels; distances from island center. */
  terrain: {
    /** Topmost y filled with sea water. */
    seaLevel: 14,
    seaDepth: 4,
    /** Valley floor height. Kept a few voxels above sea so a flood can cover it. */
    valleyHeight: 17,
    valleyNoise: 1.6,
    /** Radius of the land (before coastline noise) and of the floating platform. */
    landRadius: 43,
    landRadiusNoise: 6,
    coastWidth: 9,
    platformRadius: 55,
    platformRadiusNoise: 3,
    /** Ridge: rises from ridgeStart to ridgeCrest (distance toward the ridge side). */
    ridgeStart: 0,
    ridgeCrest: 31,
    ridgeHeight: 17,
    ridgeNoise: 0.3,
    /** Above valleyHeight + this, ridge tops turn to bare stone. */
    rockLine: 13,
    hillDistance: 23,
    hillRadius: 12,
    hillHeight: 8,
    /** Max height for terrain so trees still fit under the world ceiling. */
    maxGroundY: 38,
    riverSourceDistance: 19,
    riverWidthStart: 0.9,
    riverWidthEnd: 1.9,
    riverMeander: 3,
    villageFlattenRadius: 7,
    villageMinRiverDist: 5,
    villageMaxRiverDist: 14,
    /** Bottom y of the floating island's underside at its center. */
    undersideBottom: 1,
    forestThreshold: 0.15,
    forestTreeChance: 0.14,
    meadowTreeChance: 0.012,
    treeSpacing: 3,
    treeClearOfVillage: 11,
  },

  villagers: {
    startCount: 20,
    softCap: 150,
    lifespanYears: 45,
    generationYears: 25,
  },

  belief: {
    /** Below this a belief dies (SPEC §8 step 5). */
    deathThreshold: 0.05,
    /** At or above this a belief drives behavior. */
    behaviorThreshold: 0.3,
    /** At or above this a belief becomes doctrine. */
    doctrineThreshold: 0.6,
    /** Contradictions weigh this much relative to confirmations (confirmation bias). */
    contradictionWeight: 0.3,
    /** A second attribution forms if within this fraction of the top salience. */
    secondAttributionMargin: 0.15,
    /** Window (in in-game days) for a believed response to count as confirmation. */
    confirmationWindowDays: 1,
  },

  rumor: {
    hearsayWeight: 0.5,
    magnitudeGrowthMin: 1.1,
    magnitudeGrowthMax: 1.4,
    swapDetailChance: 0.15,
    dropPlaceChance: 0.1,
  },

  warning: {
    floodInYears: 120,
    survivalToWin: 0.4,
  },
} as const;

export type Tuning = typeof TUNING;
