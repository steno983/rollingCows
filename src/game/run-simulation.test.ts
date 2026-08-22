import { describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
// Unico riferimento alla vista in questo file, e per una ragione precisa: il
// tetto delle istanze è una promessa che la vista fa al gioco ("so disegnare
// fino a N entità dello stesso tipo"), e l'unico modo di verificarla è
// misurare quante il gioco ne produce davvero. instancing.ts non importa three.
import { INSTANCE_CAPACITY } from '../render/instancing';
import { ENTITY_BOX } from './collisions';
import { CONFIG } from './config';
import {
  createGame,
  entityIsSolid,
  type GameState,
  handleAction,
  startRun,
  updateGame,
} from './game';
import { activeBranchOf, branchCenterAt, choiceIsOpen, forkZOf, realignProgressOf } from './path';
import type { Entity, EntityKind, ObstacleKind, PickupKind } from './types';
import { isOverhead } from './types';

/**
 * Test di CONTINUITÀ DELL'ESPERIENZA, non di modulo.
 *
 * I test dei singoli moduli (spawner.test.ts, path.test.ts, game.test.ts) sono
 * verdi anche quando il percorso che il giocatore attraversa davvero è rotto:
 * lo spawner viene interrogato con un unico segmento enorme, il bivio viene
 * montato a mano, i buff non vengono mai raccolti da nessuno. Qui invece si
 * simula una corsa vera — chunk che si riciclano, bivi che nascono, si
 * risolvono e si chiudono — e si misura ciò che il giocatore incontra
 * davvero, nell'ordine in cui lo incontra.
 */

const STEP = 1 / 60;

/** Stessa finestra usata da game.ts per costruire le AABB. */
const MAX_ENTITY_DEPTH = Math.max(...Object.values(ENTITY_BOX).map((box) => box.depth));
const COLLISION_Z_WINDOW = CONFIG.player.depth + MAX_ENTITY_DEPTH;

interface Crossing {
  kind: ObstacleKind;
  /** Posizione ASSOLUTA lungo la discesa in cui l'ostacolo incrocia il giocatore. */
  distance: number;
  /** Velocità del mondo in quel momento. */
  speed: number;
}

interface GhostRun {
  game: GameState;
  crossings: Crossing[];
  buffsCollected: PickupKind[];
  /** Ostacoli che hanno attraversato il giocatore mentre erano INERTI: gli
   *  volano dentro senza effetto, quindi non fanno parte del ritmo che sente. */
  phantomCrossings: number;
}

/** Tempo reale che serve a completare l'azione richiesta da un ostacolo. */
function requiredActionSeconds(kind: ObstacleKind): number {
  return isOverhead(kind) ? CONFIG.player.slideSeconds : CONFIG.player.jumpSeconds;
}

function isObstacleKind(entity: Entity): entity is Entity & { kind: ObstacleKind } {
  return entity.category === 'obstacle';
}

/**
 * SCEGLIE, se un bivio e' in corso e nessuna scelta e' ancora stata data.
 *
 * Non e' una comodita' del test: da quando l'indecisione costa la corsa
 * (design §4, regola nuova) non scegliere non e' piu' un modo di giocare, e' un
 * modo di morire al primo bivio — misurato, a 8,0 s su tutti i seed. Un
 * fantasma che non sceglie smetterebbe quindi di misurare il percorso proprio
 * dove il percorso comincia a essere interessante.
 *
 * Sceglie il ramo SGOMBRO, cioe' quello che il gioco assegnava d'ufficio fino a
 * ieri: cosi' le corse simulate restano confrontabili con quelle di prima, e i
 * test che vogliono il ramo ricco lo chiedono esplicitamente nel proprio
 * `onFrame` (la scelta resta cambiabile fino al punto di non ritorno).
 */
function chooseIfUndecided(game: GameState): void {
  if (!choiceIsOpen(game.path)) return;
  if (game.path.phase !== 'approaching' || game.path.choice !== null) return;
  handleAction(game, game.path.richBranch === 'left' ? 'CHOOSE_RIGHT' : 'CHOOSE_LEFT');
}

/**
 * Registra ogni ostacolo SOLIDO che entra nella finestra di collisione e lo
 * toglie di mezzo: il "fantasma" attraversa gli ostacoli invece di schiantarcisi,
 * così una singola corsa misura l'intero percorso generato invece di fermarsi
 * al primo errore. Non tocca i raccoglibili, che restano da prendere: è così
 * che la stessa corsa risponde anche alla domanda "un buff è mai raccoglibile?".
 */
function harvest(game: GameState, run: GhostRun, seen: Set<number>): void {
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (!isObstacleKind(entity)) continue;
    if (entity.z > COLLISION_Z_WINDOW) continue;
    if (seen.has(entity.id)) continue;
    // `entityIsSolid` e non `branchIsSolid`: e' la stessa domanda che si fa
    // il ciclo di collisione, e la differenza fra le due e' esattamente il
    // cartello del bivio, che sta sul tronco ma e' inerte per chi ha scelto.
    // Con branchIsSolid il fantasma raccoglieva il cartello come se fosse un
    // ostacolo del ritmo, e la coppia "ultimo ostacolo -> cartello" violava
    // l'invariante di giocabilita' per un ostacolo che non e' nel ritmo e non
    // e' nemmeno solido.
    if (!entityIsSolid(game.path, entity)) {
      // Non lo si toglie di mezzo: se il ramo diventa solido più avanti,
      // l'ostacolo va ancora contato. Ma se supera del tutto il giocatore
      // restando inerte, è un fantasma.
      //
      // Il cartello del bivio no: e' inerte DI PROPOSITO per chi ha scelto, e
      // per una ragione geometrica — la mucca e' su un ramo, cioe' fino a
      // branchSeparation unita' di lato, e il cartello le passa accanto invece
      // che addosso. Non e' un ostacolo che gli vola dentro senza effetto, e'
      // un palo piantato di fianco alla strada che ha imboccato.
      if (entity.z < -COLLISION_Z_WINDOW && entity.kind !== 'signpost') {
        seen.add(entity.id);
        run.phantomCrossings += 1;
      }
      continue;
    }
    seen.add(entity.id);
    run.crossings.push({
      kind: entity.kind,
      distance: game.world.distance + entity.z,
      speed: game.world.speed,
    });
    entity.alive = false;
  }
}

