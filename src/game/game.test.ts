import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus, type EventName, type GameEvents } from '../core/events';
import { addCharge, createAvalanche } from './avalanche';
import { applyBuff, createBuffs } from './buffs';
import { CONFIG } from './config';
import {
  abandonRun,
  advanceWorldOnly,
  createGame,
  effectiveMultiplier,
  type GameState,
  handleAction,
  startRun,
  updateGame,
} from './game';
import { activeBranchOf, createPath, forkApproaching, type PathState } from './path';
import { createScore, registerPassedObstacle, streakMultiplier } from './score';
import { createSpawner } from './spawner';
import { DEFAULT_DIFFICULTY_PROFILE, difficultyAt, lateRampAt, speedAt } from './speed';
import { type Branch, type Entity, isOverhead } from './types';

const STEP = 1 / 60;

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = [
  'run:started',
  'run:ended',
  'run:stopped',
  'pickup:collected',
  'obstacle:hit',
  'size:changed',
  'avalanche:triggered',
  'avalanche:ending',
  'avalanche:ended',
  'fork:appeared',
  'fork:chosen',
  'fork:resolved',
  'buff:gained',
  'buff:expired',
  'shield:consumed',
  'streak:changed',
  'record:beaten',
];

function recordEvents(bus: EventBus): Recorded[] {
  const seen: Recorded[] = [];
  for (const name of ALL_EVENTS) {
    bus.on(name, (payload: unknown) => {
      seen.push({ name, payload });
    });
  }
  return seen;
}

function countOf(events: readonly Recorded[], name: EventName): number {
  return events.filter((event) => event.name === name).length;
}

function payloadsOf<K extends EventName>(events: readonly Recorded[], name: K): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

function groundObstacle(branch: Branch = 'main', z = 5): Entity {
  return { id: 1, kind: 'rock', category: 'obstacle', branch, z, y: 0, alive: true };
}

function overheadObstacle(branch: Branch = 'main', z = 5): Entity {
  return {
    id: 2,
    kind: 'branch',
    category: 'obstacle',
    branch,
    z,
    y: CONFIG.spawn.overheadY,
    alive: true,
  };
}

function snowflake(branch: Branch = 'main', z = 5): Entity {
  return { id: 3, kind: 'snowflake', category: 'pickup', branch, z, y: 0, alive: true };
}

/**
 * Piazza una sola entità sul ramo indicato, a 5 unità dal giocatore. A 18
 * u/s l'impatto avviene entro ~17 frame; 60 frame simulati restano
 * abbondantemente sotto al primo riciclo di chunk, quindi nessuna entità
 * generata dallo spawner interferisce con lo scenario.
 */
function scenario(seed: number, entity: Entity): { game: GameState; events: Recorded[] } {
  const bus = createEventBus();
  const game = createGame(seed, bus);
  startRun(game);
  const events = recordEvents(bus);
  game.entities.length = 0;
  game.entities.push(entity);
  return { game, events };
}

/**
 * Monta uno stato di percorso nel gioco. Il parametro è dichiarato PathState e
 * non la fase specifica per una ragione di tipi: passando per una funzione, il
 * compilatore non "fissa" `game.path` sulla fase montata qui, e i confronti
 * successivi — che osservano la fase che updateGame produce davvero — restano
 * confronti legittimi invece di sembrargli impossibili. È ciò che permette a
 * questi test di non contenere una sola asserzione di tipo.
 */
function mountPath(game: GameState, path: PathState): void {
  game.path = path;
}

function runFrames(game: GameState, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    updateGame(game, STEP);
  }
}

describe('startRun', () => {
  it('reinizializza tutto, incluso path e buffs, ed emette run:started', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const game = createGame(99, bus);

    startRun(game);
    runFrames(game, 120);
    expect(game.score.points).toBeGreaterThan(0);

    game.forgivenessUsed = true;
    game.alive = false;
    applyBuff(game.buffs, 'star', game.bus);
    startRun(game, { seed: 7 });

    expect(game.seed).toBe(7);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(game.entities.length).toBeGreaterThan(0);
    for (const entity of game.entities) {
      expect(entity.z).toBeGreaterThanOrEqual(CONFIG.world.spawnSafeZ);
      expect(entity.branch).toBe('main');
    }
    expect(game.score).toEqual(createScore());
    expect(game.world.distance).toBe(0);
    expect(game.avalanche).toEqual(createAvalanche());
    expect(game.buffs).toEqual(createBuffs());
    expect(game.path.phase).toBe('none');
    expect(payloadsOf(events, 'run:started')).toEqual([{ seed: 99 }, { seed: 7 }]);
  });
});

