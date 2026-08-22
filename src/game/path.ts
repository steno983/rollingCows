import type { EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Branch } from './types';

export type ForkPhase = 'none' | 'approaching' | 'committed' | 'realigning';

/**
 * Campi che esistono in OGNI fase, e che quindi si possono leggere senza
 * chiedersi a che punto sia il bivio.
 */
interface PathCommon {
  /** Offset laterale corrente del mondo, in unità. 0 = tracciato dritto. */
  offsetX: number;
  /** Scelta data FUORI dalla finestra di avvicinamento (design §4: "uno swipe
   *  dato appena prima che il bivio compaia vale come scelta anticipata").
   *  Vale solo finché `pendingChoiceTimeLeft` è positivo. */
  pendingChoice: 'left' | 'right' | null;
  pendingChoiceTimeLeft: number;
}

/** Nessun bivio in corso: il tracciato è dritto e se ne aspetta uno. */
export interface PathNone extends PathCommon {
  phase: 'none';
  /** Distanza ancora da percorrere prima che il prossimo bivio COMPAIA. */
  nextForkIn: number;
}

/** Il bivio è visibile e la scelta è ancora cambiabile. */
export interface PathApproaching extends PathCommon {
  phase: 'approaching';
  /** Distanza della biforcazione dal giocatore: positiva, cala a ogni frame. */
  forkZ: number;
  /** Ramo verso cui il giocatore è orientato: null finché non sceglie. */
  choice: 'left' | 'right' | null;
  /** Quale dei due rami è quello ricco (più fiocchi e buff, più ostacoli). */
  richBranch: 'left' | 'right';
}

/** Punto di non ritorno superato: il ramo è deciso e già solido, ma la
 *  biforcazione non è ancora stata raggiunta. */
export interface PathCommitted extends PathCommon {
  phase: 'committed';
  /** Ancora positiva: quanto manca alla biforcazione. */
  forkZ: number;
  choice: 'left' | 'right';
  richBranch: 'left' | 'right';
  /** Ramo solido. Non può più essere 'main': è per questo che il tipo lo
   *  restringe ai due lati invece di lasciarlo Branch. */
  activeBranch: 'left' | 'right';
}

/** Biforcazione superata: il mondo trasla lateralmente per riportare il ramo
 *  scelto al centro. */
export interface PathRealigning extends PathCommon {
  phase: 'realigning';
  /** Da qui in giù è NEGATIVA: il suo valore assoluto è la distanza percorsa
   *  oltre la biforcazione, che a velocità nota si converte in "quanto tempo è
   *  passato" senza bisogno di un campo a parte. */
  forkZ: number;
  choice: 'left' | 'right';
  richBranch: 'left' | 'right';
  activeBranch: 'left' | 'right';
  /** Avanzamento del riallineamento, 0..1. Serve alla vista per far svanire il
   *  nastro scartato invece di vederlo saltare al centro nel frame in cui il
   *  bivio si chiude. */
  realignProgress: number;
}

/**
 * Stato del percorso, come UNIONE DISCRIMINATA su `phase`.
 *
 * Era un record piatto con i campi condizionali documentati a parole («valido
 * se phase !== none», «segnaposto senza significato»): sei moduli facevano
 * ciascuno il proprio controllo di fase per sapere cosa potevano leggere, e chi
 * se ne dimenticava leggeva un segnaposto mentre il compilatore taceva. È
 * precisamente il punto in cui i bug del bivio erano già stati due volte. Ora
 * `forkZ` non esiste dove non c'è un bivio, `realignProgress` non esiste fuori
 * dal riallineamento, e `activeBranch` non esiste — né vale 'main' — prima del
 * punto di non ritorno: leggerli fuori posto non compila.
 *
 * Conseguenza inevitabile: il discriminante non si può cambiare mutando
 * l'oggetto, quindi `updatePath` RESTITUISCE lo stato nuovo e il chiamante lo
 * riassegna. Dentro una fase la mutazione in place resta (nessuna allocazione
 * per frame); si alloca solo nelle quattro transizioni di un bivio.
 */
export type PathState = PathNone | PathApproaching | PathCommitted | PathRealigning;

