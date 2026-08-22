import type { EventBus } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import {
  type AvalancheState,
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  chargeRatio,
  createAvalanche,
  scoreMultiplier,
  updateAvalanche,
} from './avalanche';
import {
  applyBuff,
  type BuffState,
  buffMultiplier,
  consumeShield,
  createBuffs,
  magnetActive,
  updateBuffs,
} from './buffs';
import { boxesOverlap, ENTITY_BOX, entityBox, playerBox } from './collisions';
import { CONFIG } from './config';
import {
  activeBranchOf,
  branchIsSolid,
  chooseBranch,
  createPath,
  type ForkPhase,
  type PathState,
  rememberChoice,
  updatePath,
} from './path';
import { createPlayer, jump, type PlayerState, slide, updatePlayer } from './player';
import {
  addBonus,
  addDistance,
  breakStreak,
  createScore,
  registerPassedObstacle,
  registerSmash,
  type ScoreState,
  streakMultiplier,
  updateSmashChain,
} from './score';
import { branchSpawnStartZ, createSpawner, type Spawner } from './spawner';
import {
  DEFAULT_DIFFICULTY_PROFILE,
  type DifficultyProfile,
  difficultyAt,
  lateRampAt,
  resolveDifficultyProfile,
} from './speed';
import type { Action, Branch, Entity, EntityKind, ObstacleKind, PickupKind } from './types';
import { createWorld, updateWorld, type WorldState } from './world';

/**
 * Distanza a cui il tracciato si sdoppia. Durante un bivio è la biforcazione
 * stessa; fuori da un bivio è la biforcazione che sta arrivando, che si conosce
 * già (nextForkIn è il residuo di distanza, previewZ la distanza a cui il bivio
 * diventerà visibile). Serve al tronco per sapere dove FERMARSI: oltre questa
 * z il mondo si sdoppia, quindi lì non può esistere un ostacolo 'main'.
 */
function bifurcationZ(path: PathState): number {
  if (path.phase === 'none') return path.nextForkIn + CONFIG.path.previewZ;
  return path.forkZ;
}

/** Bordo più lontano del mondo già esistente: oltre non c'è terreno da popolare. */
function worldHorizonZ(world: WorldState): number {
  const chunks = world.chunks;
  let maxZ = -Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    if (chunk.z > maxZ) maxZ = chunk.z;
  }
  return maxZ + CONFIG.world.chunkLength;
}

/** Popola un tratto di TRONCO, troncandolo alla biforcazione che sta
 *  arrivando: senza questo limite il tronco invaderebbe il tratto in cui il
 *  mondo si sdoppia, e alla comparsa del bivio quelle entità andrebbero
 *  cancellate — anche un masso a due unità dal muso del giocatore. */
function populateTrunk(
  game: GameState,
  startZ: number,
  length: number,
  difficulty: number,
  lateProgress: number,
): void {
  const endZ = Math.min(startZ + length, bifurcationZ(game.path));
  if (endZ <= startZ) return;
  game.spawner.populateSegment(
    startZ,
    endZ - startZ,
    difficulty,
    'main',
    false,
    game.entities,
    lateProgress,
  );
}