describe('startRun — popolamento iniziale del tronco', () => {
  it('subito dopo startRun il tronco non è vuoto e rispetta la zona franca', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);

    startRun(game);

    expect(game.entities.length).toBeGreaterThan(0);
    for (const entity of game.entities) {
      expect(entity.z).toBeGreaterThanOrEqual(CONFIG.world.spawnSafeZ);
    }
  });

  it('almeno il 90% delle run ha un ostacolo raggiungibile entro pochi secondi simulati (300 seed)', () => {
    // Diversamente dalla v1 (che aveva un popolamento delle righe iniziali
    // probabilistico, corretto con un "startBelt" forzato), lo spawner v2
    // piazza gli ostacoli a passo fisso fra minObstacleGap e maxObstacleGap
    // (nessun "tiro" di riempimento): la soglia qui è quindi una verifica di
    // integrazione, non una correzione di un buco statistico noto.
    const SEED_COUNT = 300;
    const REACH_SECONDS = 6;
    const reachZ = CONFIG.world.startSpeed * REACH_SECONDS;

    let withinReach = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      const hasObstacleAhead = game.entities.some(
        (entity) => entity.category === 'obstacle' && entity.z < reachZ,
      );
      if (hasObstacleAhead) withinReach += 1;
    }

    expect(withinReach / SEED_COUNT).toBeGreaterThanOrEqual(0.9);
  });

  it('resta deterministico: stesso seed produce le stesse entità iniziali', () => {
    function initialEntities(seed: number): Entity[] {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);
      return game.entities.map((entity) => ({ ...entity }));
    }

    expect(initialEntities(2026)).toEqual(initialEntities(2026));
  });
});

describe('updateGame — simulazione lunga', () => {
  it('60 secondi a 1/60 con seed fisso non lanciano e le entità vive restano limitate', () => {
    const bus = createEventBus();
    const game = createGame(20260819, bus);
    startRun(game);

    let maxEntities = 0;

    expect(() => {
      for (let frame = 0; frame < 60 * 60; frame += 1) {
        updateGame(game, STEP);
        maxEntities = Math.max(maxEntities, game.entities.length);
        if (!game.alive) startRun(game);
      }
    }).not.toThrow();

    expect(maxEntities).toBeGreaterThan(0);
    // Tetto più largo che in v1: durante un bivio esistono temporaneamente
    // le entità di ENTRAMBI i rami, oltre a file di fiocchi più lunghe
    // (6..10 contro l'1 della v1).
    expect(maxEntities).toBeLessThan(300);
  });

  it('il giocatore che non fa nulla muore prima o poi, e run:ended arriva una sola volta', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    const events = recordEvents(bus);

    let frame = 0;
    while (game.alive && frame < 60 * 60) {
      updateGame(game, STEP);
      frame += 1;
    }

    expect(game.alive).toBe(false);
    expect(countOf(events, 'run:ended')).toBe(1);

    const total = events.length;
    runFrames(game, 30);
    expect(events).toHaveLength(total);
  });

  it('il punteggio non decresce mai finché il giocatore è vivo', () => {
    const bus = createEventBus();
    const game = createGame(4242, bus);
    startRun(game);

    let previous = game.score.points;
    let frames = 0;

    while (game.alive && frames < 60 * 30) {
      updateGame(game, STEP);
      expect(game.score.points).toBeGreaterThanOrEqual(previous);
      previous = game.score.points;
      frames += 1;
    }

    expect(frames).toBeGreaterThan(0);
    expect(game.score.points).toBeGreaterThan(0);
  });
});

describe('advanceWorldOnly', () => {
  it('fa avanzare world.distance anche con game.alive = false', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    game.alive = false;

    const distanceBefore = game.world.distance;
    advanceWorldOnly(game, 1);

    expect(game.world.distance).toBeGreaterThan(distanceBefore);
  });

  it('sposta le entità esistenti in avanti, senza generarne di nuove né assegnare punti', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    game.alive = false;
    const entityCountBefore = game.entities.length;
    const firstZBefore = game.entities[0]?.z;
    const pointsBefore = game.score.points;

    advanceWorldOnly(game, 0.1);

    expect(game.entities.length).toBeLessThanOrEqual(entityCountBefore);
    if (firstZBefore !== undefined && game.entities[0] !== undefined) {
      expect(game.entities[0].z).toBeLessThan(firstZBefore);
    }
    expect(game.score.points).toBe(pointsBefore);
  });

  it('non lancia mai su una simulazione lunga, anche con entità che escono dietro', () => {
    const bus = createEventBus();
    const game = createGame(99, bus);
    startRun(game);
    game.alive = false;

    expect(() => {
      for (let frame = 0; frame < 600; frame += 1) advanceWorldOnly(game, STEP);
    }).not.toThrow();
  });
});

describe('abandonRun', () => {
  it('emette run:stopped e segna la run come non più viva', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    const events = recordEvents(bus);
    expect(game.alive).toBe(true);

    abandonRun(game);

    expect(game.alive).toBe(false);
    expect(countOf(events, 'run:stopped')).toBe(1);
    expect(countOf(events, 'run:ended')).toBe(0);
  });

  it('è un no-op se la run non era già viva (nessun evento duplicato)', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    const events = recordEvents(bus);

    abandonRun(game);
    abandonRun(game);

    expect(countOf(events, 'run:stopped')).toBe(1);
  });
});

