export const CONFIG = {
  world: {
    laneCount: 3,
    laneWidth: 2,
    startSpeed: 18,
    maxSpeed: 40,
    speedGrowth: 6,
    speedRefDistance: 150,
    chunkLength: 40,
    chunkCount: 6,
    despawnBehindZ: -20,
  },
  player: {
    laneChangeSeconds: 0.12,
    jumpSeconds: 0.55,
    jumpHeight: 3.2,
    slamGravityMultiplier: 3.5,
    baseHalfWidth: 0.45,
    halfWidthPerSize: 0.11,
    baseHeight: 1.2,
    heightPerSize: 0.25,
    depth: 1.4,
  },
  avalanche: {
    threshold: 100,
    durationSeconds: 8,
    warningSeconds: 1.5,
    scoreMultiplier: 4,
    /** Soglie di carica per taglia 1..5 */
    sizeThresholds: [0, 20, 40, 60, 80],
    maxSize: 5,
    /** Taglia minima per sfondare tree/fence */
    smashMinSize: 3,
  },
  forgiveness: {
    enabled: true,
    minChargeRatio: 0.5,
    sizePenalty: 1,
  },
  pickups: {
    charge: { snowflake: 1, hay: 5, cow: 10 },
    sizeBonus: { snowflake: 0, hay: 0, cow: 1 },
  },
  score: {
    pointsPerUnit: 1,
    pickupBonus: { snowflake: 5, hay: 25, cow: 50 },
    smashBonus: 30,
    recordKey: 'rollingcows.record',
  },
  spawn: {
    /** Passo tra due "righe" generabili dentro un chunk */
    rowSpacing: 10,
    /** Probabilità che una riga contenga qualcosa, a difficoltà 0 e 1 */
    rowFillChanceMin: 0.35,
    rowFillChanceMax: 0.8,
    /** Numero massimo di corsie occupabili da ostacoli in una riga (deve restare >=1 libera) */
    maxBlockedLanes: 2,
    /** Distanza a cui la difficoltà raggiunge il massimo */
    difficultyRampDistance: 2500,
    pickupChance: 0.45,
    cowChance: 0.05,
    hayChance: 0.15,
  },
  render: {
    maxPixelRatio: 2,
    fogNear: 40,
    fogFar: 120,
    voxelPoolSize: 4000,
    voxelSize: 0.25,
    cameraBaseDistance: 9,
    cameraDistancePerSize: 0.9,
    cameraBaseFov: 60,
    cameraAvalancheFov: 78,
    shakeDecay: 4,
  },
  input: {
    swipeMinPixels: 24,
    swipeMaxMs: 400,
    bufferSeconds: 0.18,
  },
  perf: {
    lowFpsThreshold: 45,
    lowFpsSeconds: 3,
  },
} as const;
