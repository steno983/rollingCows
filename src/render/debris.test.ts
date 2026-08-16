import { beforeEach, describe, expect, it } from 'vitest';
import { MODELS, PALETTE, type VoxelModel } from './models';
import { MAX_BURST_VOXELS, avalancheTrail, burstFromModel, resetDebris } from './debris';
import { createVoxelPool } from './voxel-pool';

const BIG_POOL = 500;

function model(voxelCount: number): VoxelModel {
  const voxels: number[][] = [];
  for (let i = 0; i < voxelCount; i += 1) voxels.push([i % 5, (i % 3) + 1, i % 4, i % 3]);
  return { voxels, palette: PALETTE };
}

describe('burstFromModel', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('genera un cubetto per ogni voxel dei modelli piccoli', () => {
    const pool = createVoxelPool(64, 0.25);
    burstFromModel(pool, model(10), 0, 1, 0, 8);
    expect(pool.activeCount).toBe(10);
  });

  it('campiona i modelli grandi per non svuotare il pool', () => {
    const pool = createVoxelPool(1000, 0.25);
    const big = model(500);
    burstFromModel(pool, big, 0, 1, 0, 8);
    const step = Math.ceil(500 / MAX_BURST_VOXELS);
    expect(pool.activeCount).toBe(Math.ceil(500 / step));
    expect(pool.activeCount).toBeLessThanOrEqual(MAX_BURST_VOXELS);
  });

  it('con un pool pieno non esplode e non corrompe nulla', () => {
    const pool = createVoxelPool(5, 0.25);
    burstFromModel(pool, model(40), 0, 1, 0, 8);
    expect(pool.activeCount).toBe(5);
    expect(pool.spawn(0, 0, 0, 0, 0, 0, 0xffffff, 1)).toBe(false);
  });

  it('un modello vuoto non fa nulla', () => {
    const pool = createVoxelPool(16, 0.25);
    burstFromModel(pool, { voxels: [], palette: PALETTE }, 0, 1, 0, 8);
    expect(pool.activeCount).toBe(0);
  });

  it('funziona con i modelli veri del gioco', () => {
    const pool = createVoxelPool(BIG_POOL, 0.25);
    burstFromModel(pool, MODELS.tree, 0, 0.5, 12, 9);
    expect(pool.activeCount).toBeGreaterThan(0);
    expect(pool.activeCount).toBeLessThanOrEqual(MAX_BURST_VOXELS);
  });
});

describe('avalancheTrail', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('con intensità 0 non emette nulla', () => {
    const pool = createVoxelPool(200, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(pool, 1 / 60, 0, 0.2, -1.5, 0);
    expect(pool.activeCount).toBe(0);
  });

  it('emette la stessa quantità a 60 e a 120 fps', () => {
    const poolA = createVoxelPool(200, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(poolA, 1 / 60, 0, 0.2, -1.5, 1);
    const atSixty = poolA.activeCount;

    resetDebris();
    const poolB = createVoxelPool(200, 0.25);
    for (let i = 0; i < 120; i += 1) avalancheTrail(poolB, 1 / 120, 0, 0.2, -1.5, 1);
    const atOneTwenty = poolB.activeCount;

    expect(atSixty).toBeGreaterThan(0);
    expect(Math.abs(atSixty - atOneTwenty)).toBeLessThanOrEqual(1);
  });

  it('emette di più al crescere dell intensità', () => {
    const weak = createVoxelPool(400, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(weak, 1 / 60, 0, 0.2, -1.5, 0.2);
    const weakCount = weak.activeCount;

    resetDebris();
    const strong = createVoxelPool(400, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(strong, 1 / 60, 0, 0.2, -1.5, 1);

    expect(strong.activeCount).toBeGreaterThan(weakCount);
  });

  it('con il pool pieno si ferma senza accumulare debito infinito', () => {
    const pool = createVoxelPool(8, 0.25);
    for (let i = 0; i < 600; i += 1) avalancheTrail(pool, 1 / 60, 0, 0.2, -1.5, 1);
    expect(pool.activeCount).toBe(8);
  });
});
