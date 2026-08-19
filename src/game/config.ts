export const CONFIG = {
  world: {
    trackWidth: 4,
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
  path: {
    /** Distanza laterale di ciascun ramo dal centro durante un bivio. */
    branchSeparation: 6,
    /** A che distanza il bivio diventa visibile. */
    previewZ: 90,
    /** Punto di non ritorno, in unità prima della biforcazione. */
    commitZ: 12,
    /** Durata del riallineamento del ramo scelto verso il centro. */
    realignSeconds: 0.6,
    /** Per quanto vale una scelta anticipata: uno swipe laterale dato fuori
     *  dalla finestra di avvicinamento non fa nulla, ma viene ricordato per
     *  questo tempo e, se il bivio compare entro tale finestra, vale come
     *  scelta già data (design §4). */
    earlyChoiceSeconds: 0.6,
    /** Distanza del PRIMISSIMO bivio di una corsa, diversa da minGap: a
     *  minGap (120 unità, ~6,5 s a velocità di partenza) il giocatore deve
     *  superare tre ostacoli prima di vedere un bivio, e spesso muore prima
     *  di arrivarci. A 55 unità (~3 s) la meccanica dei bivi si incontra
     *  quasi subito. Vale SOLO per il bivio con cui si apre la corsa: quelli
     *  successivi tornano a usare minGap/gapPerSpeed (vedi la chiusura del
     *  riallineamento in path.ts). */
    firstForkIn: 55,
    /** Distanza minima fra due bivi, a velocità di partenza. */
    minGap: 120,
    /** Quanto la distanza minima cresce con la velocità (unità per u/s). */
    gapPerSpeed: 6,
  },
  player: {
    jumpSeconds: 0.55,
    jumpHeight: 3.2,
    slideSeconds: 0.55,
    /** Fattore di schiacciamento della sagoma e del modello in scivolata. */
    slideHeightRatio: 0.45,
    diveGravityMultiplier: 3.5,
    /** Altezza della sagoma di collisione a taglia 0, in unità di mondo; la
     *  sagoma reale è baseHeight + heightPerSize * taglia.
     *
     *  Questi due numeri sono vincolati da DUE lati e non si tarano a
     *  sentimento (design §6, "l'azione richiesta non cambia mai con la
     *  taglia"):
     *  - a taglia 1 la mucca IN PIEDI deve toccare un ostacolo sospeso:
     *    baseHeight + heightPerSize > spawn.overheadY (1.75 > 1.6). Con i
     *    valori precedenti (1.2 + 0.25 = 1.45) la mucca piccola passava sotto
     *    ai sospesi restando in piedi, quindi ramo, arco e cornicione erano
     *    innocui fino alla taglia 2;
     *  - a taglia 5 la mucca IN SCIVOLATA deve passarci sotto:
     *    (baseHeight + 5 * heightPerSize) * slideHeightRatio < overheadY
     *    (2.75 * 0.45 = 1.24 < 1.6).
     *  1.75 a taglia 1 è anche l'altezza vera del modello voxel della mucca
     *  (7 cubetti da render.voxelSize): la sagoma ora coincide con ciò che si
     *  vede, invece di essere più bassa di un terzo. */
    baseHeight: 1.5,
    heightPerSize: 0.25,
    depth: 1.4,
  },
  collisions: {
    /** Ingombro verticale e in profondità di ogni tipo di entità. La X è sparita:
     *  senza corsie, le collisioni si riducono a distanza e quota (vedi
     *  game/collisions.ts). */
    entityBox: {
      /** Masso basso e tozzo: si scavalca solo saltando. */
      rock: { height: 1.4, depth: 1.4 },
      /** Tronco caduto: più basso del masso, stessa azione. */
      log: { height: 1.0, depth: 1.2 },
      /** Staccionata: bassa e sottile, il salto ci passa sopra comodamente. */
      fence: { height: 1.2, depth: 0.8 },
      /** Crepaccio: praticamente piatto, quindi colpisce solo chi è a terra;
       *  molto profondo, così va anticipato con il salto. */
      crevasse: { height: 0.1, depth: 4 },
      /** Ramo di abete sospeso: base a spawn.overheadY, spesso quanto una
       *  staccionata. */
      branch: { height: 1.2, depth: 0.8 },
      /** Arco di roccia sospeso: più alto del ramo. */
      arch: { height: 1.4, depth: 1.0 },
      /** Cornicione di ghiaccio sospeso: il più ingombrante dei tre. */
      cornice: { height: 1.6, depth: 1.2 },
      /** Fiocco di neve: piccolo, ma la raccolta è generosa. */
      snowflake: { height: 0.8, depth: 0.8 },
      /** Cristallo di ghiaccio: cubo di un metro. */
      crystal: { height: 1, depth: 1 },
      /** Stella: cubo di un metro. */
      star: { height: 1, depth: 1 },
      /** Calamita: cubo di un metro. */
      magnet: { height: 1, depth: 1 },
      /** Campanaccio: cubo di un metro. */
      bell: { height: 1, depth: 1 },
    },
  },
  avalanche: {
    threshold: 100,
    durationSeconds: 4.5,
    warningSeconds: 1,
    scoreMultiplier: 5,
    /** Soglie di carica per taglia 1..5 */
    sizeThresholds: [0, 20, 40, 60, 80],
    maxSize: 5,
    /** Taglia minima per sfondare gli ostacoli durante la valanga */
    smashMinSize: 3,
  },
  forgiveness: {
    enabled: true,
    /** Il primissimo impatto di ogni corsa è perdonato indipendentemente
     *  dalla carica: a inizio corsa la carica è sempre zero, quindi
     *  minChargeRatio non è mai soddisfatto e il primo errore chiuderebbe
     *  sempre la corsa mentre il giocatore sta ancora imparando i comandi.
     *  Vale una volta sola per corsa esattamente come il perdono normale
     *  (stesso `forgivenessUsed`, stessa penalità): questo flag toglie solo
     *  il requisito di carica per quella prima occasione. */
    firstHitFree: true,
    minChargeRatio: 0.5,
    sizePenalty: 1,
  },
  pickups: {
    /** Carica data da ogni raccoglibile. star/magnet/bell non danno carica: il
     *  loro effetto è lo stato di buff che attivano, non un numero (vedi
     *  game/buffs.ts, task successivo). */
    charge: { snowflake: 4, crystal: 20, star: 0, magnet: 0, bell: 0 },
  },
  buffs: {
    starSeconds: 8,
    starMultiplier: 2,
    magnetSeconds: 8,
    /** Raggio entro cui la calamita raccoglie i fiocchi. */
    magnetRangeZ: 14,
  },
  score: {
    pointsPerUnit: 1,
    // Bonus in punti per raccolta, indipendenti dalla carica che il pickup dà
    // alla valanga (quella è in pickups.charge). Non specificati dal
    // contratto: scelti qui in ordine di rarità (design doc §7), campanaccio
    // (il più raro) in cima.
    pickupBonus: { snowflake: 5, crystal: 15, star: 20, magnet: 20, bell: 30 },
    smashBonus: 30,
    recordKey: 'rollingcows.record',
  },
  spawn: {
    /** Passo minimo fra due ostacoli consecutivi, in unità. */
    minObstacleGap: 26,
    maxObstacleGap: 48,
    /** Lunghezza di una fila di fiocchi. */
    trailMin: 6,
    trailMax: 10,
    /** Passo fra due fiocchi della stessa fila. */
    trailSpacing: 3,
    /** Altezza dell'apice di una fila ad arco. */
    trailArcHeight: 3,
    difficultyRampDistance: 2500,
    overheadY: 1.6,
    /** Probabilità che dopo un ostacolo nasca un buff, sul RAMO RICCO di un bivio. */
    buffChance: 0.22,
    /** Stessa probabilità sul tronco e sul ramo sgombro. Più bassa, ma non
     *  zero: con i buff confinati al ramo ricco il cristallo — che il design §7
     *  vuole "comune, a terra sul tracciato" — non nascerebbe mai fuori da un
     *  bivio, e metà del contenuto del gioco resterebbe legata a un evento che
     *  capita una volta ogni ~10 secondi. */
    commonBuffChance: 0.1,
    /** Peso relativo dei buff quando ne esce uno sul ramo ricco. */
    buffWeights: { crystal: 6, star: 3, magnet: 3, bell: 1 },
    /** Pesi sul tronco e sul ramo sgombro: domina il cristallo (comune) e il
     *  campanaccio ha peso zero, perché il design lo vuole solo nel "ramo
     *  difficile di un bivio". */
    commonBuffWeights: { crystal: 8, star: 2, magnet: 2, bell: 0 },
  },
  render: {
    maxPixelRatio: 2,
    // Nebbia spostata più lontano insieme alla camera rialzata (vedi
    // render/camera-rig.ts, CAMERA_HEIGHT_RATIO): a fogNear=40 il pendio
    // sbiancava proprio dove iniziava a leggersi un ostacolo lontano, lasciando
    // meno di un secondo di preavviso a velocità di crociera.
    fogNear: 75,
    fogFar: 200,
    voxelPoolSize: 4000,
    voxelSize: 0.25,
    cameraBaseDistance: 9,
    cameraDistancePerSize: 0.9,
    cameraBaseFov: 60,
    cameraAvalancheFov: 78,
    shakeDecay: 4,
    /** Quanto il terreno si estende oltre il tracciato giocabile (banchi
     *  inclusi), per lato. Con fov 60 e camera a ~9 unità di distanza il
     *  frustum è largo circa 26 unità a z=40 e 64 a z=120: senza questo
     *  margine, sotto ai banchi laterali (sospesi, base a y≈-1) si vedeva il
     *  cielo. Il corridoio giocabile (vedi world.trackWidth) resta invariato:
     *  questo numero allarga solo ciò che sta oltre il tracciato. */
    groundExtraWidth: 220,
    /** Oltre questa distanza laterale dal corridoio (in unità di CORRIDOR_HALF)
     *  il rilievo procedurale del terreno smette di crescere e resta un pendio
     *  pieno: senza un tetto, il termine quadratico dell'ondulazione produce
     *  altezze assurde ai bordi di una mesh larga groundExtraWidth.
     *  A 6 (precedente) il tetto era ~80 unità: pareti di neve alte 50 volte
     *  la mucca, che nascondevano gli ostacoli lontani invece di lasciarli
     *  stagliare contro il cielo. A 1.2, con i coefficienti di
     *  render/terrain.ts (displaceGround), il tetto reale è ~3.8 unità: una
     *  conca larga e bassa, non più una gola. Vedi anche render.backdrop.*BaseY,
     *  che assumono questo tetto come altezza massima plausibile del pendio. */
    groundMaxLateralRise: 1.2,
    /** Altezza e posizione verticale (base) dei banchi laterali: la base deve
     *  restare sempre sotto il punto più basso plausibile del pendio adiacente
     *  (≈0, il pavimento del corridoio: vedi displaceGround, che a distanza
     *  laterale nulla vale sempre 0), qualunque sia l'ondulazione in quel
     *  punto, altrimenti si vede la sua base fluttuare nel vuoto. L'altezza è
     *  stata dimezzata rispetto a prima (8) insieme al ribasso del pendio
     *  (groundMaxLateralRise): un banco alto 8 unità accanto a un pendio alto
     *  al più 3.8 sembrava un muro slegato dal paesaggio. bankBottomY è stato
     *  alzato di conseguenza (non più -6) perché il TETTO del banco
     *  (bankBottomY + bankHeight) resti comunque sopra il pendio vicino invece
     *  di sprofondarci sotto e sparire. */
    bankHeight: 2.5,
    bankBottomY: -0.5,
    /** Sfondo lontano (creste innevate + fondovalle con un paese), ancorato
     *  alla camera sul piano orizzontale (vedi render/backdrop.ts): non è mai
     *  raggiungibile e non scorre via con i chunk del pendio. */
    backdrop: {
      /** Seed fisso: stesso panorama a ogni avvio. Mai Math.random, per lo
       *  stesso motivo di ogni altra generazione procedurale del progetto. */
      seed: 0x8a1e5eed,
      /** Piani di creste, dal più vicino (più saturo) al più lontano (più
       *  chiaro e desaturato): dà la prospettiva atmosferica. */
      ridgeLayers: 3,
      /** Profondità (oltre la camera, lungo z) del primo piano di creste. */
      ridgeBaseDistance: 150,
      /** Passo in profondità fra un piano di creste e il successivo. */
      ridgeLayerSpacing: 35,
      /** Picchi per cresta (vedi generateRidgeProfile). */
      ridgeSegments: 18,
      /** Larghezza del piano più vicino: i piani più lontani scalano con la
       *  distanza, per restare larghi quanto il FOV massimo (avalancheFov). */
      ridgeWidth: 480,
      /** Altezza di un picco sopra ridgeBaseY, PER IL PIANO PIÙ VICINO: i
       *  piani più lontani scalano con la distanza (come ridgeWidth), non
       *  restano fissi, altrimenti a distanza le creste rimpicciolirebbero
       *  fino a un filo. Tarata sul frustum reale (fov verticale 60°/78°,
       *  camera inclinata di CAMERA_HEIGHT_RATIO=0.68, vedi camera-rig.ts):
       *  nel caso peggiore (taglia massima, fov base 60°, quindi il minor
       *  margine sopra l'orizzonte) il picco più alto arriva a ~9.3° sopra
       *  l'orizzonte, contro un margine disponibile di ~11.6° prima del
       *  bordo dello schermo. Con 46 (valore precedente) il picco arrivava a
       *  oltre 30°: ben fuori dall'inquadratura, si vedevano solo due
       *  triangoli tagliati agli angoli. */
      ridgePeakHeight: 22,
      /** Variazione casuale (±) dell'altezza di ogni picco (anche questa
       *  scala per piano insieme a ridgePeakHeight). */
      ridgePeakVariance: 5,
      /** Quota della base delle creste. Deve restare sopra il rilievo
       *  massimo del pendio (render.groundMaxLateralRise, ≈3.8 unità con i
       *  coefficienti attuali di displaceGround) con un margine di
       *  sicurezza: il pendio è opaco e più vicino della camera, quindi
       *  qualunque cosa stia sotto la sua altezza massima in qualunque punto
       *  del corridoio o dei suoi bordi finirebbe nascosta dietro di esso,
       *  invisibile. Con questo valore la base delle creste cade comunque
       *  appena sotto la linea dell'orizzonte (fra -0.3° e -1.4° a seconda
       *  della taglia), come una vera catena che emerge dalla valle. */
      ridgeBaseY: 5,
      /** Colore del piano di creste più vicino (verso la cima: la base è
       *  sfumata verso hazeColor, vedi ridgeHazeMix). */
      ridgeColorNear: 0x7897ab,
      /** Colore del piano di creste più lontano: quasi bianco, prospettiva
       *  atmosferica. */
      ridgeColorFar: 0xe6eef4,
      /** Colore della foschia: STESSO valore di FOG_COLOR in render/scene.ts
       *  (duplicato apposta, non importato: sono due moduli indipendenti, e
       *  il vincolo è "sembra la stessa foschia", non una dipendenza fra
       *  file). Usato per sfumare verso il nulla sia la base delle creste sia
       *  il bordo vicino del fondovalle, così il punto dove il pendio
       *  (sbiancato dalla nebbia del corridoio) incontra lo sfondo non è più
       *  un bordo netto fra due colori pieni. */
      hazeColor: 0xdfeeff,
      /** Quanto la base di ogni cresta è tinta di foschia (0 = colore pieno
       *  fino in fondo, 1 = tutta foschia): sfuma la cresta invece di
       *  lasciarla un blocco di colore piatto che stacca di netto dal resto. */
      ridgeHazeMix: 0.55,
      /** Quota del fondovalle: stessa ragione di ridgeBaseY, sopra il
       *  rilievo massimo del pendio. Con la taglia minima (camera più bassa)
       *  resta comunque sotto la linea dell'orizzonte (vedi village.*). */
      valleyY: 5,
      /** Profondità e ampiezza in z del fondovalle (fra la camera e le
       *  creste): il bordo lontano (valleyDistance + valleyDepth = 215) resta
       *  volutamente entro l'ultimo piano di creste (ridgeBaseDistance +
       *  2 * ridgeLayerSpacing = 220), così il fondovalle non sporge oltre le
       *  montagne più lontane. */
      valleyDistance: 90,
      valleyDepth: 125,
      /** Larghezza del fondovalle. */
      valleyWidth: 620,
      /** Colore del fondovalle nella parte lontana (verso le creste): il
       *  bordo vicino (verso la camera) è invece sfumato a hazeColor, così
       *  non c'è un bordo netto contro il pendio innevato in primo piano. */
      valleyColor: 0xc7d8e2,
      village: {
        /** Numero di case: una di queste (scelta dall'rng) diventa il
         *  campanile. */
        houseCount: 9,
        /** Semi-ampiezza dell'area occupata dal villaggio nel fondovalle. */
        spread: 22,
        /** Profondità del centro del villaggio. */
        distance: 110,
        /** Altezza ASSOLUTA (in unità di mondo) di una casa, non uno
         *  scalare: piccola apposta e sopra tutto tarata perché la cima resti
         *  sotto la linea dell'orizzonte a qualunque taglia della camera (il
         *  caso peggiore è la taglia minima, camera più bassa: qui la cima
         *  della torre più alta del villaggio deve restare sotto tutti e
         *  due), altrimenti il paese "galleggia" sulla linea dell'orizzonte
         *  come un adesivo invece di leggersi come appoggiato nel fondovalle,
         *  molto lontano e molto in basso. */
        houseHeight: 0.35,
        /** Altezza assoluta del campanile (stessa unità di houseHeight, non
         *  più un moltiplicatore): resta il più alto del villaggio ma non si
         *  avvicina neanche lontanamente alla scala delle creste. */
        towerHeight: 0.8,
        /** Colore pareti: freddo e desaturato, un registro visivo diverso da
         *  quello vivace degli ostacoli. */
        wallColor: 0xcdd6de,
        /** Colore tetti: blu-grigio spento. Deliberatamente NON il rosso
         *  saturo del tetto della baita (models.ts, ROOF = 0xb43a3a):
         *  altrimenti i tetti del paese si confonderebbero a colpo d'occhio
         *  con un ostacolo. */
        roofColor: 0x6c7f91,
      },
    },
    /** Oggetti decorativi ai lati del tracciato: non sono entità di gioco, non
     *  collidono mai e non devono MAI entrare nel corridoio giocabile. */
    scenery: {
      itemsPerChunk: 7,
      /** Distanza laterale minima dal centro: deve restare ben oltre il bordo
       *  del corridoio (world.trackWidth / 2) perché non si confonda con un
       *  ostacolo da schivare. */
      minLateral: 9,
      maxLateral: 46,
      /** Peso relativo dei tre modelli decorativi. */
      weights: { tree: 7, cabin: 2, hay: 3 },
      minScale: 0.8,
      maxScale: 1.6,
    },
    /** Inclinazione "da cartone animato" con cui si legge un bivio: il mondo
     *  (pendio, entità, sfondo) ruota attorno alla mucca invece di scivolare
     *  di lato in blocco, e la mucca stessa si piega sul fianco mentre la
     *  camera aggiunge un lieve rollio all'orizzonte (vedi render/curve.ts).
     *  Puramente estetico e a somma zero: tutti e tre tornano esattamente a 0
     *  alla chiusura del bivio, l'allineamento geometrico resta compito della
     *  traslazione path.offsetX che già esisteva. Gradi, non radianti: sono
     *  numeri pensati per essere letti e tarati a occhio. */
    curve: {
      /** Rotazione di picco del gruppo-mondo (pendio+entità+sfondo) al
       *  culmine della curva. Voluta esagerata ("sopra le righe"): un
       *  bivio reale sposta il tracciato di soli branchSeparation=6 unità,
       *  ma la vecchia traslazione pura senza rotazione si leggeva come un
       *  errore di rendering, non come una svolta. */
      maxWorldTiltDeg: 38,
      /** Inclinazione di picco della mucca sul fianco, sullo stesso verso
       *  della rotazione del mondo (si piega DENTRO la curva, come una moto
       *  o uno sciatore). Volutamente vistosa: è il dettaglio che vende
       *  l'idea "sono io a curvare", non il mondo che scivola. */
      maxPlayerTiltDeg: 32,
      /** Rollio di picco della camera: leggero apposta, un tocco che inclina
       *  l'orizzonte senza disorientare (a differenza dei due angoli sopra,
       *  che possono permettersi di essere marcati perché non toccano mai
       *  l'inquadratura in sé). */
      maxCameraRollDeg: 9,
    },
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
    /** Cristallo di ghiaccio: carica in un colpo, quindi un timbro breve e
     *  netto — lo stesso "zap" acuto usato come base per gli altri buff, qui
     *  al suo taglio più corto e diretto. */
    chime: { lowHz: 900, highHz: 1400, seconds: 0.22, gain: 0.55 },
    /** Stella: raddoppia i punti per 8 secondi, quindi un timbro che
     *  "festeggia" con due note ascendenti invece di una sola — più lungo e
     *  più mosso del semplice zap del cristallo, per farlo sentire più raro. */
    sparkle: { lowHz: 700, midHz: 1100, highHz: 1700, noteSeconds: 0.1, gain: 0.5 },
    /** Calamita: attira i fiocchi per 8 secondi. Un'onda sinusoidale che
     *  scende invece di salire — l'opposto timbrico del cristallo/stella —
     *  per suggerire l'attrazione verso il basso/verso il centro piuttosto
     *  che uno scatto verso l'alto. */
    magnetPull: { highHz: 1200, lowHz: 500, seconds: 0.24, gain: 0.5 },
    /** Campanaccio: dà lo scudo. Deve suonare come un vero campanaccio, non
     *  come gli altri tre buff — due parziali NON armoniche (fondamentale +
     *  un rapporto non intero) con un decadimento percussivo rapido, la
     *  tecnica minima per un timbro "di metallo" invece che un tono puro. */
    cowbell: { fundamentalHz: 520, overtoneRatio: 2.4, seconds: 0.4, gain: 0.6 },
    /** Comparsa di un bivio: il momento in cui bisogna alzare lo sguardo.
     *  Un richiamo breve e distinto da tutti i suoni di raccolta. */
    forkAppear: { lowHz: 500, highHz: 750, seconds: 0.16, gain: 0.4 },
    /** Lo scudo che assorbe un colpo: rumore passa-alto, un "crac" cristallino
     *  distinto dal tonfo sordo passa-basso di un impatto normale
     *  (CONFIG.audio.impact). */
    shieldBreak: { cutoffHz: 1600, seconds: 0.35, gain: 0.7 },
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
    /** Tetto al contributo di UN SINGOLO campione (in secondi), sia nel monitor
     *  sia nel clamp lato main.ts prima di passargli il dt reale: senza questo,
     *  il primo frame dopo una tab sospesa vale l'intera durata della pausa e da
     *  solo supera lowFpsSeconds, spegnendo ombre e particelle per sempre su un
     *  dispositivo che non è mai stato lento. */
    maxSampleSeconds: 0.1,
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
    /** Scuotimento leggero alla raccolta di un buff: meno di un impatto, è
     *  un premio, non un colpo. */
    buffShake: 0.4,
  },
} as const;
