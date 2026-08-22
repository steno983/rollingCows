import { describe, expect, it } from 'vitest';
import type { EntityKind } from '../game/types';
import {
  INSTANCE_CAPACITY,
  MAX_BUFF_INSTANCES,
  MAX_OBSTACLE_INSTANCES,
  MAX_SNOWFLAKE_INSTANCES,
} from './instancing';

const ALL_KINDS: readonly EntityKind[] = [
  'rock',
  'log',
  'fence',
  'crevasse',
  'branch',
  'arch',
  'cornice',
  'snowflake',
  'crystal',
  'star',
  'magnet',
  'bell',
];

describe('capienza delle InstancedMesh', () => {
  it('il tetto del fiocco copre la fila più lunga possibile su due rami', () => {
    // Il numero esatto non conta (è derivato da CONFIG): conta che stia sopra
    // al massimo che il gioco può davvero produrre — misurato in una corsa
    // simulata da src/game/run-simulation.test.ts — e sotto a un tetto che
    // sprecherebbe memoria di istanze per nulla.
    expect(MAX_SNOWFLAKE_INSTANCES).toBeGreaterThanOrEqual(96);
    expect(MAX_SNOWFLAKE_INSTANCES).toBeLessThanOrEqual(512);
  });

  it('ostacoli e buff sono dimensionati per famiglia, non come il fiocco', () => {
    // Il difetto corretto: la capienza del fiocco applicata anche a massi e
    // campanacci, che non superano mai una decina di unità vive.
    expect(MAX_OBSTACLE_INSTANCES).toBeLessThan(MAX_SNOWFLAKE_INSTANCES / 4);
    expect(MAX_BUFF_INSTANCES).toBeLessThan(MAX_SNOWFLAKE_INSTANCES / 4);
  });

  it('nessun tipo scende sotto il massimo che il gioco può produrne su due rami', () => {
    // Un ramo non può contenere più di un ostacolo ogni minObstacleGap, e un
    // buff nasce al più assieme a un ostacolo: il doppio del massimo per ramo
    // è quindi un tetto vero, non una stima.
    expect(MAX_OBSTACLE_INSTANCES).toBeGreaterThanOrEqual(16);
    expect(MAX_BUFF_INSTANCES).toBeGreaterThanOrEqual(16);
  });

  it('ogni tipo di entità ha una capienza positiva', () => {
    for (const kind of ALL_KINDS) {
      expect(INSTANCE_CAPACITY[kind]).toBeGreaterThan(0);
    }
  });

  it('dimensionare per famiglia costa molto meno del tetto unico', () => {
    let total = 0;
    for (const kind of ALL_KINDS) total += INSTANCE_CAPACITY[kind];
    expect(total).toBeLessThan(ALL_KINDS.length * MAX_SNOWFLAKE_INSTANCES * 0.3);
  });
});