function ghostRun(seed: number, seconds: number, onFrame?: (game: GameState) => void): GhostRun {
  const bus = createEventBus();
  const game = createGame(seed, bus);
  startRun(game);

  const run: GhostRun = { game, crossings: [], buffsCollected: [], phantomCrossings: 0 };
  const seen = new Set<number>();

  bus.on('pickup:collected', (payload) => {
    if (payload.kind !== 'snowflake') run.buffsCollected.push(payload.kind);
  });

  const frames = Math.round(seconds / STEP);
  for (let frame = 0; frame < frames; frame++) {
    harvest(game, run, seen);
    chooseIfUndecided(game);
    updateGame(game, STEP);
    if (onFrame !== undefined) onFrame(game);
    if (!game.alive) {
      // Un ostacolo è diventato solido DENTRO updateGame (fase del bivio che
      // scatta nello stesso frame): il fantasma non muore, lo registra e
      // prosegue. Se il gioco è sano questo ramo non viene mai preso.
      game.alive = true;
      harvest(game, run, seen);
    }
  }

  run.crossings.sort((a, b) => a.distance - b.distance);
  return run;
}

/**
 * Quanto prima dell'impatto il pilota automatico agisce, in secondi. Un salto
 * dura jumpSeconds e culmina a metà: agendo a poco più di metà salto prima
 * dell'ostacolo, l'apice cade proprio sopra di esso. Lo stesso valore va bene
 * per la scivolata, che schiaccia la sagoma dal primo istante.
 */
const AUTOPILOT_REACTION_SECONDS = 0.28;

interface AutopilotOutcome {
  aliveSeconds: number;
  deathKind: string;
}

/**
 * Un giocatore che gioca bene: guarda l'ostacolo solido più vicino davanti a
 * sé e, quando manca poco più di metà azione, salta (a terra) o scivola
 * (sospeso). Al bivio sceglie il ramo sgombro appena il bivio compare — non
 * per avidità al contrario, ma perché è il minimo che il gioco ora RICHIEDE:
 * chi non sceglie va a sbattere contro il cartello (design §4, regola nuova).
 */
function autopilotRun(seed: number, seconds: number): AutopilotOutcome {
  const bus = createEventBus();
  const game = createGame(seed, bus);
  startRun(game);

  let deathKind = '';
  bus.on('obstacle:hit', (payload) => {
    if (payload.outcome === 'death') deathKind = `${payload.kind} (z ${payload.z.toFixed(2)})`;
  });

  const frames = Math.round(seconds / STEP);
  for (let frame = 0; frame < frames; frame++) {
    chooseIfUndecided(game);

    let nearest: Entity | null = null;
    for (const entity of game.entities) {
      if (!entity.alive || entity.category !== 'obstacle') continue;
      if (entity.z <= 0) continue;
      if (!entityIsSolid(game.path, entity)) continue;
      if (nearest === null || entity.z < nearest.z) nearest = entity;
    }

    if (nearest !== null && nearest.z / game.world.speed <= AUTOPILOT_REACTION_SECONDS) {
      if (isOverhead(nearest.kind)) {
        // In aria la scivolata è un tuffo: atterra subito e prosegue in
        // scivolata, ed è proprio la manovra che serve qui.
        if (!game.player.sliding) handleAction(game, 'SLIDE');
      } else if (!game.player.airborne) {
        handleAction(game, 'JUMP');
      }
    }

    updateGame(game, STEP);
    if (!game.alive) return { aliveSeconds: frame * STEP, deathKind };
  }

  return { aliveSeconds: seconds, deathKind };
}

