import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import {
  addBonus,
  addDistance,
  createScore,
  loadRecord,
  saveRecord,
} from './score';

/** Storage finto e isolato: i test non toccano mai il localStorage vero. */
function createFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
  };
}

describe('createScore', () => {
  it('parte da zero punti e zero distanza', () => {
    expect(createScore()).toEqual({ points: 0, distance: 0 });
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
    expect(score.points).toBe(30);

    addBonus(score, CONFIG.score.smashBonus, 4);
    expect(score.points).toBe(30 + 120);
    expect(score.distance).toBe(0);
  });
});

describe('loadRecord', () => {
  it('restituisce 0 su storage vuoto', () => {
    expect(loadRecord(createFakeStorage())).toBe(0);
  });

  it('restituisce 0 su valore non numerico, senza lanciare', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: 'pippo' });
    expect(() => loadRecord(storage)).not.toThrow();
    expect(loadRecord(storage)).toBe(0);
  });

  it('legge il valore salvato', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: '1234.5' });
    expect(loadRecord(storage)).toBe(1234.5);
  });
});

describe('saveRecord', () => {
  it('salva e restituisce true se il punteggio è maggiore del record', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: '100' });

    expect(saveRecord(150, storage)).toBe(true);
    expect(loadRecord(storage)).toBe(150);
  });

  it('non sovrascrive e restituisce false se il punteggio è minore o uguale', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: '150' });

    expect(saveRecord(150, storage)).toBe(false);
    expect(saveRecord(10, storage)).toBe(false);
    expect(loadRecord(storage)).toBe(150);
  });

  it('salva il primo record su storage vuoto', () => {
    const storage = createFakeStorage();

    expect(saveRecord(42, storage)).toBe(true);
    expect(storage.getItem(CONFIG.score.recordKey)).toBe('42');
  });
});

describe('senza storage disponibile', () => {
  it('loadRecord dà 0 e saveRecord non lancia', () => {
    const globalWithStorage = globalThis as { localStorage?: Storage };
    const original = globalWithStorage.localStorage;
    delete globalWithStorage.localStorage;

    try {
      expect(loadRecord()).toBe(0);
      expect(() => saveRecord(1000)).not.toThrow();
      expect(saveRecord(1000)).toBe(false);
    } finally {
      if (original !== undefined) globalWithStorage.localStorage = original;
    }
  });
});
