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
    /** A che distanza il bivio diventa visibile. Alzato da 90: a 90 la
     *  biforcazione nasceva dentro la nebbia (che ora inizia a
     *  render.fogNear=95) e il contenuto dei rami si leggeva già sbiancato.
     *  A 110 nasce appena fuori, nella zona nitida. */
    previewZ: 110,
    /** Punto di non ritorno, in unità prima della biforcazione. Alzato da 12:
     *  a 12 unità la fase impegnata durava 0,30 s a velocità massima, cioè il
     *  passaggio da "posso ancora cambiare" a "sono impegnato" era
     *  impercettibile e coincideva con l'inizio della piegata — il feedback
     *  della scelta arrivava quando la scelta non era più modificabile. A 24
     *  la fase impegnata dura 0,60 s e la piegata parte visibilmente PRIMA
     *  della biforcazione.
     *
     *  DA QUANDO L'INDECISIONE COSTA LA CORSA (design §4, regola nuova: chi
     *  non sceglie va dritto contro il cartello) questo non è più solo il
     *  punto in cui la scelta smette di essere reversibile, è la SCADENZA:
     *  chi arriva qui senza avere scelto non prende alcun ramo e si schianta
     *  contro il cartello 24 unità più avanti.
     *
     *  Non è più anche l'estremo INFERIORE della finestra di scelta, che ora
     *  è a tempo: vedi `choiceWindowSeconds`, che è il numero da muovere se
     *  la finestra si rivelasse stretta. Restano invece 24 unità — da 0,52 a
     *  0,60 s — fra qui e il cartello: non tempo di decisione, ma il
     *  preavviso che rende la morte leggibile invece che improvvisa. */
    commitZ: 24,
    /**
     * Per quanto TEMPO la scelta resta aperta, prima del punto di non ritorno.
     *
     * La visibilita' del bivio e la possibilita' di sceglierlo erano la stessa
     * cosa, e non dovevano esserlo. La Y del tracciato si vede arrivare da
     * `previewZ` = 110 unita' perche' serve leggere il terreno e preparare la
     * manovra; ma 110 unita' sono una DISTANZA, e una distanza fissa dura
     * tempi diversi a velocita' diverse. La finestra di scelta ne usciva
     * lunga 2,15 s al tetto di "Normale" e **4,78 s a velocita' di partenza**:
     * cinque secondi con un bivio fermo davanti e una decisione binaria gia'
     * presa da un pezzo. Il proprietario lo ha descritto cosi': «devo poter
     * scegliere solo a ridosso del bivio con un minimo di buffer, non ore
     * prima».
     *
     * La finestra si apre quindi quando `forkZ <= commitZ + speed * questo
     * numero`, ed e' l'unica soglia del bivio espressa in tempo: dura uguale a
     * qualunque velocita', che e' esattamente cio' che serviva.
     *
     * 2,0 s. Il tetto vero e' il minimo fra questo e cio' che `previewZ`
     * concede, perche' non si puo' aprire la scelta su un bivio che non si
     * vede ancora: il pareggio e' a (110 − 24) / 2 = 43 u/s, quindi sotto i 43
     * u/s comanda questo numero e sopra comanda `previewZ`. In pratica: 2,00 s
     * per tutti i profili tranne "Toro" vicino al suo tetto, dove restano gli
     * 1,87 s di prima. Il cambio quindi ACCORCIA solo dove era troppo lungo e
     * non tocca il caso gia' stretto.
     *
     * Non e' tempo dedicato solo a decidere: dentro quella finestra si
     * continua a saltare e scivolare (a 46 u/s ci passano ~3,5 ostacoli).
     * Misurato con un pilota automatico che gioca gli ostacoli e ritarda la
     * scelta di R secondi, il ritardo massimo tollerato e' riportato nei test
     * (game/run-simulation.test.ts): e' il margine vero, non i 2,0 nominali.
     */
    choiceWindowSeconds: 2,
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
    /** Il primo tratto di OGNI ramo, subito dopo la biforcazione, nasce
     *  sgombro per questa distanza. Non è una scelta estetica: il ramo scelto
     *  diventa solido al punto di non ritorno, ma la traslazione laterale
     *  parte solo quando la biforcazione arriva a z=0 e dura realignSeconds.
     *  Nel frattempo un ostacolo del ramo — disegnato a branchSeparation di
     *  lato, cioè fino a 6 unità fuori da un corridoio largo 4 — era già
     *  letale. Misurato prima di questa zona franca: 3,43% degli ostacoli
     *  uccideva mentre era disegnato fuori pista, l'unica classe di morte che
     *  il giocatore non poteva né prevedere né imparare.
     *
     *  Il valore copriva il caso peggiore della traslazione a tempo (velocità
     *  massima per tutta la durata del riallineamento: 40 * 0,6 = 24 unità).
     *  Ora la traslazione segue la geometria del bivio e la mucca resta
     *  esattamente al centro del proprio nastro in ogni frame (vedi
     *  game/path.ts, branchSpreadAt), quindi la morte "fuori pista" non
     *  dipende più da questo numero. Le 24 unità restano perché continuano a
     *  servire per due motivi indipendenti: nelle prime unità dopo la
     *  biforcazione i due nastri sono ancora quasi sovrapposti e un ostacolo
     *  lì dentro non si leggerebbe come appartenente all'uno o all'altro
     *  ramo; e la vista disegna le entità di ramo a branchOffsetX pieno senza
     *  applicare l'apertura (vedi render/entities-view.ts), approssimazione
     *  che regge solo dove l'apertura è quasi completa — a 24 unità su
     *  forkBlendZ = 28 vale 0,944, cioè 0,34 unità di errore. */
    branchClearanceAfterFork: 24,
    /** Su quante unità dopo la biforcazione i due nastri della pista si
     *  aprono da coincidenti a ±branchSeparation (smoothstep, vedi
     *  game/path.ts, branchSpreadAt). Senza questa transizione il centro
     *  salta di 6 unità in una sola riga di geometria e il bivio si legge
     *  come due piste parallele comparse di fianco alla propria, non come una
     *  Y. Il rapporto ~1:4,7 fra separazione e lunghezza è quello di uno
     *  svincolo reale.
     *
     *  Governa anche la DURATA del riallineamento, che non è più un tempo a
     *  sé (c'era un realignSeconds: 0,6, rimosso) ma questa stessa distanza:
     *  il bivio si chiude quando la mucca ha percorso forkBlendZ unità oltre
     *  la biforcazione, cioè quando il ramo scelto è davvero arrivato al
     *  centro. Erano due curve diverse per la stessa cosa e divergevano fino
     *  a 4,01 unità — la mucca fuori dal proprio nastro, che è il difetto
     *  visivo per cui questa unificazione esiste. In tempo: 1,55 s a velocità
     *  di partenza, 0,70 s a velocità massima. Se un giorno la piegata
     *  sembrasse troppo lunga a bassa velocità, la leva NON è accorciare la
     *  traslazione (si tornerebbe esattamente al difetto) ma accorciare lo
     *  svincolo: congelare all'apertura del bivio un blendZ proporzionale
     *  alla velocità e tenerlo in PathState. */
    forkBlendZ: 28,
  },
  player: {
    jumpSeconds: 0.55,
    jumpHeight: 3.2,
    /** Alzata da 0,55. Il salto ha una finestra utile simmetrica attorno
     *  all'apice; la scivolata parte istantanea, quindi copre 0,55 s in avanti
     *  e ZERO all'indietro: perdona chi anticipa e non perdona chi reagisce.
     *  Misurato con un modello di giocatore che reagisce invece di anticipare
     *  sui sospesi, le morti erano 60 su 60 proprio su ramo/arco/cornicione.
     *  0,70 s allarga la tolleranza e resta sotto il vincolo di spaziatura:
     *  0,70 × maxSpeed = 28 < spawn.minObstacleGap = 30, quindi l'invariante
     *  di giocabilità continua a non essere il termine che morde. */
    slideSeconds: 0.7,
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
      /**
       * CREPACCIO VERO: non una crepa da scavalcare ma un buco in cui si
       * precipita (vedi types.ts, `isUnforgiving`, e game.ts, hitObstacle).
       * Stessa altezza simbolica del crepaccio piatto — un buco "colpisce"
       * solo chi sta a terra, e nemmeno la scivolata aiuta, perché schiaccia
       * la sagoma senza alzarne la base — ma largo 7 invece di 4: è la
       * LARGHEZZA a farne un buco e non una fenditura.
       *
       * I CONTI DI SUPERABILITÀ, che qui non sono una formalità perché 7
       * unità sono quasi il doppio dell'ostacolo più profondo del gioco.
       * Il salto è y(t) = 4·h·u·(1−u) con u = t/T, h = player.jumpHeight =
       * 3,2 e T = player.jumpSeconds = 0,55 (vedi player.ts).
       *
       * 1. Quanto si sta sopra il bordo: y ≥ 0,1 quando u·(1−u) ≥ 0,0078125,
       *    cioè u ∈ [0,0079; 0,9921] → 0,9843·0,55 = 0,5414 s.
       * 2. Quanto si sta sopra il buco: la finestra di collisione in z è
       *    player.depth + depth = 1,4 + 7 = 8,4 unità, percorse in 8,4/v.
       * 3. Serve dunque v ≥ 8,4 / 0,5414 = 15,5 u/s. NOTARE IL VERSO: per un
       *    ostacolo largo e piatto il nemico è la velocità BASSA, non quella
       *    alta — più si corre, meno tempo si passa sospesi sul vuoto. È il
       *    contrario di tutto il resto del gioco, ed è la ragione per cui il
       *    crepaccio è riservato alla rampa tardiva (spawn.chasmChanceLate):
       *    a `spawn.lateRampStart` = 5000 unità la velocità vale almeno 28
       *    u/s (il tetto di "Vitellino"; "Normale" 39,2, "Toro" 43,2), cioè
       *    l'80% sopra il minimo necessario.
       * 4. Margine residuo per sbagliare il tempo del salto: 0,241 s a 28
       *    u/s, 0,331 s a 40, 0,359 s a 46. Per confronto, il MASSO — che
       *    nessuno considera ingiusto — ne lascia 0,344 a 40 u/s. Il
       *    crepaccio è quindi tarato sulla stessa difficoltà di timing di un
       *    masso, non su una più severa.
       * 5. Concatenamento con l'ostacolo successivo, cioè l'invariante di
       *    giocabilità: l'atterraggio più precoce che permette di superarlo
       *    cade a T/2 − (0,5414 − 8,4/v)/2 dal suo passaggio, che a 46 u/s
       *    vale 0,096 s, contro gli 0,098 s del masso. Il crepaccio libera la
       *    mucca appena PRIMA di un masso: `jumpSeconds × maxSpeed` resta il
       *    termine giusto dell'invariante, e la coppia stretta non ha bisogno
       *    di trattarlo diversamente.
       */
      chasm: { height: 0.1, depth: 7 },
      /**
       * CARTELLO DEL BIVIO, con le due frecce verso i due rami. Non nasce
       * dallo spawner: lo piazza il bivio nel cuneo fra i due nastri, ed è
       * solido solo finché nessuno ha scelto (vedi path.ts, signpostIsSolid).
       *
       * ALTEZZA — è il numero che regge tutta la regola nuova, e va scritto
       * il conto. `player.jumpHeight` = 3,2 è l'apice della BASE della sagoma
       * della mucca: più in alto di così la base non arriva mai, a nessuna
       * velocità, a nessuna taglia e con nessuna gravità (il tuffo abbassa
       * l'apice, non lo alza). Con il cartello alto 3,6 le due sagome si
       * sovrappongono in quota in OGNI istante del volo, perché la mucca
       * occupa [y, y + altezza] e il cartello [0; 3,6] con y ≤ 3,2 < 3,6.
       * Non esiste una finestra temporale da calcolare: non esiste proprio
       * un'altezza a cui passare. Le 0,4 unità sopra l'apice (+12,5%) sono il
       * margine perché il conto resti vero anche se un giorno il salto
       * cresce di poco.
       *
       * Senza questo, "scegli o muori" diventerebbe "scegli o salta", cioè
       * una terza opzione più facile delle altre due.
       *
       * PROFONDITÀ 1: un palo, non un muro. Serve solo a dargli un ingombro
       * in z; largo o stretto non cambia nulla, dato che in quota non lo si
       * evita comunque.
       */
      signpost: { height: 3.6, depth: 1 },
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
    /** Alzata da 100. Misurato con pilota automatico su 20 seed × 240 s, con
     *  la soglia a 100 la valanga era accesa fra il 25,6% e il 37,3% del
     *  tempo (una ogni 12 s per chi sceglie il ramo ricco) e produceva fra il
     *  64% e l'80% del punteggio totale. Tre conseguenze, tutte contrarie al
     *  design: il picco emotivo si consumava (una cosa che accade ogni dodici
     *  secondi è una fase del ciclo, non un climax), un terzo del tempo di
     *  gioco era passivo (invulnerabilità totale: nessun input conta), e
     *  l'abilità non pagava, perché il punteggio dipendeva dalla raccolta e
     *  non dalla schivata. A 160 il ciclo va sui ~20 s e l'uptime sotto il
     *  20%. Il costo del reset torna a essere un costo. */
    threshold: 160,
    /** Alzata da 4,5 insieme alla soglia: meno valanghe ma più lunghe. Il
     *  tempo totale in valanga scende comunque, perché la soglia è cresciuta
     *  del 60% contro il 33% della durata. */
    durationSeconds: 6,
    /** Quanto dura il lampeggio di fine valanga. Alzato da 1: ora la barra
     *  scende per tutta la fase raccontando il tempo che resta
     *  (avalancheBarRatio), quindi il lampeggio non è più l'unico avviso ma la
     *  conferma di una cosa che il giocatore sta già guardando — e conviene
     *  che arrivi con l'anticipo necessario a rimettersi in assetto, non
     *  all'ultimo istante. A velocità massima un secondo e mezzo sono 60
     *  unità: due ostacoli. */
    warningSeconds: 1.5,
    /** Abbassato da 5. Con soglia e durata nuove il moltiplicatore ×5 avrebbe
     *  lasciato la quota di punti da valanga sopra il 70%; ×4 la porta verso
     *  il 55%, che è ancora la ricompensa dominante ma lascia respiro al
     *  punteggio guadagnato sopravvivendo (vedi anche score.streak*). */
    scoreMultiplier: 4,
    /** Soglie di carica per taglia 1..5, riscalate sulla soglia nuova
     *  (erano 0/20/40/60/80 su 100): il ritmo di crescita relativo resta
     *  identico, così la mucca continua a raggiungere la taglia 3 — quella
     *  che sfonda gli ostacoli fuori valanga — a poco più di un terzo della
     *  barra. */
    sizeThresholds: [0, 32, 64, 96, 128],
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
    /** Il perdono torna disponibile quando la barra riattraversa
     *  minChargeRatio verso l'alto DOPO essere stato consumato. Prima era di
     *  fatto "uno per corsa e basta": con firstHitFree a true la condizione
     *  `carica >= minChargeRatio || firstHitFree` è sempre vera, quindi
     *  minChargeRatio non aveva alcun effetto (configurazione morta) e il
     *  perdono era una vita gratis all'inizio — sparita proprio nel momento in
     *  cui sarebbe servita, tre minuti dentro e a taglia 5. Rendendolo
     *  ricaricabile, minChargeRatio torna a essere il numero che governa la
     *  cosa e il perdono diventa una risorsa che si riguadagna giocando. */
    rechargeable: true,
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
    /** Raggio entro cui la calamita agisce sui fiocchi. */
    magnetRangeZ: 14,
    /** Velocità con cui un fiocco catturato dalla calamita viene TRASCINATO
     *  verso la mucca, in unità al secondo (in aggiunta allo scorrimento del
     *  mondo). Prima la calamita non trascinava: raccoglieva direttamente a
     *  distanza, quindi dal punto di vista del giocatore i fiocchi svanivano
     *  mezzo secondo prima di arrivare, senza nessuna traiettoria che li
     *  collegasse alla mucca, mentre si sentivano sei suoni di raccolta al
     *  secondo. È il secondo buff più forte del gioco (+52 di carica contro i
     *  20 del cristallo) ed era quello di cui si percepiva meno l'effetto. */
    magnetPullSpeed: 26,
    /** Con quanto anticipo avvisare che un buff a tempo sta per finire. */
    expiryWarnSeconds: 2,
  },
  score: {
    pointsPerUnit: 1,
    // Bonus in punti per raccolta, indipendenti dalla carica che il pickup dà
    // alla valanga (quella è in pickups.charge). Non specificati dal
    // contratto: scelti qui in ordine di rarità (design doc §7), campanaccio
    // (il più raro) in cima.
    pickupBonus: { snowflake: 5, crystal: 15, star: 20, magnet: 20, bell: 30 },
    smashBonus: 30,
    /** Catena di sfondamenti in valanga: ogni ostacolo distrutto entro
     *  smashChainSeconds dal precedente aggiunge un gradino di bonus, fino a
     *  smashChainMax gradini. Serve a dare qualcosa DA GIOCARE nei secondi di
     *  invulnerabilità, che altrimenti restano tempo passivo: nessun input
     *  conta, si guarda soltanto. */
    smashChainStep: 15,
    smashChainMax: 4,
    smashChainSeconds: 1,
    /** Moltiplicatore di serie: sale di un gradino ogni streakStep ostacoli
     *  superati senza subire colpi, e si azzera a qualunque impatto che non
     *  sia uno sfondamento. È il modo standard di far pagare l'abilità in un
     *  runner, e qui serve anche a riequilibrare una distribuzione di punti
     *  che la valanga monopolizzava (vedi avalanche.scoreMultiplier). Il
     *  primo valore è il moltiplicatore a serie zero, quindi 1. */
    streakStep: 10,
    streakMultipliers: [1, 1.25, 1.5, 2],
    recordKey: 'rollingcows.record',
    /** Record separati: la corsa del giorno ha un seed fisso e condiviso,
     *  quindi il suo punteggio non è confrontabile con quello di una corsa
     *  normale; e ogni profilo di difficoltà ha il proprio, altrimenti
     *  "Vitellino" cancellerebbe di continuo il record fatto su "Toro". */
    dailyRecordKey: 'rollingcows.record.daily',
    profileRecordPrefix: 'rollingcows.record.',
    /** Distanza dell'ultima corsa e distanza della corsa che detiene il
     *  record: servono alla schermata di fine partita per le due righe di
     *  confronto ("+340 m rispetto alla corsa precedente", "−12 m dal
     *  record"), che sono il gancio che fa premere RIGIOCA. */
    lastDistanceKey: 'rollingcows.distance.last',
    recordDistanceKey: 'rollingcows.distance.record',
  },
  /** Profilo di difficoltà scelto dall'utente, ricordato fra una sessione e
   *  l'altra: chi ha scelto "Vitellino" per un bambino non deve riselezionarlo
   *  ogni volta che apre il gioco. */
  difficultyKey: 'rollingcows.difficulty',
  spawn: {
    /** Passo minimo fra due ostacoli consecutivi, in unità. Alzato da 26.
     *  A 26 unità e velocità massima due ostacoli distano 0,650 s contro un
     *  salto che ne dura 0,55: restavano 0,100 s fra atterraggio e ostacolo
     *  successivo, cioè sotto il tempo di reazione umano (250-400 ms). Il
     *  gioco a regime non era più reattivo ma mnemonico. A 30 il margine sale
     *  a 0,200 s. Misurato su 60 seed × 240 s con un modello di giocatore con
     *  80 ms di errore di timing: 26 unità → 1 corsa su 60 arrivava a 240 s;
     *  30 unità → 10 su 60; 30 unità più buffer d'azione e rampa più lunga →
     *  24 su 60. Notare che abbassare maxSpeed non serviva quasi a nulla
     *  (3 su 60): il problema è la spaziatura, non la velocità. */
    minObstacleGap: 30,
    maxObstacleGap: 48,
    /** Pavimento alla VARIANZA della spaziatura, come multiplo del passo
     *  minimo. Senza, a difficoltà piena il termine che decresce con la
     *  difficoltà (maxObstacleGap - gapSpread) arrivava esattamente al passo
     *  minimo: l'intervallo di estrazione collassava e il gap diventava
     *  deterministico — stesso identico valore, per sempre, su entrambi i
     *  rami. Dagli 84 secondi in poi non c'era più un ritmo da leggere, solo
     *  un pattern da eseguire. Con 1,25 la pressione media resta quella, ma
     *  la distanza torna a variare e il giocatore torna a leggere. */
    gapVarianceFloor: 1.25,
    /** Passo minimo sul RAMO SGOMBRO di un bivio, come multiplo del passo
     *  minimo normale. La differenza di spaziatura fra i due rami svaniva con
     *  la difficoltà: a difficoltà piena entrambi finivano allo stesso gap,
     *  quindi il ramo ricco (4× fiocchi, 2,2× buff, unico che può contenere
     *  il campanaccio) diventava strettamente dominante e la scelta di firma
     *  del gioco una formalità — misurato, il doppio dei punti a parità di
     *  sopravvivenza. Con questo pavimento il ramo sgombro conserva ~27% di
     *  respiro in più anche a difficoltà massima. */
    clearBranchGapRatio: 1.27,
    /** Lunghezza di una fila di fiocchi. */
    trailMin: 6,
    trailMax: 10,
    /** Passo fra due fiocchi della stessa fila. */
    trailSpacing: 3,
    /** Altezza dell'apice di una fila ad arco. */
    trailArcHeight: 3,
    /** Allungata da 2500: la rampa di densità finiva 3200 unità prima di
     *  quella di velocità (che arriva al tetto a 5718), quindi per metà
     *  corsa cresceva solo la velocità su una spaziatura già ferma al minimo.
     *  A 4000 le due rampe finiscono quasi insieme. */
    difficultyRampDistance: 4000,
    /** Secondo asse di difficoltà, che parte dove finisce il primo. Alzare
     *  ancora la velocità non è un'opzione (a 40 u/s il margine di reazione è
     *  già al limite), quindi oltre lateRampStart cresce la QUOTA di ostacoli
     *  sospesi: la scivolata è l'azione con la finestra più asimmetrica ed è
     *  quella che si sbaglia di più. Senza questo, dopo 169 secondi il gioco
     *  restava identico a se stesso per sempre — e un endless runner vive
     *  sulla promessa contraria. */
    lateRampStart: 5000,
    lateRampDistance: 4000,
    overheadShare: 0.5,
    overheadShareLate: 0.65,
    /** Sul ramo ricco di un bivio la quota di sospesi è più alta anche prima
     *  della rampa tardiva: così i due rami non si distinguono solo per
     *  QUANTO chiedono ma per QUALE abilità chiedono. */
    overheadShareRich: 0.65,
    /** Coppie strette: con questa probabilità (che cresce con la rampa
     *  tardiva) il secondo ostacolo nasce al limite esatto della
     *  traversabilità invece che alla distanza normale, obbligando al tuffo —
     *  la manovra avanzata che il gioco implementa già e che finora nulla
     *  richiedeva davvero. */
    tightPairChanceLate: 0.25,
    /**
     * Probabilità che un ostacolo A TERRA sia un CREPACCIO VERO (`chasm`), a
     * rampa tardiva piena; scala linearmente con `lateRampAt`, quindi vale 0
     * fino a `lateRampStart` e non consuma nemmeno un numero pseudocasuale
     * prima di lì (le corse esistenti restano identiche seed per seed).
     *
     * Riservato alla parte avanzata per due motivi che vanno nella stessa
     * direzione. Il primo è di ritmo: è l'unico ostacolo che non perdona
     * niente, e metterlo davanti a chi sta ancora imparando i comandi
     * significherebbe chiudere corse senza avere insegnato nulla. Il secondo
     * è aritmetico, ed è il vincolo vero: un buco largo si salta solo se si
     * corre abbastanza (vedi il conto in collisions.entityBox.chasm — serve
     * v ≥ 15,5 u/s), e la rampa tardiva è esattamente il punto della corsa in
     * cui quella velocità è garantita in tutti e tre i profili.
     *
     * 0,18 sulla sola quota a terra, che a rampa piena è il 35% degli
     * ostacoli (overheadShareLate = 0,65): circa un ostacolo ogni 16. Raro
     * abbastanza da restare un evento, frequente abbastanza da incontrarne
     * qualcuno in una corsa lunga.
     */
    chasmChanceLate: 0.18,
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
    /** Ribilanciati da {crystal: 8, star: 2, magnet: 2, bell: 0}. Il problema
     *  non era lo sbilanciamento dei valori ma l'inversione fra frequenza e
     *  interesse: il cristallo era due terzi di tutti i buff comuni ed è il
     *  meno significativo dei quattro (+20 su una soglia di 160: non cambia
     *  niente di come si gioca), mentre il campanaccio — l'unico che cambia
     *  davvero una corsa, perché è una vita — aveva peso zero, il che
     *  significava che chi non sceglie mai ai bivi non vedeva MAI uno scudo.
     *  Il cristallo resta il più comune, ma smette di essere quasi tutto. */
    commonBuffWeights: { crystal: 5, star: 3, magnet: 3, bell: 1 },
  },
  render: {
    /** Pendenza visiva della montagna, in GRADI. È un intervento di SOLA
     *  resa: inclina attorno all'asse X il gruppo-mondo, la mucca e il rig
     *  della camera dello stesso angolo, quindi la geometria fra camera e
     *  pendio non cambia di un millimetro e nessuna quota di collisione è
     *  coinvolta — game/collisions.ts continua a lavorare su un mondo piatto.
     *
     *  Quello che cambia è ciò che NON ruota, cioè cielo e fondale, ed è lì
     *  che sta l'effetto: su una pianura il terreno svanisce SULL'orizzonte,
     *  in discesa svanisce di questi gradi SOTTO, e la fascia in mezzo si
     *  riempie di fondovalle e paese. Misurata: da 1,5-2,5° a 7,5-8,5°, cioè
     *  da un filo a un settimo dello schermo.
     *
     *  Il tetto pratico è ~8°: oltre, il fondale va abbassato tanto che il
     *  paese finisce dietro il pendio. Il conto non è a mano ma in
     *  render/backdrop.ts (backdropDrop), che a pendenza 0 restituisce
     *  esattamente 0 — così il panorama di prima resta quello di prima. */
    worldSlopeDeg: 6,
    maxPixelRatio: 2,
    /** Pixel ratio quando il monitor delle prestazioni abbassa la qualità.
     *  Prima il degrado spegneva ombre e particelle e lasciava la risoluzione
     *  intatta: ma su GPU mobile il collo di bottiglia è quasi sempre il fill
     *  rate, non i triangoli. Su un telefono 1080×2340 a dpr 2 si renderizzano
     *  oltre 10 megapixel per frame con background e terreno opachi a schermo
     *  pieno; scendere a 1,25 taglia il 61% dei frammenti. È la leva singola
     *  più efficace disponibile, ed era l'unica che il degrado non toccava. */
    lowQualityPixelRatio: 1.25,
    /** Tetto al pixel ratio su dispositivi con puntatore grosso (telefoni e
     *  tablet), applicato già all'avvio: meglio partire a 1,5 con MSAA acceso
     *  che a 2 senza. La scena è fatta al 100% di spigoli ad alto contrasto e
     *  si muove sempre, cioè lo scenario peggiore per l'aliasing temporale, e
     *  sulle GPU mobili (a tile) l'MSAA si risolve nella tile memory ed è
     *  molto meno caro che raddoppiare la risoluzione. */
    coarsePixelRatio: 1.5,
    // Nebbia spostata più lontano insieme alla camera rialzata (vedi
    // render/camera-rig.ts, CAMERA_HEIGHT_RATIO): a fogNear=40 il pendio
    // sbiancava proprio dove iniziava a leggersi un ostacolo lontano, lasciando
    // meno di un secondo di preavviso a velocità di crociera.
    /** Spostata ancora più lontano (era 75) insieme a path.previewZ: il bivio
     *  ora compare a 110 unità e deve nascere fuori dalla nebbia, non già al
     *  12% di sbiancamento. */
    fogNear: 95,
    fogFar: 200,
    /** Frustum e bias della shadow map del sole. Misurando la copertura reale
     *  al suolo, i valori precedenti (±14 in x, ±24 in y, far 90) coprivano
     *  z ∈ [-23, 47] con texel da 0,027 unità: dieci volte più fini di un
     *  voxel (0,25), cioè risoluzione sprecata dove non serve mentre l'ombra
     *  di un ostacolo compariva di colpo a 47 unità — poco più di un secondo
     *  prima dell'impatto, quando l'ombra al suolo è il principale indizio per
     *  decidere quando saltare. Riallocando gli stessi texel la copertura
     *  diventa z ∈ [-39, 80], cioè oltre fogNear, dove l'ostacolo è già mezzo
     *  dissolto e il pop-in non si vede. Il bias grande e senza normalBias
     *  valeva mezzo voxel di offset, cioè peter-panning garantito sui modelli
     *  piccoli: la pratica corrente è bias quasi nullo e normalBias, che
     *  sposta il campionamento lungo la normale senza staccare l'ombra. */
    shadow: {
      mapSize: 1024,
      halfWidth: 16,
      halfDepth: 50,
      near: 1,
      far: 160,
      bias: -0.0002,
      normalBias: 0.05,
    },
    voxelPoolSize: 4000,
    voxelSize: 0.25,
    cameraBaseDistance: 9,
    cameraDistancePerSize: 0.9,
    /** FOV legato alla VELOCITÀ, non più un valore fisso. Prima nulla
     *  nell'inquadratura dipendeva da quanto si stava andando forte, benché la
     *  velocità raddoppi abbondantemente nel corso di una corsa (18 → 40): a
     *  18 u/s e a 40 u/s la corsa era inquadrata identica, e l'accelerazione —
     *  la sensazione centrale del genere — era affidata al solo scorrimento
     *  del pendio. Interpolato fra i due estremi con la stessa costante di
     *  tempo del resto del rig. */
    cameraMinFov: 56,
    cameraMaxFov: 64,
    /** La valanga ora AGGIUNGE gradi invece di sostituire il FOV con un valore
     *  assoluto (era 78): così l'apertura da velocità e quella da valanga si
     *  sommano, invece che la seconda cancellare la prima proprio nel momento
     *  in cui si va più forte di tutti. */
    cameraAvalancheFovDelta: 14,
    /** Micro-vibrazione continua della camera proporzionale alla velocità:
     *  impercettibile da fermi, "motore su di giri" a velocità massima. In
     *  unità di mondo, al massimo della velocità. */
    speedJitter: 0.012,
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
        /** Colore tetti: blu-grigio spento, perché un tetto rosso saturo si
         *  confonderebbe a colpo d'occhio con un ostacolo.
         *
         *  Questo valore è nato qui, per il villaggio lontano, mentre la baita
         *  vicina teneva un rosso acceso: ma il principio valeva per entrambe
         *  — anzi, valeva DI PIÙ per la baita, che è a bordo pista. Oggi
         *  `ROOF` in models.ts è esattamente questo stesso colore, e la
         *  saturazione è riservata ai soli raccoglibili, che sono gli unici
         *  oggetti in scena che il giocatore deve inseguire. */
        roofColor: 0x6c7f91,
      },
    },
    /** Oggetti decorativi ai lati del tracciato: non sono entità di gioco, non
     *  collidono mai e non devono MAI entrare nel corridoio giocabile. */
    scenery: {
      itemsPerChunk: 7,
      /** Distanza laterale minima dal centro a cui può nascere un elemento
       *  decorativo. Alzata da 9.
       *
       *  La vecchia giustificazione ("ben oltre il bordo del corridoio,
       *  world.trackWidth / 2 = 2") guardava il tracciato DRITTO, che è il
       *  caso in cui c'è più spazio. Durante un bivio la pista arriva a
       *  branchSeparation + trackWidth / 2 = 8 unità di lato (il ramo attivo
       *  non va mai oltre: il suo centro vale branchOffsetX per uno meno
       *  l'apertura a z = 0, quindi al più branchSeparation), e i 7 di
       *  margine dichiarati erano in realtà 1 — anzi, meno di zero, perché
       *  questo numero posiziona il CENTRO dell'elemento e l'ingombro va
       *  sottratto:
       *  - baita: semi-diagonale √(1,88² + 1,38²) = 2,33 a scala 1, per
       *    maxScale 1,6 fa 3,73 (lo yaw è casuale, quindi la diagonale si
       *    presenta davvero) → a 9 il suo spigolo arrivava a 5,27, cioè 2,7
       *    unità DENTRO il ramo esterno, più di metà della sua larghezza;
       *  - abete e balla di fieno: semi-diagonale 0,88 · √2 · 1,6 = 1,99 → a
       *    9 arrivavano a 7,01, un'unità dentro il ramo.
       *  8 + 3,73 = 11,73, arrotondato a 12.
       *
       *  Restano volutamente fuori dal conto due cose. Il nastro SCARTATO,
       *  che durante il riallineamento scivola fino a |x| = 12: quando il suo
       *  bordo esterno tocca quel valore è largo 0,4 unità e sta svanendo
       *  (vedi render/terrain.ts, trackHalfWidths), e dimensionare su di lui
       *  porterebbe la scenografia a 15,7 svuotando i fianchi della pista. E
       *  la rotazione del gruppo-mondo dei bivi, che non c'entra: pendio,
       *  pista, entità e scenografia stanno tutti nello STESSO gruppo
       *  ruotato (main.ts), quindi è una rotazione rigida e non può
       *  sovrapporre un albero alla pista se non lo era già a rotazione
       *  zero. Quello che la rotazione fa è far attraversare lo schermo a
       *  ciò che è lontano, ed è il motivo per cui render.curve.* è stato
       *  ridimensionato. */
      minLateral: 12,
      maxLateral: 46,
      /** Peso relativo dei tre modelli decorativi. */
      weights: { tree: 7, cabin: 2, hay: 3 },
      minScale: 0.8,
      maxScale: 1.6,
      /** Margine oltre la semilarghezza del frustum entro cui un elemento
       *  decorativo viene ancora disegnato. Le InstancedMesh hanno
       *  frustumCulled = false — scelta giusta, perché il loro volume di
       *  delimitazione non segue le istanze — ma non era stata sostituita da
       *  nulla: i ~29.000 triangoli della scenografia (una baita da sola ne
       *  vale 1748, più del doppio della mucca) venivano inviati sempre,
       *  comprese le baite dietro la camera e quelle oltre la nebbia, dove
       *  sono comunque un blocco di colore uniforme. Il culling ora lo fa il
       *  ciclo di sync, che visita già ogni elemento: una moltiplicazione. */
      cullMarginX: 6,
      /** Quanto dietro la camera un elemento resta comunque disegnato. */
      cullBehindZ: 12,
      /** Ombra di contatto finta: un quad orizzontale con gradiente radiale
       *  sotto ogni elemento decorativo, in una sola InstancedMesh aggiuntiva.
       *  Le ombre vere sono escluse apposta: la scenografia vive fra 9 e 46
       *  unità di lato e allargare fin lì il frustum della shadow map
       *  sacrificherebbe i texel dove servono davvero (vedi render.shadow).
       *  Senza nulla sotto, però, su una distesa bianca e piatta alberi e
       *  baite non hanno punto di contatto col terreno e leggono come
       *  adesivi. Una draw call per tutto il paesaggio. */
      contactShadowScale: 1.35,
      contactShadowOpacity: 0.22,
    },
    /** Texture procedurale della neve, generata a runtime (nessun asset
     *  esterno, come tutto il resto). Il pavimento era un solo quad a tinta
     *  unita con normale costante: quando i chunk scorrevano, del pendio non
     *  si muoveva letteralmente nulla sullo schermo, e in un endless runner la
     *  velocità si percepisce soprattutto da lì. Poiché i chunk si spostano
     *  già, la texture scorre con loro senza alcun aggiornamento per frame.
     *  Le UV vengono riscritte dopo il merge a partire dalla posizione di
     *  mondo: con chunkLength 40 e passo 4 la ripetizione è esatta, quindi
     *  nessuna cucitura visibile quando un chunk viene riciclato. */
    snowTexture: {
      size: 128,
      /** Unità di mondo per ripetizione. Deve dividere world.chunkLength. */
      tileWorldUnits: 4,
      /** Ampiezza del rumore, in livelli su 255: basso apposta, deve dare
       *  grana e appiglio visivo senza sporcare il bianco. */
      noiseAmplitude: 14,
      /** Solchi tipo sastrugi: quanti per tile e quanto scuri. */
      grooveCount: 3,
      grooveDarkness: 10,
      seed: 0x5c0ffee,
    },
    /** Neve che cade: qualche centinaio di punti in un volume agganciato alla
     *  camera, fatti scendere in un vertex shader così da non toccare mai il
     *  buffer da JavaScript. Una draw call, nessun aggiornamento CPU. Fra la
     *  camera e il terreno non c'era nulla, e la densità legata alla velocità
     *  dà un secondo indizio di quanto si sta andando forte. */
    snowfall: {
      count: 480,
      areaWidth: 34,
      areaHeight: 16,
      areaDepth: 44,
      size: 0.13,
      fallSpeed: 3.2,
      /** Quanto la velocità del mondo inclina e accelera la caduta. */
      speedInfluence: 0.6,
    },
    /** Resa della valanga. Durava 4,5 secondi (ora 6), valeva il
     *  moltiplicatore più alto ed era ciò che si insegue per tutta la corsa,
     *  ma passato il mezzo secondo di zoom lo schermo era identico al gioco
     *  normale. Niente EffectComposer: su mobile costerebbe due render target
     *  e otto passaggi a schermo pieno per un effetto che si ottiene con un
     *  quad. */
    avalancheFx: {
      /** Strisce radiali su un quad a schermo intero, additive. */
      speedLineIntensity: 0.35,
      speedLineCount: 24,
      speedLineSpeed: 3,
      /** Vignetta calda pulsante, in CSS sul contenitore UI: costo zero. */
      vignetteOpacity: 0.32,
      vignettePulseHz: 1.6,
      /** Scuotimento di base mantenuto per tutta la durata, proporzionale
       *  alla taglia: prima c'era solo l'impulso d'ingresso, che si spegneva
       *  in meno di un secondo su una fase che ne dura sei. */
      sustainedShake: 0.12,
      /** Di quanto si scalda e si intensifica il sole durante la fase. */
      sunIntensityBoost: 1.15,
    },
    /** Moltiplicatori applicati quando il sistema chiede di ridurre il
     *  movimento. La media query CSS disattivava quattro animazioni
     *  dell'interfaccia e non toccava nulla di ciò che causa davvero disagio
     *  vestibolare: la rotazione del gruppo-mondo a ogni bivio,
     *  l'inclinazione della mucca, il rollio, la pompa di FOV in valanga e gli
     *  scuotimenti. Con un bivio ogni ~12 s e una valanga ogni ~20, chi è
     *  sensibile al movimento affrontava una giostra in continuazione. Il
     *  bivio resta perfettamente leggibile anche al 25%, perché la rotazione è
     *  dichiaratamente estetica e a somma zero: il lavoro geometrico lo fa la
     *  traslazione. */
    reducedMotion: {
      curveScale: 0.25,
      shakeScale: 0.3,
      fovDeltaScale: 0.45,
      speedJitterScale: 0,
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
       *  culmine della curva. Abbassata da 38 a 16 e poi a 6, e la seconda
       *  volta per un motivo che non è di gusto ma di geometria.
       *
       *  Questo è l'UNICO dei tre angoli che sposta la strada: il gruppo ruota
       *  attorno alla mucca, quindi un punto a distanza z si sposta di
       *  z·sin(yaw) — 5,5 unità a 20 di distanza con 16°, 11 a 40. Il
       *  corridoio è largo 4. Il risultato, con la pista che nel frattempo
       *  scivola anch'essa verso il ramo scelto, era che scegliendo DESTRA la
       *  strada finiva a sinistra dello schermo: le parole del proprietario
       *  sono state «viene presa la strada di sinistra come strada
       *  principale». Non è compensabile alzando o abbassando qualcosa
       *  d'altro: una rotazione sposta in proporzione a z, una strada dritta è
       *  scostata di una costante, e le due cose coincidono al più a una sola
       *  distanza. L'unica leva è tenere l'angolo piccolo.
       *
       *  A 6° la strada resta entro ~2 unità dal centro dello schermo fino a
       *  20 unità di distanza, cioè dentro il corridoio per tutto il tratto
       *  che il giocatore sta effettivamente leggendo. Il senso di curva non
       *  si perde perché non è più questo angolo a portarlo: la pista ORA
       *  curva davvero (il ramo scelto scivola al centro prima della
       *  biforcazione, vedi game/path.ts, straightenProgress), e ci pensano
       *  soprattutto i due angoli qui sotto, che non spostano niente. */
      maxWorldTiltDeg: 6,
      /** Inclinazione di picco della mucca sul fianco, sullo stesso verso
       *  della rotazione del mondo (si piega DENTRO la curva, come una moto o
       *  uno sciatore). È il dettaglio che vende l'idea "sono io a curvare", e
       *  resta il più marcato dei tre proprio perché è gratis: inclinare la
       *  mucca non sposta di un millimetro la strada né nulla della scena.
       *  Abbassata da 32 a 18 e poi a 14 per non staccarsi troppo dalla
       *  rotazione del mondo, che la geometria costringe a essere piccola: se
       *  la mucca si piegasse tre volte più del mondo, i due movimenti non si
       *  leggerebbero più come uno solo. */
      maxPlayerTiltDeg: 14,
      /** Rollio di picco della camera: inclina l'orizzonte, e come la piegata
       *  della mucca non sposta nulla. Resta il più piccolo dei tre perché è
       *  l'unico che agisce sull'inquadratura in sé, dove anche pochi gradi si
       *  sentono; abbassato da 9 a 5 e poi a 4 per restare sotto la rotazione
       *  del mondo, che ora vale 6. */
      maxCameraRollDeg: 4,
    },
  },
  input: {
    swipeMinPixels: 24,
    /** Soglia più alta per il solo swipe ORIZZONTALE: le due azioni non hanno
     *  lo stesso costo, quindi non meritano la stessa sensibilità. */
    swipeMinPixelsHorizontal: 32,
    /** Di quanto la componente orizzontale deve superare la verticale perché
     *  il gesto conti come laterale. Prima il pareggio andava all'orizzontale,
     *  cioè all'azione MENO importante del gioco: un flick verso l'alto di 30
     *  px con 30 px di deriva laterale — il gesto normale di un pollice su un
     *  telefono tenuto in una mano — diventava una scelta di ramo, il salto
     *  non partiva e la mucca moriva. Il pollice devia sistematicamente: con
     *  costi asimmetrici, la soglia va resa asimmetrica. */
    horizontalDominance: 1.6,
    /** Alzata da 400 ms: uno swipe deliberato e lento — quello di un bambino
     *  piccolo, o di chi gioca col telefono appoggiato — non produceva nulla,
     *  e il gioco non dava alcun riscontro di "ho ricevuto qualcosa ma non
     *  l'ho capito". */
    swipeMaxMs: 600,
    /** Il tap ora salta. È il gesto più istintivo su un telefono ed è
     *  l'azione primaria in tutti i runner mobili di riferimento; prima non
     *  era mappato su nulla. */
    tapMaxMs: 250,
    /** Ora è un numero vivo: un salto o una scivolata chiesti mentre l'azione
     *  precedente è ancora in corso restano armati per questo tempo e partono
     *  all'atterraggio, invece di essere buttati. Prima il buffer conteneva
     *  una sola azione e veniva svuotato a ogni passo del loop (16,7 ms),
     *  quindi questa finestra non scadeva mai e la costante era di fatto
     *  morta: chi anticipava la pressione — cioè chi giocava bene — veniva
     *  punito. Misurato: con 80 ms di errore di timing la sopravvivenza a 240
     *  secondi passa da 1 corsa su 60 a 16 su 60 con il solo buffer. */
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
    /** Raccolta: triangolare con salto di frequenza verso l'alto. La coppia di
     *  note ora sale di un semitono per ogni fiocco preso di seguito, e la
     *  serie si azzera dopo streakResetSeconds senza raccolte. Prima era
     *  sempre identica: con la calamita attiva si raccolgono quasi sei fiocchi
     *  al secondo, cioè sei note uguali al secondo, un ronzio — e siccome ne
     *  servono decine per una valanga, la sequenza sonora che dovrebbe
     *  costruire tensione verso il momento clou era piatta. È la tecnica di
     *  Mario e di Sonic e costa cinque righe. */
    pickup: {
      lowHz: 620,
      highHz: 990,
      stepRatio: 0.35,
      seconds: 0.18,
      gain: 0.5,
      streakResetSeconds: 0.6,
      streakMaxSteps: 12,
    },
    /** Stacco del salto: un soffio breve passa-alto, la neve che schizza. */
    jump: { cutoffHz: 1400, seconds: 0.14, gain: 0.35 },
    /** Atterraggio: tonfo sordo passa-basso, più corto di un impatto vero. */
    land: { cutoffHz: 420, seconds: 0.18, gain: 0.45 },
    /** Scivolata: rumore filtrato in loop finché dura, con un filo di
     *  risonanza — il frusciare della pancia sulla neve. */
    slide: { cutoffHz: 900, resonance: 3, gain: 0.28, fadeSeconds: 0.08 },
    /** Salita di taglia: lo stesso muggito, ma più acuto a ogni taglia. */
    sizeUp: { pitchPerSize: 0.12, gain: 0.8 },
    /** Buff in scadenza: due note discendenti, l'opposto del suono con cui il
     *  buff è arrivato. Prima stella e calamita finivano in silenzio. */
    buffExpire: { highHz: 900, lowHz: 520, seconds: 0.2, gain: 0.4 },
    /** Fine della valanga: sgonfiamento discendente, inverso timbrico del
     *  muggito d'ingresso. */
    avalancheEnd: { startHz: 320, endHz: 90, seconds: 0.6, gain: 0.7 },
    /** Conferma della scelta di un ramo: il richiamo del bivio trasposto più
     *  in alto, così si riconosce come "stessa famiglia, altra cosa". */
    forkChosen: { pitchRatio: 1.5, seconds: 0.12, gain: 0.35 },
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
    cowbell: {
      fundamentalHz: 520,
      overtoneRatio: 2.4,
      seconds: 0.4,
      gain: 0.6,
      /** La parziale non armonica dura e pesa meno della fondamentale: erano
       *  due 0.6 scritti a mano dentro audio.ts, unici numeri audio senza una
       *  voce qui. */
      overtoneDecayRatio: 0.6,
      overtoneGainRatio: 0.6,
    },
    /** Comparsa di un bivio: il momento in cui bisogna alzare lo sguardo.
     *  Un richiamo breve e distinto da tutti i suoni di raccolta. */
    forkAppear: { lowHz: 500, highHz: 750, seconds: 0.16, gain: 0.4 },
    /** Lo scudo che assorbe un colpo: rumore passa-alto, un "crac" cristallino
     *  distinto dal tonfo sordo passa-basso di un impatto normale
     *  (CONFIG.audio.impact). */
    shieldBreak: { cutoffHz: 1600, seconds: 0.35, gain: 0.7 },
    /** Rombo della valanga: rumore filtrato in loop. */
    rumble: {
      cutoffHz: 380,
      maxGain: 0.8,
      riseSeconds: 0.4,
      fadeSeconds: 0.8,
      endingGainRatio: 0.4,
      /** Quanto dura l'abbassamento di volume che segnala l'ultimo secondo:
       *  era scritto a mano in audio.ts. Da solo però non basta come
       *  preavviso — un'assenza non è un segnale — e infatti sotto riduzione
       *  del movimento restava l'unico avviso rimasto (vedi hud). */
      duckSeconds: 0.2,
    },
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
    /** Tetto allo scuotimento accumulabile. Stava in render/scene.ts come
     *  MAX_SHAKE = 1.2 e clampava silenziosamente deathShake, che vale 1.6:
     *  il numero di bilanciamento non arrivava mai a destinazione e chi
     *  avesse voluto una morte più violenta non avrebbe visto alcuna
     *  differenza. Ora il tetto sta qui, accanto ai valori che governa, ed è
     *  sopra il più grande di essi. */
    maxShake: 1.8,
    /** Fermo-immagine brevissimo su un evento, in secondi: applicato con lo
     *  stesso meccanismo del rallentatore della morte, che era finora l'unico
     *  uso della scala temporale in tutto il gioco. Il perdono deve
     *  spaventare (ed era indistinguibile dallo sfondamento: stesso ramo di
     *  codice, stesso burst, stessa scossa, benché uno sia una ricompensa e
     *  l'altro l'errore che ti è quasi costato la corsa); lo sfondamento deve
     *  essere gustoso ma non fastidioso, perché in valanga capita più volte
     *  al secondo. */
    hitStop: {
      forgiven: 0.09,
      shielded: 0.06,
      smashed: 0.035,
      avalanche: 0.12,
    },
    /** Scuotimento del perdono: volutamente MAGGIORE di un impatto normale. */
    forgivenShake: 1.2,
    shieldShake: 0.9,
    smashShake: 0.4,
    /** Salto e atterraggio: le due azioni che il giocatore compie più spesso
     *  non producevano nulla — niente suono, niente particelle, niente
     *  scuotimento, niente squash. È la differenza singola più grande fra un
     *  prototipo e un gioco. Il tonfo è un decimo di un impatto: si deve
     *  sentire, non disturbare. */
    landShake: 0.15,
    jumpBurstPower: 2,
    landBurstPower: 3,
    /** Deformazione elastica di stacco e atterraggio: scala verticale e
     *  durata. Prima la sagoma cambiava solo in scivolata, e di scatto. */
    jumpSquash: 0.88,
    landSquash: 1.15,
    squashSeconds: 0.11,
    /** Scatto di scala quando la mucca sale di taglia. La crescita è il cuore
     *  dell'idea originale del gioco ed era completamente muta: l'evento
     *  esisteva sul bus e non lo ascoltava nessuno, l'HUD cambiava una scritta
     *  e il modello saltava di dimensione in un frame. */
    sizePunch: 1.25,
    sizePunchSeconds: 0.14,
    /** Ingresso in valanga: dopo il fermo-immagine, un quarto di secondo a
     *  metà velocità mentre il FOV si apre. */
    avalancheEnterSlowSeconds: 0.25,
    avalancheEnterTimeScale: 0.5,
  },
  /** Primo tratto guidato. I comandi esistevano solo nel README: un giocatore
   *  nuovo incontrava il primo ostacolo dopo 2,3 secondi senza sapere che si
   *  può saltare, e tutte le attenzioni già presenti (primo ostacolo garantito
   *  a terra, primo bivio anticipato, primo colpo perdonato) non servivano a
   *  nulla se non sapeva che esiste un comando. Non una schermata di
   *  istruzioni: tre prompt diegetici sul pendio, ognuno dei quali si spegne
   *  PER SEMPRE appena l'azione corrispondente riesce una volta. */
  tutorial: {
    /** Distanza del primo ostacolo quando i prompt sono ancora attivi: più
     *  lontano del normale (37-48) per dare il tempo di leggere. */
    firstObstacleZ: 70,
    /** A che distanza dall'ostacolo compare il prompt. */
    promptZ: 45,
    storageKey: 'rollingcows.taught',
  },
  /** Profili di difficoltà. Con la spaziatura normale una bambina piccola
   *  arriva a una decina di secondi, ogni volta — e il gioco nasce dall'idea
   *  di una bambina. Ogni profilo scala tre soli numeri e ha il proprio
   *  record, perché altrimenti il più facile cancellerebbe di continuo quello
   *  fatto sul più difficile. */
  difficultyProfiles: {
    calf: { label: 'Vitellino', startSpeed: 14, maxSpeed: 28, minObstacleGap: 36 },
    normal: { label: 'Normale', startSpeed: 18, maxSpeed: 40, minObstacleGap: 30 },
    bull: { label: 'Toro', startSpeed: 22, maxSpeed: 46, minObstacleGap: 26 },
  },
  /** Missioni: tre alla volta, estratte da un seed giornaliero e salvate in
   *  locale. Il record era l'unico motore di rigiocabilità del gioco. Tutti
   *  gli eventi necessari esistono già sul bus, quindi il modulo resta puro:
   *  niente three, niente DOM. */
  quests: {
    count: 3,
    storageKey: 'rollingcows.quests',
  },
  /** Corsa del giorno: stesso seed per tutti, derivato dalla data. Il gioco è
   *  completamente deterministico dato il seed e l'evento di avvio lo porta
   *  già con sé "per poterla rigiocare identica": l'infrastruttura c'era
   *  tutta, mancava il bottone. */
  daily: {
    seedSalt: 0x9e3779b1,
  },
} as const;