describe('BUCO 1 — gap fra ostacoli come li incontra il giocatore', () => {
  it('nessuna coppia di ostacoli consecutivi è impossibile da superare, attraverso confini di chunk e bivi (25 seed x 60 s)', () => {
    const SEEDS = 25;
    const SECONDS = 60;

    let pairsChecked = 0;
    let impossible = 0;
    let worst = { gap: Infinity, needed: 0, seed: 0, from: '' as string, to: '' as string };

    for (let seed = 1; seed <= SEEDS; seed++) {
      const { crossings } = ghostRun(seed, SECONDS);
      for (let i = 1; i < crossings.length; i++) {
        const previous = crossings[i - 1];
        const current = crossings[i];
        if (previous === undefined || current === undefined) throw new Error('crossing mancante');
        const gap = current.distance - previous.distance;
        // Il giocatore deve poter COMPLETARE l'azione richiesta dal primo
        // ostacolo prima che arrivi il secondo, alla velocità di quel momento.
        const needed = requiredActionSeconds(previous.kind) * current.speed;
        pairsChecked += 1;
        if (gap < needed) impossible += 1;
        if (gap - needed < worst.gap - worst.needed) {
          worst = { gap, needed, seed, from: previous.kind, to: current.kind };
        }
      }
    }

    expect(pairsChecked).toBeGreaterThan(500);
    expect(
      `${impossible}/${pairsChecked} coppie impossibili; peggiore: seed ${worst.seed}, ` +
        `${worst.from} -> ${worst.to}, gap ${worst.gap.toFixed(2)} contro ${worst.needed.toFixed(2)} necessari`,
    ).toBe(
      `0/${pairsChecked} coppie impossibili; peggiore: seed ${worst.seed}, ` +
        `${worst.from} -> ${worst.to}, gap ${worst.gap.toFixed(2)} contro ${worst.needed.toFixed(2)} necessari`,
    );
  });

  it('nessun ostacolo attraversa il giocatore restando inerte (10 seed x 90 s)', () => {
    // Corollario del precedente: un ostacolo che passa attraverso il giocatore
    // mentre il suo ramo non è solido non entra nella misura del gap, e il
    // ritmo misurato diventa una finzione. Con i rami popolati PRIMA della
    // biforcazione era il caso di tutto il contenuto di ogni bivio.
    let phantoms = 0;
    let crossings = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const run = ghostRun(seed, 90);
      phantoms += run.phantomCrossings;
      crossings += run.crossings.length;
    }
    expect(crossings).toBeGreaterThan(200);
    expect(phantoms).toBe(0);
  });
});