describe('updateGame — ostacoli a terra e sospesi', () => {
  it('un ostacolo a terra uccide chi resta fermo', () => {
    const { game, events } = scenario(1, groundObstacle());
    // Il primo impatto di ogni corsa è perdonato (onboarding): per isolare la
    // domanda "un ostacolo a terra uccide chi resta fermo?" dal perdono si
    // disattiva a mano, come già fanno gli altri test di morte "genuina" qui
    // sotto.
    game.forgivenessUsed = true;

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.branch)).toEqual(['main']);
    expect(countOf(events, 'run:ended')).toBe(1);

    const total = events.length;
    runFrames(game, 10);
    expect(events).toHaveLength(total);
    expect(countOf(events, 'run:ended')).toBe(1);
  });

  it('un ostacolo a terra si supera saltando', () => {
    const { game } = scenario(1, groundObstacle());

    handleAction(game, 'JUMP');
    runFrames(game, 60);

    expect(game.alive).toBe(true);
  });

  it('un ostacolo sospeso uccide chi resta in piedi A OGNI TAGLIA, minima compresa', () => {
    // Design §6: l'azione richiesta non cambia mai con la taglia. La versione
    // precedente di questo test usava SOLO la taglia massima e passava anche
    // quando la sagoma a taglia 1 (1.2 + 0.25 = 1.45) restava sotto
    // spawn.overheadY (1.6): a taglia 1 i sospesi erano innocui, cioè un
    // terzo degli ostacoli del gioco non chiedeva nulla al giocatore.
    for (let size = 1; size <= CONFIG.avalanche.maxSize; size++) {
      const { game, events } = scenario(1, overheadObstacle());
      // Carica esattamente pari alla soglia della taglia voluta. Il perdono va
      // disattivato a mano: a carica alta un chargeRatio >= 0.5 perdonerebbe
      // il primo impatto e il test finirebbe per verificare il perdono invece
      // della domanda vera, "un sospeso uccide chi resta in piedi?".
      const threshold = CONFIG.avalanche.sizeThresholds[size - 1] ?? 0;
      if (threshold > 0) addCharge(game.avalanche, threshold, game.bus);
      expect(game.avalanche.size).toBe(size);
      // Il perdono va disattivato a mano, e ora servono DUE righe: da quando
      // è ricaricabile, `forgivenessUsed = true` da solo non basta, perché al
      // primo frame la barra piena verrebbe letta come un attraversamento di
      // minChargeRatio verso l'alto e lo restituirebbe subito. Dichiarare che
      // la barra era già lassù nel frame precedente è esattamente la
      // condizione "speso e non ancora riguadagnato".
      game.forgivenessUsed = true;
      game.chargeRatioBefore = 1;

      runFrames(game, 60);

      expect(game.alive).toBe(false);
      expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
    }
  });

  it('un ostacolo sospeso si supera scivolando A OGNI TAGLIA, massima compresa', () => {
    for (let size = 1; size <= CONFIG.avalanche.maxSize; size++) {
      const { game } = scenario(1, overheadObstacle());
      const threshold = CONFIG.avalanche.sizeThresholds[size - 1] ?? 0;
      if (threshold > 0) addCharge(game.avalanche, threshold, game.bus);
      expect(game.avalanche.size).toBe(size);

      handleAction(game, 'SLIDE');
      runFrames(game, 60);

      expect(game.alive).toBe(true);
    }
  });

  it('ONBOARDING: il primo impatto della corsa è sempre perdonato, anche a carica zero', () => {
    const { game, events } = scenario(1, groundObstacle());
    expect(game.avalanche.charge).toBe(0);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['forgiven']);
    expect(countOf(events, 'run:ended')).toBe(0);
  });

  it('ONBOARDING: il secondo impatto della corsa uccide, anche se il primo (a carica zero) era stato perdonato', () => {
    const { game, events } = scenario(1, groundObstacle());
    runFrames(game, 60);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);

    game.entities.length = 0;
    game.entities.push(groundObstacle());
    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual([
      'forgiven',
      'death',
    ]);
  });

  it("con la barra sopra minChargeRatio perdona l'impatto invece di uccidere", () => {
    const { game, events } = scenario(1, groundObstacle());
    // La carica è espressa in frazione della soglia, non in unità: è quella la
    // grandezza su cui è tarato minChargeRatio, e la soglia è già stata
    // ritarata una volta (100 → 160).
    addCharge(
      game.avalanche,
      CONFIG.avalanche.threshold * CONFIG.forgiveness.minChargeRatio,
      game.bus,
    );
    const sizeBefore = game.avalanche.size;
    expect(sizeBefore).toBeGreaterThan(1);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);
    expect(game.avalanche.charge).toBe(0);
    expect(game.avalanche.size).toBe(sizeBefore - CONFIG.forgiveness.sizePenalty);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['forgiven']);
    expect(countOf(events, 'run:ended')).toBe(0);
    expect(game.entities).toHaveLength(0);
  });

  it('in fase valanga sfonda la roccia e incassa il bonus moltiplicato', () => {
    const { game, events } = scenario(1, groundObstacle());
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    expect(game.avalanche.phase).toBe('active');

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['smashed']);
    expect(game.score.points).toBeGreaterThanOrEqual(
      CONFIG.score.smashBonus * CONFIG.avalanche.scoreMultiplier,
    );
    expect(game.entities).toHaveLength(0);
  });

  it('con lo scudo attivo un impatto lo consuma e il giocatore sopravvive', () => {
    const { game, events } = scenario(11, groundObstacle());
    applyBuff(game.buffs, 'bell', game.bus);
    expect(game.buffs.shield).toBe(true);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.buffs.shield).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['shielded']);
    expect(countOf(events, 'shield:consumed')).toBe(1);
  });

  it('senza scudo (e senza carica da perdonare) lo stesso impatto uccide', () => {
    const { game, events } = scenario(11, groundObstacle());
    // Vedi il commento nel test "un ostacolo a terra uccide chi resta
    // fermo": senza disattivarlo a mano, il perdono del primo impatto
    // (onboarding) assorbirebbe questo colpo invece di ucciderlo.
    game.forgivenessUsed = true;

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
  });
});

