import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import { createSpawner } from './spawner';
import { isOverhead } from './types';
import type { Entity, ObstacleKind } from './types';

function requiredGap(kind: ObstacleKind): number {
  const seconds = isOverhead(kind) ? CONFIG.player.slideSeconds : CONFIG.player.jumpSeconds;
  return seconds * CONFIG.world.maxSpeed;
}

function isUnimodal(ys: readonly number[]): boolean {
  let rising = true;
  let previous = ys[0] ?? 0;
  for (const y of ys.slice(1)) {
    if (rising) {
      if (y < previous) rising = false;
    } else if (y > previous) {
      return false;
    }
    previous = y;
  }
  return true;
}

/** Le file ad arco sono l'UNICA fonte di fiocchi con y > 0 (le file basse e
 *  dritte stanno tutte a y = 0): raggrupparli per contiguità in z basta a
 *  ricostruire ogni singola fila ad arco dall'output piatto dello spawner. */
function groupArcTrails(entities: Entity[]): number[][] {
  const flakes = entities
    .filter((entity) => entity.kind === 'snowflake' && entity.y > 0)
    .sort((a, b) => a.z - b.z);
  const groups: number[][] = [];
  let current: number[] = [];
  let lastZ: number | null = null;
  for (const flake of flakes) {
    if (lastZ !== null && flake.z - lastZ > CONFIG.spawn.trailSpacing + 0.01) {
      groups.push(current);
      current = [];
    }
    current.push(flake.y);
    lastZ = flake.z;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

describe('populateSegment', () => {
  it('posiziona le entità dentro l-intervallo [startZ, startZ + length)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const spawner = createSpawner(createRng(seed));
      const out: Entity[] = [];
      const startZ = 300;
      const length = 500;
      spawner.populateSegment(startZ, length, 1, 'main', true, out);
      for (const entity of out) {
        expect(entity.z).toBeGreaterThanOrEqual(startZ);
        expect(entity.z).toBeLessThan(startZ + length);
      }
    }
  });

  it('assegna a ogni entità il ramo richiesto', () => {
    const spawner = createSpawner(createRng(21));
    const out: Entity[] = [];
    spawner.populateSegment(0, 800, 0.5, 'left', true, out);
    for (const entity of out) {
      expect(entity.branch).toBe('left');
    }
  });

  it('assegna id univoci e strettamente crescenti', () => {
    const spawner = createSpawner(createRng(99));
    const out: Entity[] = [];
    spawner.populateSegment(0, 2000, 1, 'main', true, out);
    expect(out.length).toBeGreaterThan(10);
    for (let i = 1; i < out.length; i++) {
      const previous = out[i - 1];
      const current = out[i];
      if (!previous || !current) throw new Error('entità mancante');
      expect(current.id).toBeGreaterThan(previous.id);
    }
  });

  it('è deterministico a parità di seed', () => {
    const a: Entity[] = [];
    createSpawner(createRng(555)).populateSegment(0, 1000, 0.5, 'right', true, a);
    const b: Entity[] = [];
    createSpawner(createRng(555)).populateSegment(0, 1000, 0.5, 'right', true, b);
    expect(a).toEqual(b);
  });

  it('marca tutte le entità come vive e coerenti nella categoria', () => {
    const out: Entity[] = [];
    createSpawner(createRng(31337)).populateSegment(0, 1500, 1, 'main', true, out);
    const buffKinds = new Set(['crystal', 'star', 'magnet', 'bell']);
    for (const entity of out) {
      expect(entity.alive).toBe(true);
      const isPickup = entity.kind === 'snowflake' || buffKinds.has(entity.kind);
      expect(entity.category).toBe(isPickup ? 'pickup' : 'obstacle');
    }
  });

  it('il ramo sgombro genera meno entità e nessun buff rispetto al ramo ricco, a parità di seed', () => {
    let richBuffs = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const richOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 0.5, 'left', true, richOut);
      const poorOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 0.5, 'right', false, poorOut);

      expect(poorOut.length).toBeLessThan(richOut.length);
      const poorHasBuff = poorOut.some(
        (entity) => entity.category === 'pickup' && entity.kind !== 'snowflake',
      );
      expect(poorHasBuff).toBe(false);
      richBuffs += richOut.filter(
        (entity) => entity.category === 'pickup' && entity.kind !== 'snowflake',
      ).length;
    }
    expect(richBuffs).toBeGreaterThan(0);
  });

  it('le file ad arco hanno y crescente e poi decrescente, con apice a trailArcHeight', () => {
    let arcsChecked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 2000, 0.5, 'main', true, out);
      for (const group of groupArcTrails(out)) {
        if (group.length < 3) continue;
        arcsChecked++;
        expect(isUnimodal(group)).toBe(true);
        const peak = Math.max(...group);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(CONFIG.spawn.trailArcHeight + 1e-9);
      }
    }
    expect(arcsChecked).toBeGreaterThan(50);
  });

  it('i fiocchi della fila bassa stanno sotto l-ostacolo sospeso a cui sono associati', () => {
    const { trailMax, trailSpacing } = CONFIG.spawn;
    const halfSpan = ((trailMax - 1) * trailSpacing) / 2 + 0.5;
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 2000, 0.5, 'main', true, out);
      const overheadObstacles = out.filter(
        (entity) => entity.category === 'obstacle' && isOverhead(entity.kind),
      );
      for (const obstacle of overheadObstacles) {
        const nearby = out.filter(
          (entity) =>
            entity.kind === 'snowflake' &&
            entity.y === 0 &&
            Math.abs(entity.z - obstacle.z) <= halfSpan,
        );
        if (nearby.length === 0) continue;
        checked++;
        for (const flake of nearby) {
          expect(flake.y).toBeLessThan(obstacle.y);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('INVARIANTE DI GIOCABILITÀ: nessuna coppia di ostacoli consecutivi dista meno del minimo superabile alla velocità massima (300 seed x 2 rami x rich/sgombro)', () => {
    let pairsChecked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const rich of [true, false]) {
        const out: Entity[] = [];
        createSpawner(createRng(seed)).populateSegment(0, 5000, 1, 'main', rich, out);
        const obstacles = out
          .filter((entity) => entity.category === 'obstacle')
          .sort((a, b) => a.z - b.z);
        for (let i = 1; i < obstacles.length; i++) {
          const previous = obstacles[i - 1];
          const current = obstacles[i];
          if (!previous || !current) throw new Error('ostacolo mancante');
          const gap = current.z - previous.z;
          const minGap = requiredGap(previous.kind as ObstacleKind);
          expect(gap).toBeGreaterThanOrEqual(minGap);
          pairsChecked++;
        }
      }
    }
    expect(pairsChecked).toBeGreaterThan(1000);
  });
});

describe('reset', () => {
  it('riporta il contatore degli id a zero', () => {
    const spawner = createSpawner(createRng(8));
    const first: Entity[] = [];
    spawner.populateSegment(0, 1000, 1, 'main', true, first);
    expect(first.length).toBeGreaterThan(0);

    spawner.reset();
    const second: Entity[] = [];
    spawner.populateSegment(0, 1000, 1, 'main', true, second);
    const firstEntity = second[0];
    if (!firstEntity) throw new Error('nessuna entità generata dopo il reset');
    expect(firstEntity.id).toBe(0);
  });
});
