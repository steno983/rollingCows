import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import { DEFAULT_DIFFICULTY_PROFILE, type DifficultyProfile } from './speed';
import type {
  Branch,
  BuffKind,
  Entity,
  GroundObstacleKind,
  ObstacleKind,
  OverheadObstacleKind,
} from './types';
import { isOverhead } from './types';

/**
 * Elenchi esaustivi dei tipi che lo spawner può estrarre.
 *
 * Erano array annotati col tipo dell'elemento (`readonly GroundObstacleKind[]`):
 * così il compilatore verifica che ogni voce appartenga al tipo, ma NON che il
 * tipo sia coperto per intero. Aggiungendo domani un ostacolo nuovo, tutto
 * compilava, i test passavano, e l'ostacolo non nasceva mai — un bug muto, che
 * si scopre solo giocando abbastanza a lungo da accorgersi che manca qualcosa.
 * Derivarli da un record chiave→chiave verificato con `satisfies` sposta
 * l'errore al momento giusto: aggiungere un tipo senza elencarlo qui rompe la
 * compilazione. `Object.values` conserva il tipo delle chiavi, quindi la
 * derivazione non richiede alcun cast.
 */
const GROUND_OBSTACLES: readonly GroundObstacleKind[] = Object.values({
  rock: 'rock',
  log: 'log',
  fence: 'fence',
  crevasse: 'crevasse',
} satisfies { [K in GroundObstacleKind]: K });

const OVERHEAD_OBSTACLES: readonly OverheadObstacleKind[] = Object.values({
  branch: 'branch',
  arch: 'arch',
  cornice: 'cornice',
} satisfies { [K in OverheadObstacleKind]: K });

const BUFF_KINDS: readonly BuffKind[] = Object.values({
  crystal: 'crystal',
  star: 'star',
  magnet: 'magnet',
  bell: 'bell',
} satisfies { [K in BuffKind]: K });

/**
 * Margine puramente NUMERICO — non di gioco — applicato al passo della coppia
 * stretta. Il passo viene sommato al cursore e poi riletto dall'esterno come
 * differenza fra due z: l'arrotondamento in virgola mobile può restituire
 * qualche ulp in MENO di quanto sommato, e alla distanza esatta della
 * traversabilità quel residuo basta a violare l'invariante di giocabilità.
 * Relativo, così resta corretto a qualunque z; a 1e-9 vale meno di un decimo
 * di micrometro su un passo di trenta unità.
 */
const TRAVERSABILITY_EPSILON = 1e-9;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * z minima da cui può nascere il primo ostacolo di un ramo appena aperto.
 *
 * ZONA FRANCA DOPO LA BIFORCAZIONE. Il ramo scelto diventa solido al punto di
 * non ritorno, ma il mondo trasla lateralmente solo DOPO la biforcazione e per
 * tutto `path.realignSeconds`: nel frattempo un ostacolo del ramo — disegnato
 * fino a `path.branchSeparation` di lato, cioè 6 unità fuori da un corridoio
 * largo 4 — è già letale pur essendo visibilmente fuori pista. Misurato: il
 * 3,43% degli ostacoli letali uccideva così, l'unica classe di morte che il
 * giocatore non può né prevedere né imparare.
 *
 * Vive qui e non in game.ts perché è una regola su DOVE lo spawner può
 * cominciare a popolare, e va usata sia per il cursore (`copyCursor`) sia per
 * il bordo del segmento (`populateSegment`): due chiamanti, una sola verità.
 */
export function branchSpawnStartZ(forkZ: number): number {
  return forkZ + CONFIG.path.branchClearanceAfterFork;
}

/**
 * Impostazioni della singola corsa, non del gioco: separate dal profilo di
 * difficoltà perché non dipendono da quanto si è bravi ma da quanto si è
 * NUOVI. Oggetto invece di un altro parametro posizionale perché `createSpawner`
 * ne aveva già due e il terzo booleano nudo sarebbe stato illeggibile sul
 * posto di chiamata.
 */
