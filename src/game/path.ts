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
    // Prima del primissimo bivio non esiste ancora una velocità "di prima" da
    // usare nella formula gapPerSpeed: si parte dal solo margine minimo, come
    // se la run fosse appena ripartita da un riallineamento a velocità nulla.
    nextForkIn: CONFIG.path.minGap,
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
  return true;
}

/** Avanza il percorso. `travelled` è la distanza percorsa in questo frame. */
export function updatePath(
  path: PathState,
  travelled: number,
  speed: number,
  rng: Rng,
  bus: EventBus,
): void {
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
      return;
    }
    case 'realigning': {
      // Da qui forkZ scende sotto zero: il suo valore assoluto è la distanza
      // percorsa OLTRE la biforcazione, che a velocità nota si converte in
      // "quanto tempo è passato" senza bisogno di un campo a parte.
      path.forkZ -= travelled;
      const distancePast = -path.forkZ;
      const realignDistance = Math.max(1e-6, speed * CONFIG.path.realignSeconds);
      const t = Math.min(1, distancePast / realignDistance);
      path.offsetX = -branchOffsetX(path, path.activeBranch) * t;
      if (t >= 1) {
        path.phase = 'none';
        path.offsetX = 0;
        path.activeBranch = 'main';
        path.choice = null;
        path.forkZ = 0;
        path.nextForkIn = CONFIG.path.minGap + CONFIG.path.gapPerSpeed * speed;
      }
      return;
    }
  }
}