describe('BUCO 2 — i buff sono raccoglibili in una corsa vera', () => {
  it('in una corsa simulata almeno un buff viene raccolto', () => {
    // Il seed è arbitrario, e la sua fortuna si sposta con QUALUNQUE taratura
    // che cambi la cadenza dei bivi: legando il riallineamento alla distanza
    // (forkBlendZ) invece che al tempo, a velocità di partenza ogni bivio
    // dura ~17 unità in più e tutta la generazione scorre di conseguenza. Il
    // vecchio 2026 è finito così fra i seed "asciutti" a 90 s, che sono circa
    // 2 su 10 in qualunque taratura (misurato: 2025 e 2026 su 2020-2030) —
    // non un buco, la coda della distribuzione. La proprietà vera la misura
    // il test successivo, su 20 seed; questo resta il suo controllo rapido.
    const { buffsCollected } = ghostRun(1, 90);
    expect(buffsCollected.length).toBeGreaterThan(0);
  });

  it('su 20 seed la stragrande maggioranza delle corse raccoglie almeno un buff', () => {
    const SEEDS = 20;
    // 120 s e non più 90: la zona franca dopo ogni biforcazione
    // (path.branchClearanceAfterFork) toglie 24 unità di ramo a ogni bivio, e
    // con esse una fetta dei buff comuni che vi sarebbero nati. È il prezzo
    // dichiarato di quella correzione; la soglia di 19 su 20 resta quella di
    // prima, perché è la proprietà ("i buff sono raggiungibili davvero") a non
    // dover cedere. A 90 s la stessa misura dà 18 su 20.
    const SECONDS = 120;
    let withBuff = 0;
    const kinds = new Set<PickupKind>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { buffsCollected } = ghostRun(seed, SECONDS);
      if (buffsCollected.length > 0) withBuff += 1;
      for (const kind of buffsCollected) kinds.add(kind);
    }
    // "Stragrande maggioranza", non tutte: i buff comuni nascono anche sui
    // rami di un bivio (non solo sul tronco), quindi possono capitare tutti
    // sul ramo che finisce scartato — su 90 s e ~20 seed indipendenti, un
    // singolo seed sfortunato non segnala un buco nella generazione (verificato:
    // seed 5, in questa taratura, vede ogni cristallo comune nascere proprio
    // sul ramo poi non scelto). Qualunque taratura legittima di CONFIG può
    // spostare quale seed è quello sfortunato; imporre 20/20 renderebbe il
    // test fragile a ogni bilanciamento invece che al buco reale che vuole
    // scoprire.
    expect(withBuff).toBeGreaterThanOrEqual(SEEDS - 1);
    // Il campanaccio non è più escluso: aveva peso zero fra i buff comuni,
    // il che significava che chi non sceglie mai ai bivi non vedeva MAI uno
    // scudo — l'unico buff che cambia davvero una corsa. Ora
    // spawn.commonBuffWeights.bell vale 1 (raro, non impossibile), quindi qui
    // può comparire; resta molto più probabile sul ramo ricco, ed è quello che
    // verifica il test successivo.
    // Non un solo tipo fortunato: il contenuto della v2 deve essere davvero
    // raggiungibile in tutte le sue forme.
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('chi sceglie il ramo ricco arriva a raccogliere TUTTI e quattro i buff, campanaccio compreso', () => {
    const kinds = new Set<PickupKind>();
    for (let seed = 1; seed <= 25; seed++) {
      const run = ghostRun(seed, 120, (game) => {
        if (!choiceIsOpen(game.path) || game.path.phase !== 'approaching') return;
        handleAction(game, game.path.richBranch === 'left' ? 'CHOOSE_LEFT' : 'CHOOSE_RIGHT');
      });
      for (const kind of run.buffsCollected) kinds.add(kind);
    }
    expect([...kinds].sort()).toEqual(['bell', 'crystal', 'magnet', 'star']);
  });
});

describe('BUCO 3 — il ramo scelto contiene qualcosa dopo il riallineamento', () => {
  it('alla chiusura di ogni bivio il tracciato davanti al giocatore non è mai vuoto (15 seed x 90 s)', () => {
    // game.test.ts verifica solo che il ramo SCARTATO sparisca: passerebbe
    // identico se sparissero entrambi. Qui si guarda il ramo che resta.
    const AHEAD_Z = CONFIG.path.previewZ;
    let forksClosed = 0;
    let closedEmpty = 0;
    let minObstaclesAhead = Number.POSITIVE_INFINITY;

    for (let seed = 1; seed <= 15; seed++) {
      let phaseBefore = 'none';
      ghostRun(seed, 90, (game) => {
        const phase = game.path.phase;
        if (phaseBefore !== 'none' && phase === 'none') {
          forksClosed += 1;
          let obstacles = 0;
          for (const entity of game.entities) {
            if (!entity.alive || entity.branch !== 'main') continue;
            if (entity.z <= 0 || entity.z > AHEAD_Z) continue;
            if (entity.category === 'obstacle') obstacles += 1;
          }
          if (obstacles === 0) closedEmpty += 1;
          minObstaclesAhead = Math.min(minObstaclesAhead, obstacles);
        }
        phaseBefore = phase;
      });
    }

    expect(forksClosed).toBeGreaterThan(50);
    expect(closedEmpty).toBe(0);
    expect(minObstaclesAhead).toBeGreaterThan(0);
  });

  it('durante il riallineamento il vecchio tronco è già tutto alle spalle', () => {
    // È la condizione che rende lecito toglierlo alla chiusura del bivio
    // (vedi game.ts, handleForkTransitions): se una sua entità fosse ancora
    // davanti al giocatore, rimuoverla sarebbe una sparizione a vista.
    let framesChecked = 0;
    let worstZ = Number.NEGATIVE_INFINITY;
    for (let seed = 1; seed <= 10; seed++) {
      ghostRun(seed, 90, (game) => {
        if (game.path.phase !== 'realigning') return;
        framesChecked += 1;
        for (const entity of game.entities) {
          if (!entity.alive || entity.branch !== 'main') continue;
          worstZ = Math.max(worstZ, entity.z);
        }
      });
    }
    expect(framesChecked).toBeGreaterThan(100);
    expect(worstZ).toBeLessThan(0);
  });
});

describe('BUCO 4 — finestra di solidità al commit', () => {
  it('nel frame in cui il ramo scelto diventa solido, nessuna sua entità è già addosso al giocatore', () => {
    let commits = 0;
    let worstZ = Number.POSITIVE_INFINITY;

    for (let seed = 1; seed <= 15; seed++) {
      let phaseBefore = 'none';
      ghostRun(seed, 90, (game) => {
        const phase = game.path.phase;
        if (phaseBefore === 'approaching' && phase === 'committed') {
          commits += 1;
          for (const entity of game.entities) {
            if (!entity.alive || entity.branch !== game.path.activeBranch) continue;
            worstZ = Math.min(worstZ, entity.z);
          }
        }
        phaseBefore = phase;
      });
    }

    expect(commits).toBeGreaterThan(50);
    // I rami vivono oltre la biforcazione, che al commit dista commitZ: la
    // prima entità del ramo scelto non può quindi trovarsi dentro la finestra
    // di collisione. Prima della correzione un `arch` poteva diventare solido
    // a 0,30 unità dal muso: morte inevitabile, zero preavviso.
    expect(worstZ).toBeGreaterThan(COLLISION_Z_WINDOW);
  });
});

describe('BUCO 8 — nessun ostacolo uccide mentre è disegnato fuori dal corridoio', () => {
  it('ogni ostacolo SOLIDO che entra nella finestra di collisione sta dentro trackWidth/2 (30 seed x 90 s)', () => {
    // Il test di BUCO 4 guarda il solo frame del commit ed è insufficiente
    // proprio perché il problema si manifesta DOPO: il ramo scelto diventa
    // solido al punto di non ritorno, ma la traslazione laterale del mondo
    // parte solo quando la biforcazione arriva a z=0. Nel mezzo, un ostacolo
    // del ramo era già letale mentre sullo schermo stava fino a
    // branchSeparation (6) unità di lato, su un corridoio largo trackWidth
    // (4): una morte che il giocatore non può né prevedere né imparare, una
    // potenziale per ogni bivio.
    //
    // Lo scostamento è calcolato con la stessa funzione della vista
    // (render/entities-view.ts, entityWorldOffsetX, che chiama branchCenterAt):
    // dov'è il pezzo di strada su cui l'ostacolo sta, alla sua distanza. Da
    // quando il ramo scelto si raddrizza prima della biforcazione il numero
    // peggiore non è "sotto la semi-larghezza" ma zero esatto.
    const HALF_TRACK = CONFIG.world.trackWidth / 2;
    let checked = 0;
    let outside = 0;
    let worst = { lateral: 0, detail: '' };

    for (let seed = 1; seed <= 30; seed++) {
      ghostRun(seed, 90, (game) => {
        for (const entity of game.entities) {
          if (!entity.alive || entity.category !== 'obstacle') continue;
          if (Math.abs(entity.z) > COLLISION_Z_WINDOW) continue;
          if (!entityIsSolid(game.path, entity)) continue;

          checked += 1;
          const lateral = Math.abs(branchCenterAt(game.path, entity.branch, entity.z));
          if (lateral > HALF_TRACK) outside += 1;
          if (lateral > worst.lateral) {
            worst = {
              lateral,
              detail: `seed ${seed}, ${entity.kind} sul ramo ${entity.branch}, fase ${game.path.phase}, z ${entity.z.toFixed(2)}`,
            };
          }
        }
      });
    }

    expect(checked).toBeGreaterThan(500);
    expect(
      `${outside}/${checked} ostacoli letali fuori pista; peggiore ${worst.lateral.toFixed(2)} su ${HALF_TRACK} — ${worst.detail}`,
    ).toBe(
      `0/${checked} ostacoli letali fuori pista; peggiore ${worst.lateral.toFixed(2)} su ${HALF_TRACK} — ${worst.detail}`,
    );
  });
});

describe('BUCO 5 — sopravvivenza di un giocatore che gioca bene', () => {
  it('un pilota automatico che salta e scivola al momento giusto arriva vivo a 60 secondi (20 seed)', () => {
    const SEEDS = 20;
    const SECONDS = 60;
    const survived: number[] = [];
    const deaths: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const outcome = autopilotRun(seed, SECONDS);
      if (outcome.aliveSeconds >= SECONDS) survived.push(seed);
      else
        deaths.push(
          `seed ${seed}: morto a ${outcome.aliveSeconds.toFixed(1)} s su ${outcome.deathKind}`,
        );
    }

    expect(deaths).toEqual([]);
    expect(survived).toHaveLength(SEEDS);
  });
});

