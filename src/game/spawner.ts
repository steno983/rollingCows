import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type {
  Branch,
  BuffKind,
  Entity,
  GroundObstacleKind,
  ObstacleKind,
  OverheadObstacleKind,
} from './types';
import { isOverhead } from './types';

const GROUND_OBSTACLES: readonly GroundObstacleKind[] = ['rock', 'log', 'fence', 'crevasse'];
const OVERHEAD_OBSTACLES: readonly OverheadObstacleKind[] = ['branch', 'arch', 'cornice'];
const BUFF_KINDS: readonly BuffKind[] = ['crystal', 'star', 'magnet', 'bell'];

export interface Spawner {
  /**
   * Popola un tratto di percorso su un ramo, aggiungendo entità a `out`.
   *
   * Lo spawner NON riparte da `startZ`: ogni ramo ha un cursore che sopravvive
   * fra una chiamata e l'altra (vedi `advance`). Il gioco popola un chunk alla
   * volta, al riciclo, e i chunk sono contigui: ripartire ogni volta da
   * `startZ` metteva un ostacolo esattamente sul confine di ogni chunk, a
   * distanza arbitraria (fino a zero) dall'ultimo del chunk precedente.
   * L'invariante di giocabilità vale sul percorso CONTINUO, non dentro un
   * singolo segmento.
   */
  populateSegment(
    startZ: number,
    length: number,
    difficulty: number,
    branch: Branch,
    rich: boolean,
    out: Entity[],
  ): void;
  /**
   * Sposta i cursori insieme al mondo: i cursori vivono nelle stesse
   * coordinate z (relative al giocatore) delle entità, quindi vanno fatti
   * scorrere indietro dello stesso `moved` a ogni frame.
   */
  advance(moved: number): void;
  /**
   * Fa ripartire il ramo `to` da dove si è fermato il ramo `from`, mai prima
   * di `minZ`. È ciò che tiene valida l'invariante di giocabilità ATTRAVERSO
   * un bivio: i due rami nascono da dove finisce il tronco, e alla chiusura
   * il tronco eredita il cursore del ramo che ha vinto.
   */
  copyCursor(from: Branch, to: Branch, minZ: number): void;
  reset(): void;
}

