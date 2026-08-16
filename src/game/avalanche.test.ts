import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  type EventBus,
  type EventName,
  type GameEvents,
} from '../core/events';
import {
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  createAvalanche,
  isInvulnerable,
  scoreMultiplier,
  sizeForCharge,
  updateAvalanche,
} from './avalanche';
import { CONFIG } from './config';

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

function namesOf(events: readonly Recorded[]): EventName[] {
  return events.map((event) => event.name);
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

describe('sizeForCharge', () => {
  it('rispetta le soglie [0, 20, 40, 60, 80]', () => {
    expect(CONFIG.avalanche.sizeThresholds).toEqual([0, 20, 40, 60, 80]);
    expect(sizeForCharge(0)).toBe(1);
    expect(sizeForCharge(19)).toBe(1);
    expect(sizeForCharge(20)).toBe(2);
    expect(sizeForCharge(39.9)).toBe(2);
    expect(sizeForCharge(40)).toBe(3);
    expect(sizeForCharge(60)).toBe(4);
    expect(sizeForCharge(79.9)).toBe(4);
    expect(sizeForCharge(80)).toBe(5);
    expect(sizeForCharge(100)).toBe(5);
  });
});

describe('createAvalanche', () => {
  it('parte da carica 0, taglia 1, fase idle', () => {
    const state = createAvalanche();
    expect(state).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
  });
});

describe('addCharge', () => {
  it('accumula la carica e la clampa alla soglia', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, 5, bus);
    expect(state.charge).toBe(5);

    addCharge(state, 10, bus);
    expect(state.charge).toBe(15);

    addCharge(state, 999, bus);
    expect(state.charge).toBe(CONFIG.avalanche.threshold);
  });

  it('emette size:changed a ogni cambio di taglia con size e previous corretti', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 5, bus);
    expect(countOf(events, 'size:changed')).toBe(0);

    addCharge(state, 15, bus);
    expect(payloadsOf(events, 'size:changed')).toEqual([{ size: 2, previous: 1 }]);
    expect(state.size).toBe(2);

    addCharge(state, 1, bus);
    expect(countOf(events, 'size:changed')).toBe(1);

    addCharge(state, 19, bus);
    expect(payloadsOf(events, 'size:changed')).toEqual([
      { size: 2, previous: 1 },
      { size: 3, previous: 2 },
    ]);
  });

  it('superata la soglia entra in fase active ed emette avalanche:triggered una sola volta', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 90, bus);
    expect(state.phase).toBe('idle');
    expect(countOf(events, 'avalanche:triggered')).toBe(0);

    addCharge(state, 30, bus);
    expect(state.phase).toBe('active');
    expect(state.charge).toBe(CONFIG.avalanche.threshold);
    expect(state.size).toBe(CONFIG.avalanche.maxSize);
    expect(state.timeLeft).toBe(CONFIG.avalanche.durationSeconds);
    expect(payloadsOf(events, 'avalanche:triggered')).toEqual([{ size: 5 }]);

    addCharge(state, 50, bus);
    addCharge(state, 50, bus);
    expect(countOf(events, 'avalanche:triggered')).toBe(1);
  });

  it('durante la fase attiva non fa ripartire la fase né altera timeLeft', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, 3, bus);
    const timeLeft = state.timeLeft;

    addCharge(state, 50, bus);
    expect(state.timeLeft).toBe(timeLeft);
    expect(state.phase).toBe('active');
    expect(state.charge).toBe(CONFIG.avalanche.threshold);
  });
});