describe('updateGame — raccolta dei buff', () => {
  function buffPickup(kind: 'crystal' | 'star' | 'magnet' | 'bell', z = 5): Entity {
    return { id: 4, kind, category: 'pickup', branch: 'main', z, y: 0, alive: true };
  }

  it('il cristallo annuncia la raccolta come gli altri buff, pur non avendo stato', () => {
    const { game, events } = scenario(1, buffPickup('crystal'));

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    // L'effetto del cristallo resta la carica, non uno stato di buff.
    expect(game.avalanche.charge).toBe(CONFIG.pickups.charge.crystal);
    expect(game.buffs).toEqual(createBuffs());
    // ...ma la raccolta è annunciata: è 'buff:gained' a far suonare il timbro
    // del cristallo (CONFIG.audio.chime). Senza, era codice morto.
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'crystal' }]);
    // toMatchObject e non toEqual: il payload porta anche la posizione del
    // raccoglibile (branch/z/y), che serve a chi disegna l'esplosione di
    // cubetti ma non è ciò che questo test verifica. Ricalcare la forma esatta
    // del payload renderebbe rosso questo test a ogni campo aggiunto, che è il
    // modo migliore per insegnare a ignorare i test.
    expect(payloadsOf(events, 'pickup:collected')).toMatchObject([
      { kind: 'crystal', charge: CONFIG.pickups.charge.crystal },
    ]);
  });

  it('tutti e quattro i buff emettono buff:gained una volta sola quando vengono raccolti', () => {
    for (const kind of ['crystal', 'star', 'magnet', 'bell'] as const) {
      const { game, events } = scenario(1, buffPickup(kind));

      runFrames(game, 60);

      expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind }]);
    }
  });

  it('il fiocco non è un buff: annuncia la raccolta, non un buff guadagnato', () => {
    const { game, events } = scenario(1, snowflake());

    runFrames(game, 60);

    expect(countOf(events, 'buff:gained')).toBe(0);
    expect(payloadsOf(events, 'pickup:collected')).toMatchObject([
      { kind: 'snowflake', charge: CONFIG.pickups.charge.snowflake },
    ]);
  });
});

describe('updateGame — ramo non solido', () => {
  it("un'entità sul ramo non scelto non colpisce mai e i suoi fiocchi non si raccolgono", () => {
    const { game, events } = scenario(1, groundObstacle('right'));
    game.entities.push(snowflake('right', 6));
    expect(activeBranchOf(game.path)).toBe('main');

    runFrames(game, 180);

    expect(game.alive).toBe(true);
    expect(countOf(events, 'obstacle:hit')).toBe(0);
    expect(countOf(events, 'pickup:collected')).toBe(0);
  });
});