export interface SpawnerOptions {
  /**
   * z minima del PRIMISSIMO ostacolo della corsa. Quando è assente vale la
   * sola zona franca di partenza (`CONFIG.world.spawnSafeZ`, 25 unità), e il
   * primo ostacolo cade dove capita fra 37 e 48 unità: circa 2,3 secondi dopo
   * l'avvio, cioè prima che chi non ha mai giocato abbia finito di leggere il
   * prompt "SALTA". Il tutorial lo spinge più in là (vedi
   * `CONFIG.tutorial.firstObstacleZ`).
   *
   * Vale SOLO per il primo: dal secondo in poi tornano le regole normali, che
   * è ciò che rende questa un'introduzione e non una difficoltà diversa.
   */
  firstObstacleZ?: number;
}

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
   *
   * `lateProgress` è il secondo asse di difficoltà (0..1, da `lateRampAt` in
   * speed.ts): oltre `spawn.lateRampStart` cresce la quota di ostacoli sospesi
   * e compaiono le coppie strette. È opzionale e vale 0 di default perché
   * "nessuna rampa tardiva" è esattamente il comportamento storico, e perché
   * lo spawner non conosce la distanza percorsa: gliela deve dire il chiamante,
   * che è l'unico ad averla.
   */
  populateSegment(
    startZ: number,
    length: number,
    difficulty: number,
    branch: Branch,
    rich: boolean,
    out: Entity[],
    lateProgress?: number,
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
   *
   * Per la zona franca dopo la biforcazione, `minZ` va calcolato con
   * `branchSpawnStartZ(forkZ)`, non con `forkZ` nudo.
   */
  copyCursor(from: Branch, to: Branch, minZ: number): void;
  reset(): void;
}

