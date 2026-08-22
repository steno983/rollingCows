import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus, type GameEvents } from '../core/events';
import { CONFIG } from './config';
import {
  addBonus,
  addDistance,
  breakStreak,
  createScore,
  registerPassedObstacle,
  registerSmash,
  streakMultiplier,
  updateSmashChain,
} from './score';

/** La persistenza NON è più qui: vive in platform/storage.ts, con i suoi test.
 *  Il livello delle regole non deve sapere cos'è un localStorage. */

function recordStreak(bus: EventBus): GameEvents['streak:changed'][] {
  const seen: GameEvents['streak:changed'][] = [];
  bus.on('streak:changed', (payload) => {
    seen.push(payload);
  });
  return seen;
}

describe('createScore', () => {
  it('parte da zero punti, zero distanza, serie e catena spente', () => {
    expect(createScore()).toEqual({
      points: 0,
      distance: 0,
      streak: 0,
      streakTier: 0,
      smashChain: 0,
      smashChainTimeLeft: 0,
    });
  });
});

describe('addDistance', () => {
  it('somma metri * pointsPerUnit * multiplier e aggiorna la distanza', () => {
    const score = createScore();

    addDistance(score, 10, 1);
    expect(score.distance).toBe(10);
    expect(score.points).toBe(10 * CONFIG.score.pointsPerUnit);

    addDistance(score, 10, 4);
    expect(score.distance).toBe(20);
    expect(score.points).toBe(10 * CONFIG.score.pointsPerUnit + 40 * CONFIG.score.pointsPerUnit);
  });

  it('mantiene i punti come float, senza arrotondamenti', () => {
    const score = createScore();
    addDistance(score, 0.3, 1);
    addDistance(score, 0.3, 1);
    expect(score.points).toBeCloseTo(0.6, 10);
    expect(score.distance).toBeCloseTo(0.6, 10);
  });
});

describe('addBonus', () => {
  it('somma amount * multiplier senza toccare la distanza', () => {
    const score = createScore();

    addBonus(score, CONFIG.score.pickupBonus.bell, 1);
    expect(score.points).toBe(CONFIG.score.pickupBonus.bell);

    addBonus(score, CONFIG.score.smashBonus, 4);
    expect(score.points).toBe(CONFIG.score.pickupBonus.bell + CONFIG.score.smashBonus * 4);
    expect(score.distance).toBe(0);
  });
});

describe('moltiplicatore di serie', () => {
  it('sale di un gradino ogni streakStep ostacoli superati, ed emette streak:changed solo al cambio', () => {
    const bus = createEventBus();
    const events = recordStreak(bus);
    const score = createScore();
    const step = CONFIG.score.streakStep;

    for (let i = 0; i < step - 1; i++) registerPassedObstacle(score, bus);
    expect(events).toHaveLength(0);
    expect(streakMultiplier(score)).toBe(1);

    registerPassedObstacle(score, bus);
    expect(score.streakTier).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ streak: step, multiplier: streakMultiplier(score) });
    expect(streakMultiplier(score)).toBeGreaterThan(1);

    // I nove successivi non cambiano gradino: nessun evento in più.
    for (let i = 0; i < step - 1; i++) registerPassedObstacle(score, bus);
    expect(events).toHaveLength(1);

    registerPassedObstacle(score, bus);
    expect(events).toHaveLength(2);
    expect(score.streakTier).toBe(2);
  });

  it("satura sull'ultimo moltiplicatore dichiarato, senza crescere all'infinito", () => {
    const bus = createEventBus();
    const score = createScore();
    const tiers = CONFIG.score.streakMultipliers.length;

    for (let i = 0; i < CONFIG.score.streakStep * (tiers + 5); i++) {
      registerPassedObstacle(score, bus);
    }
    expect(score.streakTier).toBe(tiers - 1);
    expect(streakMultiplier(score)).toBe(CONFIG.score.streakMultipliers[tiers - 1]);
  });

  it('un colpo subito azzera serie e gradino, e lo annuncia se il gradino cambia', () => {
    const bus = createEventBus();
    const events = recordStreak(bus);
    const score = createScore();

    for (let i = 0; i < CONFIG.score.streakStep; i++) registerPassedObstacle(score, bus);
    expect(events).toHaveLength(1);

    breakStreak(score, bus);
    expect(score.streak).toBe(0);
    expect(score.streakTier).toBe(0);
    expect(streakMultiplier(score)).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ streak: 0, multiplier: 1 });
  });

  it('rompere una serie che non è mai salita di gradino non annuncia niente', () => {
    const bus = createEventBus();
    const events = recordStreak(bus);
    const score = createScore();

    registerPassedObstacle(score, bus);
    breakStreak(score, bus);
    expect(score.streak).toBe(0);
    expect(events).toHaveLength(0);

    // E rompere una serie già a zero è un no-op completo.
    breakStreak(score, bus);
    expect(events).toHaveLength(0);
  });
});

describe('catena di sfondamenti', () => {
  it('il primo sfondamento vale il bonus base, i successivi un gradino in più ciascuno', () => {
    const score = createScore();

    expect(registerSmash(score)).toBe(CONFIG.score.smashBonus);
    expect(registerSmash(score)).toBe(CONFIG.score.smashBonus + CONFIG.score.smashChainStep);
    expect(registerSmash(score)).toBe(CONFIG.score.smashBonus + 2 * CONFIG.score.smashChainStep);
  });

  it('la catena si ferma a smashChainMax gradini', () => {
    const score = createScore();
    for (let i = 0; i < CONFIG.score.smashChainMax + 5; i++) registerSmash(score);
    expect(score.smashChain).toBe(CONFIG.score.smashChainMax);
    expect(registerSmash(score)).toBe(
      CONFIG.score.smashBonus + CONFIG.score.smashChainMax * CONFIG.score.smashChainStep,
    );
  });

  it('si azzera dopo smashChainSeconds senza sfondare nulla', () => {
    const score = createScore();
    registerSmash(score);
    registerSmash(score);
    expect(score.smashChain).toBe(1);

    updateSmashChain(score, CONFIG.score.smashChainSeconds / 2);
    expect(score.smashChain).toBe(1);
    // Il tempo residuo si ricarica a ogni sfondamento: la catena vive finché
    // si continua a sfondare.
    registerSmash(score);
    expect(score.smashChain).toBe(2);

    updateSmashChain(score, CONFIG.score.smashChainSeconds);
    expect(score.smashChain).toBe(0);
    expect(registerSmash(score)).toBe(CONFIG.score.smashBonus);
  });
});
