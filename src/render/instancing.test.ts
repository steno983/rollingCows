import { describe, expect, it } from 'vitest';
import type { Branch, Entity, EntityKind } from '../game/types';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';

let nextId = 1;

function entity(kind: EntityKind, alive = true, branch: Branch = 'main'): Entity {
  return {
    id: nextId++,
    kind,
    category: kind === 'snowflake' || kind === 'crystal' || kind === 'star' || kind === 'magnet' || kind === 'bell' ? 'pickup' : 'obstacle',
    branch,
    z: 10,
    y: 0,
    alive,
  };
}

describe('instanceCountFor', () => {
  it('conta solo le entità vive del tipo richiesto', () => {
    const entities = [
      entity('rock'),
      entity('log'),
      entity('rock'),
      entity('rock', false),
      entity('snowflake'),
    ];
    expect(instanceCountFor(entities, 'rock', 32)).toBe(2);
    expect(instanceCountFor(entities, 'log', 32)).toBe(1);
    expect(instanceCountFor(entities, 'snowflake', 32)).toBe(1);
    expect(instanceCountFor(entities, 'fence', 32)).toBe(0);
  });

  it('su un elenco vuoto restituisce 0', () => {
    expect(instanceCountFor([], 'rock', 32)).toBe(0);
  });

  it('non supera mai il tetto, anche con molte più entità', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 500; i += 1) entities.push(entity('log'));
    expect(instanceCountFor(entities, 'log', 32)).toBe(32);
    expect(instanceCountFor(entities, 'log', 1)).toBe(1);
    expect(instanceCountFor(entities, 'log', 0)).toBe(0);
  });

  it('conta esattamente il tetto quando le entità vive sono altrettante', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 32; i += 1) entities.push(entity('rock'));
    expect(instanceCountFor(entities, 'rock', 32)).toBe(32);
  });

  it('il tetto di default copre la fila di fiocchi più lunga possibile su due rami', () => {
    // Il numero esatto non conta (è derivato da CONFIG): conta che stia sopra
    // al massimo che il gioco può davvero produrre — misurato in una corsa
    // simulata da src/game/run-simulation.test.ts — e sotto a un tetto che
    // sprecherebbe memoria di istanze per nulla.
    expect(MAX_INSTANCES_PER_KIND).toBeGreaterThanOrEqual(128);
    expect(MAX_INSTANCES_PER_KIND).toBeLessThanOrEqual(512);
  });
});