export function createSpawner(rng: Rng): Spawner {
  const { minObstacleGap, maxObstacleGap, trailMin, trailMax, trailSpacing, trailArcHeight } =
    CONFIG.spawn;
  const gapSpread = maxObstacleGap - minObstacleGap;

  let nextId = 0;
  // ONBOARDING: il primo ostacolo che il giocatore INCONTRA DAVVERO in una
  // corsa deve essere saltabile: il salto è il gesto più istintivo, e i
  // sospesi (che chiedono la scivolata) arrivano dopo. Un game state crea
  // uno spawner nuovo a ogni startRun (vedi game.ts), quindi questo flag
  // identifica l'inizio corsa senza che il chiamante lo dichiari
  // esplicitamente. Resta true anche oltre il primo ostacolo emesso in
  // assoluto: quello nasce sempre a cursorZ 0, dentro la zona franca
  // (world.spawnSafeZ) che startRun cancella subito dopo, quindi da solo non
  // è ciò che il giocatore vede. Il flag si spegne solo al primo ostacolo
  // che nasce OLTRE la zona franca, cioè quello davvero raggiunto.
  let firstObstaclePending = true;

  /** z del PROSSIMO ostacolo di ciascun ramo. -Infinity = ramo mai popolato,
   *  quindi il primo ostacolo cade sul bordo del segmento richiesto. */
  const nextObstacleZ: Record<Branch, number> = {
    main: -Infinity,
    left: -Infinity,
    right: -Infinity,
  };
  /** z dell'ULTIMO ostacolo già emesso su ciascun ramo: limite inferiore per la
   *  fila ad arco del prossimo, anche quando i due cadono in segmenti diversi. */
  const lastObstacleZ: Record<Branch, number> = {
    main: -Infinity,
    left: -Infinity,
    right: -Infinity,
  };

  function emit(
    out: Entity[],
    kind: Entity['kind'],
    category: 'obstacle' | 'pickup',
    branch: Branch,
    z: number,
    y: number,
  ): void {
    out.push({ id: nextId++, kind, category, branch, z, y, alive: true });
  }

  /** Tempo reale che serve a completare l'azione richiesta da questo ostacolo:
   *  scivolata per i sospesi, salto per quelli a terra. È la base
   *  dell'invariante di giocabilità (vedi Note di progetto). */
  function requiredActionSeconds(kind: ObstacleKind): number {
    return isOverhead(kind) ? CONFIG.player.slideSeconds : CONFIG.player.jumpSeconds;
  }

  function pickObstacleKind(): ObstacleKind {
    return rng.chance(0.5) ? rng.pick(GROUND_OBSTACLES) : rng.pick(OVERHEAD_OBSTACLES);
  }

  /** Il ramo ricco di un bivio pesca dai pesi "rari" (è l'unico posto dove può
   *  nascere il campanaccio, design §7); tronco e ramo sgombro pescano dai pesi
   *  comuni, dove domina il cristallo — che il design vuole "comune, a terra sul
   *  tracciato" e che quindi NON può esistere solo dentro un bivio. */
  function pickBuffKind(rich: boolean): BuffKind {
    const weights: Record<BuffKind, number> = rich
      ? CONFIG.spawn.buffWeights
      : CONFIG.spawn.commonBuffWeights;
    const total = weights.crystal + weights.star + weights.magnet + weights.bell;
    let roll = rng.next() * total;
    for (const kind of BUFF_KINDS) {
      roll -= weights[kind];
      if (roll < 0) return kind;
    }
    const fallback = BUFF_KINDS[BUFF_KINDS.length - 1];
    if (fallback === undefined) throw new Error('pickBuffKind: BUFF_KINDS vuoto');
    return fallback;
  }

  /** Fila ad arco che insegna il salto: termina esattamente sull'ostacolo a terra
   *  (l'ultimo fiocco coincide con esso), apice a trailArcHeight a metà fila. I
   *  punti che cadrebbero prima dell'inizio del segmento, o prima dell'ostacolo
   *  precedente, vengono scartati: senza questo secondo limite, quando il gap
   *  fra due ostacoli scende vicino al minimo giocabile una fila lunga potrebbe
   *  sporgere all'indietro oltre l'ostacolo precedente e interfogliarsi con la
   *  sua stessa fila ad arco, rompendo la forma unimodale di entrambe. */
  function emitArcTrail(
    obstacleZ: number,
    branch: Branch,
    count: number,
    floorZ: number,
    out: Entity[],
  ): void {
    for (let i = 0; i < count; i++) {
      const z = obstacleZ - (count - 1 - i) * trailSpacing;
      if (z < floorZ) continue;
      const t = count > 1 ? i / (count - 1) : 0.5;
      const rawY = trailArcHeight * Math.sin(Math.PI * t);
      // Math.sin(Math.PI) non è esattamente 0 (Math.PI è un'approssimazione):
      // agli estremi dell'arco arrotondiamo lo zero vero, altrimenti quel
      // residuo infinitesimale ma positivo farebbe sembrare l'ultimo fiocco
      // "in aria" e lo saldrebbe visivamente alla fila ad arco successiva.
      const y = Math.abs(rawY) < 1e-9 ? 0 : rawY;
      emit(out, 'snowflake', 'pickup', branch, z, y);
    }
  }

  /** Fila bassa che insegna la scivolata: centrata sull'ostacolo sospeso, a quota
   *  0 (sotto la sua base, spawn.overheadY). */
  function emitLowTrail(
    obstacleZ: number,
    branch: Branch,
    count: number,
    startZ: number,
    endZ: number,
    out: Entity[],
  ): void {
    const half = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const z = obstacleZ + (i - half) * trailSpacing;
      if (z < startZ || z >= endZ) continue;
      emit(out, 'snowflake', 'pickup', branch, z, 0);
    }
  }

  return {
    populateSegment(
      startZ: number,
      length: number,
      difficulty: number,
      branch: Branch,
      rich: boolean,
      out: Entity[],
    ): void {
      if (length <= 0) return;
      const clamped = Math.min(1, Math.max(0, difficulty));
      const endZ = startZ + length;
      // Il cursore del ramo: dove era rimasto, mai prima dell'inizio del
      // segmento richiesto (un ramo appena nato, o un buco di copertura,
      // ripartono dal bordo).
      let cursorZ = Math.max(startZ, nextObstacleZ[branch]);
      // z dell'ostacolo precedente: limite inferiore per la fila ad arco del
      // prossimo, così due file non si interfogliano quando il gap è stretto
      // (vedi commento su emitArcTrail).
      let previousObstacleZ = lastObstacleZ[branch];

      while (cursorZ < endZ) {
        const kind = firstObstaclePending ? rng.pick(GROUND_OBSTACLES) : pickObstacleKind();
        if (firstObstaclePending && cursorZ >= CONFIG.world.spawnSafeZ) firstObstaclePending = false;
        const overhead = isOverhead(kind);

        // La distanza scelta cala con la difficoltà, ma non scende MAI sotto il
        // tempo reale che serve a completare l'azione richiesta da questo
        // ostacolo alla velocità massima: è l'invariante di giocabilità.
        const minTraversableGap = requiredActionSeconds(kind) * CONFIG.world.maxSpeed;
        const rangeLow = Math.max(minObstacleGap, minTraversableGap);
        const desiredHigh = maxObstacleGap - gapSpread * clamped;
        const rangeHigh = Math.max(rangeLow, desiredHigh);
        const midpoint = (rangeLow + rangeHigh) / 2;
        // Ramo ricco: distanza nel semi-intervallo basso (ostacoli più fitti).
        // Ramo sgombro: semi-intervallo alto (ostacoli più radi).
        const gap = rich
          ? rangeLow + rng.next() * (midpoint - rangeLow)
          : midpoint + rng.next() * (rangeHigh - midpoint);

        emit(out, kind, 'obstacle', branch, cursorZ, overhead ? CONFIG.spawn.overheadY : 0);

        // Ramo ricco: fila lunga (trailMin..trailMax). Ramo sgombro: fila corta
        // (1..ceil(trailMin/2)), sempre più povera ma mai assente.
        const trailCount = rich
          ? rng.int(trailMin, trailMax + 1)
          : rng.int(1, Math.ceil(trailMin / 2) + 1);

        if (overhead) {
          emitLowTrail(cursorZ, branch, trailCount, startZ, endZ, out);
        } else {
          emitArcTrail(cursorZ, branch, trailCount, Math.max(startZ, previousObstacleZ), out);
        }
        previousObstacleZ = cursorZ;

        // Il ramo ricco di un bivio è più generoso — è ciò che rende la scelta
        // una scelta vera — ma i buff comuni nascono ovunque: il design §7
        // colloca il cristallo "a terra sul tracciato", non dentro un bivio.
        const chance = rich ? CONFIG.spawn.buffChance : CONFIG.spawn.commonBuffChance;
        if (rng.chance(chance)) {
          const buffZ = cursorZ + gap / 2;
          if (buffZ < endZ) emit(out, pickBuffKind(rich), 'pickup', branch, buffZ, 0);
        }

        cursorZ += gap;
      }

      nextObstacleZ[branch] = cursorZ;
      lastObstacleZ[branch] = previousObstacleZ;
    },
    advance(moved: number): void {
      nextObstacleZ.main -= moved;
      nextObstacleZ.left -= moved;
      nextObstacleZ.right -= moved;
      lastObstacleZ.main -= moved;
      lastObstacleZ.left -= moved;
      lastObstacleZ.right -= moved;
    },
    copyCursor(from: Branch, to: Branch, minZ: number): void {
      nextObstacleZ[to] = Math.max(minZ, nextObstacleZ[from]);
      lastObstacleZ[to] = lastObstacleZ[from];
    },
    reset(): void {
      nextId = 0;
      firstObstaclePending = true;
      nextObstacleZ.main = -Infinity;
      nextObstacleZ.left = -Infinity;
      nextObstacleZ.right = -Infinity;
      lastObstacleZ.main = -Infinity;
      lastObstacleZ.left = -Infinity;
      lastObstacleZ.right = -Infinity;
    },
  };
}