describe('BUCO 6 — continuità laterale', () => {
  it('nessuna entità salta di lato fra un frame e il successivo (10 seed x 90 s)', () => {
    // Lo scostamento laterale di un\'entità è branchCenterAt alla sua z: la
    // stessa funzione di render/entities-view.ts (entityWorldOffsetX).
    //
    // L\'unico movimento laterale legittimo viene dalle due smoothstep che la
    // compongono — l\'apertura della Y (lunga forkBlendZ) e il raddrizzamento
    // del ramo scelto (lungo commitZ) — che hanno pendenza al più 1,5 diviso
    // la propria lunghezza e nel caso peggiore si sommano. In un frame si
    // percorrono al massimo maxSpeed * STEP unità.
    const maxLegitimateStep =
      CONFIG.path.branchSeparation *
      CONFIG.world.maxSpeed *
      STEP *
      1.5 *
      (1 / CONFIG.path.forkBlendZ + 1 / CONFIG.path.commitZ);
    let worstStep = 0;
    let worstDetail = '';

    for (let seed = 1; seed <= 10; seed++) {
      let previous = new Map<number, number>();
      ghostRun(seed, 90, (game) => {
        const current = new Map<number, number>();
        for (const entity of game.entities) {
          if (!entity.alive) continue;
          const x = branchCenterAt(game.path, entity.branch, entity.z);
          const before = previous.get(entity.id);
          if (before !== undefined) {
            const step = Math.abs(x - before);
            if (step > worstStep) {
              worstStep = step;
              worstDetail = `seed ${seed}, entità ${entity.id} (${entity.kind}, ramo ${entity.branch}), fase ${game.path.phase}`;
            }
          }
          current.set(entity.id, x);
        }
        previous = current;
      });
    }

    expect(`${worstStep.toFixed(3)} — ${worstDetail}`).toBe(
      worstStep <= maxLegitimateStep
        ? `${worstStep.toFixed(3)} — ${worstDetail}`
        : `<= ${maxLegitimateStep.toFixed(3)}`,
    );
  });

  it("il riallineamento è praticamente completo nell'ultimo frame in cui esiste", () => {
    // È ciò che permette alla vista (render/terrain.ts, trackHalfWidths) di
    // far svanire il nastro scartato PRIMA che il bivio si chiuda: se il
    // riallineamento si interrompesse a metà, nel frame della chiusura quel
    // nastro salterebbe al centro largo quanto l'altro.
    let closures = 0;
    let worstProgress = 1;
    for (let seed = 1; seed <= 10; seed++) {
      let progressBefore = 0;
      let phaseBefore = 'none';
      ghostRun(seed, 90, (game) => {
        if (phaseBefore === 'realigning' && game.path.phase === 'none') {
          closures += 1;
          worstProgress = Math.min(worstProgress, progressBefore);
        }
        phaseBefore = game.path.phase;
        progressBefore = realignProgressOf(game.path);
      });
    }
    expect(closures).toBeGreaterThan(30);
    expect(worstProgress).toBeGreaterThan(0.95);
  });
});

