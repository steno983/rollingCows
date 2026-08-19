import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { playerModelScale } from './player-view';

const SCALE_PER_SIZE = 0.18;

describe('playerModelScale', () => {
  it('a taglia 1 e senza scivolata la scala è uniforme e pari a 1', () => {
    expect(playerModelScale(1, false)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('la taglia scala uniformemente le tre dimensioni fuori dalla scivolata', () => {
    const scale = playerModelScale(5, false);
    const expected = 1 + 4 * SCALE_PER_SIZE;
    expect(scale.x).toBeCloseTo(expected, 6);
    expect(scale.y).toBeCloseTo(expected, 6);
    expect(scale.z).toBeCloseTo(expected, 6);
  });

  it('in scivolata Y si schiaccia esattamente di slideHeightRatio rispetto alla base', () => {
    const base = 1 + 4 * SCALE_PER_SIZE;
    const scale = playerModelScale(5, true);
    expect(scale.y).toBeCloseTo(base * CONFIG.player.slideHeightRatio, 6);
  });

  it('in scivolata X e Z si allargano rispetto alla base, ma restano meno del doppio', () => {
    const base = 1 + 4 * SCALE_PER_SIZE;
    const scale = playerModelScale(5, true);
    expect(scale.x).toBeGreaterThan(base);
    expect(scale.x).toBeLessThan(base * 2);
    expect(scale.z).toBe(scale.x);
  });

  it('la scivolata non introduce mai una torsione laterale (X e Z restano uguali)', () => {
    for (const size of [1, 2, 3, 4, 5]) {
      const scale = playerModelScale(size, true);
      expect(scale.x).toBe(scale.z);
    }
  });
});
