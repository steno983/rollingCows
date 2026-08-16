import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('produce la stessa sequenza a parità di seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const sequenceA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const sequenceB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produce sequenze diverse con seed diversi', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sequenceA = [a.next(), a.next(), a.next()];
    const sequenceB = [b.next(), b.next(), b.next()];
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('next() resta sempre in [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() resta nei limiti e copre tutti i valori possibili', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.int(2, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('int() con intervallo vuoto o invertito restituisce minInclusive', () => {
    const rng = createRng(3);
    expect(rng.int(4, 4)).toBe(4);
    expect(rng.int(4, 1)).toBe(4);
  });

  it('chance(0) è sempre false e chance(1) è sempre true', () => {
    const rng = createRng(42);
    for (let i = 0; i < 500; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('chance(p) ha una frequenza vicina a p', () => {
    const rng = createRng(2024);
    let hits = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      if (rng.chance(0.3)) {
        hits += 1;
      }
    }
    const ratio = hits / samples;
    expect(ratio).toBeGreaterThan(0.28);
    expect(ratio).toBeLessThan(0.32);
  });

  it('pick() restituisce sempre un elemento dell\'array', () => {
    const rng = createRng(5);
    const items = ['rock', 'tree', 'fence'] as const;
    for (let i = 0; i < 500; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('pick() su un array di un solo elemento restituisce quell\'elemento', () => {
    const rng = createRng(6);
    expect(rng.pick(['cabin'])).toBe('cabin');
  });

  it('pick() su array vuoto lancia un errore', () => {
    const rng = createRng(6);
    expect(() => rng.pick([])).toThrow('rng.pick: empty array');
  });
});