describe('BUCO 9 — la strada su cui si corre è dritta, non solo centrata', () => {
  it('in una corsa vera lo scostamento è nullo a ogni distanza (12 seed x 90 s)', () => {
    // I due difetti visti dal proprietario, misurati insieme su corse vere:
    // «la mucca sembra finire fuori pista» (lo scostamento alla sua quota) e
    // «la strada si deforma» (lo scostamento a tutte le altre distanze, che il
    // primo controllo non vedeva — era verde mentre il secondo difetto era in
    // produzione). Si riducono a una sola domanda: dov'è il centro del pezzo
    // di strada su cui la mucca sta correndo? Lei è a x = 0, quindi la
    // risposta deve essere 0, a ogni z.
    //
    // path.test.ts la verifica su bivi pilotati a velocità fisse e su entrambi
    // i rami; qui la verificano la rampa di velocità vera e i rami che il
    // gioco sceglie da sé.
    const MAX_OFF_TRACK = 0.25;
    const HORIZON = CONFIG.world.chunkLength * CONFIG.world.chunkCount;
    let worst = 0;
    let detail = '';
    let forkFrames = 0;

    for (let seed = 1; seed <= 12; seed++) {
      ghostRun(seed, 90, (game) => {
        const path = game.path;
        // Dalla biforcazione in poi, cioè da quando la mucca è DENTRO il ramo
        // che ha scelto. Prima la Y è legittimamente aperta — è il bivio da
        // scegliere — e il ramo sta di lato per costruzione; che si chiuda
        // senza mai risalire lo verifica il test di convergenza in
        // path.test.ts.
        if (path.phase !== 'realigning') return;
        forkFrames += 1;
        const branch = activeBranchOf(path);
        for (let z = 0; z <= HORIZON; z += 4) {
          const off = Math.abs(branchCenterAt(path, branch, z));
          if (off > worst) {
            worst = off;
            detail = `seed ${seed}, fase ${path.phase}, z ${z}, velocità ${game.world.speed.toFixed(1)}`;
          }
        }
      });
    }

    // Migliaia di frame di riallineamento davvero misurati: senza questo, un
    // giorno in cui i bivi smettessero di aprirsi il test resterebbe verde
    // misurando il nulla.
    expect(forkFrames).toBeGreaterThan(3000);
    expect(`${worst.toFixed(3)} — ${detail}`).toBe(
      worst <= MAX_OFF_TRACK ? `${worst.toFixed(3)} — ${detail}` : `<= ${MAX_OFF_TRACK}`,
    );
  });
});

