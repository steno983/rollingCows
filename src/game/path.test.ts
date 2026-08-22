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
  choiceIsOpen,
  chooseBranch,
  createPath,
  forkApproaching,
  forkCommitted,
  forkZOf,
  realignProgressOf,
  SIGNPOST_OFFSET_Z,
  signpostIsSolid,
  updatePath,
} from './path';
import { resolveDifficultyProfile, speedAt } from './speed';

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

/**
 * Avanza finché la FINESTRA DI SCELTA non si apre — che non è più lo stesso
 * momento in cui il bivio compare: il bivio si vede da `previewZ`, ma la
 * scelta si apre a un tempo fisso dal punto di non ritorno (vedi
 * `CONFIG.path.choiceWindowSeconds`). Quasi tutti i test che scelgono hanno
 * bisogno di questo, non di `travelToFork`.
 */
function travelToChoice(
  path: PathState,
  speed: number,
  rng: ReturnType<typeof createRng>,
  bus: EventBus,
): PathState {
  let current = path;
  let guard = 0;
  while (!choiceIsOpen(current) && guard < 10000) {
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

  it('compare dopo la distanza attesa, ma la scelta non è ancora aperta', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    let path: PathState = createPath();
    const rng = createRng(1);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    // Il bivio è VISIBILE: la fase è cambiata, la Y del tracciato c'è, il
    // cartello è stato piazzato. Ma vedere e poter scegliere sono due cose
    // diverse, e a velocità di partenza fra le due passano quasi tre secondi.
    expect(path.phase).toBe('approaching');
    expect(choiceIsOpen(path)).toBe(false);
    expect(payloads.length).toBe(0);
  });

  it('fork:appeared arriva quando si apre la finestra di scelta, non prima', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    const speed = CONFIG.world.startSpeed;
    const rng = createRng(1);
    const path = travelToChoice(createPath(), speed, rng, bus);

    expect(choiceIsOpen(path)).toBe(true);
    expect(payloads.length).toBe(1);
    expect(['left', 'right']).toContain(payloads[0]?.richBranch);
    // E si apre a ridosso: entro un frame dalla soglia a tempo.
    const forkZ = forkZOf(path);
    if (forkZ === null) throw new Error('bivio mancante');
    const threshold = CONFIG.path.commitZ + speed * CONFIG.path.choiceWindowSeconds;
    expect(forkZ).toBeLessThanOrEqual(threshold);
    expect(forkZ).toBeGreaterThan(threshold - speed * STEP);
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
    path = travelToChoice(path, CONFIG.world.startSpeed, rng, bus);
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
    path = travelToChoice(path, CONFIG.world.startSpeed, rng, bus);
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

describe('senza scelta non si prende NESSUN ramo (design §4, regola nuova)', () => {
  it("al punto di non ritorno non impone piu' il ramo sgombro: la fase resta approaching", () => {
    const { bus, payloads } = recordedBus('fork:resolved');
    let path: PathState = createPath();
    const rng = createRng(7);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);

    path = travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    // Nessun ramo imboccato d'ufficio: nessuna scelta, nessun ramo attivo,
    // nessun 'fork:resolved'. Il tracciato prosegue dritto in mezzo ai due.
    expect(path.phase).toBe('approaching');
    expect(choiceOf(path)).toBeNull();
    expect(activeBranchOf(path)).toBe('main');
    expect(payloads.length).toBe(0);
  });

  it("superato il punto di non ritorno la scelta non e' piu' accettata", () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(11);
    path = travel(path, CONFIG.path.firstForkIn + 1, CONFIG.world.startSpeed, rng, bus);
    path = travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    // La fase e\' ancora 'approaching' (nessuno ha scelto), ma il punto di non
    // ritorno e\' passato: senza il controllo esplicito su commitZ dentro
    // chooseBranch la scelta resterebbe possibile fino al cartello.
    expect(path.phase).toBe('approaching');
    expect(chooseBranch(path, 'left')).toBe(false);
    expect(choiceOf(path)).toBeNull();
  });

  it('la rete di sicurezza chiude comunque un bivio mai scelto, invece di bloccarsi', () => {
    // In gioco non ci si arriva: il cartello uccide alla biforcazione. Ma la
    // macchina a stati non deve poter restare appesa se un giorno il cartello
    // non ci fosse (vedi path.ts, advanceUnchosen).
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(13);
    const speed = CONFIG.world.startSpeed;
    path = travel(path, CONFIG.path.firstForkIn + 1, speed, rng, bus);
    // La rete scatta quando e' passato anche il CARTELLO, che sta oltre la
    // biforcazione: chiudere prima lo toglierebbe di mezzo proprio mentre
    // arriva addosso a chi non ha scelto.
    path = travel(
      path,
      CONFIG.path.previewZ + CONFIG.path.forkBlendZ + SIGNPOST_OFFSET_Z + 2,
      speed,
      rng,
      bus,
    );

    expect(path.phase).toBe('none');
    expect(activeBranchOf(path)).toBe('main');
  });
});

