import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import { BRANCH_Y, createSpawner } from './spawner';
import type { Entity } from './types';

const { laneCount, chunkLength } = CONFIG.world;

function rowsOf(entities: Entity[]): number[] {
  return [...new Set(entities.map((entity) => entity.z))].sort((a, b) => a - b);
}

/** Corsie realmente bloccate a terra in una riga: il branch è sospeso e non conta. */
function groundBlockedLanes(entities: Entity[], rowZ: number): Set<number> {
  const blocked = new Set<number>();
  for (const entity of entities) {
    if (entity.z !== rowZ) continue;
    if (entity.category !== 'obstacle') continue;
    if (entity.y > 0) continue;
    for (let offset = 0; offset < entity.width; offset++) {
      blocked.add(entity.lane + offset);
    }
  }
  return blocked;
}

function generate(seed: number, difficulty: number, chunks: number): Entity[] {
  const spawner = createSpawner(createRng(seed));
  const out: Entity[] = [];
  for (let i = 0; i < chunks; i++) {
    spawner.populateChunk(i * chunkLength, difficulty, out);
  }
  return out;
}

describe('populateChunk', () => {
  it('posiziona le entità dentro l-intervallo [chunkZ, chunkZ + chunkLength)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const spawner = createSpawner(createRng(seed));
      const out: Entity[] = [];
      const chunkZ = 320;
      spawner.populateChunk(chunkZ, 1, out);
      for (const entity of out) {
        expect(entity.z).toBeGreaterThanOrEqual(chunkZ);
        expect(entity.z).toBeLessThan(chunkZ + chunkLength);
      }
    }
  });

  it('aggiunge in coda a out senza cancellare il contenuto preesistente', () => {
    const spawner = createSpawner(createRng(7));
    const out: Entity[] = [];
    spawner.populateChunk(0, 1, out);
    const first = out.length;
    spawner.populateChunk(chunkLength, 1, out);
    expect(out.length).toBeGreaterThan(first);
  });

  it('non lascia mai una riga con tutte le corsie bloccate a terra (500 seed, difficoltà 1)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const entities = generate(seed, 1, 1);
      for (const rowZ of rowsOf(entities)) {
        const blocked = groundBlockedLanes(entities, rowZ);
        expect(blocked.size).toBeLessThanOrEqual(CONFIG.spawn.maxBlockedLanes);
        expect(blocked.size).toBeLessThanOrEqual(laneCount - 1);
      }
    }
  });

  it('genera meno entità a difficoltà 0 che a difficoltà 1', () => {
    const easy = generate(12345, 0, 200).length;
    const hard = generate(12345, 1, 200).length;
    expect(easy).toBeGreaterThan(0);
    expect(easy).toBeLessThan(hard);
  });

  it('non mette mai un pickup nella stessa corsia e riga di un ostacolo a terra', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const entities = generate(seed, 1, 3);
      for (const entity of entities) {
        if (entity.category !== 'pickup') continue;
        const blocked = groundBlockedLanes(entities, entity.z);
        expect(blocked.has(entity.lane)).toBe(false);
      }
    }
  });

  it('assegna id univoci e strettamente crescenti', () => {
    const entities = generate(99, 1, 50);
    expect(entities.length).toBeGreaterThan(10);
    for (let i = 1; i < entities.length; i++) {
      const previous = entities[i - 1];
      const current = entities[i];
      if (!previous || !current) throw new Error('entità mancante');
      expect(current.id).toBeGreaterThan(previous.id);
    }
  });

  it('sospende solo il branch: y = 1.6 per il branch, 0 per tutto il resto', () => {
    const entities = generate(2024, 1, 200);
    let branches = 0;
    for (const entity of entities) {
      if (entity.kind === 'branch') {
        branches++;
        expect(entity.y).toBe(BRANCH_Y);
        expect(BRANCH_Y).toBe(1.6);
      } else {
        expect(entity.y).toBe(0);
      }
    }
    expect(branches).toBeGreaterThan(0);
  });

  it('dà width 2 solo alla cabin, e solo nelle corsie 0 o 1', () => {
    const entities = generate(4242, 1, 200);
    let cabins = 0;
    for (const entity of entities) {
      if (entity.kind === 'cabin') {
        cabins++;
        expect(entity.width).toBe(2);
        expect([0, 1]).toContain(entity.lane);
      } else {
        expect(entity.width).toBe(1);
      }
    }
    expect(cabins).toBeGreaterThan(0);
  });

  it('marca tutte le entità come vive e coerenti nella categoria', () => {
    const entities = generate(31337, 1, 50);
    const pickupKinds = new Set(['snowflake', 'hay', 'cow']);
    for (const entity of entities) {
      expect(entity.alive).toBe(true);
      expect(entity.category).toBe(pickupKinds.has(entity.kind) ? 'pickup' : 'obstacle');
    }
  });

  it('è deterministico a parità di seed', () => {
    const a = generate(555, 0.5, 20);
    const b = generate(555, 0.5, 20);
    expect(a).toEqual(b);
  });
});

describe('reset', () => {
  it('riporta il contatore degli id a zero', () => {
    const spawner = createSpawner(createRng(8));
    const first: Entity[] = [];
    spawner.populateChunk(0, 1, first);
    expect(first.length).toBeGreaterThan(0);

    spawner.reset();
    const second: Entity[] = [];
    spawner.populateChunk(0, 1, second);
    const firstEntity = second[0];
    if (!firstEntity) throw new Error('nessuna entità generata dopo il reset');
    expect(firstEntity.id).toBe(0);
  });
});