describe('BUCO 7 — onboarding: il primo bivio e il primo ostacolo sono raggiungibili', () => {
  it("su almeno 100 seed il primo bivio della corsa compare entro 4 secondi simulati dall'avvio", () => {
    const SEEDS = 100;
    const MAX_SECONDS = 4;
    const frames = Math.round(MAX_SECONDS / STEP);
    const late: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      let appeared = false;
      for (let frame = 0; frame < frames; frame++) {
        updateGame(game, STEP);
        if (game.path.phase !== 'none') {
          appeared = true;
          break;
        }
      }
      if (!appeared) late.push(`seed ${seed}`);
    }

    expect(late).toEqual([]);
  });

  it('su almeno 100 seed il primo ostacolo che il giocatore incontra è a terra, non sospeso', () => {
    const SEEDS = 100;
    const notGround: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      const firstObstacle = game.entities
        .filter(
          (entity): entity is Entity & { kind: ObstacleKind } =>
            entity.category === 'obstacle' && entity.branch === 'main',
        )
        .sort((a, b) => a.z - b.z)[0];

      if (firstObstacle === undefined) {
        throw new Error(`nessun ostacolo generato per il seed ${seed}`);
      }
      if (isOverhead(firstObstacle.kind)) notGround.push(`seed ${seed}: ${firstObstacle.kind}`);
    }

    expect(notGround).toEqual([]);
  });
});

describe('tetto delle istanze della vista', () => {
  it('il numero di entità vive di uno stesso tipo resta sotto la capienza dichiarata per quel tipo', () => {
    // I fiocchi oltre il tetto sarebbero raccoglibili ma INVISIBILI. I tetti
    // vivono in render/instancing.ts e sono DERIVATI da CONFIG, uno per tipo
    // (il fiocco ne ha uno tutto suo, molto più alto); qui si verifica che il
    // gioco non produca mai più di quanto la vista sa disegnare.
    const peak = new Map<EntityKind, number>();
    for (let seed = 1; seed <= 10; seed++) {
      ghostRun(seed, 90, (game) => {
        const counts = new Map<EntityKind, number>();
        for (const entity of game.entities) {
          if (!entity.alive) continue;
          counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
        }
        for (const [kind, count] of counts) {
          peak.set(kind, Math.max(peak.get(kind) ?? 0, count));
        }
      });
    }
    expect(peak.size).toBeGreaterThan(0);
    const over = [...peak]
      .filter(([kind, count]) => count > INSTANCE_CAPACITY[kind])
      .map(([kind, count]) => `${kind}: picco ${count} su capienza ${INSTANCE_CAPACITY[kind]}`);
    expect(over).toEqual([]);
  });
});

