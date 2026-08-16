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
    /** Zona franca davanti al giocatore alla partenza: nessuna entità nasce sotto questa z. */
    spawnSafeZ: 25,
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
    /** Durata della finestra di schiacciata a terra: quanto la mucca resta abbassata. */
    slamGroundSeconds: 0.25,
  },
  collisions: {
    /** Quanto si abbassa la mucca in schiacciata: dimezza l'altezza del box, il
     *  che la porta sotto la base del ramo sospeso (spawn.branchY) fino a taglia 5. */
    slamHeightRatio: 0.5,
    /** Ingombro verticale e in profondità di ogni tipo di entità. La larghezza
     *  non serve: deriva dalle corsie occupate (entityHalfWidth). */
    entityBox: {
      /** Masso basso e tozzo: si scavalca solo saltando. */
      rock: { height: 1.4, depth: 1.4 },
      /** Albero: troppo alto per essere saltato, va aggirato o sfondato da taglia 3. */
      tree: { height: 3, depth: 1.2 },
      /** Staccionata: bassa e sottile, il salto ci passa sopra comodamente. */
      fence: { height: 1.2, depth: 0.8 },
      /** Baita: muro invalicabile, profondo, che occupa due corsie. */
      cabin: { height: 3.5, depth: 4 },
      /** Crepaccio: praticamente piatto, quindi collide solo con chi è a terra;
       *  molto profondo, così va anticipato con il salto. */
      crevasse: { height: 0.1, depth: 3 },
      /** Ramo sospeso: base a spawn.branchY, spesso quanto una staccionata. */
      branch: { height: 1.2, depth: 0.8 },
      /** Fiocco di neve: piccolo, ma la raccolta è generosa. */
      snowflake: { height: 0.8, depth: 0.8 },
      /** Balla di fieno: cubo di un metro. */
      hay: { height: 1, depth: 1 },
      /** Altra mucca: stesse proporzioni del giocatore a taglia 1. */
      cow: { height: 1.4, depth: 1.6 },
    },
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
    /** Probabilità che la riga sia dominata da una cabin, a difficoltà 0 e 1. */
    cabinChanceBase: 0.1,
    cabinChancePerDifficulty: 0.12,
    /** Probabilità di un secondo ostacolo a terra, a difficoltà 0 e 1. */
    secondObstacleChanceBase: 0.2,
    secondObstacleChancePerDifficulty: 0.45,
    /** Probabilità di un ramo sospeso, a difficoltà 0 e 1. */
    branchChanceBase: 0.12,
    branchChancePerDifficulty: 0.2,
    /** Quota della base del ramo sospeso: sotto ci si passa con lo slam. */
    branchY: 1.6,
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
  audio: {
    /** Volume del bus principale: tutto passa di qui. */
    masterVolume: 0.35,
    mutedKey: 'rollingcows.muted',
    /** Durata del buffer di rumore bianco riusato da impatti e rombo. */
    noiseSeconds: 1,
    /** Muggito: sawtooth con portamento discendente. */
    moo: { startHz: 220, endHz: 110, seconds: 0.5, attackRatio: 0.12, gain: 0.9 },
    /** Impatto: rumore bianco passa-basso con decadimento rapido. */
    impact: { cutoffHz: 700, seconds: 0.28, gain: 1 },
    /** Raccolta: triangolare con salto di frequenza verso l'alto. */
    pickup: { lowHz: 620, highHz: 990, stepRatio: 0.35, seconds: 0.18, gain: 0.5 },
    /** Rombo della valanga: rumore filtrato in loop. */
    rumble: { cutoffHz: 380, maxGain: 0.8, riseSeconds: 0.4, fadeSeconds: 0.8, endingGainRatio: 0.4 },
  },
  perf: {
    lowFpsThreshold: 45,
    lowFpsSeconds: 3,
    /** Costante di tempo della media mobile degli FPS, in secondi. */
    smoothingSeconds: 0.5,
    /** Fattore applicato alle particelle quando la qualità viene abbassata. */
    lowQualityParticleScale: 0.35,
    /** Ogni quanti secondi loggare draw call e triangoli in console. */
    statsLogSeconds: 5,
  },
  feel: {
    /** Rallentatore alla morte: quanto dura e quanto rallenta. */
    deathSlowSeconds: 0.8,
    deathTimeScale: 0.35,
    /** Ampiezza dello scuotimento di camera per i vari eventi. */
    impactShake: 0.7,
    avalancheShake: 1.1,
    deathShake: 1.6,
    /** Potenza dell'esplosione di cubetti. */
    deathBurstPower: 9,
    smashBurstPower: 6,
  },
} as const;