describe('updateAvalanche', () => {
  it('in fase idle non fa nulla e non emette eventi', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    updateAvalanche(state, 1, bus);
    expect(state).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
    expect(events).toHaveLength(0);
  });

  it('scala timeLeft del delta time', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, 1, bus);
    expect(state.timeLeft).toBeCloseTo(CONFIG.avalanche.durationSeconds - 1, 6);

    updateAvalanche(state, 0.5, bus);
    expect(state.timeLeft).toBeCloseTo(CONFIG.avalanche.durationSeconds - 1.5, 6);
  });

  it('entra in warning ed emette avalanche:ending una sola volta', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, 6, bus);
    expect(state.phase).toBe('active');
    expect(countOf(events, 'avalanche:ending')).toBe(0);

    updateAvalanche(state, 0.6, bus);
    expect(state.phase).toBe('warning');
    expect(countOf(events, 'avalanche:ending')).toBe(1);

    updateAvalanche(state, 0.1, bus);
    updateAvalanche(state, 0.1, bus);
    updateAvalanche(state, 0.1, bus);
    expect(state.phase).toBe('warning');
    expect(countOf(events, 'avalanche:ending')).toBe(1);
  });

  it('a timeLeft esaurito chiude la fase, azzera la carica e torna a taglia 1', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, CONFIG.avalanche.durationSeconds, bus);

    expect(state.phase).toBe('idle');
    expect(state.charge).toBe(0);
    expect(state.size).toBe(1);
    expect(state.timeLeft).toBe(0);
    expect(countOf(events, 'avalanche:ended')).toBe(1);
    expect(namesOf(events).slice(-2)).toEqual(['avalanche:ended', 'size:changed']);
    expect(payloadsOf(events, 'size:changed').at(-1)).toEqual({ size: 1, previous: 5 });

    updateAvalanche(state, 1, bus);
    expect(countOf(events, 'avalanche:ended')).toBe(1);
  });
});

describe('isInvulnerable / canSmash / scoreMultiplier', () => {
  it('è invulnerabile solo in fase active o warning', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    expect(isInvulnerable(state)).toBe(false);

    addCharge(state, CONFIG.avalanche.threshold, bus);
    expect(isInvulnerable(state)).toBe(true);

    updateAvalanche(state, CONFIG.avalanche.durationSeconds - 1, bus);
    expect(state.phase).toBe('warning');
    expect(isInvulnerable(state)).toBe(true);

    updateAvalanche(state, 5, bus);
    expect(isInvulnerable(state)).toBe(false);
  });

  it('durante la valanga sfonda qualunque ostacolo', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    addCharge(state, CONFIG.avalanche.threshold, bus);

    expect(canSmash(state, 'rock')).toBe(true);
    expect(canSmash(state, 'tree')).toBe(true);
    expect(canSmash(state, 'fence')).toBe(true);
    expect(canSmash(state, 'cabin')).toBe(true);
    expect(canSmash(state, 'crevasse')).toBe(true);
    expect(canSmash(state, 'branch')).toBe(true);
  });

  it('fuori dalla valanga sfonda solo tree e fence da taglia 3', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, 20, bus);
    expect(state.size).toBe(2);
    expect(canSmash(state, 'tree')).toBe(false);
    expect(canSmash(state, 'fence')).toBe(false);

    addCharge(state, 20, bus);
    expect(state.size).toBe(3);
    expect(canSmash(state, 'tree')).toBe(true);
    expect(canSmash(state, 'fence')).toBe(true);
    expect(canSmash(state, 'rock')).toBe(false);
    expect(canSmash(state, 'cabin')).toBe(false);
    expect(canSmash(state, 'crevasse')).toBe(false);
    expect(canSmash(state, 'branch')).toBe(false);
  });

  it('il moltiplicatore vale 4 in valanga e 1 fuori', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    expect(scoreMultiplier(state)).toBe(1);

    addCharge(state, CONFIG.avalanche.threshold, bus);
    expect(scoreMultiplier(state)).toBe(CONFIG.avalanche.scoreMultiplier);

    updateAvalanche(state, CONFIG.avalanche.durationSeconds, bus);
    expect(scoreMultiplier(state)).toBe(1);
  });
});

describe('applyForgivenessPenalty', () => {
  it('azzera la carica, scala la taglia ed emette size:changed', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 60, bus);
    expect(state.size).toBe(4);

    applyForgivenessPenalty(state, bus);
    expect(state.charge).toBe(0);
    expect(state.size).toBe(4 - CONFIG.forgiveness.sizePenalty);
    expect(payloadsOf(events, 'size:changed').at(-1)).toEqual({ size: 3, previous: 4 });
  });

  it('non scende mai sotto taglia 1', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 5, bus);
    applyForgivenessPenalty(state, bus);

    expect(state.charge).toBe(0);
    expect(state.size).toBe(1);
    expect(countOf(events, 'size:changed')).toBe(0);
  });
});