export interface GameState {
  /** Seed della run corrente: va in `run:started` e permette di rigiocarla identica. */
  seed: number;
  rng: Rng;
  bus: EventBus;
  world: WorldState;
  path: PathState;
  player: PlayerState;
  avalanche: AvalancheState;
  buffs: BuffState;
  score: ScoreState;
  spawner: Spawner;
  /** Profilo di difficoltà con cui si sta giocando. Vive nello stato e viene
   *  passato a chi lo usa (speedAt, createSpawner) invece di essere una
   *  lettura di CONFIG sparsa nei moduli: il giorno in cui la difficoltà
   *  cambia a metà corsa, o due stati di gioco convivono, non c'è nulla da
   *  riscrivere. */
  profile: DifficultyProfile;
  entities: Entity[];
  alive: boolean;
  /** Il perdono è al momento SPESO. Non è più "per tutta la corsa": con
   *  CONFIG.forgiveness.rechargeable torna disponibile quando la barra
   *  riattraversa minChargeRatio verso l'alto (vedi rechargeForgiveness). */
  forgivenessUsed: boolean;
  /** Il bonus di onboarding (firstHitFree) è già stato speso. Prima non
   *  esisteva perché non serviva: `forgivenessUsed` bastava a distinguere il
   *  primissimo impatto, dato che il perdono non tornava mai. Ora che torna,
   *  senza questo flag ogni ricarica regalerebbe di nuovo un perdono a carica
   *  zero e minChargeRatio resterebbe la configurazione morta che era. */
  firstHitUsed: boolean;
  /** Frazione di carica del frame precedente: serve a rilevare
   *  l'ATTRAVERSAMENTO di minChargeRatio, non lo stato "sono sopra la soglia"
   *  (che sarebbe vero per centinaia di frame di fila e ricaricherebbe il
   *  perdono di continuo). */
  chargeRatioBefore: number;
  /** Record da battere, comunicato da chi avvia la corsa (il livello
   *  platform: le regole non sanno cos'è un localStorage). Zero significa
   *  "nessun record noto": in quel caso 'record:beaten' non viene emesso,
   *  perché superare zero non è un'impresa. */
  previousRecord: number;
  /** 'record:beaten' è già stato emesso in questa corsa: una volta sola. */
  recordBeaten: boolean;
  /** Moltiplicatore EFFETTIVO totale (valanga × stella × serie), aggiornato a
   *  ogni frame. Esposto nello stato perché l'HUD deve poterlo mostrare: i
   *  tre fattori vivono in tre moduli diversi e ricomporli nella vista
   *  significherebbe duplicare la regola. */
  multiplier: number;
}

/** Esito di una corsa, per chi deve salvarlo o mostrarlo. */
export interface RunSummary {
  points: number;
  distance: number;
  isRecord: boolean;
}

/**
 * Moltiplicatore totale: valanga × stella × serie. Stella e valanga si
 * moltiplicavano già fra loro (×2 × ×4) ed è l'unica decisione strategica del
 * gioco ("tengo la stella per la valanga"); la serie si aggiunge come terzo
 * fattore e premia la sequenza pulita, che prima non valeva nulla.
 */
export function effectiveMultiplier(game: GameState): number {
  return (
    scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs) * streakMultiplier(game.score)
  );
}

export function runSummary(game: GameState): RunSummary {
  return {
    points: game.score.points,
    distance: game.score.distance,
    isRecord: game.score.points > game.previousRecord,
  };
}

/**
 * Semi-finestra lungo z entro cui vale la pena costruire le AABB. Derivata
 * dalle profondità dichiarate, non da un numero scelto a mano: a 40 u/s con
 * passo 1/60 un'entità si sposta di 0,67 unità per frame, quindi non può
 * saltare questa finestra senza essere testata.
 */
const MAX_ENTITY_DEPTH = Math.max(...Object.values(ENTITY_BOX).map((box) => box.depth));
const COLLISION_Z_WINDOW = CONFIG.player.depth + MAX_ENTITY_DEPTH;

function isPickupKind(kind: EntityKind): kind is PickupKind {
  return (
    kind === 'snowflake' ||
    kind === 'crystal' ||
    kind === 'star' ||
    kind === 'magnet' ||
    kind === 'bell'
  );
}

export function createGame(seed: number, bus: EventBus): GameState {
  const rng = createRng(seed);
  return {
    seed,
    rng,
    bus,
    world: createWorld(DEFAULT_DIFFICULTY_PROFILE),
    path: createPath(),
    player: createPlayer(),
    avalanche: createAvalanche(),
    buffs: createBuffs(),
    score: createScore(),
    spawner: createSpawner(rng, DEFAULT_DIFFICULTY_PROFILE),
    profile: DEFAULT_DIFFICULTY_PROFILE,
    entities: [],
    // Uno stato appena creato non è in corsa: serve startRun.
    alive: false,
    forgivenessUsed: false,
    firstHitUsed: false,
    chargeRatioBefore: 0,
    previousRecord: 0,
    recordBeaten: false,
    multiplier: 1,
  };
}

/**
 * Tutto ciò che una corsa deve sapere e che le regole non possono scoprire da
 * sole, perché vive su disco: è il livello platform (main.ts, storage.ts) a
 * leggerlo e a passarlo qui.
 *
 * Oggetto e non parametri posizionali: erano già quattro, il quinto avrebbe
 * reso `startRun(game, 8, 50, undefined, true)` illeggibile sul posto di
 * chiamata, e ogni campo qui è opzionale e indipendente dagli altri — la forma
 * per cui l'oggetto esiste.
 */