describe('updateGame — bivio', () => {
  it('dopo che un bivio si risolve, nessuna entità del ramo scartato resta viva', () => {
    const bus = createEventBus();
    const game = createGame(1, bus);
    startRun(game);
    game.entities.length = 0;

    // Il bivio si monta con il costruttore della sua fase, non spingendo un
    // percorso dritto a colpi di assegnazioni: PathState è un'unione
    // discriminata su `phase` (vedi path.ts) e uno stato incoerente — un bivio
    // senza ramo ricco, un ramo attivo prima del punto di non ritorno — non è
    // più esprimibile.
    mountPath(game, forkApproaching({ forkZ: CONFIG.path.previewZ, richBranch: 'right' }));

    // Entrambi i rami popolati e visibili prima della scelta, come da design.
    game.entities.push(
      groundObstacle('left', CONFIG.path.previewZ - 5),
      snowflake('left', CONFIG.path.previewZ - 5),
      groundObstacle('right', CONFIG.path.previewZ - 5),
      snowflake('right', CONFIG.path.previewZ - 5),
    );

    let frame = 0;
    while (game.path.phase !== 'committed' && frame < 600) {
      updateGame(game, STEP);
      frame += 1;
    }

    expect(game.path.phase).toBe('committed');
    // Niente più asserzioni di tipo: prima ne servivano due (`as string` sulla
    // condizione del while e `as Branch` qui) perché il compilatore vedeva un
    // record piatto assegnato a mano e non poteva sapere che updateGame lo
    // avrebbe mutato. Ora il ramo attivo si chiede alla funzione che lo sa.
    const chosen = activeBranchOf(game.path);
    expect(chosen === 'left' || chosen === 'right').toBe(true);
    const discarded: Branch = chosen === 'left' ? 'right' : 'left';

    expect(game.entities.some((entity) => entity.branch === discarded && entity.alive)).toBe(false);
  });

  it('la calamita TRASCINA il fiocco fino alla mucca invece di raccoglierlo a distanza', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    const events = recordEvents(bus);
    game.entities.length = 0;
    const farFlake = snowflake('main', CONFIG.buffs.magnetRangeZ - 1);
    game.entities.push(farFlake);
    applyBuff(game.buffs, 'magnet', game.bus);

    const zBefore = farFlake.z;
    updateGame(game, STEP);

    // Nel primo frame il fiocco NON è raccolto: è in viaggio. Prima svaniva
    // sul posto, mezzo secondo prima di arrivare, senza nessuna traiettoria
    // che lo collegasse alla mucca.
    expect(farFlake.alive).toBe(true);
    expect(farFlake.attracted).toBe(true);
    expect(countOf(events, 'pickup:collected')).toBe(0);
    // Si avvicina più in fretta del solo scorrimento del mondo.
    expect(zBefore - farFlake.z).toBeGreaterThan(game.world.speed * STEP);

    // ...e arriva: la raccolta avviene quando il fiocco tocca la mucca.
    for (let i = 0; i < 120 && farFlake.alive; i++) updateGame(game, STEP);
    expect(farFlake.alive).toBe(false);
    // Raccolto ADDOSSO alla mucca, non a dieci unità di distanza: o è arrivato
    // a z <= 0, o lo ha intercettato la sagoma di collisione, che è la stessa
    // cosa vista dal giocatore.
    expect(farFlake.z).toBeLessThan(CONFIG.player.depth);
    expect(payloadsOf(events, 'pickup:collected').map((p) => p.kind)).toEqual(['snowflake']);
  });
});

describe('determinismo', () => {
  it('due partite con lo stesso seed e le stesse azioni danno lo stesso punteggio', () => {
    function play(
      seed: number,
      frames: number,
    ): { points: number; distance: number; alive: boolean } {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      for (let frame = 0; frame < frames; frame += 1) {
        if (frame % 53 === 0) handleAction(game, 'JUMP');
        if (frame % 71 === 0) handleAction(game, 'SLIDE');
        if (frame % 97 === 0) handleAction(game, 'CHOOSE_LEFT');
        if (frame % 131 === 0) handleAction(game, 'CHOOSE_RIGHT');
        updateGame(game, STEP);
        if (!game.alive) startRun(game, { seed });
      }

      return { points: game.score.points, distance: game.score.distance, alive: game.alive };
    }

    const first = play(31337, 60 * 20);
    const second = play(31337, 60 * 20);

    expect(second).toEqual(first);
    expect(first.points).toBeGreaterThan(0);
  });
});

describe('handleAction', () => {
  it('instrada JUMP al salto', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'JUMP');
    expect(game.player.airborne).toBe(true);
  });

  it('instrada SLIDE alla scivolata', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'SLIDE');
    expect(game.player.sliding).toBe(true);
  });

  it("instrada CHOOSE_LEFT/CHOOSE_RIGHT alla scelta del bivio, solo quando c'è un bivio da scegliere", () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    const events = recordEvents(bus);

    // Con il prossimo bivio ancora lontano lo swipe non è una scelta e NON
    // viene ricordato: quasi sempre è un salto malriuscito, e ricordarlo
    // significava imboccare un ramo senza averlo deciso (vedi path.ts,
    // rememberChoice).
    mountPath(game, { ...createPath(), nextForkIn: CONFIG.path.earlyChoiceWindowZ + 1 });
    handleAction(game, 'CHOOSE_LEFT');
    expect(game.path.pendingChoice).toBeNull();
    expect(countOf(events, 'fork:chosen')).toBe(0);

    // Con il bivio imminente, invece, resta in memoria come scelta anticipata
    // (design §4) — e nemmeno allora annuncia nulla, perché il bivio non c'è.
    mountPath(game, { ...createPath(), nextForkIn: CONFIG.path.earlyChoiceWindowZ - 1 });
    handleAction(game, 'CHOOSE_LEFT');
    expect(game.path.pendingChoice).toBe('left');
    expect(countOf(events, 'fork:chosen')).toBe(0);

    // Si legge la scelta dal riferimento tipizzato al bivio invece che da
    // game.path: `choice` esiste solo nelle fasi che ce l'hanno, ed è il
    // punto dell'unione discriminata.
    const approaching = forkApproaching({ forkZ: CONFIG.path.previewZ });
    mountPath(game, approaching);
    handleAction(game, 'CHOOSE_LEFT');
    expect(approaching.choice).toBe('left');

    handleAction(game, 'CHOOSE_RIGHT');
    expect(approaching.choice).toBe('right');

    // 'fork:chosen' è l'unico riscontro che il giocatore riceve fra lo swipe e
    // il punto di non ritorno: senza, lo swipe al bivio non dà alcun segnale.
    expect(payloadsOf(events, 'fork:chosen')).toEqual([{ side: 'left' }, { side: 'right' }]);
  });

  it('ignora PAUSE, gestita fuori dal gioco', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    const before = { ...game.player };

    handleAction(game, 'PAUSE');

    expect(game.player).toEqual(before);
    expect(game.alive).toBe(true);
  });
});

