import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import {
  DEFAULT_DIFFICULTY_PROFILE,
  difficultyAt,
  lateRampAt,
  resolveDifficultyProfile,
  speedAt,
} from './speed';

describe('speedAt', () => {
  it('parte esattamente da startSpeed', () => {
    expect(speedAt(0)).toBe(CONFIG.world.startSpeed);
  });

  it('cresce in modo monotono con la distanza', () => {
    let previous = speedAt(0);
    for (let distance = 25; distance <= 3000; distance += 25) {
      const current = speedAt(distance);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
    expect(speedAt(500)).toBeGreaterThan(speedAt(100));
  });

  it('resta clampata a maxSpeed anche per distanze enormi', () => {
    expect(speedAt(10_000_000)).toBe(CONFIG.world.maxSpeed);
    expect(speedAt(1e12)).toBe(CONFIG.world.maxSpeed);
  });

  it('non supera mai maxSpeed lungo tutta la curva', () => {
    for (let distance = 0; distance <= 500_000; distance += 500) {
      expect(speedAt(distance)).toBeLessThanOrEqual(CONFIG.world.maxSpeed);
    }
  });
});

describe('difficultyAt', () => {
  it('vale 0 alla partenza', () => {
    expect(difficultyAt(0)).toBe(0);
  });

  it('vale 1 alla distanza di rampa e oltre', () => {
    expect(difficultyAt(CONFIG.spawn.difficultyRampDistance)).toBe(1);
    expect(difficultyAt(CONFIG.spawn.difficultyRampDistance * 10)).toBe(1);
  });

  it('è lineare a metà rampa', () => {
    expect(difficultyAt(CONFIG.spawn.difficultyRampDistance / 2)).toBeCloseTo(0.5, 10);
  });

  it('non scende sotto 0 per distanze negative', () => {
    expect(difficultyAt(-100)).toBe(0);
  });
});

describe('profili di difficoltà', () => {
  it('senza profilo esplicito si usa "Normale", che è la taratura di riferimento', () => {
    const normal = resolveDifficultyProfile('normal');
    expect(DEFAULT_DIFFICULTY_PROFILE).toBe(normal);
    expect(normal.startSpeed).toBe(CONFIG.world.startSpeed);
    expect(normal.maxSpeed).toBe(CONFIG.world.maxSpeed);
    expect(normal.minObstacleGap).toBe(CONFIG.spawn.minObstacleGap);
  });

  it('risolve i tre nomi previsti e ricade su "Normale" per tutto il resto', () => {
    // Il nome arriva da localStorage o da un pulsante: è una stringa non
    // verificata, e una corsa non deve mai partire senza profilo.
    expect(resolveDifficultyProfile('calf').label).toBe(CONFIG.difficultyProfiles.calf.label);
    expect(resolveDifficultyProfile('bull').label).toBe(CONFIG.difficultyProfiles.bull.label);
    expect(resolveDifficultyProfile('vitellino')).toBe(DEFAULT_DIFFICULTY_PROFILE);
    expect(resolveDifficultyProfile(undefined)).toBe(DEFAULT_DIFFICULTY_PROFILE);
    expect(resolveDifficultyProfile('')).toBe(DEFAULT_DIFFICULTY_PROFILE);
  });

  it('porta con sé il proprio nome, che è la chiave del record separato', () => {
    // Ogni profilo ha il proprio record, altrimenti "Vitellino" cancellerebbe
    // di continuo quello fatto su "Toro".
    expect(resolveDifficultyProfile('calf').name).toBe('calf');
    expect(resolveDifficultyProfile('bull').name).toBe('bull');
  });

  it('scala partenza e tetto della stessa curva, senza cambiarne la forma', () => {
    const calf = resolveDifficultyProfile('calf');
    const bull = resolveDifficultyProfile('bull');

    expect(speedAt(0, calf)).toBe(calf.startSpeed);
    expect(speedAt(0, bull)).toBe(bull.startSpeed);
    expect(speedAt(1e9, calf)).toBe(calf.maxSpeed);
    expect(speedAt(1e9, bull)).toBe(bull.maxSpeed);

    for (let distance = 0; distance <= 20_000; distance += 250) {
      expect(speedAt(distance, calf)).toBeLessThanOrEqual(speedAt(distance, bull));
      expect(speedAt(distance, calf)).toBeLessThanOrEqual(calf.maxSpeed);
      expect(speedAt(distance, bull)).toBeLessThanOrEqual(bull.maxSpeed);
    }
  });
});

describe('lateRampAt', () => {
  it('vale 0 fino a lateRampStart', () => {
    expect(lateRampAt(0)).toBe(0);
    expect(lateRampAt(CONFIG.spawn.lateRampStart)).toBe(0);
    expect(lateRampAt(CONFIG.spawn.lateRampStart - 1)).toBe(0);
  });

  it('sale a 1 su lateRampDistance e lì resta', () => {
    const { lateRampStart, lateRampDistance } = CONFIG.spawn;
    expect(lateRampAt(lateRampStart + lateRampDistance / 2)).toBeCloseTo(0.5, 10);
    expect(lateRampAt(lateRampStart + lateRampDistance)).toBe(1);
    expect(lateRampAt(lateRampStart + lateRampDistance * 100)).toBe(1);
  });

  it('parte dove la rampa di densità è ormai finita', () => {
    // È un SECONDO asse: se partisse prima si sommerebbe al primo invece di
    // subentrargli, e la difficoltà farebbe un gradino.
    expect(CONFIG.spawn.lateRampStart).toBeGreaterThanOrEqual(CONFIG.spawn.difficultyRampDistance);
    expect(difficultyAt(CONFIG.spawn.lateRampStart)).toBe(1);
  });
});
