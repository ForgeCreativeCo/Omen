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
    // 1× runs at half the sim rate (40 s days, unhurried walking); 4× and 16× are multiples of the base rate.
    speeds: [0, 0.5, 4, 16],
    /** Safety valve: max sim ticks run in one rendered frame before dropping time. */
    maxTicksPerFrame: 40,
    /** Fraction of the day where dawn/dusk begin, 0 = midnight. */
    dawnAt: 0.22,
    duskAt: 0.78,
  },

  world: {
    sizeX: 256,
    sizeZ: 256,
    sizeY: 64,
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
    landRadius: 96,
    landRadiusNoise: 20,
    coastWidth: 12,
    platformRadius: 110,
    /** The sea reaches this far past the land, beyond the platform the main island is built on (room for the islets). */
    outerSeaRadius: 124,
    platformRadiusNoise: 4,
    /** The home valley (village, east hill, ridge, river) keeps its old scale inside this radius. */
    homeRadius: 44,
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
    maxGroundY: 52,
    /** Highlands past the ridge: peaks this tall over the plateau. */
    highlandHeight: 12,
    /** Lowlands across the valley: rolling hills this high. */
    lowlandHills: 4,
    /** Badlands on the far flank: flat-topped mesas this tall, in steps (kept under the Warning's sea). */
    mesaHeight: 6,
    mesaStep: 3,
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
    /** Small islands in the sea around the main one: how many, how big, how high, and the water kept between. */
    isletCount: [2, 4] as readonly number[],
    isletRadius: [10, 13] as readonly number[],
    isletHeight: [3, 5] as readonly number[],
    isletGap: 5,
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
    /** In water: wading speed, how far they look for dry ground, ticks with water over the head before drowning. */
    wadeSpeed: 0.15,
    panicRadius: 5,
    drownTicks: 40,
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
    /** Births × (1 + this × (mean love − mean fear)), clamped to [min, max]. */
    moodBirthEffect: 0.6,
    moodBirthMin: 0.75,
    moodBirthMax: 1.35,
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
    /** Share of stored food lost when the village moves (what can't be carried). */
    relocateLoss: 0.3,
    /** Trees cleared around a new village site, to make room for homes. */
    clearRadius: 12,
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

  /** Paths worn by feet. */
  paths: {
    /** Walkers leave a mark this often (ticks). */
    everyTicks: 5,
    /** Grass wears through where the marks stand this deep at dawn. */
    wearAt: 12,
    /** Worn cells looked over each day for grass coming back (a cycle takes about this many days). */
    regrowDays: 30,
    /** A path with less footfall than this when looked at grows back to grass. */
    regrowBelow: 2,
    /** Share of the marks that fades each day. */
    fadePerDay: 0.25,
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
    /** When no ground is clear for a home or field, they mark the nearest wooded spot for felling (at most this many trees). */
    clearMaxTrees: 14,
    /** With no bare stone near, they look this far for some to quarry. */
    stoneSearchRadius: 90,
    /** Building beyond need, once the stores run deep. */
    surplus: {
      wood: 110,
      stone: 30,
      /** Stored food per person. */
      food: 8,
      /** Extra beds they keep spare. */
      extraBeds: 5,
      storehouseAt: 14,
      longhouseAt: 20,
      longhouseBeds: 9,
      /** A storehouse multiplies the food that keeps without spoiling. */
      storehouseKeeps: 2,
    },
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
    /** The god's bolt sets nearly everything burnable around it alight, wet or dry. */
    divineIgniteChance: 0.9,
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
    /** No cooldowns and no Grace cost: the god's power is limitless. */
    unlimited: true,
    rain: { cost: 10, cooldown: 20, radius: 6, durationTicks: 90, moisturePerTick: 0.02, dousePerTick: 0.3 },
    lightning: {
      /** The god's bolt blasts a crater this wide and kills this close (storms stay small). */
      blastRadius: 2.5,
      killRadius: 3.5,
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
    /** The Hand: grab, carry, set down or throw. Distances in voxels, speeds per tick. */
    hand: {
      cost: 0,
      cooldown: 0,
      /** How high above the ground things are carried, and how fast the hand moves. */
      carryHeight: 9,
      carrySpeed: 3,
      /** How close to the pointer a tree must be to take hold of it. */
      reach: 2,
      /** Earth torn up: a disc this wide, this many layers deep. */
      earthRadius: 1,
      earthDepth: 2,
      /** Let go slower than this and a villager is set down unharmed. */
      placeSpeed: 0.25,
      maxThrowSpeed: 2.4,
      /** Upward toss on a full-speed throw. */
      throwLift: 0.5,
      gravity: 0.09,
      /** Landing faster than this kills a thrown villager (a drop from carry height does). */
      survivableSpeed: 0.9,
      bruisedDays: 1,
      /** Crush radius where a tree, or a clod of earth (by its size), lands. */
      treeRadius: 1.6,
      maxEarthRadius: 2.5,
      /** Chance per structure block in the crush radius that it's knocked off. */
      smashChance: 0.6,
    },
    /** Holy Light: a pillar of light, harmless and seen from far off. */
    light: { cost: 22, cooldown: 40, radius: 3, durationTicks: 120, range: 60 },
    /** Bless: one villager restored; people close by see the glow and feel it a little. */
    bless: { cost: 15, cooldown: 25, witnessRadius: 2, love: 0.25, onlookerLove: 0.04, onlookerRadius: 8 },
    /** Blight: crops wither and grass dies back. */
    blight: { cost: 14, cooldown: 20, radius: 5, grassChance: 0.55 },
    /** Falling Star: a meteor lands a few ticks after the cast. */
    meteor: {
      cost: 60,
      cooldownDays: 4,
      fallTicks: 10,
      craterRadius: 9,
      /** Crater depth at the center, voxels. */
      depth: 7,
      killRadius: 7,
      /** The shockwave past the rim: huts lose blocks, trees fall, people die near its edge. */
      blastRadius: 16,
      blastWreckChance: 0.35,
      /** Everyone this close is shaken. */
      fearRadius: 34,
      /** Chance per structure block in the crater that it's blown away. */
      wreckChance: 0.95,
      /** Fires started around the rim. */
      fires: 18,
    },
    /** Earthquake: the ground shakes over an area, cracks open and topples huts. */
    quake: {
      cost: 45,
      cooldownDays: 2,
      radius: 18,
      /** How long the shaking lasts, ticks. */
      durationTicks: 40,
      /** Fissures torn from the epicenter, and how deep they go. */
      cracks: [3, 5] as readonly number[],
      crackDepth: 3,
      /** Chance per structure block (scaled down toward the edge) that it falls over the quake. */
      topple: 0.55,
      treeFall: 0.25,
      /** Anyone in a home that loses this many blocks is crushed, with this chance. */
      crushChance: 0.35,
    },
    /** Plague: sickness that goes from person to person. Times in days. */
    plague: {
      cost: 40,
      cooldownDays: 3,
      /** The first to fall sick: everyone this close to where the god points. */
      radius: 5,
      /** How close two people must stand, and the chance per day together that it passes. */
      contactRadius: 3,
      spreadChance: 0.5,
      /** At the evening fire it passes most easily. */
      gatheringSpread: 0.8,
      sickDays: [2, 4] as readonly number[],
      /** Chance per day of sickness that it kills: adults, and the very young and old. */
      deathPerDay: 0.12,
      frailDeathPerDay: 0.28,
    },
    /** Tidal wave: the sea surges inland toward where the god points, then draws back. */
    wave: {
      cost: 55,
      cooldownDays: 3,
      /** Width of the wave front, voxels. */
      width: 20,
      /** How far past the aim point it runs on (falling away), and how far from the sea it may start. */
      overrun: 12,
      searchRadius: 120,
      /** The crest stands at least this far above the sea, and this deep over the ground where the god points, but never more than maxRise above the sea. */
      height: 6,
      depth: 3,
      maxRise: 16,
      /** Voxels the front moves per tick, and ticks the water stays before draining. */
      speed: 1.5,
      holdTicks: 50,
      /** Ticks the water takes to sink away. */
      drainTicks: 40,
      /** Chance per structure block under the crest that it's torn away. */
      wreck: 0.4,
      /** People caught are carried along and may drown. */
      carry: 0.6,
    },
    /** Firestorm: fire rains on an area for a while. */
    firestorm: {
      cost: 50,
      cooldownDays: 3,
      radius: 11,
      durationTicks: 60,
      /** Burning stones landing per tick. */
      perTick: 2,
      /** Anyone this close to where one lands is killed. */
      killRadius: 1.2,
      fearRadius: 20,
    },
    /** Swarm: a cloud of locusts eats one people's crops, field by field. */
    swarm: {
      cost: 35,
      cooldownDays: 2,
      radius: 3,
      durationTicks: 300,
      /** Voxels per tick it flies between fields. */
      speed: 0.6,
      /** Crop tiles eaten per tick while over a field, and food taken from the store as it passes the village. */
      eatPerTick: 2,
      storeShare: 0.15,
    },
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
    /** Traditions barely fade (×this on decay): nobody remembers why, so nobody doubts. */
    traditionDecay: 0.25,
    /** DEPICTION trait votes fade by this factor per day, so the image follows recent omens. */
    depictionFadePerDay: 0.994,
    devoutDecay: 0.5,
    /** Evening telling at the fire: listeners gain this × teller strength. */
    spreadRate: 0.12,
    /** Children inherit doctrine at this fraction of their parents' / priest's strength. */
    inheritance: 0.5,
    /** Faith change per witnessed omen = valence × magnitude × this (× DEPICTION_WEIGHT for everyday weather). */
    faithPerOmen: 0.12,
    /** Love and fear fade by this fraction a day: a god who does nothing is slowly forgotten. */
    faithFadePerDay: 0.01,
    /** History points kept per belief (one per day). */
    historyLength: 120,

    // ---- Behavior (SPEC §9)
    cursedPathCost: 12,
    cursedMarkerCount: 6,
    sacredCairnAt: 0.45,
    /** Cairn → shrine → temple (SPEC §11): strength and population needed for each. */
    sacredShrineAt: 0.5,
    shrinePopulation: 22,
    sacredTempleAt: 0.62,
    templePopulation: 40,
    pilgrimageChance: 0.15,
    outcastExileAt: 0.6,
    /** Food offered per person per day at full OFFERING strength. */
    offeringPerCapita: 0.25,
    offeringEscalation: 1.5,
    /** Food per person kept back from offerings, and the most of the rest given in one evening. */
    offeringReservePerCapita: 3,
    offeringSurplusShare: 0.25,
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
    /** Stories older than this are no longer told. */
    maxAgeDays: 36,
    /** magnitude × |valence| below this isn't worth telling. */
    minInterest: 0.08,
    listeners: 3,
    gossipListeners: 5,
    /** Gossips' retellings swap and drop details this many times as often. */
    gossipMutation: 2,
    /** Retold magnitude stops growing here (a 1.0 omen can become a 3.0 legend). */
    maxMagnitude: 3,
    magnitudeGrowthMin: 1.1,
    magnitudeGrowthMax: 1.4,
    swapDetailChance: 0.15,
    dropPlaceChance: 0.1,
  },

  myth: {
    /** A first statue needs this much DEPICTION strength and this many people. */
    statueAt: 0.1,
    statuePopulation: 12,
    /** A new statue when the image has changed this much (statues.ts depictionDistance)… */
    statueShift: 1.5,
    /** …and has stayed changed this many days, at most once per this many years. */
    statueStableDays: 4,
    statueMinYears: 6,
    /** Daily chance an old statue loses another block. */
    ruinDecayChance: 0.06,
    /** Daily chance an abandoned hut on cursed ground loses a block. */
    abandonedDecayChance: 0.25,
    /** Omens become legends (the myth record) above this magnitude, or with deaths… */
    legendMagnitude: 0.55,
    /** …and get their own verse above this, or with deaths. */
    verseMagnitude: 0.7,
    minWitnesses: 3,
    /** At priest succession legends' numbers inflate by this range. */
    inflateMin: 1.3,
    inflateMax: 2.2,
    /** Nobody counts past this. */
    maxCount: 99,
    /** Doctrine verses of one belief type per chapter. */
    versesPerTypePerEra: 2,
    /** Fame (magnitude × witnesses) an omen family needs before it names the god. */
    nameFame: 12,
    /** A place gets a name after this many notable omens there (deaths or terrain count double). */
    placeOmens: 2,
  },

  warning: {
    floodInYears: 120,
    survivalToWin: 0.4,
    /** Faith collapse (a loss): mean love + fear below this for this many days in a row… */
    faithCollapseBelow: 0.03,
    faithCollapseDays: 24,
    /** …but not in the first years, while the village is still meeting its god. */
    faithGraceYears: 3,
  },

  flood: {
    /** Final sea level: this far over the east hill's top, at least this far over the valley… */
    aboveHill: 1,
    minAboveValley: 5,
    /** …and always at least this far under the ridge's peak. */
    belowRidgeTop: 6,
    /** Days for the sea to climb to its final height. */
    riseDays: 3,
    /** Rows of a new water layer filled per tick (spreads the work and the remeshing). */
    rowsPerTick: 16,
    /** Days after the peak before survival is judged. */
    settleDays: 1,
    /** Personal strength in a sacred place needed to run there when the water comes. */
    refugeTrust: 0.2,
  },

  /** How people feel about each other: fondness, grudges, affairs, feuds, killing. */
  society: {
    /** Feeling between partners, and between kin, before anything happens. */
    partnerStart: 0.6,
    kinStart: 0.4,
    /** Warmth gained from whoever you sit with at the fire. */
    fondPerEvening: 0.04,
    /** All feelings drift back toward nothing, this much a day. */
    bondFadePerDay: 0.006,
    /** Partners: a shared roof warms, time wears. */
    homeWarmth: 0.003,
    partnerStaleness: 0.006,
    quarrelGrudge: 0.15,
    theftGrudge: 0.2,
    /** Share of thefts where the victims learn who did it. */
    theftKnownChance: 0.5,
    /** An affair: cold toward one's partner, warm toward someone else. */
    affairColdBelow: 0.25,
    affairFondAbove: 0.3,
    affairChancePerDay: 0.05,
    affairExposePerDay: 0.06,
    affairFadePerDay: 0.03,
    exposureGrudgePartner: 0.5,
    exposureGrudgeLover: 0.7,
    exposureStanding: 0.1,
    breakupChance: 0.5,
    /** Feeling at or below which two people feud, then come to blows. */
    feudAt: -0.6,
    violenceAt: -0.8,
    feudQuarrelChance: 0.35,
    fightHurtChance: 0.4,
    hurtDays: 2,
    /** Chance a fight between bitter enemies ends in a death. */
    killChance: 0.015,
    /** The worst hatred may kill in secret. */
    ambushAt: -0.9,
    ambushChancePerDay: 0.0015,
    /** The victim's family against a known killer. */
    bloodGrudge: 0.9,
  },

  /** Peoples on a new sandbox island. */
  sandboxTribes: 3,

  /** War between peoples: how feelings drift, when they fight, how a raid goes. */
  war: {
    /** Villages closer than this chafe over land (more the closer). */
    nearDistance: 90,
    landFriction: 0.012,
    /** A people this short of food per head resents a neighbor with twice as much. */
    hungryBelow: 3,
    hungerFriction: 0.02,
    /** A different name for the god divides; the same one eases (half as much). */
    faithFriction: 0.006,
    /** Feelings ease back toward nothing, this share a day. */
    easePerDay: 0.01,
    /** A people born of a schism starts this bitter toward the one it left. */
    schismStart: -0.45,
    warAt: -0.6,
    peaceAt: -0.25,
    /** Feeling right after a peace. */
    afterPeace: -0.3,
    /** Each death in battle hardens it this much, and wearies both sides this much. */
    deathGrudge: 0.04,
    wearinessPerDeath: 0.1,
    peaceWeariness: 0.6,
    /** Fighting adults a people needs before it goes to war. */
    minFighters: 4,
    raidChancePerDay: 0.15,
    raidRestDays: 10,
    /** Share of a people's fighters that go, and the fewest. */
    partyShare: 0.25,
    partyMin: 3,
    /** Close enough to the enemy fire to begin; defenders come from this far. */
    arriveRadius: 8,
    defendRadius: 16,
    /** How long a fight lasts at most (ticks), and how close to strike. */
    fightTicks: 90,
    reach: 2.2,
    /** Chance per tick a raider in reach trades a blow; share of blows that kill (else wound). */
    blowChance: 0.035,
    killShare: 0.2,
    /** Defenders count this many times over (home ground). */
    homeAdvantage: 1.3,
    /** A party breaks off when this share of it is left. */
    breakAt: 0.65,
    /** Food each surviving raider carries off. */
    lootPerRaider: 6,
    burnChance: 0.4,
    /** A people down to this many is taken in by the neighbor it gets on with best. */
    absorbAtOrBelow: 2,
    /** A winning raid carries off this many of the enemy (children and the young first). */
    captivesMax: 2,
    captiveChance: 0.6,
    /** A beaten party's odds of snatching someone anyway, relative to a winning one's. */
    snatchShare: 0.15,
    /** Captives become one of their captors after this long; at peace, newer ones go home. */
    captiveYears: 2,
    /** Conquest: a people with this few fighters left, against an enemy this many times stronger, is beaten. */
    conquestFighters: 2,
    conquestRatio: 3,
    /** …absorbed by a conqueror that shares its god's name or doesn't hate it this much, else driven out. */
    driveOutBelow: -0.75,
    /** Alliances: two peoples this fond of each other, both bitter toward a third. */
    allyAt: 0.05,
    allyEnemyBelow: -0.45,
    /** Allies grow fonder each day; an alliance ends below this. */
    allyWarmth: 0.01,
    allyBreakBelow: -0.1,
    /** A raid's people pray for victory: the god's answer (harm to the enemy, or to them) shifts their faith and fight. */
    prayerDays: 3,
    answeredLove: 0.08,
    answeredRaidBoost: 2,
    spurnedWeariness: 0.25,
  },

  /** Leaving a ruined home: when the village gives up its site, and where it goes. */
  exodus: {
    /** Huts destroyed (share) that, with the god's hand in it, means home is lost. */
    ruinedShare: 0.6,
    /** How recently the god must have struck the village for ruin to count as a sign. */
    signDays: 3,
    /** A new home: this far from the old one at least, and at most. */
    minMove: 26,
    maxMove: 110,
    /** Flat within this radius (height spread at most flatSpread), fresh water within waterWithin. */
    flatRadius: 6,
    flatSpread: 2,
    waterWithin: 14,
    /** Years before they'll move again. */
    restYears: 1,
    /** No two villages closer than this. */
    apart: 30,
    /** Fewer than this can't found a people of their own (they leave the island instead). */
    minFounders: 6,
    /** A breakaway people settles this far from the village it left. */
    splitMin: 40,
    splitMax: 130,
    /** Peoples at the start of a game settle this far from the first. */
    startMin: 60,
    startMax: 200,
  },

  /** Village justice: accusation, the god's window, judgment at the fire, custom and law. */
  /** Boats: crowded peoples send settlers to the islets. */
  boats: {
    /** A people this big (and short of beds) may send settlers, at this chance a day, then rest this long. */
    crowdedAt: 22,
    chancePerDay: 0.04,
    restYears: 6,
    /** How many go. */
    settlers: 8,
    /** Voxels a tick afloat. */
    speed: 0.35,
    /** How the new people feel toward the one they left. */
    startFondness: 0.3,
    /** Days of food each settler carries (they have fields to plant first). */
    foodDays: 30,
    /** An islet whose settlers die out this soon is never tried again. */
    failedYears: 10,
  },

  /** How a people answers a cruel god (dread, great offerings, sacrifice, defiance, rivalry). */
  appease: {
    /** Dread added by one harmful omen: per death, per damaged home, per sick, per 10 rows of crops lost, plus a base. */
    harmPerDeath: 0.18,
    harmPerHome: 0.07,
    harmPerSick: 0.05,
    harmPerCrops: 0.05,
    baseHarm: 0.05,
    dreadDecayPerDay: 0.05,
    /** One omen this harmful is a disaster: a great offering, and news for the other peoples. */
    disasterAt: 0.25,
    /** Share of the food store given in a great offering, and to outdo a neighbor. */
    greatOfferingShare: 0.3,
    rivalOfferingShare: 0.12,
    offeringCalm: 0.15,
    /** At this dread the priest gives a person to the god. */
    sacrificeAt: 0.7,
    sacrificeCalm: 0.45,
    sacrificeRestDays: 6,
    sacrificeMinPeople: 8,
    /** Chance a grieving relative of someone the god killed stands up against it. */
    defyChance: 0.3,
    maxDefiers: 3,
    /** Fear (and love) taken from each listener per defier at the fire. */
    defierFearCure: 0.02,
    /** Fear given to those who see a defier struck down. */
    struckFear: 0.2,
    /** Days of no harm before a defier is proven right and another joins. */
    vindicatedDays: 4,
    /** Feeling toward a people the god struck (scorn) or blessed (envy), and dread at the neighbor's fate. */
    scorn: 0.08,
    envy: 0.04,
    neighborDread: 0.08,
  },

  justice: {
    /** Days between a wrong coming to light and judgment at the fire (the god's window). */
    windowDays: 1,
    /** Chance the wronged blame someone for an unseen theft (a killing is always blamed). */
    suspectChance: 0.3,
    /** They only accuse someone they already feel at least this badly about. */
    suspicionBelow: -0.1,
    /** Lightning, blight or a star this close to the accused is the god's sentence. */
    godStrikeRadius: 5,
    shameStanding: 0.2,
    flogDays: 2,
    /** The same sentence this many times for a crime becomes written law. */
    lawAfter: 3,
    /** Below murder, exile only for someone already found guilty this many times. */
    habitualAfter: 2,
    /** A sentence settles the wronged side's grudge this much... */
    settled: 0.3,
    /** ...and the punished one's family resents the accusers this much (more for exile, death). */
    familyResentment: 0.1,
  },

  /** Turning away (neglect): silence, a Doubter or a False Prophet, and schism. */
  dissent: {
    /** Days without a witnessed wonder before they notice the silence. */
    silenceDays: 12,
    /** Days of silence before someone speaks in the god's place. */
    leaderAfterDays: 24,
    /** Pull gained per evening at the fire when the leader speaks (followers alone: half). */
    spreadPerEvening: 0.12,
    /** Pull at or above this makes a follower. */
    followAt: 0.5,
    pullFadePerDay: 0.03,
    /** A witnessed wonder takes this much pull (× magnitude) from each witness. */
    wonderCure: 0.35,
    /** Doubters' beliefs fade this many times faster; their faith this much a day. */
    doubterDecay: 2,
    doubterFaithFade: 0.08,
    /** Doubters skip rites and get more done. */
    doubterYield: 1.25,
    /** A prophet's followers give the god this share of their faith (as Grace). */
    prophetGraceShare: 0.5,
    /** Lightning or a star this close to the prophet discredits them. */
    discreditRadius: 6,
    prophecyChancePerDay: 0.08,
    prophecyDays: 3,
    prophecyPull: 0.12,
    /** Followers (with the leader) as a share of adults that splits the village. */
    schismShare: 0.35,
    schismMinFollowers: 3,
    schismMinDays: 4,
    /** Loyal adults needed per follower to drive the leader out instead. */
    loyalPerFollower: 1.5,
    /** A split needs a faithful side: at least this many loyal adults, and this share. */
    schismMinLoyal: 3,
    schismMinLoyalShare: 0.2,
    /** Most of the village that can leave in a split. */
    maxLeaving: 0.35,
    /** Years before anyone new rises after a split (about a generation). */
    restAfterSplitYears: 25,
    /** Smaller villages hold together: too few to break apart. */
    schismMinPopulation: 24,
  },
} as const;

export type Tuning = typeof TUNING;