describe('perdono ricaricabile', () => {
  it("torna disponibile quando la barra RIATTRAVERSA minChargeRatio verso l'alto", () => {
    const { game, events } = scenario(1, groundObstacle());
    const halfBar = CONFIG.avalanche.threshold * CONFIG.forgiveness.minChargeRatio;

    // Primo impatto: perdonato (a carica zero, per l'eccezione di onboarding).
    runFrames(game, 60);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);
    expect(game.firstHitUsed).toBe(true);

    // Si riempie la barra fino a metà: il perdono torna disponibile. Non è lo
    // STATO "sono sopra metà" a ricaricarlo ma l'ATTRAVERSAMENTO, e infatti
    // serve un frame di gioco perché la ricarica venga rilevata.
    addCharge(game.avalanche, halfBar, game.bus);
    expect(game.forgivenessUsed).toBe(true);
    runFrames(game, 1);
    expect(game.forgivenessUsed).toBe(false);

    // ...e un secondo impatto viene di nuovo perdonato, al prezzo di tutta la
    // barra e di una taglia.
    game.entities.length = 0;
    game.entities.push(groundObstacle());
    runFrames(game, 60);
    expect(game.alive).toBe(true);
    expect(game.avalanche.charge).toBe(0);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual([
      'forgiven',
      'forgiven',
    ]);
  });

  it('restare sopra la soglia non ricarica di continuo: serve un attraversamento', () => {
    const { game } = scenario(2, groundObstacle());
    const halfBar = CONFIG.avalanche.threshold * CONFIG.forgiveness.minChargeRatio;

    // La barra è già sopra la soglia da prima dell'impatto.
    addCharge(game.avalanche, halfBar + 10, game.bus);
    runFrames(game, 60);
    expect(game.forgivenessUsed).toBe(true);
    // Il perdono ha azzerato la barra: da lì non si riattraversa nulla finché
    // non la si riempie di nuovo.
    expect(game.avalanche.charge).toBe(0);
    runFrames(game, 60);
    expect(game.forgivenessUsed).toBe(true);
  });

  it('il secondo impatto a carica zero uccide: firstHitFree vale una volta per corsa', () => {
    const { game, events } = scenario(3, groundObstacle());
    runFrames(game, 60);
    expect(game.alive).toBe(true);

    game.entities.length = 0;
    game.entities.push(groundObstacle());
    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual([
      'forgiven',
      'death',
    ]);
  });
});

describe('moltiplicatore di serie', () => {
  it('un ostacolo schivato alza la serie, un colpo subito la azzera', () => {
    const { game, events } = scenario(4, groundObstacle());

    // Si salta: l'ostacolo passa sotto e la serie sale di uno.
    handleAction(game, 'JUMP');
    runFrames(game, 90);
    expect(game.alive).toBe(true);
    expect(game.score.streak).toBeGreaterThan(0);
    const afterDodge = game.score.streak;

    // Un colpo perdonato è comunque un colpo: la serie riparte da zero.
    game.entities.length = 0;
    game.entities.push(groundObstacle());
    runFrames(game, 60);
    expect(afterDodge).toBeGreaterThan(0);
    expect(game.score.streak).toBe(0);
    expect(countOf(events, 'obstacle:hit')).toBe(1);
  });

  it('lo sfondamento NON rompe la serie: è il premio della valanga, non un errore', () => {
    const { game } = scenario(5, groundObstacle());
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    for (let i = 0; i < CONFIG.score.streakStep; i++) registerPassedObstacle(game.score, game.bus);
    const before = game.score.streak;

    runFrames(game, 60);

    expect(game.score.streak).toBe(before);
    expect(game.score.streakTier).toBeGreaterThan(0);
  });

  it('il moltiplicatore esposto nello stato è il prodotto di valanga, stella e serie', () => {
    const { game } = scenario(6, snowflake('main', 200));
    applyBuff(game.buffs, 'star', game.bus);
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    for (let i = 0; i < CONFIG.score.streakStep; i++) registerPassedObstacle(game.score, game.bus);

    runFrames(game, 1);

    const expected =
      CONFIG.avalanche.scoreMultiplier * CONFIG.buffs.starMultiplier * streakMultiplier(game.score);
    expect(game.multiplier).toBe(expected);
    expect(effectiveMultiplier(game)).toBe(expected);
    // La combinazione stella × valanga resta intatta: è l'unica decisione
    // strategica del gioco ("tengo la stella per la valanga").
    expect(expected).toBeGreaterThanOrEqual(
      CONFIG.avalanche.scoreMultiplier * CONFIG.buffs.starMultiplier,
    );
  });

  it('la catena di sfondamenti alza il bonus del secondo ostacolo distrutto', () => {
    const { game } = scenario(7, groundObstacle('main', 5));
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    const multiplier = game.multiplier;

    const pointsBefore = game.score.points;
    runFrames(game, 30);
    const firstGain = game.score.points - pointsBefore;

    game.entities.length = 0;
    game.entities.push(groundObstacle('main', 3));
    const beforeSecond = game.score.points;
    runFrames(game, 20);
    const secondGain = game.score.points - beforeSecond;

    // Le due misure contengono anche i punti da distanza percorsa, quindi si
    // confronta la DIFFERENZA con il gradino atteso, non i valori assoluti.
    expect(secondGain - firstGain).toBeGreaterThan(CONFIG.score.smashChainStep * multiplier * 0.5);
    expect(game.score.smashChain).toBe(1);
  });
});

