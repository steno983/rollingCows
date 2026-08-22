import { describe, expect, it } from 'vitest';
import type { EventBus, GameEvents } from '../core/events';
import { createEventBus } from '../core/events';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import type { ForkPhase, PathState } from './path';
import {
  activeBranchOf,
  branchCenterAt,
  branchIsSolid,
  branchOffsetX,
  chooseBranch,
  createPath,
  forkApproaching,
  realignProgressOf,
  rememberChoice,
  updatePath,
} from './path';
import { speedAt } from './speed';

const STEP = 1 / 60;

/** I due rami, per i test che devono provarli entrambi. */
const SIDES = ['left', 'right'] as const;

/** Bus di test: accumula i payload di un evento, nell'ordine di emissione. */
function recordedBus<K extends keyof GameEvents>(
  name: K,
): { bus: EventBus; payloads: GameEvents[K][] } {
  const bus = createEventBus();
  const payloads: GameEvents[K][] = [];
  bus.on(name, (payload) => payloads.push(payload));
  return { bus, payloads };
}

/** Avanza il percorso di `distance` unità a velocità costante, a passi di STEP
 *  (l'ultimo passo può essere più corto, per chiudere esattamente su
 *  `distance`) e RESTITUISCE lo stato risultante: `PathState` è un'unione
 *  discriminata su `phase`, quindi una transizione di fase produce un oggetto
 *  nuovo e il chiamante deve riassegnare. */
function travel(
  path: PathState,
  distance: number,
  speed: number,
  rng: ReturnType<typeof createRng>,
  bus: EventBus,
): PathState {
  let current = path;
  let remaining = distance;
  while (remaining > 0) {
    const step = Math.min(speed * STEP, remaining);
    current = updatePath(current, step, speed, rng, bus);
    remaining -= step;
  }
  return current;
}

/** Avanza finché il bivio non compare. Sostituisce il vecchio
 *  `travel(path, path.nextForkIn + 1, ...)`: `nextForkIn` esiste solo nella
 *  fase 'none' e dopo un travel il compilatore — giustamente — non sa più in
 *  quale fase sia il percorso. */
function travelToFork(
  path: PathState,
  speed: number,
  rng: ReturnType<typeof createRng>,
  bus: EventBus,
): PathState {
  let current = path;
  let guard = 0;
  while (current.phase === 'none' && guard < 10000) {
    current = updatePath(current, speed * STEP, speed, rng, bus);
    guard += 1;
  }
  return current;
}

/** La scelta corrente, o null dove non c'è un bivio che possa averne una.
 *  Vive qui e non in path.ts perché serve solo a questi test: il gioco legge
 *  la scelta solo dentro una fase in cui esiste. */
function choiceOf(path: PathState): 'left' | 'right' | null {
  return path.phase === 'none' ? null : path.choice;
}

/** Il ramo ricco del bivio in corso, o null se non c'è alcun bivio. */
function richBranchOf(path: PathState): 'left' | 'right' | null {
  return path.phase === 'none' ? null : path.richBranch;
}

describe('createPath', () => {
  it('parte senza bivio, sul ramo main, offset zero', () => {
    const path: PathState = createPath();
    expect(path.phase).toBe('none');
    expect(activeBranchOf(path)).toBe('main');
    // Pista dritta: senza bivio nessun ramo è scostato, a nessuna distanza.
    expect(branchCenterAt(path, 'left', 60)).toBe(0);
    expect(branchCenterAt(path, 'right', 60)).toBe(0);
    expect(choiceOf(path)).toBeNull();
  });
});