const SIDES: readonly ('left' | 'right')[] = ['left', 'right'];

export function createPath(): PathNone {
  return {
    phase: 'none',
    offsetX: 0,
    // Il primissimo bivio di una corsa usa la sua distanza dedicata
    // (firstForkIn), più vicina di minGap: senza questo, per vedere il primo
    // bivio bisognerebbe superare tre ostacoli, e chi non conosce ancora i
    // comandi spesso muore prima di arrivarci. I bivi successivi, alla
    // chiusura del riallineamento qui sotto, tornano a minGap/gapPerSpeed.
    nextForkIn: CONFIG.path.firstForkIn,
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
  };
}

/**
 * Ramo solido corrente, per chi ha in mano uno stato di fase ignota e non può
 * restringerla: fuori da un bivio impegnato la strada è il tronco. Prima
 * `activeBranch` esisteva sempre e valeva 'main' come segnaposto; ora quel
 * segnaposto è una funzione, cioè una cosa che si legge apposta invece di un
 * campo che si legge per sbaglio.
 */
export function activeBranchOf(path: PathState): Branch {
  if (path.phase === 'committed' || path.phase === 'realigning') return path.activeBranch;
  return 'main';
}

/** Distanza della biforcazione, o null se non c'è alcun bivio in corso. Stesso
 *  ruolo di `activeBranchOf`: rende esplicito il caso "non esiste". */
export function forkZOf(path: PathState): number | null {
  return path.phase === 'none' ? null : path.forkZ;
}

/** Avanzamento del riallineamento, 0 fuori dalla fase che lo possiede. Serve a
 *  chi deve confrontare lo stato del percorso con quello del frame precedente
 *  (la cache della geometria del nastro, in render/terrain.ts) e quindi legge
 *  tutti i campi senza poter restringere la fase. */
export function realignProgressOf(path: PathState): number {
  return path.phase === 'realigning' ? path.realignProgress : 0;
}

/** Offset laterale a cui va disegnato un ramo, in unità di mondo. Pura
 *  geometria del bivio: non dipende dalla fase corrente. */
export function branchOffsetX(_path: PathState, branch: Branch): number {
  if (branch === 'left') return -CONFIG.path.branchSeparation;
  if (branch === 'right') return CONFIG.path.branchSeparation;
  return 0;
}

/** true se le entità di quel ramo sono solide (collidono e si raccolgono). */
export function branchIsSolid(path: PathState, branch: Branch): boolean {
  if (branch === 'main') return true;
  return activeBranchOf(path) === branch;
}

/**
 * Registra o cambia la scelta. Restituisce false se non c'è un bivio
 * scegliibile (nessun bivio in corso, o punto di non ritorno già superato).
 * Non emette eventi: la firma non riceve il bus, quindi 'fork:chosen' è
 * responsabilità del chiamante (l'orchestratore), che lo emette quando questa
 * funzione restituisce true.
 */
export function chooseBranch(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'approaching') return false;
  path.choice = side;
  path.pendingChoice = null;
  path.pendingChoiceTimeLeft = 0;
  return true;
}

/**
 * Memorizza uno swipe laterale dato quando NON c'è un bivio scegliibile — ma
 * SOLO se il prossimo bivio è imminente, cioè se manca al massimo
 * `CONFIG.path.earlyChoiceWindowZ` alla sua comparsa. Restituisce true se la
 * scelta è stata davvero memorizzata.
 *
 * La finestra non è un dettaglio di taratura: senza, uno swipe dato in mezzo
 * al nulla restava valido 0,6 s e veniva applicato a qualunque bivio nascesse
 * in quel lasso, senza che il giocatore lo sapesse. Combinato col fatto che
 * uno swipe diagonale veniva letto come laterale (vedi
 * input.horizontalDominance), un salto malriuscito diventava una scelta di
 * ramo silenziosa — e la scelta al bivio è LA decisione del gioco.
 *
 * Le fasi diverse da 'none' escono subito, e ora è il tipo stesso a spiegare
 * perché: `nextForkIn` esiste SOLO in `PathNone`. Durante un bivio in corso
 * non c'è alcuna distanza dal prossimo bivio da confrontare con la finestra.
 */
