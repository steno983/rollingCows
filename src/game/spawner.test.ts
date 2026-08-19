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

function countBuffs(entities: readonly Entity[]): number {
  return entities.filter((entity) => entity.category === 'pickup' && entity.kind !== 'snowflake')
    .length;
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

  it('il ramo sgombro genera meno entità e meno buff del ramo ricco, a parità di seed', () => {
    let richBuffs = 0;
    let poorBuffs = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const richOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 0.5, 'left', true, richOut);
      const poorOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 0.5, 'right', false, poorOut);

      expect(poorOut.length).toBeLessThan(richOut.length);
      richBuffs += countBuffs(richOut);
      poorBuffs += countBuffs(poorOut);
    }
    // I buff comuni nascono ovunque (design §7: il cristallo sta "a terra sul
    // tracciato"), ma il ramo ricco resta nettamente più generoso: è quello il
    // premio della scelta, non l'esistenza stessa dei buff.
    expect(poorBuffs).toBeGreaterThan(0);
    expect(richBuffs).toBeGreaterThan(poorBuffs * 1.5);
  });

  it('il campanaccio nasce SOLO sul ramo ricco di un bivio', () => {
    // Design §7: rarità "raro", posizione tipica "ramo difficile di un bivio".
    let richBells = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const poorOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 0.5, 'main', false, poorOut);
      expect(poorOut.some((entity) => entity.kind === 'bell')).toBe(false);

      const richOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 0.5, 'left', true, richOut);
      richBells += richOut.filter((entity) => entity.kind === 'bell').length;
    }
    expect(richBells).toBeGreaterThan(0);
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

/** Ostacoli di `out` ordinati per z, con il controllo di esistenza che
 *  noUncheckedIndexedAccess impone. */
function obstaclesByZ(out: readonly Entity[]): (Entity & { kind: ObstacleKind })[] {
  return out
    .filter((entity): entity is Entity & { kind: ObstacleKind } => entity.category === 'obstacle')
    .sort((a, b) => a.z - b.z);
}

function expectGapsTraversable(obstacles: readonly (Entity & { kind: ObstacleKind })[]): number {
  let pairs = 0;
  for (let i = 1; i < obstacles.length; i++) {
    const previous = obstacles[i - 1];
    const current = obstacles[i];
    if (previous === undefined || current === undefined) throw new Error('ostacolo mancante');
    expect(current.z - previous.z).toBeGreaterThanOrEqual(requiredGap(previous.kind));
    pairs += 1;
  }
  return pairs;
}

describe('cursore che sopravvive fra le chiamate', () => {
  it("INVARIANTE DI GIOCABILITÀ ATTRAVERSO I CONFINI DI SEGMENTO: chunk contigui popolati uno alla volta, con il mondo che scorre in mezzo", () => {
    // Riproduce il modo in cui il gioco chiama DAVVERO lo spawner: un chunk
    // alla volta, sempre allo stesso bordo relativo, con il mondo che scorre
    // di un chunk fra una chiamata e l'altra. Interrogarlo invece con un unico
    // segmento da 5000 unità (l'unica configurazione che il gioco non usa mai)
    // rende il test cieco proprio al caso che rompe la giocabilità.
    const CHUNK = CONFIG.world.chunkLength;
    const RECYCLE_Z = 200;
    let pairsChecked = 0;

    for (let seed = 1; seed <= 50; seed++) {
      const spawner = createSpawner(createRng(seed));
      const out: Entity[] = [];
      for (let step = 0; step < 30; step++) {
        const before = out.length;
        spawner.populateSegment(RECYCLE_Z, CHUNK, 1, 'main', false, out);
        // Riporta in coordinate assolute ciò che è appena nato, così l'intero
        // percorso si legge come lo attraversa il giocatore.
        for (let i = before; i < out.length; i++) {
          const entity = out[i];
          if (entity === undefined) continue;
          entity.z += step * CHUNK;
        }
        spawner.advance(CHUNK);
      }
      pairsChecked += expectGapsTraversable(obstaclesByZ(out));
    }

    expect(pairsChecked).toBeGreaterThan(500);
  });

  it('copyCursor fa ripartire un ramo da dove si è fermato il tronco', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const spawner = createSpawner(createRng(seed));
      const trunk: Entity[] = [];
      spawner.populateSegment(0, 200, 1, 'main', false, trunk);

      const forkZ = 200;
      spawner.copyCursor('main', 'left', forkZ);
      const branch: Entity[] = [];
      spawner.populateSegment(forkZ, 200, 1, 'left', true, branch);

      const trunkObstacles = obstaclesByZ(trunk);
      const branchObstacles = obstaclesByZ(branch);
      const last = trunkObstacles[trunkObstacles.length - 1];
      const first = branchObstacles[0];
      if (last === undefined || first === undefined) throw new Error('ostacolo mancante');
      expect(first.z - last.z).toBeGreaterThanOrEqual(requiredGap(last.kind));
    }
  });

  it('copyCursor non fa mai arretrare il ramo prima di minZ', () => {
    const spawner = createSpawner(createRng(1));
    const trunk: Entity[] = [];
    spawner.populateSegment(0, 40, 1, 'main', false, trunk);
    // Il cursore del tronco è fermo poco oltre 40; il ramo nasce a 500.
    spawner.copyCursor('main', 'right', 500);
    const branch: Entity[] = [];
    spawner.populateSegment(500, 100, 1, 'right', false, branch);
    for (const entity of branch) {
      expect(entity.z).toBeGreaterThanOrEqual(500);
    }
  });

  it('un segmento di lunghezza nulla non sposta il cursore', () => {
    const spawner = createSpawner(createRng(4));
    const first: Entity[] = [];
    spawner.populateSegment(0, 100, 1, 'main', false, first);
    const cursorProbe: Entity[] = [];
    spawner.populateSegment(100, 0, 1, 'main', false, cursorProbe);
    expect(cursorProbe).toHaveLength(0);

    const second: Entity[] = [];
    spawner.populateSegment(100, 100, 1, 'main', false, second);
    const all = obstaclesByZ([...first, ...second]);
    expectGapsTraversable(all);
  });
});

describe('reset', () => {
  it('riporta i cursori dei rami allo stato iniziale', () => {
    const spawner = createSpawner(createRng(12));
    const first: Entity[] = [];
    spawner.populateSegment(0, 400, 1, 'main', false, first);

    spawner.reset();
    const second: Entity[] = [];
    spawner.populateSegment(0, 400, 1, 'main', false, second);

    // Senza il reset dei cursori il secondo segmento ripartirebbe da dove si
    // era fermato il primo, cioè da oltre 400: vuoto. (Il contenuto non è
    // identico al primo: reset non riavvolge l'rng, che è del chiamante.)
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    const firstObstacle = obstaclesByZ(second)[0];
    if (firstObstacle === undefined) throw new Error('nessun ostacolo dopo il reset');
    expect(firstObstacle.z).toBe(0);
  });

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
