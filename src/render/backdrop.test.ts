import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { generateRidgeProfile, generateVillageLayout } from './backdrop';

describe('generateRidgeProfile', () => {
  it('produce segments + 1 picchi', () => {
    const profile = generateRidgeProfile(createRng(1), 18, 40, 10);
    expect(profile).toHaveLength(19);
  });

  it('stesso seed → stesso profilo', () => {
    const a = generateRidgeProfile(createRng(42), 12, 30, 8);
    const b = generateRidgeProfile(createRng(42), 12, 30, 8);
    expect(a).toEqual(b);
  });

  it('semi diversi → profili diversi', () => {
    const a = generateRidgeProfile(createRng(1), 12, 30, 8);
    const b = generateRidgeProfile(createRng(2), 12, 30, 8);
    expect(a).not.toEqual(b);
  });

  it('nessun picco scende sotto zero anche con varianza grande', () => {
    const profile = generateRidgeProfile(createRng(7), 40, 5, 50);
    for (const peak of profile) {
      expect(peak).toBeGreaterThanOrEqual(0);
    }
  });

  it('resta entro baseHeight ± variance', () => {
    const baseHeight = 40;
    const variance = 10;
    const profile = generateRidgeProfile(createRng(9), 30, baseHeight, variance);
    for (const peak of profile) {
      expect(peak).toBeGreaterThanOrEqual(Math.max(0, baseHeight - variance));
      expect(peak).toBeLessThanOrEqual(baseHeight + variance);
    }
  });
});

describe('generateVillageLayout', () => {
  it('produce esattamente houseCount case', () => {
    const layout = generateVillageLayout(createRng(3), 9, 20);
    expect(layout).toHaveLength(9);
  });

  it('stesso seed → stesso layout', () => {
    const a = generateVillageLayout(createRng(11), 9, 20);
    const b = generateVillageLayout(createRng(11), 9, 20);
    expect(a).toEqual(b);
  });

  it('semi diversi → layout diversi', () => {
    const a = generateVillageLayout(createRng(1), 9, 20);
    const b = generateVillageLayout(createRng(2), 9, 20);
    expect(a).not.toEqual(b);
  });

  it('esattamente una casa ospita il campanile', () => {
    const layout = generateVillageLayout(createRng(5), 9, 20);
    const towers = layout.filter((house) => house.isTower);
    expect(towers).toHaveLength(1);
  });

  it('con houseCount 0 non produce case', () => {
    expect(generateVillageLayout(createRng(1), 0, 20)).toEqual([]);
  });

  it('le case restano ragionevolmente dentro lo spread (con un margine per il jitter)', () => {
    const spread = 20;
    const layout = generateVillageLayout(createRng(4), 16, spread);
    for (const house of layout) {
      expect(Math.abs(house.x)).toBeLessThanOrEqual(spread * 1.5);
      expect(Math.abs(house.z)).toBeLessThanOrEqual(spread * 1.5);
    }
  });
});