export function rememberChoice(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'none') return false;
  if (path.nextForkIn > CONFIG.path.earlyChoiceWindowZ) return false;
  path.pendingChoice = side;
  path.pendingChoiceTimeLeft = CONFIG.path.earlyChoiceSeconds;
  return true;
}

/**
 * Avanza il percorso di `travelled` unità e restituisce lo stato risultante,
 * che è lo STESSO oggetto se la fase non è cambiata e uno nuovo se lo è. Il
 * chiamante deve riassegnare: `game.path = updatePath(game.path, ...)`.
 */
export function updatePath(
  path: PathState,
  travelled: number,
  speed: number,
  rng: Rng,
  bus: EventBus,
): PathState {
  // La scelta anticipata scade nel TEMPO, non nella distanza (design §4: "per
  // un breve istante"). Il dt non è un parametro perché updatePath ragiona in
  // distanze, ma si ricava esatto: updateWorld calcola travelled = speed * dt
  // con la stessa `speed` passata qui.
  if (path.pendingChoiceTimeLeft > 0) {
    const dt = speed > 0 ? travelled / speed : 0;
    path.pendingChoiceTimeLeft = Math.max(0, path.pendingChoiceTimeLeft - dt);
    if (path.pendingChoiceTimeLeft === 0) path.pendingChoice = null;
  }

  switch (path.phase) {
    case 'none':
      return advanceNone(path, travelled, rng, bus);
    case 'approaching':
      return advanceApproaching(path, travelled, bus);
    case 'committed':
      return advanceCommitted(path, travelled, speed);
    case 'realigning':
      path.forkZ -= travelled;
      return applyRealignment(path, speed);
  }
}

/** Attesa del prossimo bivio, e sua nascita. */
function advanceNone(path: PathNone, travelled: number, rng: Rng, bus: EventBus): PathState {
  path.nextForkIn -= travelled;
  if (path.nextForkIn > 0) return path;

  // L'eccesso di questo passo appartiene già al bivio appena nato: senza
  // scalarlo da previewZ, ogni bivio nascerebbe un po' più lontano di
  // quanto dovrebbe, un errore che si accumulerebbe run dopo run.
  const overshoot = -path.nextForkIn;
  const richBranch = rng.pick(SIDES);
  const next: PathApproaching = {
    phase: 'approaching',
    forkZ: CONFIG.path.previewZ - overshoot,
    choice: null,
    richBranch,
    offsetX: path.offsetX,
    // La scelta anticipata si consuma qui, in un modo o nell'altro: o diventa
    // la scelta del bivio appena nato, o non serve più a niente.
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
  };
  bus.emit('fork:appeared', { richBranch });

  // Scelta anticipata: lo swipe dato poco prima che il bivio comparisse
  // vale come scelta, ed è a tutti gli effetti una scelta del giocatore,
  // quindi emette 'fork:chosen' come se fosse arrivata adesso.
  const pending = path.pendingChoice;
  if (pending !== null) {
    next.choice = pending;
    bus.emit('fork:chosen', { side: pending });
  }
  return next;
}

/** Avvicinamento, e punto di non ritorno. */
function advanceApproaching(path: PathApproaching, travelled: number, bus: EventBus): PathState {
  path.forkZ -= travelled;
  if (path.forkZ > CONFIG.path.commitZ) return path;

  // Punto di non ritorno: chi non ha scelto imbocca il ramo più sgombro,
  // cioè quello NON ricco. L'indecisione costa il premio, mai la corsa.
  const resolved = path.choice ?? (path.richBranch === 'left' ? 'right' : 'left');
  const next: PathCommitted = {
    phase: 'committed',
    forkZ: path.forkZ,
    choice: resolved,
    richBranch: path.richBranch,
    activeBranch: resolved,
    offsetX: path.offsetX,
    pendingChoice: path.pendingChoice,
    pendingChoiceTimeLeft: path.pendingChoiceTimeLeft,
  };
  bus.emit('fork:resolved', { side: resolved });
  return next;
}

/** Ultimo tratto prima della biforcazione vera e propria: il ramo è già
 *  solido, ma il mondo non ha ancora iniziato a scorrere lateralmente. */
