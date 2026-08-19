import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  type EventBus,
  type EventName,
  type GameEvents,
} from '../core/events';
import { addCharge } from './avalanche';
import { applyBuff } from './buffs';
import { CONFIG } from './config';
import {
  abandonRun,
  advanceWorldOnly,
  createGame,
  handleAction,
  startRun,
  updateGame,
  type GameState,
} from './game';
import type { Branch, Entity } from './types';

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

function payloadsOf<K extends EventName>(
  events: readonly Recorded[],
  name: K,
): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

function groundObstacle(branch: Branch = 'main', z = 5): Entity {
  return { id: 1, kind: 'rock', category: 'obstacle', branch, z, y: 0, alive: true };
}

function overheadObstacle(branch: Branch = 'main', z = 5): Entity {
  return { id: 2, kind: 'branch', category: 'obstacle', branch, z, y: CONFIG.spawn.overheadY, alive: true };
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
    startRun(game, 7);

    expect(game.seed).toBe(7);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(game.entities.length).toBeGreaterThan(0);
    for (const entity of game.entities) {
      expect(entity.z).toBeGreaterThanOrEqual(CONFIG.world.spawnSafeZ);
      expect(entity.branch).toBe('main');
    }
    expect(game.score).toEqual({ points: 0, distance: 0 });
    expect(game.world.distance).toBe(0);
    expect(game.avalanche).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
    expect(game.buffs).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    expect(game.path.phase).toBe('none');
    expect(game.path.offsetX).toBe(0);
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
      game.forgivenessUsed = true;

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

  it('con carica al 60% perdona il primo impatto invece di uccidere', () => {
    const { game, events } = scenario(1, groundObstacle());
    addCharge(game.avalanche, 60, game.bus);
    expect(game.avalanche.size).toBe(4);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);
    expect(game.avalanche.charge).toBe(0);
    expect(game.avalanche.size).toBe(4 - CONFIG.forgiveness.sizePenalty);
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
    expect(game.buffs).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    // ...ma la raccolta è annunciata: è 'buff:gained' a far suonare il timbro
    // del cristallo (CONFIG.audio.chime). Senza, era codice morto.
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'crystal' }]);
    expect(payloadsOf(events, 'pickup:collected')).toEqual([
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
    expect(payloadsOf(events, 'pickup:collected')).toEqual([
      { kind: 'snowflake', charge: CONFIG.pickups.charge.snowflake },
    ]);
  });
});

describe('updateGame — ramo non solido', () => {
  it("un'entità sul ramo non scelto non colpisce mai e i suoi fiocchi non si raccolgono", () => {
    const { game, events } = scenario(1, groundObstacle('right'));
    game.entities.push(snowflake('right', 6));
    expect(game.path.activeBranch).toBe('main');

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

    game.path.phase = 'approaching';
    game.path.forkZ = CONFIG.path.previewZ;
    game.path.choice = null;
    game.path.richBranch = 'right';
    game.path.activeBranch = 'main';
    game.path.offsetX = 0;
    game.path.nextForkIn = 999999;

    // Entrambi i rami popolati e visibili prima della scelta, come da design.
    game.entities.push(
      groundObstacle('left', CONFIG.path.previewZ - 5),
      snowflake('left', CONFIG.path.previewZ - 5),
      groundObstacle('right', CONFIG.path.previewZ - 5),
      snowflake('right', CONFIG.path.previewZ - 5),
    );

    let frame = 0;
    while ((game.path.phase as string) !== 'committed' && frame < 600) {
      updateGame(game, STEP);
      frame += 1;
    }

    expect(game.path.phase).toBe('committed');
    // `as Branch`, non solo l'annotazione: TypeScript restringe il tipo letto
    // qui a 'main' in base all'assegnazione fatta più sopra nel test (control
    // flow narrowing su una const), ignorando che updateGame lo muta al di là
    // di ciò che il flow analysis può seguire. Un'annotazione da sola non
    // basta a farlo desistere; l'asserzione sì (stesso trucco già usato sopra
    // per `game.path.phase as string` nella condizione del while).
    const chosen = game.path.activeBranch as Branch;
    expect(chosen === 'left' || chosen === 'right').toBe(true);
    const discarded: Branch = chosen === 'left' ? 'right' : 'left';

    expect(game.entities.some((entity) => entity.branch === discarded && entity.alive)).toBe(false);
  });

  it('la calamita raccoglie fiocchi che il giocatore non tocca direttamente', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    const events = recordEvents(bus);
    game.entities.length = 0;
    const farFlake = snowflake('main', CONFIG.buffs.magnetRangeZ - 1);
    game.entities.push(farFlake);
    applyBuff(game.buffs, 'magnet', game.bus);

    updateGame(game, STEP);

    expect(farFlake.alive).toBe(false);
    expect(payloadsOf(events, 'pickup:collected').map((p) => p.kind)).toEqual(['snowflake']);
  });
});

describe('determinismo', () => {
  it('due partite con lo stesso seed e le stesse azioni danno lo stesso punteggio', () => {
    function play(seed: number, frames: number): { points: number; distance: number; alive: boolean } {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      for (let frame = 0; frame < frames; frame += 1) {
        if (frame % 53 === 0) handleAction(game, 'JUMP');
        if (frame % 71 === 0) handleAction(game, 'SLIDE');
        if (frame % 97 === 0) handleAction(game, 'CHOOSE_LEFT');
        if (frame % 131 === 0) handleAction(game, 'CHOOSE_RIGHT');
        updateGame(game, STEP);
        if (!game.alive) startRun(game, seed);
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

  it('instrada CHOOSE_LEFT/CHOOSE_RIGHT alla scelta del bivio, solo quando c\'è un bivio da scegliere', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    const events = recordEvents(bus);

    handleAction(game, 'CHOOSE_LEFT');
    expect(game.path.choice).toBeNull();
    // Fuori dal bivio non è una scelta, ma non va persa: resta in memoria come
    // scelta anticipata (design §4), e infatti non annuncia nulla.
    expect(game.path.pendingChoice).toBe('left');
    expect(countOf(events, 'fork:chosen')).toBe(0);

    game.path.phase = 'approaching';
    handleAction(game, 'CHOOSE_LEFT');
    expect(game.path.choice).toBe('left');

    handleAction(game, 'CHOOSE_RIGHT');
    expect(game.path.choice).toBe('right');

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