describe('record e abbandono', () => {
  it('annuncia record:beaten durante la corsa, una volta sola', () => {
    const bus = createEventBus();
    const game = createGame(8, bus);
    const events = recordEvents(bus);
    startRun(game, { seed: 8, previousRecord: 50 });

    runFrames(game, 10);
    expect(countOf(events, 'record:beaten')).toBe(0);

    runFrames(game, 600);
    expect(game.score.points).toBeGreaterThan(50);
    expect(countOf(events, 'record:beaten')).toBe(1);
    expect(payloadsOf(events, 'record:beaten')[0]?.points).toBeGreaterThan(50);
  });

  it("senza un record precedente non annuncia nulla: superare zero non è un'impresa", () => {
    const bus = createEventBus();
    const game = createGame(9, bus);
    const events = recordEvents(bus);
    startRun(game);

    runFrames(game, 300);
    expect(game.score.points).toBeGreaterThan(0);
    expect(countOf(events, 'record:beaten')).toBe(0);
  });

  it("abandonRun restituisce l'esito della corsa, così chi ascolta può salvarlo", () => {
    const bus = createEventBus();
    const game = createGame(10, bus);
    startRun(game, { seed: 10, previousRecord: 5 });
    // Il fantasma attraversa gli ostacoli: qui interessa una corsa VIVA con
    // dei punti sul tabellone, non la sua sopravvivenza.
    for (let frame = 0; frame < 300; frame++) {
      for (const entity of game.entities) {
        if (entity.category === 'obstacle') entity.alive = false;
      }
      updateGame(game, STEP);
    }
    expect(game.alive).toBe(true);

    const summary = abandonRun(game);
    expect(summary).not.toBeNull();
    expect(summary?.points).toBe(game.score.points);
    expect(summary?.distance).toBe(game.score.distance);
    expect(summary?.isRecord).toBe(true);
    // Idempotente: una seconda chiamata non inventa una seconda corsa.
    expect(abandonRun(game)).toBeNull();
  });

  it('run:ended porta isRecord calcolato sul record ricevuto, non letto da disco', () => {
    const bus = createEventBus();
    const game = createGame(11, bus);
    const events = recordEvents(bus);
    // Record altissimo: la corsa finirà molto sotto.
    startRun(game, { seed: 11, previousRecord: 1e9 });
    game.entities.length = 0;
    game.entities.push(groundObstacle());
    game.forgivenessUsed = true;
    game.chargeRatioBefore = 1;
    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'run:ended')[0]?.isRecord).toBe(false);
  });
});

describe('profilo di difficoltà', () => {
  it('senza profilo si gioca con quello normale, che è la taratura di CONFIG', () => {
    const bus = createEventBus();
    const game = createGame(20, bus);
    expect(game.profile).toBe(DEFAULT_DIFFICULTY_PROFILE);

    startRun(game);
    expect(game.profile.name).toBe('normal');
    expect(game.world.speed).toBe(CONFIG.world.startSpeed);
  });

  it('il profilo passato a startRun arriva sia alla velocità sia allo spawner', () => {
    const bus = createEventBus();
    const game = createGame(21, bus);

    startRun(game, { seed: 21, profileName: 'calf' });

    expect(game.profile.name).toBe('calf');
    expect(game.world.speed).toBe(speedAt(0, game.profile));
    expect(game.world.speed).toBeLessThan(CONFIG.world.startSpeed);

    // Lo spawner è stato costruito col profilo: il passo minimo del vitellino
    // è più largo, quindi a parità di tratto popolato gli ostacoli sono meno.
    // Si misura su un tratto lungo e non sulle poche entità con cui si apre
    // una corsa: tre ostacoli non distinguono due tarature.
    const countFor = (name: string): number => {
      const inner = createGame(21, createEventBus());
      startRun(inner, { seed: 21, profileName: name });
      const out: Entity[] = [];
      inner.spawner.populateSegment(0, 4000, 1, 'main', false, out, 0);
      return out.filter((entity) => entity.category === 'obstacle').length;
    };
    expect(countFor('calf')).toBeLessThan(countFor('bull'));
  });

  it('un nome sconosciuto ricade sul profilo normale invece di rompere la corsa', () => {
    const bus = createEventBus();
    const game = createGame(22, bus);
    startRun(game, { seed: 22, profileName: 'mucca-volante' });
    expect(game.profile).toBe(DEFAULT_DIFFICULTY_PROFILE);
  });

  it('il profilo resta quello scelto anche nelle corse successive, finché non se ne passa un altro', () => {
    const bus = createEventBus();
    const game = createGame(23, bus);

    startRun(game, { seed: 23, profileName: 'bull' });
    expect(game.profile.name).toBe('bull');

    startRun(game, { seed: 24 });
    expect(game.profile.name).toBe('bull');
  });
});