export interface StartRunOptions {
  /** Seed della corsa. Assente: si riusa quello dello stato. */
  seed?: number;
  /**
   * Record da battere. Le regole non sanno leggerlo (è su disco, e il disco è
   * di platform/storage.ts), quindi glielo passa chi avvia la corsa. Serve a
   * due cose: emettere 'record:beaten' nel momento in cui il record cade — che
   * è il momento più gratificante di una partita, e prima lo si scopriva solo
   * morendo — e a riempire `isRecord` in 'run:ended' senza toccare
   * localStorage da dentro `hitObstacle`.
   */
  previousRecord?: number;
  /**
   * Profilo di difficoltà scelto dall'utente. Arriva dalla stessa direzione e
   * per la stessa ragione: è una preferenza, quindi sta su disco, quindi le
   * regole non la leggono. Un nome sconosciuto o assente ricade sul profilo
   * normale, i cui tre numeri coincidono con quelli di CONFIG: senza profilo
   * il gioco è identico a prima.
   */
  profileName?: string;
  /**
   * Questa corsa è ancora guidata: il giocatore non ha imparato nessuna delle
   * azioni (`taught.size === 0` nel livello platform, che è l'unico a sapere
   * cosa c'è in localStorage). L'unico effetto sulle regole è allontanare il
   * primo ostacolo a `CONFIG.tutorial.firstObstacleZ`, così c'è il tempo di
   * LEGGERE il prompt prima di doverci reagire: prima nasceva a 37-48 unità,
   * cioè 2,3 secondi dopo l'avvio, e la chiave di config non era usata da
   * nessuno.
   *
   * È un booleano e non la distanza perché il livello platform sa SE il
   * giocatore ha imparato, non a quante unità vada messo un ostacolo: il
   * numero resta in config e lo leggono le regole.
   */
  tutorial?: boolean;
}

/** Avvia una corsa. Vedi `StartRunOptions` per ciò che il chiamante deve
 *  fornire e perché non può saperlo il livello di gioco. */
export function startRun(game: GameState, options: StartRunOptions = {}): void {
  const { seed, previousRecord = 0, profileName, tutorial = false } = options;
  if (seed !== undefined) game.seed = seed;
  if (profileName !== undefined) game.profile = resolveDifficultyProfile(profileName);

  game.rng = createRng(game.seed);
  game.spawner = createSpawner(game.rng, game.profile, {
    firstObstacleZ: tutorial ? CONFIG.tutorial.firstObstacleZ : undefined,
  });
  game.world = createWorld(game.profile);
  game.path = createPath();
  game.player = createPlayer();
  game.avalanche = createAvalanche();
  game.buffs = createBuffs();
  game.score = createScore();
  game.entities.length = 0;
  game.alive = true;
  game.forgivenessUsed = false;
  game.firstHitUsed = false;
  game.chargeRatioBefore = 0;
  game.previousRecord = Math.max(0, previousRecord);
  game.recordBeaten = false;
  game.multiplier = 1;

  // Il tronco esiste già (i chunk di world.ts) ma è vuoto: senza popolarlo
  // subito, il primo riciclo di chunk sarebbe l'unica occasione di
  // generazione e la partenza sarebbe un pendio vuoto per diversi secondi.
  const difficulty = difficultyAt(game.world.distance);
  const lateProgress = lateRampAt(game.world.distance);
  const chunks = game.world.chunks;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    populateTrunk(game, chunk.z, CONFIG.world.chunkLength, difficulty, lateProgress);
  }

  // Zona franca: nessuna entità nasce addosso al giocatore.
  const spawnSafeZ = CONFIG.world.spawnSafeZ;
  for (let i = 0; i < game.entities.length; i++) {
    const entity = game.entities[i];
    if (entity !== undefined && entity.z < spawnSafeZ) entity.alive = false;
  }
  compactEntities(game.entities);

  game.bus.emit('run:started', { seed: game.seed });
}

/**
 * Interrompe la run corrente SENZA che sia stata una morte: es. il giocatore
 * torna al menu mentre è ancora vivo. Emette 'run:stopped', non 'run:ended'
 * (riservato alla morte, fa scattare il rallentatore in main.ts).
 *
 * Restituisce l'esito della corsa, che il chiamante DEVE salvare esattamente
 * come fa alla morte: chi arriva a 8000 punti e preme Esc per smettere perdeva
 * tutto, perché il salvataggio era annidato dentro hitObstacle. Restituisce
 * null se non c'era una corsa in vita (chiamata idempotente).
 */
