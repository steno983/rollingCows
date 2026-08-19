import { describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import { CONFIG } from './config';
import { ENTITY_BOX } from './collisions';
import { createGame, handleAction, startRun, updateGame, type GameState } from './game';
import { branchIsSolid, branchOffsetX } from './path';
import { isOverhead } from './types';
import type { Entity, ObstacleKind, PickupKind } from './types';
// Unico riferimento alla vista in questo file, e per una ragione precisa: il
// tetto delle istanze è una promessa che la vista fa al gioco ("so disegnare
// fino a N entità dello stesso tipo"), e l'unico modo di verificarla è
// misurare quante il gioco ne produce davvero. instancing.ts non importa three.
import { MAX_INSTANCES_PER_KIND } from '../render/instancing';

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
    if (!branchIsSolid(game.path, entity.branch)) {
      // Non lo si toglie di mezzo: se il ramo diventa solido più avanti,
      // l'ostacolo va ancora contato. Ma se supera del tutto il giocatore
      // restando inerte, è un fantasma.
      if (entity.z < -COLLISION_Z_WINDOW) {
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

function ghostRun(
  seed: number,
  seconds: number,
  onFrame?: (game: GameState) => void,
): GhostRun {
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
 * (sospeso). Non sceglie mai al bivio: al punto di non ritorno il gioco gli
 * assegna il ramo più sgombro, ed è giusto che debba sopravvivere anche così.
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
    let nearest: Entity | null = null;
    for (const entity of game.entities) {
      if (!entity.alive || entity.category !== 'obstacle') continue;
      if (entity.z <= 0) continue;
      if (!branchIsSolid(game.path, entity.branch)) continue;
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
    ).toBe(`0/${pairsChecked} coppie impossibili; peggiore: seed ${worst.seed}, ` +
        `${worst.from} -> ${worst.to}, gap ${worst.gap.toFixed(2)} contro ${worst.needed.toFixed(2)} necessari`);
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
    const { buffsCollected } = ghostRun(2026, 90);
    expect(buffsCollected.length).toBeGreaterThan(0);
  });

  it('su 20 seed la stragrande maggioranza delle corse raccoglie almeno un buff', () => {
    const SEEDS = 20;
    let withBuff = 0;
    const kinds = new Set<PickupKind>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { buffsCollected } = ghostRun(seed, 90);
      if (buffsCollected.length > 0) withBuff += 1;
      for (const kind of buffsCollected) kinds.add(kind);
    }
    expect(withBuff).toBe(SEEDS);
    // Il campanaccio NON è fra questi: vive solo sul ramo ricco di un bivio
    // (design §7) e chi non sceglie riceve sempre quello sgombro. Vedi il
    // test successivo.
    expect(kinds.has('bell')).toBe(false);
    // Non un solo tipo fortunato: il contenuto della v2 deve essere davvero
    // raggiungibile in tutte le sue forme.
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('chi sceglie il ramo ricco arriva a raccogliere TUTTI e quattro i buff, campanaccio compreso', () => {
    const kinds = new Set<PickupKind>();
    for (let seed = 1; seed <= 25; seed++) {
      const run = ghostRun(seed, 120, (game) => {
        if (game.path.phase !== 'approaching') return;
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

describe('BUCO 5 — sopravvivenza di un giocatore che gioca bene', () => {
  it('un pilota automatico che salta e scivola al momento giusto arriva vivo a 60 secondi (20 seed)', () => {
    const SEEDS = 20;
    const SECONDS = 60;
    const survived: number[] = [];
    const deaths: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const outcome = autopilotRun(seed, SECONDS);
      if (outcome.aliveSeconds >= SECONDS) survived.push(seed);
      else deaths.push(`seed ${seed}: morto a ${outcome.aliveSeconds.toFixed(1)} s su ${outcome.deathKind}`);
    }

    expect(deaths).toEqual([]);
    expect(survived).toHaveLength(SEEDS);
  });
});

describe('BUCO 6 — continuità laterale', () => {
  it('nessuna entità salta di lato fra un frame e il successivo (10 seed x 90 s)', () => {
    // Lo scostamento laterale di un\'entità è branchOffsetX + offsetX: la
    // stessa formula di render/entities-view.ts (entityWorldOffsetX), tenuta
    // qui in termini puri per non far dipendere un test di gioco dalla vista.
    // L\'unico movimento laterale legittimo è il riallineamento, che copre
    // branchSeparation in realignSeconds.
    const maxLegitimateStep =
      (CONFIG.path.branchSeparation / CONFIG.path.realignSeconds) * STEP * 1.5;
    let worstStep = 0;
    let worstDetail = '';

    for (let seed = 1; seed <= 10; seed++) {
      let previous = new Map<number, number>();
      ghostRun(seed, 90, (game) => {
        const current = new Map<number, number>();
        for (const entity of game.entities) {
          if (!entity.alive) continue;
          const x = branchOffsetX(game.path, entity.branch) + game.path.offsetX;
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

  it('il riallineamento è praticamente completo nell\'ultimo frame in cui esiste', () => {
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
        progressBefore = game.path.realignProgress;
      });
    }
    expect(closures).toBeGreaterThan(30);
    expect(worstProgress).toBeGreaterThan(0.95);
  });
});

describe('tetto delle istanze della vista', () => {
  it('il numero di entità vive di uno stesso tipo resta sotto MAX_INSTANCES_PER_KIND', () => {
    // I fiocchi oltre il tetto sarebbero raccoglibili ma INVISIBILI. Il tetto
    // vive in render/instancing.ts ed è derivato da CONFIG; qui si verifica
    // che il gioco non produca mai più di quanto la vista sa disegnare.
    const peak = new Map<string, number>();
    for (let seed = 1; seed <= 10; seed++) {
      ghostRun(seed, 90, (game) => {
        const counts = new Map<string, number>();
        for (const entity of game.entities) {
          if (!entity.alive) continue;
          counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
        }
        for (const [kind, count] of counts) {
          peak.set(kind, Math.max(peak.get(kind) ?? 0, count));
        }
      });
    }
    const worst = Math.max(...peak.values());
    expect(worst).toBeGreaterThan(0);
    expect(`picco ${worst} su tetto ${MAX_INSTANCES_PER_KIND}`).toBe(
      worst <= MAX_INSTANCES_PER_KIND
        ? `picco ${worst} su tetto ${MAX_INSTANCES_PER_KIND}`
        : `picco oltre il tetto ${MAX_INSTANCES_PER_KIND}`,
    );
  });
});
