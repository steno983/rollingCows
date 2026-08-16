export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** intero in [minInclusive, maxExclusive) */
  int(minInclusive: number, maxExclusive: number): number;
  /** true con probabilità p */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/**
 * PRNG mulberry32: veloce, senza dipendenze, deterministico a parità di seed.
 * Stato a 32 bit, sufficiente per la generazione procedurale di una run.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxExclusive: number): number => {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxExclusive);
    const span = max - min;
    if (span <= 0) {
      return min;
    }
    return min + Math.floor(next() * span);
  };

  const chance = (p: number): boolean => next() < p;

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('rng.pick: empty array');
    }
    const item = items[int(0, items.length)];
    if (item === undefined) {
      throw new Error('rng.pick: empty array');
    }
    return item;
  };

  return { next, int, chance, pick };
}
