import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { createVoxelPool, type VoxelPool } from './voxel-pool';

const WHITE = 0xffffff;
const scratch = new THREE.Matrix4();

function slotY(pool: VoxelPool, slot: number): number {
  pool.mesh.getMatrixAt(slot, scratch);
  return scratch.elements[13] ?? 0;
}

function fill(pool: VoxelPool, life: number): number {
  let spawned = 0;
  while (pool.spawn(0, 1, 0, 0, 0, 0, WHITE, life)) spawned += 1;
  return spawned;
}

describe('createVoxelPool — free list', () => {
  let pool: VoxelPool;

  beforeEach(() => {
    pool = createVoxelPool(64, 0.25);
  });

  it('parte vuoto e con la capacità richiesta', () => {
    expect(pool.capacity).toBe(64);
    expect(pool.activeCount).toBe(0);
  });

  it('dopo 1000 cicli di spawn e morte activeCount torna esattamente a 0', () => {
    for (let cycle = 0; cycle < 1000; cycle += 1) {
      const spawned = fill(pool, 0.05);
      expect(spawned).toBe(64);
      expect(pool.activeCount).toBe(64);
      for (let step = 0; step < 10; step += 1) pool.update(1 / 60, 20);
      expect(pool.activeCount).toBe(0);
    }
    // nessuno slot perso: il pool si riempie ancora tutto
    expect(fill(pool, 1)).toBe(64);
  });

  it('spawn oltre la capacità restituisce false senza corrompere lo stato', () => {
    expect(fill(pool, 1)).toBe(64);
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 1)).toBe(false);
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 1)).toBe(false);
    expect(pool.activeCount).toBe(64);
    for (let step = 0; step < 200; step += 1) pool.update(1 / 60, 20);
    expect(pool.activeCount).toBe(0);
    expect(fill(pool, 1)).toBe(64);
  });

  it('ignora gli spawn con vita non positiva senza consumare slot', () => {
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 0)).toBe(false);
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, -1)).toBe(false);
    expect(pool.activeCount).toBe(0);
    expect(fill(pool, 1)).toBe(64);
  });

  it('reset libera tutto e rende di nuovo disponibili tutti gli slot', () => {
    fill(pool, 10);
    expect(pool.activeCount).toBe(64);
    pool.reset();
    expect(pool.activeCount).toBe(0);
    expect(pool.mesh.count).toBe(0);
    expect(fill(pool, 10)).toBe(64);
  });
});

describe('createVoxelPool — fisica dei cubetti', () => {
  it('un cubetto lanciato verso l alto ricade e rimbalza più basso', () => {
    const pool = createVoxelPool(8, 0.25);
    expect(pool.spawn(0, 0, 0, 0, 12, 0, WHITE, 5)).toBe(true);

    let firstPeak = 0;
    let landed = false;
    for (let step = 0; step < 200 && !landed; step += 1) {
      pool.update(1 / 60, 0);
      const y = slotY(pool, 0);
      if (y > firstPeak) firstPeak = y;
      if (firstPeak > 0.5 && y <= 0) landed = true;
    }
    expect(landed).toBe(true);
    expect(firstPeak).toBeGreaterThan(1);

    let secondPeak = 0;
    for (let step = 0; step < 200; step += 1) {
      pool.update(1 / 60, 0);
      const y = slotY(pool, 0);
      if (y > secondPeak) secondPeak = y;
    }
    expect(secondPeak).toBeGreaterThan(0);
    expect(secondPeak).toBeLessThan(firstPeak * 0.3);
  });

  it('il mondo che scorre trascina indietro i cubetti', () => {
    const pool = createVoxelPool(8, 0.25);
    pool.spawn(0, 0, 0, 0, 0, 0, WHITE, 5);
    for (let step = 0; step < 60; step += 1) pool.update(1 / 60, 20);
    pool.mesh.getMatrixAt(0, scratch);
    expect(scratch.elements[14] ?? 0).toBeLessThan(-15);
  });

  it('gli slot morti sono nascosti con scala 0', () => {
    const pool = createVoxelPool(8, 0.25);
    pool.spawn(0, 5, 0, 0, 0, 0, WHITE, 0.05);
    for (let step = 0; step < 10; step += 1) pool.update(1 / 60, 0);
    pool.mesh.getMatrixAt(0, scratch);
    expect(scratch.elements[0]).toBe(0);
    expect(scratch.elements[5]).toBe(0);
    expect(scratch.elements[10]).toBe(0);
  });
});

