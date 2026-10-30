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
    /** Personal lifespan = lifespanYears ± this. */
    lifespanJitter: 8,
    generationYears: 25,
    adultAge: 14,
    elderAge: 38,
    /** Walking speed in voxels per tick. */
    speed: 0.6,
    childSpeedFactor: 0.8,
    /** Hunger 0 = full, 1 = starving. Rise per day. */
    hungerPerDay: 0.8,
    childHungerFactor: 0.6,
    /** Food eaten per meal, and hunger it removes. */
    mealFood: 0.5,
    mealRelief: 0.55,
    eatWhenHungerAbove: 0.3,
    /** Above this hunger a villager breaks off work to eat. */
    hungryEnoughToStopWork: 0.8,
    /** Days at full hunger before death. */
    starveDays: 3,
    energyPerDay: 0.9,
    sleepRecoverPerDay: 4,
    /** Day fractions for the schedule (0 = midnight). */
    workEndsAt: 0.72,
    gatheringEndsAt: 0.86,
    /** Ticks between re-evaluations while busy (staggered per villager). */
    thinkInterval: 30,
    /** A* searches allowed per tick across the whole village. */
    pathBudgetPerTick: 6,
    pathMaxExpand: 9000,
    /** Daily chance two single adults pair up. */
    pairChancePerDay: 0.12,
    pairMaxAgeGap: 12,
    birthChancePerDay: 0.028,
    fertileMinAge: 17,
    fertileMaxAge: 40,
    maxChildrenPerCouple: 4,
    /** Births need at least this much food stored per person. */
    birthFoodPerCapita: 4,
    /** Death chance per tick while standing in or beside fire. */
    fireDeathChancePerTick: 0.03,
    fleeFireRadius: 6,
    lightningKillRadius: 1.6,
  },

  /** Work and resources. Durations are in ticks. */
  work: {
    farmOpTicks: 5,
    chopTicks: 26,
    quarryTicks: 22,
    forageTicks: 18,
    buildTicksPerBlock: 4,
    woodPerTrunkBlock: 2,
    woodPerTreeBonus: 2,
    stonePerTrip: 3,
    /** Gatherers stop chopping / quarrying above these stocks and forage instead. */
    woodTarget: 150,
    stoneTarget: 40,
    foodPerForage: 2.5,
    /** Forage only while stored food per person is below this. */
    forageBelowFoodPerCapita: 2.5,
    /** Gatherers stop foraging (and rest) above this much food per person. */
    forageAboveCapitaStops: 12,
    /** Children this old help forage when food is short. */
    childForageAge: 8,
    startFood: 130,
    /** Stored food above this much per person rots at spoilagePerDay. */
    spoilFreePerCapita: 10,
    spoilagePerDay: 0.04,
    startWood: 40,
    startStone: 20,
    /** New trees sprout per day (chance, may be >1 for multiple). */
    treeSproutPerDay: 1.4,
  },

  farming: {
    fieldSize: 4,
    /** Growth per tick at ideal conditions; 1 = ripe. ≈ 3 days. */
    growthPerTick: 1 / 600,
    seasonGrowth: [1, 1.1, 0.6, 0] as readonly number[],
    yieldPerTile: 1.3,
    /** Field moisture decay per day by season. */
    moistureDecayPerDay: [0.12, 0.2, 0.12, 0.05] as readonly number[],
    rainMoisturePerTick: 0.01,
    /** Fields within this distance of water never fall below riverMoisture. */
    riverReach: 4,
    riverMoisture: 0.35,
    /** Below this, growing crops lose health. */
    witherBelow: 0.05,
    witherPerDay: 0.35,
    fieldsPerPerson: 1 / 4,
  },

  building: {
    hutCapacity: 5,
    /** Plan a new hut when free beds drop below this. */
    spareBeds: 3,
    wellAtPopulation: 12,
    baseRadius: 10,
    radiusPerPerson: 0.3,
    maxRadius: 40,
    /** A damaged structure below this fraction of correct blocks counts as destroyed. */
    destroyedBelow: 0.6,
    /** Unstarted construction sites are dropped after this many days without progress. */
    abandonAfterDays: 8,
  },

  weather: {
    /** Chance a shower starts on a given day, by season (spring, summer, autumn, winter). */
    rainChancePerDay: [0.6, 0.35, 0.5, 0.3] as readonly number[],
    stormShare: [0.15, 0.35, 0.2, 0.1] as readonly number[],
    rainTicks: [30, 90] as readonly number[],
    stormTicks: [50, 110] as readonly number[],
    /** Natural strikes per tick during a storm. */
    stormLightningPerTick: 0.015,
    /** Chance a drought begins, checked at each season start. */
    droughtChance: [0.08, 0.25, 0.12, 0.02] as readonly number[],
    droughtDays: [3, 6] as readonly number[],
    droughtRainFactor: 0.12,
    /** Global soil moisture (drives fire dryness). */
    moistureDecayPerDay: 0.3,
    rainMoisturePerTick: 0.008,
    windChangePerTick: 0.004,
  },

  fire: {
    /** Chance per tick a burning voxel ignites a given flammable neighbor, × flammability × dryness. */
    spreadPerTick: 0.045,
    burnTicks: [30, 60] as readonly number[],
    /** Chance per tick that rain puts out a burning voxel. */
    rainDouse: 0.08,
    maxBurning: 600,
    lightningIgniteChance: 0.6,
    ashRegrowDays: [4, 9] as readonly number[],
  },

  /** The god's power (SPEC §10). Rates are per in-game day. */
  grace: {
    start: 60,
    capBase: 50,
    capPerBeliever: 3,
    regenBasePerDay: 18,
    /** Extra regen per day per unit of summed villager faith (love + fear). */
    regenPerFaithPerDay: 5,
    /** Sandbox: Grace never regenerates below this floor, so the god can't fade out entirely. */
    sandboxFloor: 15,
  },

  /** Miracle numbers (SPEC §6). Costs in Grace, durations in ticks. */
  miracles: {
    rain: { cost: 10, cooldown: 20, radius: 6, durationTicks: 90, moisturePerTick: 0.02, dousePerTick: 0.3 },
    lightning: {
      cost: 25,
      cooldown: 15,
      radius: 1.5,
      /** Aim error: a normal spread (std dev, voxels) plus an occasional wide miss. */
      spread: 1.2,
      wildMissChance: 0.15,
      wildMissDistance: 4,
      scorchRadius: 2.2,
      injureRadius: 3.5,
    },
    shapeEarth: {
      cost: 3,
      cooldown: 0,
      radius: 3,
      /** Ticks between brush strokes while painting. */
      strokeInterval: 3,
      /** Chance per touched structure block that it shakes loose. */
      collapseChance: 0.25,
      minY: 4,
      maxY: 40,
    },
    bloom: { cost: 12, cooldown: 20, radius: 5, flowerChance: 0.25, saplings: 2 },
    dream: { cost: 40, cooldownDays: 2, symbols: 3 },
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

    // ---- Interpretation (SPEC §8)
    /** Personal belief gain per witnessed attribution, before modifiers. */
    formationRate: 0.5,
    /** Weight of a secondary attribution relative to the main one. */
    secondaryWeight: 0.6,
    /** Below this top salience nothing stood out: harm reads as hunger (OFFERING), help as temperament. */
    minSalience: 0.12,
    salienceNoise: 0.03,
    /** proximityFalloff = 1 / (1 + (d / proximityScale)²). */
    proximityScale: 7,
    /** recencyFalloff = exp(-recency / (recencyDays × ticksPerDay)) for deeds and events. */
    recencyDays: 0.8,
    /** novelty = 1 / (1 + timesSeen × noveltyDecay), never below noveltyFloor. */
    noveltyDecay: 0.18,
    noveltyFloor: 0.12,
    /** Context is gathered within this many voxels of the omen. */
    contextRadius: 11,
    traitDevout: 1.4,
    traitSkeptic: 0.6,
    traitFearfulHarm: 1.3,
    /** Personal strengths fade by this fraction per day (×trait modifiers). */
    decayPerDay: 0.012,
    skepticDecay: 2,
    devoutDecay: 0.5,
    /** Evening telling at the fire: listeners gain this × teller strength. */
    spreadRate: 0.12,
    /** Children inherit doctrine at this fraction of their parents' / priest's strength. */
    inheritance: 0.5,
    /** Faith change per witnessed omen = valence × magnitude × this. */
    faithPerOmen: 0.12,
    /** History points kept per belief (one per day). */
    historyLength: 120,

    // ---- Behavior (SPEC §9)
    cursedPathCost: 12,
    cursedMarkerCount: 6,
    sacredCairnAt: 0.45,
    pilgrimageChance: 0.15,
    outcastExileAt: 0.6,
    /** Food offered per person per day at full OFFERING strength. */
    offeringPerCapita: 0.25,
    offeringEscalation: 1.5,
    ritualTicks: 40,
    /** Doctrine rituals are held as festivals every this many days. */
    festivalEveryDays: 3,
    /** Base daily chance of a theft per adult (more when hungry, less under taboo). */
    theftChancePerDay: 0.006,
    fightChancePerDay: 0.004,
    /** Chance per gathering that someone dances when the village is content. */
    spontaneousDance: 0.25,
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
