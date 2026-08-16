import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { difficultyAt, speedAt } from './speed';

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