export function abandonRun(game: GameState): RunSummary | null {
  if (!game.alive) return null;
  game.alive = false;
  const summary = runSummary(game);
  game.bus.emit('run:stopped', {});
  return summary;
}

export function handleAction(game: GameState, action: Action): void {
  if (!game.alive) return;

  switch (action) {
    case 'CHOOSE_LEFT':
      chooseSide(game, 'left');
      break;
    case 'CHOOSE_RIGHT':
      chooseSide(game, 'right');
      break;
    case 'JUMP':
      jump(game.player, game.bus);
      break;
    case 'SLIDE':
      slide(game.player, game.bus);
      break;
    case 'PAUSE':
      // La pausa è una transizione della macchina a stati, non un'azione di gioco.
      break;
  }
}

/**
 * Uno swipe laterale. Dentro la finestra di avvicinamento è una scelta, e va
 * annunciata: 'fork:chosen' è l'unico riscontro che il giocatore riceve prima
 * del punto di non ritorno. Fuori dalla finestra non fa nulla, ma resta
 * ricordata per un istante come scelta anticipata (design §4) — e solo se un
 * bivio è davvero imminente: `rememberChoice` rifiuta il resto, che quasi
 * sempre è un salto malriuscito e non una scelta (vedi path.ts).
 */
function chooseSide(game: GameState, side: 'left' | 'right'): void {
  if (chooseBranch(game.path, side)) {
    game.bus.emit('fork:chosen', { side });
    return;
  }
  rememberChoice(game.path, side);
}

export function updateGame(game: GameState, dt: number): void {
  if (!game.alive) return;

  const distanceBefore = game.world.distance;
  updateWorld(game.world, dt, game.profile);
  const moved = game.world.distance - distanceBefore;

  // path: si cattura la fase (e il ramo attivo) PRIMA di aggiornare, perché
  // updatePath può farli scattare nello stesso frame e altrimenti perderemmo
  // il "prima" necessario a rilevare la transizione.
  const phaseBefore = game.path.phase;
  const activeBranchBefore = activeBranchOf(game.path);
  // Riassegnazione e non mutazione: `phase` è il discriminante dell'unione,
  // e cambiarlo significa cambiare tipo (vedi path.ts). Si alloca solo nelle
  // quattro transizioni di un bivio, non a ogni frame.
  game.path = updatePath(game.path, moved, game.world.speed, game.rng, game.bus);

  updatePlayer(game.player, dt, game.bus);
  updateAvalanche(game.avalanche, dt, game.bus);
  updateBuffs(game.buffs, dt, game.bus);
  updateSmashChain(game.score, dt);

  // Avanzamento del mondo PRIMA della generazione: i chunk sono già stati
  // spostati da updateWorld, quindi entità e cursori dello spawner vanno
  // portati nello stesso sistema di riferimento prima di popolare, altrimenti
  // ciò che nasce in questo frame è sfalsato di `moved` rispetto ai cursori
  // che ne misurano la distanza.
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    const zBefore = entity.z;
    entity.z -= moved;
    // Serie: un ostacolo SOLIDO che esce dalla finestra di collisione essendo
    // ancora vivo è un ostacolo schivato. Si conta all'uscita e non al
    // passaggio da z > 0, perché fra 0 e -COLLISION_Z_WINDOW l'urto è ancora
    // possibile in questo stesso frame: contarlo prima significherebbe
    // premiare una schivata e poi ucciderci sopra.
    if (
      entity.category === 'obstacle' &&
      zBefore > -COLLISION_Z_WINDOW &&
      entity.z <= -COLLISION_Z_WINDOW &&
      branchIsSolid(game.path, entity.branch)
    ) {
      registerPassedObstacle(game.score, game.bus);
    }
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }
  game.spawner.advance(moved);

  // spawn: prima le transizioni del bivio (nascita, risoluzione, chiusura),
  // che rimescolano i rami e i loro cursori, poi il rifornimento di routine sui
  // chunk riciclati, che deve già vederli nello stato nuovo.
  // Due assi di difficoltà, non uno: `difficulty` stringe la spaziatura fino a
  // spawn.difficultyRampDistance, `lateProgress` prende il testimone da
  // spawn.lateRampStart in poi e alza la quota di sospesi (alzare ancora la
  // velocità non è un'opzione). Entrambi vanno inoltrati a OGNI
  // populateSegment, altrimenti il tratto che nasce in questo frame è generato
  // con una difficoltà diversa da quello accanto.
  const difficulty = difficultyAt(game.world.distance);
  const lateProgress = lateRampAt(game.world.distance);
  handleForkTransitions(game, phaseBefore, activeBranchBefore, difficulty, lateProgress);
  populateRecycledChunks(game, difficulty, lateProgress);

  // calamita
  applyMagnet(game, dt);

  // collisioni: solo con entità il cui ramo è solido.
  const box = playerBox(game.player.y, game.avalanche.size, game.player.sliding);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (!branchIsSolid(game.path, entity.branch)) continue;
    if (Math.abs(entity.z) > COLLISION_Z_WINDOW) continue;
    if (!boxesOverlap(box, entityBox(entity))) continue;

    resolveCollision(game, entity);
    if (!game.alive) break;
  }

  compactEntities(game.entities);

  // punteggio
  if (game.alive) {
    addDistance(game.score, moved, effectiveMultiplier(game));
  }

  rechargeForgiveness(game);
  // Il moltiplicatore effettivo è ricalcolato DOPO tutto il resto: valanga,
  // stella e serie possono essere cambiate tutte e tre in questo frame, e
  // quello che l'HUD legge deve essere quello con cui si sta segnando adesso.
  game.multiplier = effectiveMultiplier(game);

  if (
    game.alive &&
    !game.recordBeaten &&
    game.previousRecord > 0 &&
    game.score.points > game.previousRecord
  ) {
    game.recordBeaten = true;
    game.bus.emit('record:beaten', { points: game.score.points });
  }
}

