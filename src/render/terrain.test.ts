import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPath, type PathState } from '../game/path';
import { heightAt, trackCenterOffsets, trackHalfWidths } from './terrain';

/** Stessa zona sempre-piatta calcolata in terrain.ts: la separazione dei
 *  rami più mezza larghezza del tracciato, così il pendio resta piatto sotto
 *  qualunque ramo, in qualunque momento di un bivio. */
const FLAT_HALF_WIDTH = CONFIG.path.branchSeparation + CONFIG.world.trackWidth / 2;
const LENGTH = CONFIG.world.chunkLength;

describe('heightAt', () => {
  it('è 0 dentro la zona sempre piatta, per qualunque z', () => {
    for (const z of [0, 5, LENGTH / 4, LENGTH / 2, LENGTH, LENGTH * 3.7]) {
      for (const x of [0, 0.5, 1, -1, 2, -2, FLAT_HALF_WIDTH, -FLAT_HALF_WIDTH]) {
        expect(heightAt(x, z)).toBe(0);
      }
    }
  });

  it('è continua al bordo della zona piatta: heightAt(±FLAT_HALF_WIDTH, z) = 0', () => {
    for (const z of [0, 13, LENGTH / 3, LENGTH]) {
      expect(heightAt(FLAT_HALF_WIDTH, z)).toBe(0);
      expect(heightAt(-FLAT_HALF_WIDTH, z)).toBe(0);
    }
  });

  it('resta vicina a zero appena fuori dalla zona piatta (continuità)', () => {
    for (const z of [0, LENGTH / 4, LENGTH / 2]) {
      const justOutside = heightAt(FLAT_HALF_WIDTH + 0.05, z);
      expect(Math.abs(justOutside)).toBeLessThan(0.02);
    }
  });

  it('non scende mai sotto un minimo prossimo a zero, in nessun punto', () => {
    let min = Infinity;
    for (let x = 0; x <= 130; x += 0.5) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h < min) min = h;
      }
    }
    expect(min).toBeGreaterThan(-0.1);
  });

  it('satura al tetto (MAX_LATERAL_RISE) oltre una certa distanza laterale', () => {
    const farA = heightAt(60, 7);
    const farB = heightAt(120, 7);
    expect(Math.abs(farA - farB)).toBeLessThan(0.5);
  });

  it('è periodica su chunkLength: due chunk adiacenti combaciano', () => {
    for (const x of [10, 16, -30, 60]) {
      expect(heightAt(x, 0)).toBeCloseTo(heightAt(x, LENGTH), 10);
      expect(heightAt(x, 3.3)).toBeCloseTo(heightAt(x, 3.3 + LENGTH), 10);
    }
  });

  it('non supera mai il tetto teorico (~3.82 con la config di default)', () => {
    let max = -Infinity;
    for (let x = 0; x <= 130; x += 0.5) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h > max) max = h;
      }
    }
    expect(max).toBeLessThan(4);
  });
});

/** Base da createPath, non un letterale scritto a mano: un campo nuovo di
 *  PathState non deve costringere a toccare le fixture dei test di vista. */
function fixture(overrides: Partial<PathState> = {}): PathState {
  return { ...createPath(), nextForkIn: 100, ...overrides };
}

describe('trackCenterOffsets', () => {
  it('senza bivio, i due nastri coincidono sempre a offsetX', () => {
    const path = fixture({ offsetX: 1.5 });
    for (const z of [0, 10, 90, 200]) {
      expect(trackCenterOffsets(path, z)).toEqual([1.5, 1.5]);
    }
  });

  it('con un bivio in corso ma prima della biforcazione (z <= forkZ), resta un solo nastro', () => {
    const path = fixture({ phase: 'approaching', forkZ: 40, offsetX: 0 });
    expect(trackCenterOffsets(path, 0)).toEqual([0, 0]);
    expect(trackCenterOffsets(path, 40)).toEqual([0, 0]);
  });

  it('oltre la biforcazione (z > forkZ) i due nastri divergono ai due rami', () => {
    const path = fixture({ phase: 'approaching', forkZ: 40, offsetX: 0 });
    const [left, right] = trackCenterOffsets(path, 41);
    expect(left).toBeCloseTo(-CONFIG.path.branchSeparation, 6);
    expect(right).toBeCloseTo(CONFIG.path.branchSeparation, 6);
  });

  it('durante il riallineamento, offsetX si somma anche ai nastri divergenti', () => {
    const path = fixture({ phase: 'committed', forkZ: 5, offsetX: -2 });
    const [left, right] = trackCenterOffsets(path, 90);
    expect(left).toBeCloseTo(-CONFIG.path.branchSeparation - 2, 6);
    expect(right).toBeCloseTo(CONFIG.path.branchSeparation - 2, 6);
  });
});

describe('trackHalfWidths', () => {
  const full = CONFIG.world.trackWidth / 2;

  it('fuori dal riallineamento i due nastri sono larghi uguale', () => {
    for (const phase of ['none', 'approaching', 'committed'] as const) {
      const path = fixture({ phase, activeBranch: 'left', realignProgress: 0 });
      expect([...trackHalfWidths(path)]).toEqual([full, full]);
    }
  });

  it('durante il riallineamento il nastro SCARTATO si assottiglia, quello scelto no', () => {
    const path = fixture({ phase: 'realigning', activeBranch: 'left', realignProgress: 0.5 });
    const [left, right] = trackHalfWidths(path);
    expect(left).toBe(full);
    expect(right).toBeCloseTo(full * 0.5, 10);

    const mirrored = fixture({ phase: 'realigning', activeBranch: 'right', realignProgress: 0.5 });
    const [mirroredLeft, mirroredRight] = trackHalfWidths(mirrored);
    expect(mirroredLeft).toBeCloseTo(full * 0.5, 10);
    expect(mirroredRight).toBe(full);
  });

  it('a riallineamento completo il nastro scartato ha larghezza nulla: la sua sparizione non si vede', () => {
    // Nel frame successivo la fase torna 'none' e i due nastri tornano a
    // coincidere al centro. Se il nastro scartato fosse ancora largo, quel
    // ritorno sarebbe uno scatto laterale di 2 * branchSeparation.
    const path = fixture({ phase: 'realigning', activeBranch: 'right', realignProgress: 1 });
    expect(trackHalfWidths(path)[0]).toBe(0);
    expect(trackHalfWidths(path)[1]).toBe(full);
  });

  it('non scende mai sotto zero, nemmeno con un avanzamento oltre 1', () => {
    const path = fixture({ phase: 'realigning', activeBranch: 'left', realignProgress: 1.5 });
    expect(trackHalfWidths(path)[1]).toBe(0);
  });
});