describe('updatePath — comparsa del bivio', () => {
  it('non compare prima della distanza attesa', () => {
    const { bus } = recordedBus('fork:appeared');
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn - 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('none');
  });

  it('compare dopo la distanza attesa', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(payloads.length).toBe(1);
    expect(['left', 'right']).toContain(payloads[0]?.richBranch);
  });

  it('emette fork:appeared una sola volta per bivio, dalla comparsa alla chiusura', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    let path: PathState = createPath();
    const rng = createRng(1);
    // Il riallineamento non dura più un TEMPO ma una DISTANZA fissa
    // (forkBlendZ: si chiude quando il ramo scelto è arrivato al centro, vedi
    // applyRealignment), quindi il costo di un bivio in unità non dipende più
    // dalla velocità.
    const totalToClose = CONFIG.path.minGap + CONFIG.path.previewZ + CONFIG.path.forkBlendZ + 5;
    path = travel(path, totalToClose, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('none');
    expect(payloads.length).toBe(1);
  });
});

describe('chooseBranch', () => {
  it('prima del punto di non ritorno cambia la scelta, anche più volte', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');

    expect(chooseBranch(path, 'left')).toBe(true);
    expect(choiceOf(path)).toBe('left');

    expect(chooseBranch(path, 'right')).toBe(true);
    expect(choiceOf(path)).toBe('right');

    expect(chooseBranch(path, 'left')).toBe(true);
    expect(choiceOf(path)).toBe('left');
  });

  it('dopo il punto di non ritorno restituisce false e non cambia più nulla', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    path = travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );
    expect(path.phase).not.toBe('approaching');

    const lockedChoice = choiceOf(path);
    expect(chooseBranch(path, lockedChoice === 'left' ? 'right' : 'left')).toBe(false);
    expect(choiceOf(path)).toBe(lockedChoice);
  });

  it('restituisce false se non c-è alcun bivio in corso', () => {
    const path: PathState = createPath();
    expect(chooseBranch(path, 'left')).toBe(false);
    expect(choiceOf(path)).toBeNull();
  });
});

describe('senza scelta', () => {
  it('al punto di non ritorno impone il ramo NON ricco', () => {
    const { bus, payloads } = recordedBus('fork:resolved');
    let path: PathState = createPath();
    const rng = createRng(7);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    const rich = richBranchOf(path);
    const expectedChoice = rich === 'left' ? 'right' : 'left';

    path = travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(choiceOf(path)).toBe(expectedChoice);
    expect(activeBranchOf(path)).toBe(expectedChoice);
    expect(payloads.length).toBe(1);
    expect(payloads[0]?.side).toBe(expectedChoice);
  });
});

describe('branchIsSolid', () => {
  it('main è sempre solido, in ogni fase', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    expect(branchIsSolid(path, 'main')).toBe(true);

    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    expect(branchIsSolid(path, 'main')).toBe(true);
  });

  it('durante approaching nessun ramo laterale è solido', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(branchIsSolid(path, 'left')).toBe(false);
    expect(branchIsSolid(path, 'right')).toBe(false);
  });

  it('dopo il commit solo il ramo scelto è solido', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    path = travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(activeBranchOf(path)).toBe('left');
    expect(branchIsSolid(path, 'left')).toBe(true);
    expect(branchIsSolid(path, 'right')).toBe(false);
  });
});

describe('riallineamento', () => {
  it('finisce con la pista dritta a OGNI distanza, phase none, activeBranch main', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(3);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    path = travel(
      path,
      CONFIG.path.previewZ + CONFIG.path.forkBlendZ + 5,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.phase).toBe('none');
    expect(activeBranchOf(path)).toBe('main');
    // Non più "offsetX è 0" (quel campo non esiste più: non c'è nessuna
    // traslazione del mondo da riportare a zero) ma la cosa che quella
    // condizione voleva davvero dire — la strada è dritta — verificata dove
    // conta, cioè a ogni distanza e non solo sotto la mucca.
    for (let z = 0; z <= 240; z += 4) {
      expect(branchCenterAt(path, 'left', z)).toBe(0);
      expect(branchCenterAt(path, 'right', z)).toBe(0);
    }
  });

  it('il ramo scelto converge al centro senza mai tornare indietro', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(3);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    path = travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ - 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );
    expect(path.phase).toBe('approaching');

    // Lo scostamento PEGGIORE del ramo scelto su tutta la pista visibile, non
    // quello alla sola quota della mucca: è la misura che si accorge di una
    // pista storta in lontananza mentre sotto il muso è centrata, cioè
    // esattamente il difetto («la strada si deforma») che il controllo a
    // z = 0 da solo lasciava passare.
    const worstDeviation = (state: PathState): number => {
      let worst = 0;
      for (let z = 0; z <= 240; z += 4) {
        worst = Math.max(worst, Math.abs(branchCenterAt(state, 'right', z)));
      }
      return worst;
    };

    let previous = worstDeviation(path);
    expect(previous).toBeCloseTo(CONFIG.path.branchSeparation, 6);
    let guard = 0;
    while (path.phase !== 'none' && guard < 5000) {
      path = updatePath(path, CONFIG.world.startSpeed * STEP, CONFIG.world.startSpeed, rng, bus);
      const current = worstDeviation(path);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
      guard += 1;
    }
    expect(path.phase).toBe('none');
    expect(previous).toBe(0);
  });
});