/**
 * Rende di nuovo disponibile il perdono quando la barra RIATTRAVERSA
 * minChargeRatio verso l'alto. Si confronta con il valore del frame precedente
 * apposta: guardare solo lo stato ("sono sopra la soglia") ricaricherebbe il
 * perdono a ogni frame passato sopra metà barra, che è la maggior parte di una
 * corsa riuscita — cioè un perdono infinito invece di una risorsa.
 */
function rechargeForgiveness(game: GameState): void {
  const ratio = chargeRatio(game.avalanche);
  const threshold = CONFIG.forgiveness.minChargeRatio;
  if (
    CONFIG.forgiveness.rechargeable &&
    game.forgivenessUsed &&
    game.chargeRatioBefore < threshold &&
    ratio >= threshold
  ) {
    game.forgivenessUsed = false;
  }
  game.chargeRatioBefore = ratio;
}

/**
 * Rifornimento di routine: ogni chunk riciclato va popolato sul ramo giusto.
 * Un chunk riciclato nasce sempre in fondo al mondo, quindi ben OLTRE la
 * biforcazione: durante un bivio appartiene ai rami, non al tronco.
 */
function populateRecycledChunks(game: GameState, difficulty: number, lateProgress: number): void {
  const recycled = game.world.recycled;
  if (recycled.length === 0) return;

  const path = game.path;
  const length = CONFIG.world.chunkLength;

  // Fuori da un bivio si popola il tronco e basta. Il controllo è uscito dal
  // ciclo perché `richBranch` esiste solo DENTRO un bivio: prima era letto
  // qui sopra, dove la fase poteva essere 'none' e il valore un segnaposto.
  if (path.phase === 'none') {
    for (let i = 0; i < recycled.length; i++) {
      const chunk = recycled[i];
      if (chunk === undefined) continue;
      populateTrunk(game, chunk.z, length, difficulty, lateProgress);
    }
    return;
  }

  const richLeft = path.richBranch === 'left';

  for (let i = 0; i < recycled.length; i++) {
    const chunk = recycled[i];
    if (chunk === undefined) continue;

    if (path.phase === 'approaching') {
      const entities = game.entities;
      game.spawner.populateSegment(
        chunk.z,
        length,
        difficulty,
        'left',
        richLeft,
        entities,
        lateProgress,
      );
      game.spawner.populateSegment(
        chunk.z,
        length,
        difficulty,
        'right',
        !richLeft,
        entities,
        lateProgress,
      );
      continue;
    }

    // 'committed' / 'realigning': il ramo scartato è già stato rimosso e non va
    // ripopolato, o resterebbero entità orfane che nessuno può raccogliere e
    // che alla chiusura del bivio galleggerebbero a lato del tracciato.
    const active = path.activeBranch;
    const rich = active === path.richBranch;
    game.spawner.populateSegment(
      chunk.z,
      length,
      difficulty,
      active,
      rich,
      game.entities,
      lateProgress,
    );
  }
}

