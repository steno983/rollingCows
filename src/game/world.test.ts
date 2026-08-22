import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { speedAt } from './speed';
import type { Chunk } from './world';
import { createWorld, updateWorld } from './world';

const { chunkCount, chunkLength, despawnBehindZ } = CONFIG.world;

function sortedByZ(chunks: Chunk[]): Chunk[] {
  return [...chunks].sort((a, b) => a.z - b.z);
}

describe('createWorld', () => {
  it('crea chunkCount chunk a z crescente con passo chunkLength', () => {
    const world = createWorld();
    expect(world.chunks).toHaveLength(chunkCount);
    for (let i = 0; i < world.chunks.length; i++) {
      const chunk = world.chunks[i];
      expect(chunk).toBeDefined();
      if (!chunk) continue;
      expect(chunk.z).toBe(i * chunkLength);
    }
  });

  it('non lascia buchi tra chunk adiacenti', () => {
    const sorted = sortedByZ(createWorld().chunks);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (!previous || !current) throw new Error('chunk mancante');
      expect(current.z - previous.z).toBe(chunkLength);
    }
  });

  it('parte da distanza 0, velocità iniziale e nessun riciclo', () => {
    const world = createWorld();
    expect(world.distance).toBe(0);
    expect(world.speed).toBe(speedAt(0));
    expect(world.recycled).toHaveLength(0);
  });

  it('assegna id univoci ai chunk', () => {
    const ids = new Set(createWorld().chunks.map((chunk) => chunk.id));
    expect(ids.size).toBe(chunkCount);
  });
});

describe('updateWorld', () => {
  it('avanza distance di speed * dt', () => {
    const world = createWorld();
    const dt = 1 / 60;
    const expected = speedAt(0) * dt;
    updateWorld(world, dt);
    expect(world.distance).toBeCloseTo(expected, 10);
    expect(world.speed).toBe(speedAt(0));
  });

  it('fa arretrare i chunk di speed * dt', () => {
    const world = createWorld();
    const dt = 1 / 60;
    const delta = speedAt(0) * dt;
    updateWorld(world, dt);
    for (let i = 0; i < world.chunks.length; i++) {
      const chunk = world.chunks[i];
      if (!chunk) throw new Error('chunk mancante');
      expect(chunk.z).toBeCloseTo(i * chunkLength - delta, 10);
    }
  });

  it('ricicla in coda il chunk uscito oltre despawnBehindZ', () => {
    const world = createWorld();
    // Un solo passo lungo abbastanza da spingere il primo chunk dietro la soglia.
    const dt = (chunkLength - despawnBehindZ + 1) / speedAt(0);
    updateWorld(world, dt);

    expect(world.recycled).toHaveLength(1);
    const recycled = world.recycled[0];
    if (!recycled) throw new Error('nessun chunk riciclato');
    expect(recycled.id).toBe(0);

    let maxOther = -Infinity;
    for (const chunk of world.chunks) {
      if (chunk.id === recycled.id) continue;
      if (chunk.z > maxOther) maxOther = chunk.z;
    }
    expect(recycled.z).toBeCloseTo(maxOther + chunkLength, 10);
  });

  it('svuota recycled all-inizio di ogni frame invece di accumulare', () => {
    const world = createWorld();
    const dt = (chunkLength - despawnBehindZ + 1) / speedAt(0);
    updateWorld(world, dt);
    expect(world.recycled.length).toBeGreaterThan(0);

    // Passo cortissimo: nessun chunk esce, quindi recycled deve tornare vuoto.
    updateWorld(world, 1 / 600);
    expect(world.recycled).toHaveLength(0);
  });

  it('riusa sempre lo stesso array recycled (nessuna allocazione)', () => {
    const world = createWorld();
    const reference = world.recycled;
    for (let i = 0; i < 100; i++) updateWorld(world, 1 / 60);
    expect(world.recycled).toBe(reference);
  });

  it('mantiene i chunk contigui e in numero costante dopo 60 secondi simulati', () => {
    const world = createWorld();
    const dt = 1 / 60;
    for (let step = 0; step < 60 * 60; step++) {
      updateWorld(world, dt);
      expect(world.chunks).toHaveLength(chunkCount);
      const sorted = sortedByZ(world.chunks);
      for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (!previous || !current) throw new Error('chunk mancante');
        expect(Math.abs(current.z - previous.z - chunkLength)).toBeLessThan(1e-6);
      }
    }
    expect(world.distance).toBeGreaterThan(CONFIG.world.startSpeed * 59);
  });

  it('aggiorna la velocità seguendo la curva speedAt', () => {
    const world = createWorld();
    for (let step = 0; step < 600; step++) updateWorld(world, 1 / 60);
    expect(world.speed).toBeGreaterThan(CONFIG.world.startSpeed);
    expect(world.speed).toBeLessThanOrEqual(CONFIG.world.maxSpeed);
  });
});
