import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { avalancheTrail, burstFromModel, MAX_BURST_VOXELS, resetDebris, starTrail } from './debris';
import { MODELS, PALETTE, type VoxelModel } from './models';
import { createVoxelPool } from './voxel-pool';

const BIG_POOL = 500;
const scratch = new THREE.Matrix4();

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

  // Il difetto: un burst nasce dentro il volume di un ostacolo e da lì
  // cubetto e ostacolo scorrono all'indietro alla STESSA velocità, quindi la
  // loro posizione relativa non cambia mai e il cubetto resta conficcato a
  // sporgere dalle facce. `worldSpeed` 0 in questi test è esattamente il
  // sistema di riferimento dell'ostacolo: quello che si misura qui è di
  // quanto il cubetto se ne allontana per moto proprio.
  it.each(['tree', 'rock', 'fence', 'snowflake'] as const)(
    'in tre decimi di secondo i cubetti di %s escono dal volume in cui sono nati',
    (kind) => {
      const pool = createVoxelPool(BIG_POOL, 0.25);
      burstFromModel(pool, MODELS[kind], 0, 0.8, 0, 4);
      const born = pool.mesh.count;
      expect(born).toBeGreaterThan(0);

      for (let step = 0; step < 18; step += 1) pool.update(1 / 60, 0);
      expect(pool.activeCount).toBe(born);

      let closest = Number.POSITIVE_INFINITY;
      for (let slot = 0; slot < born; slot += 1) {
        pool.mesh.getMatrixAt(slot, scratch);
        const distance = Math.hypot(
          scratch.elements[12] ?? 0,
          (scratch.elements[13] ?? 0) - 0.8,
          scratch.elements[14] ?? 0,
        );
        if (distance < closest) closest = distance;
      }
      // Mezzo metro è il semi-spessore abbondante di un ostacolo del gioco:
      // nemmeno il cubetto più lento è ancora dentro la sagoma.
      expect(closest).toBeGreaterThan(0.8);
    },
  );

  it('un secondo e mezzo dopo il burst non è rimasto vivo un solo cubetto', () => {
    const pool = createVoxelPool(BIG_POOL, 0.25);
    burstFromModel(pool, MODELS.tree, 0, 0.8, 0, 9);
    expect(pool.activeCount).toBeGreaterThan(0);

    for (let step = 0; step < 90; step += 1) pool.update(1 / 60, 24);
    expect(pool.activeCount).toBe(0);
    expect(pool.mesh.count).toBe(0);
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

describe('starTrail', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('non emette nulla a stella spenta (intensità 0)', () => {
    const pool = createVoxelPool(200, 0.25);
    for (let i = 0; i < 60; i += 1) starTrail(pool, 1 / 60, 0, 0.35, -0.5, 0);
    expect(pool.activeCount).toBe(0);
  });

  it('emette la stessa quantità a 60 e a 120 fps', () => {
    const poolA = createVoxelPool(200, 0.25);
    for (let i = 0; i < 60; i += 1) starTrail(poolA, 1 / 60, 0, 0.35, -0.5, 1);
    const atSixty = poolA.activeCount;

    resetDebris();
    const poolB = createVoxelPool(200, 0.25);
    for (let i = 0; i < 120; i += 1) starTrail(poolB, 1 / 120, 0, 0.35, -0.5, 1);

    expect(atSixty).toBeGreaterThan(0);
    expect(Math.abs(atSixty - poolB.activeCount)).toBeLessThanOrEqual(1);
  });

  it('è molto più rada della scia della valanga: è un aura di 8 secondi, non un esplosione', () => {
    const star = createVoxelPool(400, 0.25);
    for (let i = 0; i < 60; i += 1) starTrail(star, 1 / 60, 0, 0.35, -0.5, 1);

    resetDebris();
    const avalanche = createVoxelPool(400, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(avalanche, 1 / 60, 0, 0.2, -1.5, 1);

    expect(star.activeCount).toBeGreaterThan(0);
    expect(star.activeCount * 3).toBeLessThan(avalanche.activeCount);
  });

  it('i cubetti sono dorati, non di neve (rosso ben sopra il blu)', () => {
    const pool = createVoxelPool(16, 0.25);
    // Un solo secondo basta a emetterne parecchi; il primo occupa lo slot 0
    // (la free list parte in ordine decrescente, vedi voxel-pool.ts).
    for (let i = 0; i < 60; i += 1) starTrail(pool, 1 / 60, 0, 0.35, -0.5, 1);
    const colors = pool.mesh.instanceColor;
    expect(colors).not.toBeNull();
    if (colors === null) return;
    expect(colors.getX(0)).toBeGreaterThan(colors.getZ(0) + 0.3);
  });

  it('ha un accumulatore proprio: accendere la stella in valanga non le fa emettere il debito altrui', () => {
    const pool = createVoxelPool(400, 0.25);
    // Mezzo secondo di sola valanga accumula frazioni sul SUO accumulatore...
    for (let i = 0; i < 30; i += 1) avalancheTrail(pool, 1 / 60, 0, 0.2, -1.5, 1);
    const afterAvalanche = pool.activeCount;
    // ...e il primo frame di stella non deve emetterle tutte in un colpo.
    starTrail(pool, 1 / 60, 0, 0.35, -0.5, 1);
    expect(pool.activeCount - afterAvalanche).toBeLessThanOrEqual(1);
  });

  it('resetDebris azzera anche il suo accumulatore', () => {
    // Due passi da 0,09 s bastano a superare il cubetto intero (il rateo è
    // ~11/s): il secondo emette solo se il debito del primo è sopravvissuto.
    const kept = createVoxelPool(400, 0.25);
    starTrail(kept, 0.09, 0, 0.35, -0.5, 1);
    expect(kept.activeCount).toBe(0);
    starTrail(kept, 0.09, 0, 0.35, -0.5, 1);
    expect(kept.activeCount).toBe(1);

    resetDebris();
    const cleared = createVoxelPool(400, 0.25);
    starTrail(cleared, 0.09, 0, 0.35, -0.5, 1);
    resetDebris();
    starTrail(cleared, 0.09, 0, 0.35, -0.5, 1);
    expect(cleared.activeCount).toBe(0);
  });

  it('con il pool pieno si ferma senza accumulare debito infinito', () => {
    const pool = createVoxelPool(8, 0.25);
    for (let i = 0; i < 600; i += 1) starTrail(pool, 1 / 60, 0, 0.35, -0.5, 1);
    expect(pool.activeCount).toBe(8);
  });
});