describe('BUCO 10 — la finestra di scelta è a tempo, e resta larga abbastanza', () => {
  /**
   * Misura la finestra di scelta come la vive il giocatore, su una corsa vera
   * e a velocità crescente. La scelta si dà all'ultimo istante utile, così la
   * finestra viene percorsa per intero e ce n'è una per ogni bivio.
   */
  function choiceWindows(profileName: string, seconds: number): { speed: number; span: number }[] {
    const bus = createEventBus();
    const game = createGame(3, bus);
    startRun(game, { profileName });

    const windows: { speed: number; span: number }[] = [];
    let openedAt: number | null = null;
    let openSpeed = 0;
    let wasOpen = false;

    const frames = Math.round(seconds / STEP);
    for (let frame = 0; frame < frames && game.alive; frame++) {
      // Fantasma: gli ostacoli non sono l'oggetto della misura, il cartello sì.
      for (const entity of game.entities) {
        if (entity.category === 'obstacle' && entity.kind !== 'signpost') entity.alive = false;
      }
      const open = choiceIsOpen(game.path);
      if (open && !wasOpen) {
        openedAt = frame;
        openSpeed = game.world.speed;
      }
      if (!open && wasOpen && openedAt !== null) {
        windows.push({ speed: openSpeed, span: (frame - openedAt) * STEP });
      }
      wasOpen = open;
      // All'ultimo frame utile: è così che la finestra si misura tutta.
      if (
        open &&
        game.path.phase === 'approaching' &&
        game.path.forkZ < CONFIG.path.commitZ + game.world.speed * STEP * 2
      ) {
        handleAction(game, 'CHOOSE_LEFT');
      }
      updateGame(game, STEP);
    }
    return windows;
  }

  it('dura lo stesso a ogni velocità e su ogni profilo, invece di gonfiarsi a bassa velocità', () => {
    // È tutto il punto del cambio: con la finestra legata a `previewZ` durava
    // 4,78 s a velocità di partenza e 2,15 s al tetto — un bivio fermo davanti
    // per cinque secondi con la decisione già presa da un pezzo.
    const nominal = CONFIG.path.choiceWindowSeconds;
    for (const profileName of ['calf', 'normal', 'bull'] as const) {
      const windows = choiceWindows(profileName, 240);
      expect(windows.length, `${profileName}: nessun bivio misurato`).toBeGreaterThan(10);
      for (const { speed, span } of windows) {
        // Il tetto vero è il minimo fra il tempo concesso e ciò che la
        // visibilità permette: sopra i 43 u/s comanda previewZ, e la finestra
        // si accorcia a (previewZ - commitZ) / speed. Sotto, comanda il tempo.
        const capped = (CONFIG.path.previewZ - CONFIG.path.commitZ) / speed;
        const expected = Math.min(nominal, capped);
        // Tolleranza in difetto e non in eccesso: la soglia di apertura si
        // calcola con la velocità di QUEL frame, ma la velocità sale mentre la
        // finestra viene percorsa, quindi la distanza fissata all'apertura si
        // copre in un pelo meno di tempo. È massimo a bassa velocità, dove la
        // curva è più ripida, e vale qualche centesimo.
        const detail = `${profileName} @ ${speed.toFixed(1)} u/s: ${span.toFixed(2)} s su ${expected.toFixed(2)} attesi`;
        expect(span, detail).toBeGreaterThanOrEqual(expected - 0.1);
        expect(span, detail).toBeLessThanOrEqual(expected + 0.02);
      }
    }
  });

  it('non si apre mai a più di previewZ: non si sceglie un bivio che non si vede', () => {
    for (const profileName of ['calf', 'normal', 'bull'] as const) {
      const bus = createEventBus();
      const game = createGame(6, bus);
      startRun(game, { profileName });
      let checked = 0;
      for (let frame = 0; frame < 60 * 120 && game.alive; frame++) {
        for (const entity of game.entities) {
          if (entity.category === 'obstacle' && entity.kind !== 'signpost') entity.alive = false;
        }
        if (choiceIsOpen(game.path)) {
          const forkZ = forkZOf(game.path);
          if (forkZ === null) throw new Error('finestra aperta senza bivio');
          expect(forkZ).toBeLessThanOrEqual(CONFIG.path.previewZ);
          checked += 1;
        }
        if (
          choiceIsOpen(game.path) &&
          game.path.phase === 'approaching' &&
          game.path.forkZ < CONFIG.path.commitZ + game.world.speed * STEP * 2
        ) {
          handleAction(game, 'CHOOSE_LEFT');
        }
        updateGame(game, STEP);
      }
      expect(checked).toBeGreaterThan(500);
    }
  });

  it('un giocatore che reagisce in 1,5 s sopravvive, pur continuando a schivare', () => {
    // La domanda che rende leale la regola nuova: dentro la finestra non si
    // decide soltanto, si continua a saltare e scivolare — a 46 u/s ci passano
    // circa 3,3 ostacoli. Se il resto della corsa mangiasse la finestra, "non
    // hai scelto" diventerebbe una morte che il giocatore non capisce.
    const REACTION = 1.5;
    const delayFrames = Math.round(REACTION / STEP);

    for (const profileName of ['calf', 'normal', 'bull'] as const) {
      const deaths: string[] = [];
      for (let seed = 1; seed <= 8; seed++) {
        const bus = createEventBus();
        const game = createGame(seed, bus);
        startRun(game, { profileName });
        let deathKind = '';
        bus.on('obstacle:hit', (payload) => {
          if (payload.outcome === 'death') deathKind = payload.kind;
        });
        bus.on('player:fell', () => {
          deathKind = 'chasm';
        });

        let openedAt: number | null = null;
        let chosen = false;
        const frames = Math.round(180 / STEP);
        for (let frame = 0; frame < frames && game.alive; frame++) {
          if (choiceIsOpen(game.path)) {
            if (openedAt === null) {
              openedAt = frame;
              chosen = false;
            }
            if (!chosen && frame - openedAt >= delayFrames) {
              handleAction(game, 'CHOOSE_LEFT');
              chosen = true;
            }
          } else if (game.path.phase === 'none') {
            openedAt = null;
          }

          let nearest: Entity | null = null;
          for (const entity of game.entities) {
            if (!entity.alive || entity.category !== 'obstacle') continue;
            if (entity.z <= 0 || !entityIsSolid(game.path, entity)) continue;
            if (nearest === null || entity.z < nearest.z) nearest = entity;
          }
          if (nearest !== null && nearest.z / game.world.speed <= AUTOPILOT_REACTION_SECONDS) {
            if (isOverhead(nearest.kind)) {
              if (!game.player.sliding) handleAction(game, 'SLIDE');
            } else if (!game.player.airborne) {
              handleAction(game, 'JUMP');
            }
          }
          updateGame(game, STEP);
        }
        if (!game.alive) deaths.push(`seed ${seed} su ${deathKind}`);
      }
      expect(deaths, `${profileName}: morti con 1,5 s di reazione`).toEqual([]);
    }
  }, 120000);
});