/**
 * Reagisce alle transizioni di fase del bivio appena avvenute in updatePath.
 * Le tre transizioni rilevanti:
 * - 'none' -> 'approaching': nasce un bivio. I rami vivono OLTRE la
 *   biforcazione (è lì che il terreno si sdoppia, vedi render/terrain.ts):
 *   il tronco resta intatto fino a `forkZ` e i due rami vengono popolati da
 *   `forkZ` fino al fondo del mondo. Così il giocatore, mentre si avvicina,
 *   LEGGE il contenuto dei due rami: è l'informazione su cui decide.
 * - 'approaching' -> 'committed': la scelta è fissata. Le entità del ramo
 *   scartato vengono rimosse subito: nessun leak.
 * - da 'committed'/'realigning' a 'none': il bivio è chiuso, il ramo scelto
 *   è il nuovo tronco. Le sue entità sopravvissute vengono rietichettate
 *   'main', altrimenti branchIsSolid le renderebbe di nuovo inerti.
 */
function handleForkTransitions(
  game: GameState,
  phaseBefore: ForkPhase,
  activeBranchBefore: Branch,
  difficulty: number,
  lateProgress: number,
): void {
  const path = game.path;

  if (phaseBefore === 'none' && path.phase === 'approaching') {
    // Rete di sicurezza: populateTrunk si ferma già alla biforcazione, quindi
    // qui non dovrebbe esserci nulla. Se c'è, è oltre `forkZ` e va tolto,
    // perché quel tratto ora è sdoppiato.
    removeMainEntitiesBeyond(game.entities, path.forkZ);
    // ZONA FRANCA: i rami non ripartono dalla biforcazione ma da
    // branchSpawnStartZ(forkZ), cioè branchClearanceAfterFork unità più in là.
    // Il ramo scelto diventa solido al punto di non ritorno, ma la traslazione
    // laterale del mondo parte solo quando la biforcazione arriva a z=0 e dura
    // realignSeconds: nel frattempo un ostacolo del ramo è già letale MENTRE è
    // disegnato fino a branchSeparation (6) unità di lato, su un corridoio
    // largo trackWidth (4). Misurato prima della zona franca: il 3,43% degli
    // ostacoli letali uccideva così, con un caso peggiore di 6,00 unità —
    // l'unica classe di morte che il giocatore non poteva né prevedere né
    // imparare, e con un bivio ogni ~12 s una morte ingiusta potenziale per
    // bivio. Il costo sono 24 unità di ramo vuote dopo ogni biforcazione, che
    // sono anche una pausa di respiro dopo una decisione.
    //
    // La riga sopra resta su `forkZ` e non su `branchStartZ`: il TRONCO si
    // ferma alla biforcazione, è solo il contenuto dei rami a slittare.
    const branchStartZ = branchSpawnStartZ(path.forkZ);
    // I due rami ripartono da dove si è fermato il tronco (mai prima della
    // zona franca): è ciò che tiene valida l'invariante di giocabilità
    // attraverso la biforcazione.
    game.spawner.copyCursor('main', 'left', branchStartZ);
    game.spawner.copyCursor('main', 'right', branchStartZ);
    const richLeft = path.richBranch === 'left';
    const length = worldHorizonZ(game.world) - branchStartZ;
    const out = game.entities;
    game.spawner.populateSegment(
      branchStartZ,
      length,
      difficulty,
      'left',
      richLeft,
      out,
      lateProgress,
    );
    game.spawner.populateSegment(
      branchStartZ,
      length,
      difficulty,
      'right',
      !richLeft,
      out,
      lateProgress,
    );
    return;
  }

  if (phaseBefore === 'approaching' && path.phase === 'committed') {
    const discarded: Branch = path.activeBranch === 'left' ? 'right' : 'left';
    removeEntitiesOnBranch(game.entities, discarded);
    return;
  }

  if (phaseBefore !== 'none' && path.phase === 'none') {
    // Il vecchio tronco è ormai tutto alle spalle (per costruzione main.z <=
    // forkZ, e a fine riallineamento forkZ vale meno di -speed*realignSeconds)
    // ED è rimasto indietro DI LATO: è ancorato a offsetX, che in questo stesso
    // frame torna a 0. Senza toglierlo, ogni chiusura di bivio gli farebbe fare
    // uno scatto laterale pari all'intera separazione dei rami. Quel tronco non
    // esiste più: la strada, adesso, è il ramo scelto.
    removeEntitiesOnBranch(game.entities, 'main');
    relabelBranch(game.entities, activeBranchBefore, 'main');
    // Il tronco eredita il cursore del ramo che è appena diventato tronco: il
    // primo ostacolo dopo il bivio dista dall'ultimo del ramo quanto deve.
    game.spawner.copyCursor(activeBranchBefore, 'main', -Infinity);
    const discarded: Branch = activeBranchBefore === 'left' ? 'right' : 'left';
    removeEntitiesOnBranch(game.entities, discarded);
  }
}

