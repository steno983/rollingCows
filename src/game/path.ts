import type { EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Branch } from './types';

export type ForkPhase = 'none' | 'approaching' | 'committed' | 'realigning';

export interface PathState {
  phase: ForkPhase;
  /** Distanza della biforcazione dal giocatore. Valida se phase !== 'none':
   *  positiva prima di raggiungerla, negativa (distanza già percorsa) dopo. */
  forkZ: number;
  /** Ramo verso cui il giocatore è orientato: null finché non sceglie. */
  choice: 'left' | 'right' | null;
  /** Quale dei due rami è quello ricco (più fiocchi e buff, più ostacoli). */
  richBranch: 'left' | 'right';
  /** Ramo solido: 'main' finché non ci si impegna, poi il ramo scelto. */
  activeBranch: Branch;
  /** Offset laterale corrente del mondo, in unità. 0 = tracciato dritto. */
  offsetX: number;
  /** Distanza ancora da percorrere prima del prossimo bivio. */
  nextForkIn: number;
  /** Scelta data FUORI dalla finestra di avvicinamento (design §4: "uno swipe
   *  dato appena prima che il bivio compaia vale come scelta anticipata").
   *  Vale solo finché `pendingChoiceTimeLeft` è positivo. */
  pendingChoice: 'left' | 'right' | null;
  pendingChoiceTimeLeft: number;
  /** Avanzamento del riallineamento, 0..1. Vale 0 fuori dalla fase
   *  'realigning'. Serve alla vista per far svanire il nastro scartato invece
   *  di vederlo saltare al centro nel frame in cui il bivio si chiude. */
  realignProgress: number;
}

const SIDES: readonly ('left' | 'right')[] = ['left', 'right'];

export function createPath(): PathState {
  return {
    phase: 'none',
    forkZ: 0,
    choice: null,
    // Placeholder senza significato: sovrascritto non appena appare il primo
    // bivio (vedi il commento su forkZ qui sopra: "valido se phase !== 'none'").
    richBranch: 'left',
    activeBranch: 'main',
    offsetX: 0,
    // Il primissimo bivio di una corsa usa la sua distanza dedicata
    // (firstForkIn), più vicina di minGap: senza questo, per vedere il primo
    // bivio bisognerebbe superare tre ostacoli, e chi non conosce ancora i
    // comandi spesso muore prima di arrivarci. I bivi successivi, alla
    // chiusura del riallineamento qui sotto, tornano a minGap/gapPerSpeed.
    nextForkIn: CONFIG.path.firstForkIn,
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
    realignProgress: 0,
  };
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
  return path.activeBranch === branch;
}

/**
 * Registra o cambia la scelta. Restituisce false se non c'è un bivio
 * scegliibile (nessun bivio in corso, o punto di non ritorno già superato).
 * Non emette eventi: la firma non riceve il bus, quindi 'fork:chosen' è
 * responsabilità del chiamante (l'orchestratore, task successivo), che lo
 * emette quando questa funzione restituisce true.
 */
export function chooseBranch(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'approaching') return false;
  path.choice = side;
  path.pendingChoice = null;
  path.pendingChoiceTimeLeft = 0;
  return true;
}

/**
 * Memorizza uno swipe laterale dato quando NON c'è un bivio scegliibile. Se un
 * bivio compare entro `CONFIG.path.earlyChoiceSeconds` quello swipe vale come
 * scelta già data (design §4); altrimenti scade e non lascia traccia. Da
 * chiamare quando `chooseBranch` restituisce false.
 */
export function rememberChoice(path: PathState, side: 'left' | 'right'): void {
  path.pendingChoice = side;
  path.pendingChoiceTimeLeft = CONFIG.path.earlyChoiceSeconds;
}

/** Avanza il percorso. `travelled` è la distanza percorsa in questo frame. */
export function updatePath(
  path: PathState,
  travelled: number,
  speed: number,
  rng: Rng,
  bus: EventBus,
): void {
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
    case 'none': {
      path.nextForkIn -= travelled;
      if (path.nextForkIn > 0) return;
      // L'eccesso di questo passo appartiene già al bivio appena nato: senza
      // scalarlo da previewZ, ogni bivio nascerebbe un po' più lontano di
      // quanto dovrebbe, un errore che si accumulerebbe run dopo run.
      const overshoot = -path.nextForkIn;
      path.phase = 'approaching';
      path.forkZ = CONFIG.path.previewZ - overshoot;
      path.choice = null;
      path.richBranch = rng.pick(SIDES);
      bus.emit('fork:appeared', { richBranch: path.richBranch });
      // Scelta anticipata: lo swipe dato poco prima che il bivio comparisse
      // vale come scelta, ed è a tutti gli effetti una scelta del giocatore,
      // quindi emette 'fork:chosen' come se fosse arrivata adesso.
      const pending = path.pendingChoice;
      path.pendingChoice = null;
      path.pendingChoiceTimeLeft = 0;
      if (pending !== null) {
        path.choice = pending;
        bus.emit('fork:chosen', { side: pending });
      }
      return;
    }
    case 'approaching': {
      path.forkZ -= travelled;
      if (path.forkZ > CONFIG.path.commitZ) return;
      // Punto di non ritorno: chi non ha scelto imbocca il ramo più sgombro,
      // cioè quello NON ricco. L'indecisione costa il premio, mai la corsa.
      const resolved = path.choice ?? (path.richBranch === 'left' ? 'right' : 'left');
      path.choice = resolved;
      path.activeBranch = resolved;
      path.phase = 'committed';
      bus.emit('fork:resolved', { side: resolved });
      return;
    }
    case 'committed': {
      // Ultimo tratto prima della biforcazione vera e propria: il ramo è già
      // solido, ma il mondo non ha ancora iniziato a scorrere lateralmente.
      path.forkZ -= travelled;
      if (path.forkZ > 0) return;
      path.phase = 'realigning';
      // Nessun return: l'eccedenza di questo passo è già distanza percorsa
      // OLTRE la biforcazione, quindi appartiene al riallineamento. Uscendo
      // qui, il primo frame di 'realigning' avrebbe applicato in un colpo solo
      // due passi di traslazione laterale — uno scatto visibile all'inizio di
      // ogni chiusura di bivio.
      applyRealignment(path, speed);
      return;
    }
    case 'realigning': {
      // Da qui forkZ scende sotto zero: il suo valore assoluto è la distanza
      // percorsa OLTRE la biforcazione, che a velocità nota si converte in
      // "quanto tempo è passato" senza bisogno di un campo a parte.
      path.forkZ -= travelled;
      applyRealignment(path, speed);
      return;
    }
  }
}

/** Traslazione laterale del mondo durante il riallineamento, e chiusura del
 *  bivio quando è completa. Legge solo `forkZ`, già aggiornato dal chiamante. */
function applyRealignment(path: PathState, speed: number): void {
  const distancePast = -path.forkZ;
  const realignDistance = Math.max(1e-6, speed * CONFIG.path.realignSeconds);
  const t = Math.min(1, Math.max(0, distancePast / realignDistance));
  path.offsetX = -branchOffsetX(path, path.activeBranch) * t;
  path.realignProgress = t;
  if (t < 1) return;

  path.phase = 'none';
  path.offsetX = 0;
  path.activeBranch = 'main';
  path.choice = null;
  path.forkZ = 0;
  path.realignProgress = 0;
  path.nextForkIn = CONFIG.path.minGap + CONFIG.path.gapPerSpeed * speed;
}
