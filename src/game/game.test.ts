import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  type EventBus,
  type EventName,
  type GameEvents,
} from '../core/events';
import { addCharge } from './avalanche';
import { CONFIG } from './config';
import { createGame, handleAction, startRun, updateGame, type GameState } from './game';
import type { Entity } from './types';

const STEP = 1 / 60;

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = [
  'run:started',
  'run:ended',
  'pickup:collected',
  'obstacle:hit',
  'size:changed',
  'avalanche:triggered',
  'avalanche:ending',
  'avalanche:ended',
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

function rock(): Entity {
  return { id: 1, kind: 'rock', category: 'obstacle', lane: 1, width: 1, z: 5, y: 0, alive: true };
}

function cow(): Entity {
  return { id: 2, kind: 'cow', category: 'pickup', lane: 1, width: 1, z: 5, y: 0, alive: true };
}

/**
 * Piazza una sola entità nella corsia centrale, a 5 unità dal giocatore.
 * A 18 u/s l'impatto avviene entro ~17 frame; i 60 frame simulati restano
 * abbondantemente sotto ai 3,3 s necessari al primo riciclo di chunk, quindi
 * nessuna entità generata dallo spawner interferisce con lo scenario.
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
  it('reinizializza tutto ed emette run:started', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const game = createGame(99, bus);

    startRun(game);
    runFrames(game, 120);
    expect(game.score.points).toBeGreaterThan(0);

    game.forgivenessUsed = true;
    game.alive = false;
    startRun(game, 7);

    expect(game.seed).toBe(7);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(game.entities).toHaveLength(0);
    expect(game.score).toEqual({ points: 0, distance: 0 });
    expect(game.world.distance).toBe(0);
    expect(game.avalanche).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
    expect(payloadsOf(events, 'run:started')).toEqual([{ seed: 99 }, { seed: 7 }]);
  });
});

describe('updateGame — simulazione lunga', () => {
  it('60 secondi a 1/60 non lanciano e le entità vive restano limitate', () => {
    const bus = createEventBus();
    const game = createGame(20260816, bus);
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
    expect(maxEntities).toBeLessThan(200);
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

describe('updateGame — collisione con ostacolo', () => {
  it('uccide il giocatore ed emette run:ended una sola volta', () => {
    const { game, events } = scenario(1, rock());

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.lane)).toEqual([1]);
    expect(countOf(events, 'run:ended')).toBe(1);

    const ended = payloadsOf(events, 'run:ended')[0];
    expect(ended?.points).toBeGreaterThan(0);
    expect(ended?.distance).toBeGreaterThan(0);

    const total = events.length;
    runFrames(game, 10);
    expect(events).toHaveLength(total);
    expect(countOf(events, 'run:ended')).toBe(1);
  });

  it('con carica al 60% perdona il primo impatto invece di uccidere', () => {
    const { game, events } = scenario(1, rock());
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
    const { game, events } = scenario(1, rock());
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    expect(game.avalanche.phase).toBe('active');

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['smashed']);
    expect(game.score.points).toBeGreaterThanOrEqual(
      CONFIG.score.smashBonus * CONFIG.avalanche.scoreMultiplier,
    );
    expect(game.entities).toHaveLength(0);
  });

  it('perdona una sola volta per run', () => {
    const { game, events } = scenario(1, rock());
    addCharge(game.avalanche, 60, game.bus);
    runFrames(game, 60);
    expect(game.alive).toBe(true);

    addCharge(game.avalanche, 60, game.bus);
    game.entities.push(rock());
    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual([
      'forgiven',
      'death',
    ]);
  });
});

describe('updateGame — raccolta pickup', () => {
  it('la mucca raccolta dà carica 10 e uno scatto immediato di taglia', () => {
    const { game, events } = scenario(1, cow());

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.entities).toHaveLength(0);
    // 10 di carica base + 10 per raggiungere la soglia della taglia 2.
    expect(game.avalanche.charge).toBe(20);
    expect(game.avalanche.size).toBe(2);
    expect(payloadsOf(events, 'pickup:collected')).toEqual([{ kind: 'cow', charge: 20 }]);
    expect(payloadsOf(events, 'size:changed')).toEqual([{ size: 2, previous: 1 }]);
    expect(game.score.points).toBeGreaterThanOrEqual(CONFIG.score.pickupBonus.cow);
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
        if (frame % 71 === 0) handleAction(game, 'SLAM');
        if (frame % 97 === 0) handleAction(game, 'MOVE_LEFT');
        if (frame % 131 === 0) handleAction(game, 'MOVE_RIGHT');
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
  it('instrada MOVE_LEFT e MOVE_RIGHT al cambio corsia', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    expect(game.player.lane).toBe(1);

    handleAction(game, 'MOVE_LEFT');
    expect(game.player.lane).toBe(0);
    runFrames(game, 20);

    handleAction(game, 'MOVE_RIGHT');
    expect(game.player.lane).toBe(1);
  });

  it('instrada JUMP al salto', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'JUMP');
    expect(game.player.airborne).toBe(true);
  });

  it('instrada SLAM alla schiacciata', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'SLAM');
    expect(game.player.slamming).toBe(true);
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