function removeMainEntitiesBeyond(entities: Entity[], minZ: number): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.branch === 'main' && entity.z > minZ) entity.alive = false;
  }
}

function removeEntitiesOnBranch(entities: Entity[], branch: Branch): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.branch === branch) entity.alive = false;
  }
}

function relabelBranch(entities: Entity[], from: Branch, to: Branch): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined) continue;
    if (entity.branch === from) entity.branch = to;
  }
}

/**
 * La calamita TRASCINA i fiocchi invece di raccoglierli a distanza.
 *
 * Prima li raccoglieva direttamente entro magnetRangeZ (14 unità): dal punto
 * di vista del giocatore i fiocchi svanivano mezzo secondo prima di arrivare,
 * senza nessuna traiettoria che li collegasse alla mucca, e si sentivano sei
 * suoni di raccolta al secondo. Era il secondo buff più forte del gioco e
 * quello di cui si percepiva meno l'effetto.
 *
 * Ora il fiocco in raggio accelera verso z=0 di magnetPullSpeed (in aggiunta
 * allo scorrimento del mondo) e viene raccolto quando ARRIVA. La raccolta è
 * esplicita e non affidata al test di collisione perché un fiocco di una fila
 * ad arco sta fino a trailArcHeight sopra il suolo: passerebbe sopra la testa
 * della mucca senza che le due AABB si tocchino mai.
 */
function applyMagnet(game: GameState, dt: number): void {
  if (!magnetActive(game.buffs)) return;

  const rangeZ = CONFIG.buffs.magnetRangeZ;
  const pull = CONFIG.buffs.magnetPullSpeed * dt;
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.kind !== 'snowflake') continue;
    if (entity.z <= 0 || entity.z > rangeZ) continue;
    if (!branchIsSolid(game.path, entity.branch)) continue;
    entity.attracted = true;
    entity.z -= pull;
    if (entity.z <= 0) collectPickup(game, entity, 'snowflake');
  }
}

/**
 * Fa avanzare solo il pendio e le posizioni delle entità esistenti, senza
 * collisioni, punteggio o nuova generazione: usata da main.ts durante il
 * rallentatore alla morte (game.alive è già false, updateGame non fa nulla).
 */
export function advanceWorldOnly(game: GameState, dt: number): void {
  const distanceBefore = game.world.distance;
  updateWorld(game.world, dt, game.profile);
  const moved = game.world.distance - distanceBefore;

  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }
  compactEntities(game.entities);
}

function resolveCollision(game: GameState, entity: Entity): void {
  if (isPickupKind(entity.kind)) {
    collectPickup(game, entity, entity.kind);
    return;
  }
  hitObstacle(game, entity, entity.kind);
}

/**
 * TUTTI i buff passano da applyBuff, che è il solo posto in cui vive la
 * definizione di "cosa fa un buff" e il solo che emette 'buff:gained'. Il
 * cristallo non fa eccezione anche se di stato non ne ha: il suo effetto è la
 * carica, aggiunta qui sotto, ma la sua RACCOLTA va annunciata come quella
 * degli altri tre, altrimenti resta l'unico raccoglibile senza timbro audio.
 * Il fiocco non è un buff e non passa di lì: dà carica e basta.
 */