describe('simulazione lunga', () => {
  it('a 60 s con velocità crescente, i bivi non si sovrappongono mai e si chiudono sempre', () => {
    const bus = createEventBus();
    let forkOpen = false;
    let appearedCount = 0;
    let closedCount = 0;
    let lastCloseDistance = 0;
    const gapsSinceLastClose: number[] = [];

    bus.on('fork:appeared', () => {
      // Nessuna sovrapposizione possibile per costruzione (un solo PathState,
      // una sola fase alla volta), ma lo si verifica comunque a runtime.
      expect(forkOpen).toBe(false);
      forkOpen = true;
      appearedCount += 1;
    });

    let path: PathState = createPath();
    const rng = createRng(42);
    let distance = 0;
    const steps = Math.round(60 / STEP);

    for (let i = 0; i < steps; i++) {
      const speed = speedAt(distance);
      const travelled = speed * STEP;
      const wasNone = path.phase === 'none';
      path = updatePath(path, travelled, speed, rng, bus);
      distance += travelled;

      if (!wasNone && path.phase === 'none') {
        expect(forkOpen).toBe(true);
        forkOpen = false;
        closedCount += 1;
        gapsSinceLastClose.push(distance - lastCloseDistance);
        lastCloseDistance = distance;
      }
    }

    // Con la curva di velocità di CONFIG.world (18→40 u/s) e gapPerSpeed=6, il
    // costo di un bivio (minGap + gapPerSpeed*speed + previewZ + forkBlendZ)
    // cresce con la velocità: in 60 s simulati un seed qualsiasi ne produce
    // stabilmente 4 (verificato su più seed). La soglia resta comunque sotto
    // quel valore, per non legare il test a un numero magico ottenuto per tentativi.
    expect(appearedCount).toBeGreaterThanOrEqual(3);
    // Ogni bivio si chiude, salvo eventualmente l'ultimo se la simulazione
    // finisce a metà del suo riallineamento.
    expect(closedCount).toBeGreaterThanOrEqual(appearedCount - 1);
    // Il PRIMO bivio della corsa usa firstForkIn, più vicino di minGap
    // (design onboarding): il primo elemento di gapsSinceLastClose misura
    // quella distanza, non lo spazio fra due bivi, quindi si confronta con
    // firstForkIn. Solo dal secondo in poi il gap è "fra due bivi" e vale il
    // vincolo minGap.
    const [firstGap, ...laterGaps] = gapsSinceLastClose;
    if (firstGap !== undefined) {
      expect(firstGap).toBeGreaterThanOrEqual(CONFIG.path.firstForkIn - 1);
    }
    for (const gap of laterGaps) {
      expect(gap).toBeGreaterThanOrEqual(CONFIG.path.minGap - 1);
    }
  });
});

describe('determinismo', () => {
  it('a parità di seed la sequenza di richBranch è identica', () => {
    function run(seed: number): Array<'left' | 'right'> {
      const bus = createEventBus();
      const sequence: Array<'left' | 'right'> = [];
      bus.on('fork:appeared', (payload) => sequence.push(payload.richBranch));

      let path: PathState = createPath();
      const rng = createRng(seed);
      let distance = 0;
      const steps = Math.round(40 / STEP);
      for (let i = 0; i < steps; i++) {
        const speed = speedAt(distance);
        const travelled = speed * STEP;
        path = updatePath(path, travelled, speed, rng, bus);
        distance += travelled;
      }
      return sequence;
    }

    const first = run(123);
    expect(first.length).toBeGreaterThan(0);
    expect(run(123)).toEqual(first);
  });
});

