import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { loadCompletedQuests, loadRecord, saveCompletedQuests, saveRecord } from './storage';

/**
 * Questi test stavano in game/score.test.ts, insieme alle funzioni che
 * verificano: si sono spostati con loro, perché la persistenza è un servizio
 * di piattaforma e non una regola di gioco.
 */

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

/** Storage che lancia a ogni scrittura: Safari in navigazione privata, quota
 *  esaurita. Un record non salvato non deve mai fermare una partita. */
function createHostileStorage(): Storage {
  const base = createFakeStorage();
  return {
    ...base,
    get length(): number {
      return base.length;
    },
    getItem(): string | null {
      throw new Error('storage non disponibile');
    },
    setItem(): void {
      throw new Error('quota esaurita');
    },
  };
}

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

describe('missioni completate', () => {
  it('va e torna, preservando gli id', () => {
    const storage = createFakeStorage();
    expect(loadCompletedQuests(storage)).toEqual([]);

    expect(saveCompletedQuests(['flakes-60', 'size-5'], storage)).toBe(true);
    expect(loadCompletedQuests(storage)).toEqual(['flakes-60', 'size-5']);
  });

  it('ignora un contenuto corrotto o di una versione precedente', () => {
    expect(loadCompletedQuests(createFakeStorage({ [CONFIG.quests.storageKey]: 'boh' }))).toEqual(
      [],
    );
    expect(
      loadCompletedQuests(createFakeStorage({ [CONFIG.quests.storageKey]: '{"a":1}' })),
    ).toEqual([]);
    // Un array c'è, ma dentro non sono tutti id: si tiene solo ciò che lo è.
    expect(
      loadCompletedQuests(createFakeStorage({ [CONFIG.quests.storageKey]: '["ok", 3, null]' })),
    ).toEqual(['ok']);
  });
});

describe('degrado silenzioso', () => {
  it("con uno storage che lancia, legge 0 e non propaga l'eccezione", () => {
    const storage = createHostileStorage();
    expect(loadRecord(storage)).toBe(0);
    expect(() => saveRecord(1000, storage)).not.toThrow();
    expect(saveRecord(1000, storage)).toBe(false);
    expect(loadCompletedQuests(storage)).toEqual([]);
    expect(saveCompletedQuests(['x'], storage)).toBe(false);
  });

  it("senza localStorage nell'ambiente, loadRecord dà 0 e saveRecord non lancia", () => {
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