function advanceCommitted(path: PathCommitted, travelled: number, speed: number): PathState {
  path.forkZ -= travelled;
  if (path.forkZ > 0) return path;

  const next: PathRealigning = {
    phase: 'realigning',
    forkZ: path.forkZ,
    choice: path.choice,
    richBranch: path.richBranch,
    activeBranch: path.activeBranch,
    offsetX: path.offsetX,
    pendingChoice: path.pendingChoice,
    pendingChoiceTimeLeft: path.pendingChoiceTimeLeft,
    realignProgress: 0,
  };
  // Nessuna uscita anticipata: l'eccedenza di questo passo è già distanza
  // percorsa OLTRE la biforcazione, quindi appartiene al riallineamento.
  // Uscendo qui, il primo frame di 'realigning' avrebbe applicato in un colpo
  // solo due passi di traslazione laterale — uno scatto visibile all'inizio di
  // ogni chiusura di bivio.
  return applyRealignment(next, speed);
}

/** Traslazione laterale del mondo durante il riallineamento, e chiusura del
 *  bivio quando è completa. Legge solo `forkZ`, già aggiornato dal chiamante. */
function applyRealignment(path: PathRealigning, speed: number): PathState {
  const distancePast = -path.forkZ;
  const realignDistance = Math.max(1e-6, speed * CONFIG.path.realignSeconds);
  const t = Math.min(1, Math.max(0, distancePast / realignDistance));
  path.offsetX = -branchOffsetX(path, path.activeBranch) * t;
  path.realignProgress = t;
  if (t < 1) return path;

  // Bivio chiuso: il ramo scelto è il nuovo tronco. I campi del bivio non
  // vengono "azzerati", semplicemente non esistono più in questa fase.
  return {
    phase: 'none',
    offsetX: 0,
    nextForkIn: CONFIG.path.minGap + CONFIG.path.gapPerSpeed * speed,
    pendingChoice: path.pendingChoice,
    pendingChoiceTimeLeft: path.pendingChoiceTimeLeft,
  };
}

/**
 * Costruttori di stati di bivio, per i test.
 *
 * Prima i test di vista si fabbricavano lo stato con
 * `{ ...createPath(), phase: 'committed', activeBranch: 'left' }`: con
 * l'unione quel letterale non ha più un tipo (lo spread produce un `phase`
 * incerto), ma soprattutto non lo aveva mai davvero — permetteva un
 * `{ phase: 'none', activeBranch: 'right' }`, cioè uno stato che il gioco non
 * può produrre e su cui non ha senso testare la vista. Questi costruttori
 * chiedono esattamente i campi che quella fase possiede, e nulla di più.
 */
export function forkApproaching(options: {
  forkZ: number;
  richBranch?: 'left' | 'right';
  choice?: 'left' | 'right' | null;
  offsetX?: number;
}): PathApproaching {
  return {
    phase: 'approaching',
    forkZ: options.forkZ,
    choice: options.choice ?? null,
    richBranch: options.richBranch ?? 'left',
    offsetX: options.offsetX ?? 0,
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
  };
}

export function forkCommitted(options: {
  forkZ: number;
  activeBranch: 'left' | 'right';
  richBranch?: 'left' | 'right';
  offsetX?: number;
}): PathCommitted {
  return {
    phase: 'committed',
    forkZ: options.forkZ,
    choice: options.activeBranch,
    richBranch: options.richBranch ?? 'left',
    activeBranch: options.activeBranch,
    offsetX: options.offsetX ?? 0,
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
  };
}

export function forkRealigning(options: {
  activeBranch: 'left' | 'right';
  realignProgress: number;
  forkZ?: number;
  richBranch?: 'left' | 'right';
  offsetX?: number;
}): PathRealigning {
  return {
    phase: 'realigning',
    // Oltre la biforcazione forkZ è negativa; il valore preciso non serve a
    // chi legge realignProgress, che è già la conversione in avanzamento.
    forkZ: options.forkZ ?? 0,
    choice: options.activeBranch,
    richBranch: options.richBranch ?? 'left',
    activeBranch: options.activeBranch,
    offsetX: options.offsetX ?? 0,
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
    realignProgress: options.realignProgress,
  };
}
