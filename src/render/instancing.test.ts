import { describe, expect, it } from 'vitest';
import type { Entity, EntityKind, Lane } from '../game/types';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';

let nextId = 1;

function entity(kind: EntityKind, alive = true, lane: Lane = 1): Entity {
  return {
    id: nextId++,
    kind,
    category: kind === 'snowflake' || kind === 'hay' || kind === 'cow' ? 'pickup' : 'obstacle',
    lane,
    width: kind === 'cabin' ? 2 : 1,
    z: 10,
    y: 0,
    alive,
  };
}

describe('instanceCountFor', () => {
  it('conta solo le entità vive del tipo richiesto', () => {
    const entities = [
      entity('rock'),
      entity('tree'),
      entity('rock'),
      entity('rock', false),
      entity('hay'),
    ];
    expect(instanceCountFor(entities, 'rock', 32)).toBe(2);
    expect(instanceCountFor(entities, 'tree', 32)).toBe(1);
    expect(instanceCountFor(entities, 'hay', 32)).toBe(1);
    expect(instanceCountFor(entities, 'cabin', 32)).toBe(0);
  });

  it('su un elenco vuoto restituisce 0', () => {
    expect(instanceCountFor([], 'rock', 32)).toBe(0);
  });

  it('non supera mai il tetto, anche con molte più entità', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 500; i += 1) entities.push(entity('tree'));
    expect(instanceCountFor(entities, 'tree', 32)).toBe(32);
    expect(instanceCountFor(entities, 'tree', 1)).toBe(1);
    expect(instanceCountFor(entities, 'tree', 0)).toBe(0);
  });

  it('conta esattamente il tetto quando le entità vive sono altrettante', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 32; i += 1) entities.push(entity('rock'));
    expect(instanceCountFor(entities, 'rock', 32)).toBe(32);
  });

  it('il tetto di default è positivo e ragionevole', () => {
    expect(MAX_INSTANCES_PER_KIND).toBeGreaterThanOrEqual(16);
    expect(MAX_INSTANCES_PER_KIND).toBeLessThanOrEqual(128);
  });
});