describe('createVoxelPool — zero allocazioni', () => {
  it('gli array interni restano gli stessi dopo migliaia di spawn', () => {
    const pool = createVoxelPool(32, 0.25);
    const matrixAttribute = pool.mesh.instanceMatrix;
    const matrixArray = pool.mesh.instanceMatrix.array;
    const colorAttribute = pool.mesh.instanceColor;
    const colorArray = colorAttribute?.array;
    expect(colorArray).toBeDefined();

    for (let cycle = 0; cycle < 200; cycle += 1) {
      while (pool.spawn(0, 1, 0, 1, 2, 3, WHITE, 0.05)) {
        /* riempie il pool */
      }
      for (let step = 0; step < 10; step += 1) pool.update(1 / 60, 20);
    }

    expect(pool.mesh.instanceMatrix).toBe(matrixAttribute);
    expect(pool.mesh.instanceMatrix.array).toBe(matrixArray);
    expect(pool.mesh.instanceColor).toBe(colorAttribute);
    expect(pool.mesh.instanceColor?.array).toBe(colorArray);
    expect(pool.activeCount).toBe(0);
  });
});

describe('createVoxelPool — banda verso la GPU', () => {
  it('a pool vuoto update non tocca affatto il buffer delle matrici', () => {
    const pool = createVoxelPool(4000, 0.25);
    const attribute = pool.mesh.instanceMatrix;
    const version = attribute.version;

    for (let step = 0; step < 120; step += 1) pool.update(1 / 60, 30);

    // Prima: 4000 × 16 float × 4 byte = 256 KB caricati a ogni frame anche
    // senza un solo detrito vivo.
    expect(attribute.version).toBe(version);
    expect(attribute.updateRanges).toHaveLength(0);
  });

  it('l upload copre la sola regione viva, non tutta la capacità', () => {
    const pool = createVoxelPool(4000, 0.25);
    for (let i = 0; i < 3; i += 1) pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 1);
    pool.mesh.instanceMatrix.clearUpdateRanges();

    pool.update(1 / 60, 0);

    const ranges = pool.mesh.instanceMatrix.updateRanges;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.start).toBe(0);
    expect(ranges[0]?.count).toBe(3 * 16);
  });

  it('l ultimo frame di un detrito carica anche la sua matrice nulla, poi si ferma', () => {
    const pool = createVoxelPool(4000, 0.25);
    // Vita più corta di un passo: muore esattamente in questo update.
    pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 0.01);
    pool.update(1 / 60, 0);
    expect(pool.activeCount).toBe(0);

    const attribute = pool.mesh.instanceMatrix;
    // La release ha scritto la matrice nulla: quel frame l'upload ci vuole.
    expect(attribute.updateRanges.at(-1)?.count).toBe(16);
    const version = attribute.version;
    attribute.clearUpdateRanges();

    for (let step = 0; step < 60; step += 1) pool.update(1 / 60, 0);
    expect(attribute.version).toBe(version);
    expect(attribute.updateRanges).toHaveLength(0);
  });

  it('uno slot riusato dopo essere stato liberato resta dentro la regione caricata', () => {
    const pool = createVoxelPool(64, 0.25);
    // Riempie e svuota: la free list è LIFO, quindi la prossima spawn può
    // riprendere uno slot alto liberato poco fa.
    expect(fill(pool, 0.01)).toBe(64);
    pool.update(1 / 60, 0);
    expect(pool.activeCount).toBe(0);

    pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 1);
    pool.mesh.instanceMatrix.clearUpdateRanges();
    pool.update(1 / 60, 0);

    const ranges = pool.mesh.instanceMatrix.updateRanges;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.count).toBe(pool.mesh.count * 16);
    expect(pool.mesh.count).toBeGreaterThan(0);
  });

  it('reset azzera il conteggio e riparte da una regione vuota', () => {
    const pool = createVoxelPool(64, 0.25);
    fill(pool, 5);
    pool.update(1 / 60, 0);
    pool.reset();

    expect(pool.mesh.count).toBe(0);
    expect(pool.mesh.instanceMatrix.updateRanges).toHaveLength(0);

    const version = pool.mesh.instanceMatrix.version;
    pool.update(1 / 60, 0);
    expect(pool.mesh.instanceMatrix.version).toBe(version);
  });
});