describe('il cartello del bivio', () => {
  it('non esiste fuori da un bivio', () => {
    expect(signpostIsSolid(createPath())).toBe(false);
  });

  it("e' solido finche' nessuno ha scelto, inerte appena si sceglie", () => {
    // Sullo stato montato a mano, cioe\' sulla sola condizione, senza far
    // scorrere il mondo: e\' la scelta a decidere, non il tempo.
    expect(signpostIsSolid(forkApproaching({ forkZ: 80 }))).toBe(true);
    expect(signpostIsSolid(forkApproaching({ forkZ: 80, choice: 'left' }))).toBe(false);
    expect(signpostIsSolid(forkApproaching({ forkZ: 80, choice: 'right' }))).toBe(false);
  });

  it("e' solido su un bivio nato davvero, qualunque sia il ramo ricco", () => {
    const bus = createEventBus();
    const rng = createRng(2);
    const path = travelToFork(createPath(), CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(richBranchOf(path)).not.toBeNull();
    expect(signpostIsSolid(path)).toBe(true);
  });

  it('diventa inerte nello STESSO istante in cui la scelta viene registrata', () => {
    const bus = createEventBus();
    let path: PathState = createPath();
    const rng = createRng(2);
    path = travelToChoice(path, CONFIG.world.startSpeed, rng, bus);
    expect(signpostIsSolid(path)).toBe(true);

    // Nessun frame in mezzo, nessun aggiornamento: la solidita\' e\' una
    // funzione della scelta, non uno stato da mantenere in sincrono.
    expect(chooseBranch(path, 'left')).toBe(true);
    expect(signpostIsSolid(path)).toBe(false);
  });

  it('resta inerte per tutto il resto del bivio, a entrambi i lati', () => {
    for (const side of SIDES) {
      const bus = createEventBus();
      let path: PathState = createPath();
      const rng = createRng(5);
      const speed = CONFIG.world.startSpeed;
      path = travelToChoice(path, speed, rng, bus);
      chooseBranch(path, side);

      let guard = 0;
      while (path.phase !== 'none' && guard < 20000) {
        path = updatePath(path, speed * STEP, speed, rng, bus);
        expect(signpostIsSolid(path)).toBe(false);
        guard += 1;
      }
      expect(guard).toBeGreaterThan(0);
    }
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
    path = travelToChoice(path, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    // Oltre il punto di non ritorno, ma non oltre la biforcazione: la finestra
    // di scelta dura `choiceWindowSeconds`, quindi bastano quelle unita' piu'
    // qualcosa per superare `commitZ` restando dentro la fase impegnata.
    path = travel(
      path,
      CONFIG.world.startSpeed * CONFIG.path.choiceWindowSeconds + 1,
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
    path = travelToChoice(path, CONFIG.world.startSpeed, rng, bus);
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
    path = travelToChoice(path, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    // Fin quasi al punto di non ritorno, restando dentro la finestra di
    // scelta: la finestra dura `choiceWindowSeconds` per costruzione, quindi
    // è quella la distanza da percorrere, meno un'unità per non superarla.
    path = travel(
      path,
      CONFIG.world.startSpeed * CONFIG.path.choiceWindowSeconds - 1,
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
            // `choiceIsOpen` e non `phase === 'approaching'`: la fase comincia
            // a previewZ ma la scelta si apre a ridosso, e chiamare
            // chooseBranch prima significherebbe segnare `chosen` senza avere
            // scelto niente — cioè misurare un bivio in cui nessuno sceglie.
            if (!chosen && choiceIsOpen(path)) {
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
  /** La velocità più alta che il gioco raggiunge davvero, che non è
   *  `CONFIG.world.maxSpeed` (40, il tetto del profilo di riferimento) ma
   *  quella di "Toro". Misurare fino a 40 lasciava scoperto il 15% di velocità
   *  in più su cui la piegata è più ripida — cioè proprio il caso peggiore. */
  const TOP_SPEED = resolveDifficultyProfile('bull').maxSpeed;

  const MAX_STEP =
    CONFIG.path.branchSeparation *
    TOP_SPEED *
    STEP *
    1.5 *
    (1 / CONFIG.path.forkBlendZ + 1 / CONFIG.path.commitZ);

  /**
   * Tetto ASSOLUTO, e non derivato come quello sopra.
   *
   * `MAX_STEP` si muove insieme a `commitZ`: abbassare il punto di non ritorno
   * rende la piegata più ripida E alza la soglia che dovrebbe accorgersene,
   * quindi da solo quel controllo non può mai fallire per quella causa —
   * verifica che la formula descriva il codice, non che il risultato sia
   * guardabile. Questo numero invece resta fermo: 0,40 unità per frame a 60 Hz
   * sono 24 unità di scorrimento laterale al secondo su un punto della strada
   * a metà orizzonte, che è il limite oltre il quale la piegata smette di
   * leggersi come una curva e torna a leggersi come la deformazione che il
   * raddrizzamento è stato introdotto per togliere.
   *
   * Misurato oggi alla velocità di punta di "Toro" (46 u/s, commitZ = 20):
   * 0,345, contro 0,287 con il vecchio commitZ = 24. A commitZ 16 salirebbe a
   * 0,430 e questo test diventerebbe rosso, che è esattamente il suo scopo.
   */
  const ABSOLUTE_MAX_STEP = 0.4;

  it('nessuno scatto a nessuna z, nemmeno ai cambi di fase (3 velocità x 2 rami x 5 seed)', () => {
    let worstStep = 0;
    let stepDetail = '';
    let worstClosure = 0;
    let closures = 0;

    for (const speed of [CONFIG.world.startSpeed, 28, CONFIG.world.maxSpeed, TOP_SPEED]) {
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
            // `choiceIsOpen` e non `phase === 'approaching'`: la fase comincia
            // a previewZ ma la scelta si apre a ridosso, e chiamare
            // chooseBranch prima significherebbe segnare `chosen` senza avere
            // scelto niente — cioè misurare un bivio in cui nessuno sceglie.
            if (!chosen && choiceIsOpen(path)) {
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

    // 4 velocità × 2 rami × 5 seed.
    expect(closures).toBe(40);
    expect(worstClosure).toBe(0);
    expect(
      worstStep,
      `scatto laterale oltre il tetto assoluto — ${stepDetail}`,
    ).toBeLessThanOrEqual(ABSOLUTE_MAX_STEP);
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

    path = travelToChoice(path, speed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(realignProgressOf(path)).toBe(0);
    // Senza scelta non c'e' riallineamento: chi non sceglie non imbocca alcun
    // ramo e non arriva mai a questa fase (design §4, regola nuova).
    expect(chooseBranch(path, 'left')).toBe(true);

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

describe('il cartello sta nel CUNEO, non in mezzo alla strada', () => {
  const HALF_TRACK = CONFIG.world.trackWidth / 2;
  const HALF_SIGN = CONFIG.path.signpostHalfWidth;
  const SIGN_DEPTH = CONFIG.collisions.entityBox.signpost.depth;

  /** Spazio libero fra il bordo del cartello e il bordo interno del nastro
   *  più vicino, alla z data. Negativo = il cartello invade la pista. */
  function clearanceAt(path: PathState, z: number): number {
    let worst = Number.POSITIVE_INFINITY;
    for (const side of SIDES) {
      // Il cartello sta sul tronco, cioè a x = 0 (branchCenterAt('main') è
      // nullo per costruzione), e occupa ±HALF_SIGN.
      const inner = Math.abs(branchCenterAt(path, side, z)) - HALF_TRACK;
      worst = Math.min(worst, inner - HALF_SIGN);
    }
    return worst;
  }

  it('sulla biforcazione non ci starebbe: è il difetto che SIGNPOST_OFFSET_Z corregge', () => {
    // A forkZ esatta l'apertura vale 0 per costruzione, quindi i due nastri
    // sono ancora sovrapposti e non esiste alcun cuneo: il cartello sarebbe un
    // palo largo 3,5 in mezzo a una carreggiata larga 4.
    const path = forkApproaching({ forkZ: 60 });
    expect(branchCenterAt(path, 'left', 60)).toBe(0);
    expect(clearanceAt(path, 60)).toBeLessThan(0);
  });

  it('non sporge MAI dentro i due nastri, a nessuna z della sua profondità', () => {
    // Su tutta la vita di un bivio non scelto — che è l'unico caso in cui il
    // cartello esiste ancora, perché la scelta lo rimuove — e su tutta la sua
    // profondità, non solo al centro: il cuneo è più stretto sul bordo vicino.
    let worst = Number.POSITIVE_INFINITY;
    let detail = '';
    let checked = 0;

    for (const speed of [CONFIG.world.startSpeed, 28, CONFIG.world.maxSpeed]) {
      const bus = createEventBus();
      const rng = createRng(4);
      let path: PathState = createPath();
      for (let frame = 0; frame < 20000; frame++) {
        path = updatePath(path, speed * STEP, speed, rng, bus);
        const forkZ = forkZOf(path);
        if (forkZ === null) continue;
        const signZ = forkZ + SIGNPOST_OFFSET_Z;
        // Solo finché il cartello è davanti: dietro le spalle non lo si vede.
        if (signZ < 0) continue;
        for (const edge of [-SIGN_DEPTH / 2, 0, SIGN_DEPTH / 2]) {
          const clearance = clearanceAt(path, signZ + edge);
          checked += 1;
          if (clearance < worst) {
            worst = clearance;
            detail = `${speed} u/s, forkZ ${forkZ.toFixed(1)}, bordo ${edge}`;
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(1000);
    // Aria residua fra cartello e pista: deve restare positiva, e con un
    // margine che si legga come "accanto" invece che "attaccato".
    // L'epsilon non è generosità: `SIGNPOST_OFFSET_Z` è la bisezione della
    // stessa disuguaglianza, quindi il caso peggiore ci cade sopra ESATTAMENTE
    // e il confronto in virgola mobile lo manca per un ulp.
    const required = CONFIG.player.depth / 2 - 1e-9;
    expect(`${worst.toFixed(3)} — ${detail}`).toBe(
      worst >= required ? `${worst.toFixed(3)} — ${detail}` : '>= mezza mucca',
    );
  });

  it('appena si sceglie il cuneo si chiude su di lui: per questo va rimosso', () => {
    // È la ragione geometrica della rimozione (vedi game.ts, removeSignposts).
    // Il ramo scelto scivola al centro, la distanza fra i due nastri si
    // dimezza, e a raddrizzamento completo il cartello sarebbe esattamente
    // sotto la mucca. Nessuna distanza lo salverebbe: al massimo dell'apertura
    // il semi-spazio fra i nastri vale branchSeparation/2 − trackWidth/2 = 1,
    // meno delle 1,75 che il cartello occupa.
    const maxHalfSpaceAfterStraightening = CONFIG.path.branchSeparation / 2 - HALF_TRACK;
    expect(maxHalfSpaceAfterStraightening).toBeLessThan(HALF_SIGN);

    const committed = forkCommitted({ forkZ: 0, activeBranch: 'right' });
    const signZ = SIGNPOST_OFFSET_Z;
    // A raddrizzamento completo il ramo scelto è a x = 0, dove sta il cartello.
    expect(branchCenterAt(committed, 'right', signZ)).toBeCloseTo(0, 9);
    expect(clearanceAt(committed, signZ)).toBeLessThan(0);
  });
});