function collectPickup(game: GameState, entity: Entity, kind: PickupKind): void {
  entity.alive = false;

  // Il moltiplicatore è letto prima di qualunque effetto: il pickup che fa
  // scattare la valanga vale ancora il moltiplicatore precedente.
  const multiplier = effectiveMultiplier(game);
  addBonus(game.score, CONFIG.score.pickupBonus[kind], multiplier);

  if (kind !== 'snowflake') applyBuff(game.buffs, kind, game.bus);

  if (kind === 'star' || kind === 'magnet' || kind === 'bell') {
    game.bus.emit('pickup:collected', { kind, charge: 0 });
    return;
  }

  const base = CONFIG.pickups.charge[kind];
  // Barra PIÙ serbatoio: durante la valanga la barra è congelata ma la carica
  // non è più persa (finisce nel riporto, vedi avalanche.ts), e l'evento deve
  // dire quanta se ne è davvero guadagnata — altrimenti l'HUD continuerebbe a
  // raccontare zero proprio nella fase in cui il riporto si costruisce.
  const chargeBefore = game.avalanche.charge + game.avalanche.carryOver;
  addCharge(game.avalanche, base, game.bus);
  const chargeAfter = game.avalanche.charge + game.avalanche.carryOver;
  game.bus.emit('pickup:collected', { kind, charge: chargeAfter - chargeBefore });
}

function hitObstacle(game: GameState, entity: Entity, kind: ObstacleKind): void {
  const multiplier = effectiveMultiplier(game);
  const branch = entity.branch;
  const z = entity.z;

  if (canSmash(game.avalanche, kind)) {
    entity.alive = false;
    // Sfondare NON rompe la serie: è il premio della valanga, non un errore.
    // Il bonus cresce con la catena (vedi score.ts, registerSmash): è l'unica
    // cosa da giocare nei secondi di invulnerabilità, in cui nessun input
    // conta e finora si guardava soltanto.
    addBonus(game.score, registerSmash(game.score), multiplier);
    game.bus.emit('obstacle:hit', { kind, outcome: 'smashed', branch, z });
    return;
  }

  // Da qui in giù il colpo è stato SUBITO, in un modo o nell'altro: la serie
  // si azzera anche quando il colpo non costa la corsa. È ciò che rende una
  // sequenza pulita diversa da una sequenza con tre perdoni in mezzo.
  breakStreak(game.score, game.bus);

  if (consumeShield(game.buffs, game.bus)) {
    entity.alive = false;
    game.bus.emit('obstacle:hit', { kind, outcome: 'shielded', branch, z });
    return;
  }

  const ratio = chargeRatio(game.avalanche);
  // Il perdono è una RISORSA, non una vita gratis all'inizio. Prima la
  // condizione era `carica >= minChargeRatio || firstHitFree`: con
  // firstHitFree a true la disgiunzione era sempre vera, quindi minChargeRatio
  // era configurazione morta e il perdono era semplicemente uno per corsa a
  // qualunque carica — disponibile quando non serviva (i primi secondi) e
  // sparito quando sarebbe servito (tre minuti dentro, a taglia 5).
  //
  // Ora `forgivenessUsed` torna false quando la barra riattraversa
  // minChargeRatio (vedi rechargeForgiveness), e `firstHitUsed` tiene
  // l'eccezione di onboarding a UNA volta per corsa: il primissimo impatto
  // passa anche a carica zero, i successivi vanno pagati riempiendo la barra.
  const forgivable =
    CONFIG.forgiveness.enabled &&
    !game.forgivenessUsed &&
    (ratio >= CONFIG.forgiveness.minChargeRatio ||
      (CONFIG.forgiveness.firstHitFree && !game.firstHitUsed));

  if (forgivable) {
    game.forgivenessUsed = true;
    game.firstHitUsed = true;
    // L'ostacolo perdonato sparisce: altrimenti colpirebbe di nuovo il frame dopo.
    entity.alive = false;
    applyForgivenessPenalty(game.avalanche, game.bus);
    game.bus.emit('obstacle:hit', { kind, outcome: 'forgiven', branch, z });
    return;
  }

  game.alive = false;
  game.bus.emit('obstacle:hit', { kind, outcome: 'death', branch, z });

  // Il salvataggio del record NON sta più qui: "il giocatore ha sbattuto" e
  // "scrivi su disco" erano la stessa istruzione, e chi abbandonava la corsa
  // da vivo non salvava nulla. `isRecord` si calcola dal record che chi ha
  // avviato la corsa ci ha passato (startRun), e la persistenza è di chi
  // ascolta l'evento (vedi platform/storage.ts).
  game.bus.emit('run:ended', runSummary(game));
}

/** Compattazione a due indici, in place: nessun array nuovo per frame. */
function compactEntities(entities: Entity[]): void {
  let write = 0;
  for (let read = 0; read < entities.length; read += 1) {
    const entity = entities[read];
    if (entity === undefined || !entity.alive) continue;
    if (write !== read) entities[write] = entity;
    write += 1;
  }
  entities.length = write;
}