describe('branchOffsetX', () => {
  it('è simmetrico e nullo per il ramo main', () => {
    const path: PathState = createPath();
    expect(branchOffsetX(path, 'main')).toBe(0);
    expect(branchOffsetX(path, 'left')).toBe(-CONFIG.path.branchSeparation);
    expect(branchOffsetX(path, 'right')).toBe(CONFIG.path.branchSeparation);
  });
});

describe('scelta anticipata', () => {
  it('uno swipe dato poco prima che il bivio compaia vale come scelta, ed è annunciato', () => {
    const { bus, payloads } = recordedBus('fork:chosen');
    let path: PathState = createPath();
    const rng = createRng(1);
    const speed = 20;

    // A un passo dal bivio: il tracciato è ancora dritto, quindi lo swipe non
    // può essere una scelta vera.
    path = travel(path, path.nextForkIn - speed * STEP, speed, rng, bus);
    expect(path.phase).toBe('none');
    expect(chooseBranch(path, 'right')).toBe(false);
    // Il bivio è imminente (manca meno di earlyChoiceWindowZ), quindi lo swipe
    // viene davvero memorizzato.
    expect(rememberChoice(path, 'right')).toBe(true);
    expect(payloads).toEqual([]);

    path = updatePath(path, speed * STEP, speed, rng, bus);

    expect(path.phase).toBe('approaching');
    expect(choiceOf(path)).toBe('right');
    expect(payloads).toEqual([{ side: 'right' }]);
  });

  it('uno swipe più vecchio di earlyChoiceSeconds è dimenticato', () => {
    const { bus, payloads } = recordedBus('fork:chosen');
    let path: PathState = createPath();
    const rng = createRng(2);
    const speed = 20;

    // Ci si porta dentro la finestra di prossimità, altrimenti lo swipe non
    // verrebbe nemmeno memorizzato e il test non misurerebbe la SCADENZA.
    path = travel(
      path,
      CONFIG.path.firstForkIn - CONFIG.path.earlyChoiceWindowZ + 1,
      speed,
      rng,
      bus,
    );
    expect(rememberChoice(path, 'left')).toBe(true);

    // Il tempo scorre oltre la finestra della scelta anticipata, ma ancora
    // prima che il bivio compaia.
    path = travel(path, speed * CONFIG.path.earlyChoiceSeconds * 1.1, speed, rng, bus);
    expect(path.pendingChoice).toBeNull();

    path = travelToFork(path, speed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(choiceOf(path)).toBeNull();
    expect(payloads).toEqual([]);
  });

  it('uno swipe dato lontano da qualunque bivio non viene nemmeno memorizzato', () => {
    // È la correzione del difetto: fuori da un bivio uno swipe laterale è
    // quasi sempre un salto malriuscito (un diagonale letto come laterale), e
    // ricordarlo per 0,6 s significava imboccare un ramo 0,6 s dopo senza che
    // il giocatore lo avesse deciso — sulla decisione di firma del gioco.
    const { bus, payloads } = recordedBus('fork:chosen');
    let path: PathState = createPath();
    const rng = createRng(3);
    const speed = 20;

    expect(CONFIG.path.firstForkIn).toBeGreaterThan(CONFIG.path.earlyChoiceWindowZ);
    expect(rememberChoice(path, 'left')).toBe(false);
    expect(path.pendingChoice).toBeNull();
    expect(path.pendingChoiceTimeLeft).toBe(0);

    path = travelToFork(path, speed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(choiceOf(path)).toBeNull();
    expect(payloads).toEqual([]);
  });

  it('la memoria vale per il bivio in arrivo, non per quello successivo', () => {
    // Durante un bivio in corso `nextForkIn` è un residuo del bivio precedente
    // (viene ricalcolato solo alla chiusura): senza l'uscita anticipata sulla
    // fase, uno swipe dato dopo il punto di non ritorno verrebbe letto come
    // "bivio imminente" e applicato al bivio dopo, oltre cento unità più
    // avanti.
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(4);
    const speed = 20;

    path = travelToFork(path, speed, rng, bus);
    path = travel(path, CONFIG.path.previewZ - CONFIG.path.commitZ + 1, speed, rng, bus);
    expect(path.phase === 'committed' || path.phase === 'realigning').toBe(true);
    // Prima qui si verificava che `nextForkIn` fosse un residuo del bivio
    // precedente, cioè un valore che avrebbe ingannato la finestra di
    // prossimità. Ora quel campo non esiste proprio in questa fase: è il tipo
    // a garantire ciò che l'asserzione controllava a runtime.

    expect(rememberChoice(path, 'left')).toBe(false);
    expect(path.pendingChoice).toBeNull();
  });

  it('una scelta vera cancella quella anticipata ancora in memoria', () => {
    // La scelta anticipata si porta dietro la comparsa del bivio: la si
    // ricrea sullo stato di avvicinamento invece di "spingere" un percorso
    // dritto cambiandogli la fase, che l'unione discriminata non consente più
    // — ed è la stessa cosa che impediva di scriverla a mano nel gioco.
    const path = forkApproaching({ forkZ: CONFIG.path.previewZ });
    path.pendingChoice = 'left';
    path.pendingChoiceTimeLeft = CONFIG.path.earlyChoiceSeconds;

    expect(chooseBranch(path, 'right')).toBe(true);
    expect(path.pendingChoice).toBeNull();
    expect(path.pendingChoiceTimeLeft).toBe(0);
  });
});

/**
 * I test che mancavano, ed è il difetto per cui questa revisione esiste. Il
 * proprietario, guardando il gioco: prima «la curva ha un effetto
 * stranissimo», la mucca che sembra finire fuori pista; poi, corretto quello,
 * «la telecamera curva bene ma poi la strada si deforma e viene presa la
 * strada di sinistra come strada principale, con un orrendo glitch grafico».
 *
 * Due difetti diversi con la stessa radice: la posizione di un pezzo di strada
 * calcolata in due modi che non coincidono. La prima volta erano l'apertura
 * della Y (geometrica, dipendente da z) e una traslazione del mondo su base
 * temporale: fino a 4,01 unità di scarto fra la mucca e il centro del proprio
 * nastro. La seconda volta la traslazione era corretta a z = 0 ma restava una
 * sola per TUTTE le z, mentre l'apertura dipende da z: la pista era centrata
 * sotto la mucca, aveva un GOMITO otto unità più avanti e restava scostata di
 * 1,3 unità per tutto il resto della vista.
 *
 * Da qui la forma dei due test: il primo misura la mucca (z = 0), il secondo
 * misura TUTTA la pista visibile. Il primo da solo era verde anche mentre il
 * secondo difetto era in produzione — ed è esattamente il motivo per cui il
 * secondo esiste.
 */
describe('allineamento della mucca al centro del nastro attivo', () => {
  /** Distanza fra la mucca (x = 0) e il centro del nastro su cui sta
   *  correndo, alla sua stessa quota (z = 0). */
  function playerOffTrack(path: PathState): number {
    return Math.abs(branchCenterAt(path, activeBranchOf(path), 0));
  }

  /** Un dodicesimo della larghezza della pista: la soglia sotto la quale uno
   *  scostamento non si vede. È comunque larghissima rispetto al valore reale,
   *  che è 0 esatto. */
  const MAX_OFF_TRACK = 0.25;

  it('in ogni frame di un bivio completo, a ogni velocità e su entrambi i rami', () => {
    const speeds = [CONFIG.world.startSpeed, 28, CONFIG.world.maxSpeed];
    let worst = 0;
    let detail = '';
    let realignFrames = 0;

    for (const speed of speeds) {
      for (const side of SIDES) {
        for (let seed = 1; seed <= 5; seed++) {
          const bus = createEventBus();
          const rng = createRng(seed);
          let path: PathState = createPath();
          let chosen = false;
          let closed = false;

          for (let frame = 0; frame < 20000 && !closed; frame++) {
            path = updatePath(path, speed * STEP, speed, rng, bus);
            if (!chosen && path.phase === 'approaching') {
              chooseBranch(path, side);
              chosen = true;
            }
            if (path.phase === 'realigning') realignFrames += 1;
            closed = chosen && path.phase === 'none' && frame > 0;

            const off = playerOffTrack(path);
            if (off > worst) {
              worst = off;
              detail = `${speed} u/s, ramo ${side}, seed ${seed}, fase ${path.phase}`;
            }
          }

          // Il bivio si è davvero chiuso, altrimenti il test misurerebbe un
          // allineamento perfetto su un bivio mai avvenuto.
          expect(closed).toBe(true);
        }
      }
    }

    expect(realignFrames).toBeGreaterThan(1000);
    expect(`${worst.toFixed(3)} — ${detail}`).toBe(
      worst <= MAX_OFF_TRACK ? `${worst.toFixed(3)} — ${detail}` : `<= ${MAX_OFF_TRACK}`,
    );
  });
});

/**
 * L'invariante FORTE, quella che il controllo a z = 0 non copre: la strada su
 * cui si corre non deve solo passare sotto la mucca, deve essere DRITTA.
 *
 * Si misura il centro del ramo attivo a ogni z campionata fino all'orizzonte,
 * in ogni frame di un bivio completo, e si chiedono tre cose:
 *  - continuità: fra un frame e il successivo nessuna z si sposta più di
 *    quanto la geometria consenta — è il test dello SCATTO, e vale anche
 *    attraverso i cambi di fase, dove lo scatto è esattamente ciò che ci si
 *    aspetta di trovare se qualcosa non torna;
 *  - convergenza monotona: lo scostamento PEGGIORE su tutta la pista non
 *    risale mai;
 *  - chiusura pulita: nel primo frame senza bivio la pista vale 0 a ogni z, e
 *    quindi la differenza con l'ultimo frame di bivio è nulla.
 */
describe('la strada su cui si corre è dritta, non solo centrata', () => {
  const HORIZON = CONFIG.world.chunkLength * CONFIG.world.chunkCount;
  const Z_SAMPLES: readonly number[] = Array.from({ length: 61 }, (_, i) => (i * HORIZON) / 60);

  /**
   * Tetto allo spostamento laterale di una z fra due frame. Deriva dalla
   * formula (branchCenterAt): il centro è branchSeparation per l'apertura per
   * il raddrizzamento, e in un frame si percorrono al più maxSpeed * STEP
   * unità. Le due smoothstep hanno pendenza al più 1,5 diviso la loro
   * lunghezza (forkBlendZ per l'apertura, commitZ per il raddrizzamento) e si
   * sommano nel caso peggiore.
   */
  const MAX_STEP =
    CONFIG.path.branchSeparation *
    CONFIG.world.maxSpeed *
    STEP *
    1.5 *
    (1 / CONFIG.path.forkBlendZ + 1 / CONFIG.path.commitZ);

  it('nessuno scatto a nessuna z, nemmeno ai cambi di fase (3 velocità x 2 rami x 5 seed)', () => {
    let worstStep = 0;
    let stepDetail = '';
    let worstClosure = 0;
    let closures = 0;

    for (const speed of [CONFIG.world.startSpeed, 28, CONFIG.world.maxSpeed]) {
      for (const side of SIDES) {
        for (let seed = 1; seed <= 5; seed++) {
          const bus = createEventBus();
          const rng = createRng(seed);
          let path: PathState = createPath();
          let chosen = false;
          let previous: number[] | null = null;
          let previousPhase: ForkPhase = 'none';
          let previousWorst = Number.POSITIVE_INFINITY;

          for (let frame = 0; frame < 20000; frame++) {
            path = updatePath(path, speed * STEP, speed, rng, bus);
            if (!chosen && path.phase === 'approaching') {
              chooseBranch(path, side);
              chosen = true;
            }
            if (!chosen) continue;

            // Il ramo che la mucca sta percorrendo: dopo la chiusura è il
            // tronco, e la sua etichetta cambia — il pezzo di strada, no.
            const branch = path.phase === 'none' ? 'main' : side;
            const current = Z_SAMPLES.map((z) => branchCenterAt(path, branch, z));

            if (previous !== null) {
              for (let i = 0; i < current.length; i++) {
                const before = previous[i];
                const now = current[i];
                if (before === undefined || now === undefined) throw new Error('campione mancante');
                const step = Math.abs(now - before);
                if (step > worstStep) {
                  worstStep = step;
                  stepDetail = `${speed} u/s, ramo ${side}, seed ${seed}, z ${Z_SAMPLES[i]?.toFixed(0)}, ${previousPhase} -> ${path.phase}`;
                }
                if (previousPhase === 'realigning' && path.phase === 'none') {
                  worstClosure = Math.max(worstClosure, step);
                }
              }
            }

            // Lo scostamento peggiore su tutta la pista non risale mai.
            const worstNow = current.reduce((max, c) => Math.max(max, Math.abs(c)), 0);
            expect(worstNow).toBeLessThanOrEqual(previousWorst + 1e-9);
            previousWorst = worstNow;

            if (previousPhase === 'realigning' && path.phase === 'none') {
              closures += 1;
              // Chiusura: pista dritta a ogni z, non "quasi".
              for (const c of current) expect(c).toBe(0);
              break;
            }
            previous = current;
            previousPhase = path.phase;
          }
        }
      }
    }

    expect(closures).toBe(30);
    expect(worstClosure).toBe(0);
    expect(`${worstStep.toFixed(3)} — ${stepDetail}`).toBe(
      worstStep <= MAX_STEP
        ? `${worstStep.toFixed(3)} — ${stepDetail}`
        : `<= ${MAX_STEP.toFixed(3)}`,
    );
  });
});

describe('realignProgress', () => {
  it('vale 0 fuori dal riallineamento, sale da 0 a 1 durante, e torna 0 alla chiusura', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(7);
    const speed = 20;

    path = travel(path, path.nextForkIn + 1, speed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(realignProgressOf(path)).toBe(0);

    const seen: number[] = [];
    let guard = 0;
    while (path.phase !== 'none' && guard < 5000) {
      path = updatePath(path, speed * STEP, speed, rng, bus);
      if (path.phase === 'realigning') seen.push(path.realignProgress);
      guard += 1;
    }

    expect(seen.length).toBeGreaterThan(10);
    // Cresce in modo monotono e a passi regolari: nessun raddoppio nel primo
    // frame, che è ciò che faceva scattare lateralmente il mondo all'inizio di
    // ogni riallineamento.
    const first = seen[0];
    if (first === undefined) throw new Error('nessun frame di riallineamento');
    // L'avanzamento è una frazione di DISTANZA (forkBlendZ), non di tempo:
    // il passo nominale per frame è quindi quanto si percorre in un frame
    // diviso la lunghezza dell'apertura.
    const nominalStep = (speed * STEP) / CONFIG.path.forkBlendZ;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(nominalStep + 1e-9);
    for (let i = 1; i < seen.length; i++) {
      const previous = seen[i - 1];
      const current = seen[i];
      if (previous === undefined || current === undefined) throw new Error('campione mancante');
      expect(current).toBeGreaterThan(previous);
      expect(current - previous).toBeLessThanOrEqual(nominalStep + 1e-9);
    }

    // Alla chiusura il riallineamento era praticamente completo: è ciò che
    // permette alla vista di far svanire il nastro scartato senza scatti.
    const last = seen[seen.length - 1];
    if (last === undefined) throw new Error('nessun campione finale');
    expect(last).toBeGreaterThan(1 - nominalStep - 1e-9);
    expect(path.phase).toBe('none');
    expect(realignProgressOf(path)).toBe(0);
  });
});