export function createSpawner(
  rng: Rng,
  profile: DifficultyProfile = DEFAULT_DIFFICULTY_PROFILE,
  options: SpawnerOptions = {},
): Spawner {
  const { maxObstacleGap, trailMin, trailMax, trailSpacing, trailArcHeight } = CONFIG.spawn;
  // Il profilo di difficoltà scala il passo minimo e la velocità di punta; il
  // resto della generazione è identico in tutti i profili. Leggerli da qui e
  // non da CONFIG è ciò che rende "Vitellino" e "Toro" lo stesso gioco con tre
  // costanti diverse invece che tre generatori da mantenere in parallelo.
  const { minObstacleGap, maxSpeed } = profile;
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
  /** Pavimento in z per il primissimo ostacolo, finché non ne è nato nessuno.
   *  Diventa `undefined` alla prima emissione: è il modo in cui "solo il
   *  primo" resta vero anche se i chunk vengono popolati uno alla volta e in
   *  ordine, molto prima che il giocatore li raggiunga. */
  let firstObstacleFloorZ = options.firstObstacleZ;

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
  /** Il passo appena emesso su questo ramo era quello di una coppia stretta?
   *  Serve a impedire le CATENE: una coppia stretta è una figura di due
   *  ostacoli, e tre o quattro di fila al limite della traversabilità non
   *  sarebbero una manovra da imparare ma un muro. Vive per ramo e non nel
   *  ciclo, perché due ostacoli consecutivi cadono spesso in segmenti diversi. */
  const lastGapWasTight: Record<Branch, boolean> = {
    main: false,
    left: false,
    right: false,
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

  /**
   * Quota di ostacoli sospesi da estrarre, fra 0 e 1. Era un `rng.chance(0.5)`
   * inchiodato nel codice: la stessa miscela dal primo all'ultimo secondo.
   * Ora si muove su due assi.
   * - La rampa TARDIVA (`lateProgress`) la porta da `overheadShare` a
   *   `overheadShareLate`: la scivolata è l'azione con la finestra più
   *   asimmetrica ed è quella che si sbaglia di più, quindi è la leva giusta
   *   per alzare la pressione dove alzare la velocità non è più un'opzione.
   * - Il RAMO RICCO di un bivio parte già dalla quota alta
   *   (`overheadShareRich`): così i due rami non si distinguono solo per
   *   QUANTO chiedono ma per QUALE abilità chiedono.
   */
  function overheadShareFor(rich: boolean, lateProgress: number): number {
    const { overheadShare, overheadShareLate, overheadShareRich } = CONFIG.spawn;
    const ramped = overheadShare + (overheadShareLate - overheadShare) * lateProgress;
    return rich ? Math.max(overheadShareRich, ramped) : ramped;
  }

  function pickObstacleKind(overheadShare: number): ObstacleKind {
    return rng.chance(overheadShare) ? rng.pick(OVERHEAD_OBSTACLES) : rng.pick(GROUND_OBSTACLES);
  }

  /** Il ramo ricco di un bivio pesca dai pesi "rari"; tronco e ramo sgombro
   *  pescano dai pesi comuni, dove domina il cristallo — che il design vuole
   *  "comune, a terra sul tracciato" e che quindi NON può esistere solo dentro
   *  un bivio. Il totale è sommato sull'elenco esaustivo e non su quattro
   *  campi scritti a mano: nessuna assunzione su quali pesi siano zero (il
   *  campanaccio comune, per esempio, ora non lo è più) e nessun peso
   *  dimenticato il giorno in cui ne nasce un quinto. */
  function pickBuffKind(rich: boolean): BuffKind {
    const weights: Readonly<Record<BuffKind, number>> = rich
      ? CONFIG.spawn.buffWeights
      : CONFIG.spawn.commonBuffWeights;
    let total = 0;
    for (const kind of BUFF_KINDS) total += weights[kind];
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
      lateProgress = 0,
    ): void {
      if (length <= 0) return;
      const clamped = clamp01(difficulty);
      const late = clamp01(lateProgress);
      const endZ = startZ + length;
      // Il ramo SGOMBRO di un bivio, che NON è il tronco: `rich` da solo non
      // basta a distinguerli, perché game.ts popola anche il tronco con
      // rich=false. Il discriminante è il ramo: durante un bivio i due lati
      // sono 'left'/'right' e il tronco è sempre 'main' (alla chiusura il ramo
      // vincente viene rietichettato 'main' proprio perché torna a essere il
      // tronco). Serve perché il pavimento più alto è la contropartita della
      // scelta al bivio, non uno sconto generale sulla difficoltà.
      const clearBranch = !rich && branch !== 'main';
      // La differenza di spaziatura fra i due rami svaniva con la difficoltà:
      // a difficoltà piena finivano allo stesso gap, quindi il ramo ricco
      // (4× fiocchi, 2,2× buff, unico che può contenere il campanaccio)
      // diventava strettamente dominante e la scelta di firma del gioco una
      // formalità. Il ramo sgombro ha un pavimento tutto suo.
      const gapFloor = clearBranch
        ? minObstacleGap * CONFIG.spawn.clearBranchGapRatio
        : minObstacleGap;
      const overheadShare = overheadShareFor(rich, late);
      // Il cursore del ramo: dove era rimasto, mai prima dell'inizio del
      // segmento richiesto (un ramo appena nato, o un buco di copertura,
      // ripartono dal bordo).
      let cursorZ = Math.max(startZ, nextObstacleZ[branch]);
      // Tutorial: il primo ostacolo della corsa arretra fin oltre il proprio
      // pavimento. Applicato qui e non filtrando dopo, perché spostare il
      // cursore lascia intatta ogni altra regola — spaziatura, file di
      // fiocchi, invariante di traversabilità — invece di aprire un buco.
      if (firstObstacleFloorZ !== undefined) {
        cursorZ = Math.max(cursorZ, firstObstacleFloorZ);
      }
      // z dell'ostacolo precedente: limite inferiore per la fila ad arco del
      // prossimo, così due file non si interfogliano quando il gap è stretto
      // (vedi commento su emitArcTrail).
      let previousObstacleZ = lastObstacleZ[branch];
      let previousGapTight = lastGapWasTight[branch];

      while (cursorZ < endZ) {
        const kind = firstObstaclePending
          ? rng.pick(GROUND_OBSTACLES)
          : pickObstacleKind(overheadShare);
        if (firstObstaclePending && cursorZ >= CONFIG.world.spawnSafeZ)
          firstObstaclePending = false;
        const overhead = isOverhead(kind);

        // La distanza scelta cala con la difficoltà, ma non scende MAI sotto il
        // tempo reale che serve a completare l'azione richiesta da questo
        // ostacolo alla velocità massima: è l'invariante di giocabilità.
        const minTraversableGap = requiredActionSeconds(kind) * maxSpeed;
        const rangeLow = Math.max(gapFloor, minTraversableGap);
        const desiredHigh = maxObstacleGap - gapSpread * clamped;
        // Pavimento alla VARIANZA, non solo alla distanza: senza,
        // `desiredHigh` a difficoltà piena arrivava esattamente a `rangeLow`,
        // l'intervallo di estrazione collassava e il gap diventava
        // DETERMINISTICO — stesso identico valore, per sempre, su entrambi i
        // rami. Dagli 84 secondi in poi non c'era più un ritmo da leggere,
        // solo un pattern da eseguire.
        const rangeHigh = Math.max(rangeLow * CONFIG.spawn.gapVarianceFloor, desiredHigh);
        const midpoint = (rangeLow + rangeHigh) / 2;
        // Ramo ricco: distanza nel semi-intervallo basso (ostacoli più fitti).
        // Ramo sgombro: semi-intervallo alto (ostacoli più radi).
        const normalGap = rich
          ? rangeLow + rng.next() * (midpoint - rangeLow)
          : midpoint + rng.next() * (rangeHigh - midpoint);

        // COPPIA STRETTA: il prossimo ostacolo nasce al limite ESATTO della
        // traversabilità invece che alla distanza normale, il che obbliga al
        // tuffo — la manovra avanzata che il gioco implementa già e che finora
        // nulla richiedeva davvero. Mai sul ramo sgombro: lì il respiro in più
        // è la contropartita promessa a chi rinuncia al bottino, e una coppia
        // stretta la cancellerebbe. Mai due di fila (vedi lastGapWasTight).
        const tightChance = CONFIG.spawn.tightPairChanceLate * late;
        const tight =
          !clearBranch && !previousGapTight && tightChance > 0 && rng.chance(tightChance);
        const gap = tight ? minTraversableGap * (1 + TRAVERSABILITY_EPSILON) : normalGap;
        previousGapTight = tight;

        emit(out, kind, 'obstacle', branch, cursorZ, overhead ? CONFIG.spawn.overheadY : 0);
        firstObstacleFloorZ = undefined;

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
      lastGapWasTight[branch] = previousGapTight;
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
      // Anche la memoria della coppia stretta segue il cursore: un ramo che
      // eredita un passo stretto non deve poterne aprire subito un altro.
      lastGapWasTight[to] = lastGapWasTight[from];
    },
    reset(): void {
      nextId = 0;
      firstObstaclePending = true;
      firstObstacleFloorZ = options.firstObstacleZ;
      nextObstacleZ.main = -Infinity;
      nextObstacleZ.left = -Infinity;
      nextObstacleZ.right = -Infinity;
      lastObstacleZ.main = -Infinity;
      lastObstacleZ.left = -Infinity;
      lastObstacleZ.right = -Infinity;
      lastGapWasTight.main = false;
      lastGapWasTight.left = false;
      lastGapWasTight.right = false;
    },
  };
}