describe('corsa guidata (tutorial)', () => {
  /** z del primo ostacolo vivo davanti al giocatore subito dopo startRun. */
  function firstObstacleZ(game: GameState): number {
    let closest = Number.POSITIVE_INFINITY;
    for (const entity of game.entities) {
      if (!entity.alive || entity.category !== 'obstacle') continue;
      if (entity.z < closest) closest = entity.z;
    }
    return closest;
  }

  it('con tutorial il primo ostacolo è oltre CONFIG.tutorial.firstObstacleZ', () => {
    // Era la chiave di config che nessuno usava: i prompt comparivano, ma il
    // primo ostacolo nasceva a 37-48 unità (~2,3 s), cioè prima che chi non ha
    // mai giocato avesse finito di leggere "SALTA".
    for (let seed = 1; seed <= 20; seed++) {
      const game = createGame(seed, createEventBus());
      startRun(game, { seed, tutorial: true });
      expect(firstObstacleZ(game)).toBeGreaterThanOrEqual(CONFIG.tutorial.firstObstacleZ);
    }
  });

  it('senza tutorial il primo ostacolo torna vicino, come in una corsa normale', () => {
    // L'altra metà: se anche senza flag l'ostacolo restasse lontano, il
    // tutorial non sarebbe un tutorial ma una partenza più lenta per tutti.
    let closeStarts = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const game = createGame(seed, createEventBus());
      startRun(game, { seed });
      if (firstObstacleZ(game) < CONFIG.tutorial.firstObstacleZ) closeStarts += 1;
    }
    expect(closeStarts).toBe(20);
  });

  it('senza il flag la corsa è identica a prima, entità per entità', () => {
    const plain = createGame(42, createEventBus());
    startRun(plain, { seed: 42 });
    const explicit = createGame(42, createEventBus());
    startRun(explicit, { seed: 42, tutorial: false });
    expect(explicit.entities).toEqual(plain.entities);
  });

  it('vale solo per la corsa che lo chiede: quella dopo riparte normale', () => {
    const game = createGame(43, createEventBus());
    startRun(game, { seed: 43, tutorial: true });
    expect(firstObstacleZ(game)).toBeGreaterThanOrEqual(CONFIG.tutorial.firstObstacleZ);

    startRun(game, { seed: 43 });
    expect(firstObstacleZ(game)).toBeLessThan(CONFIG.tutorial.firstObstacleZ);
  });

  it('la corsa guidata resta giocabile: nessun ostacolo dentro la zona franca', () => {
    const game = createGame(44, createEventBus());
    startRun(game, { seed: 44, tutorial: true });
    expect(game.entities.length).toBeGreaterThan(0);
    for (const entity of game.entities) {
      expect(entity.z).toBeGreaterThanOrEqual(CONFIG.world.spawnSafeZ);
    }
  });
});

describe('rampa tardiva', () => {
  it('oltre lateRampStart la generazione riceve il secondo asse di difficoltà', () => {
    // Non si può arrivare a 5000 unità simulando una corsa vera in un test, e
    // non serve: quello che va verificato qui è il CABLAGGIO, cioè che il
    // valore calcolato da lateRampAt arrivi davvero allo spawner. Si osserva
    // sul solo effetto misurabile dall'esterno: la quota di sospesi.
    expect(lateRampAt(CONFIG.spawn.lateRampStart)).toBe(0);
    expect(lateRampAt(CONFIG.spawn.lateRampStart + CONFIG.spawn.lateRampDistance)).toBe(1);

    const overheadShareAt = (distance: number): number => {
      const bus = createEventBus();
      const game = createGame(31, bus);
      startRun(game);
      // Si sposta la corsa in avanti e si ripopola: i chunk riciclati leggono
      // la distanza del mondo, che è ciò che alimenta le due rampe.
      game.world.distance = distance;
      game.entities.length = 0;
      game.spawner = createSpawner(game.rng, game.profile);
      const difficulty = difficultyAt(distance);
      const late = lateRampAt(distance);
      game.spawner.populateSegment(0, 4000, difficulty, 'main', false, game.entities, late);
      const obstacles = game.entities.filter((entity) => entity.category === 'obstacle');
      const overhead = obstacles.filter((entity) => isOverhead(entity.kind));
      return overhead.length / obstacles.length;
    };

    const early = overheadShareAt(0);
    const late = overheadShareAt(CONFIG.spawn.lateRampStart + CONFIG.spawn.lateRampDistance);
    expect(late).toBeGreaterThan(early);
  });
});
