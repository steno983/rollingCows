import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import { branchSpawnStartZ, createSpawner } from './spawner';
import { resolveDifficultyProfile } from './speed';
import type { Entity, ObstacleKind } from './types';
import { isOverhead } from './types';

/** Distanza minima superabile per questo ostacolo. `maxSpeed` è un parametro
 *  perché il profilo di difficoltà lo scala: l'invariante non è "30 unità", è
 *  "il tempo dell'azione, alla velocità di punta di QUESTO profilo". */
function requiredGap(kind: ObstacleKind, maxSpeed: number = CONFIG.world.maxSpeed): number {
  const seconds = isOverhead(kind) ? CONFIG.player.slideSeconds : CONFIG.player.jumpSeconds;
  return seconds * maxSpeed;
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

  it('il campanaccio resta il premio del ramo ricco, ma non è più impossibile fuori', () => {
    // Prima il campanaccio aveva peso ZERO fra i buff comuni, il che
    // significava che chi non sceglie mai ai bivi non vedeva MAI uno scudo:
    // l'unico buff che cambia davvero una corsa era irraggiungibile per
    // un'intera categoria di giocatori. Ora ha peso 1 (design §7 lo vuole
    // comunque "raro" e tipico del ramo difficile), quindi il test misura il
    // RAPPORTO invece dell'assenza.
    let richBells = 0;
    let poorBells = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const poorOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 0.5, 'main', false, poorOut);
      poorBells += poorOut.filter((entity) => entity.kind === 'bell').length;

      const richOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 0.5, 'left', true, richOut);
      richBells += richOut.filter((entity) => entity.kind === 'bell').length;
    }
    expect(poorBells).toBeGreaterThan(0);
    expect(richBells).toBeGreaterThan(poorBells);
  });

  it('estrae prima o poi OGNI tipo di ostacolo e OGNI tipo di buff', () => {
    // Complemento a runtime della verifica di esaustività fatta dal
    // compilatore sugli elenchi (vedi il `satisfies` in spawner.ts): un tipo
    // dichiarato ma mai estratto è un contenuto che nessuno vedrà mai.
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 0.5, 'left', true, out, 0.5);
      for (const entity of out) kinds.add(entity.kind);
    }
    for (const kind of [
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
    ]) {
      expect(kinds.has(kind), `mai estratto: ${kind}`).toBe(true);
    }
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
  it('INVARIANTE DI GIOCABILITÀ ATTRAVERSO I CONFINI DI SEGMENTO: chunk contigui popolati uno alla volta, con il mondo che scorre in mezzo', () => {
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

/** Distanze fra ostacoli consecutivi, nell'ordine in cui il giocatore le incontra. */
function gapsOf(obstacles: readonly (Entity & { kind: ObstacleKind })[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < obstacles.length; i++) {
    const previous = obstacles[i - 1];
    const current = obstacles[i];
    if (previous === undefined || current === undefined) throw new Error('ostacolo mancante');
    gaps.push(current.z - previous.z);
  }
  return gaps;
}

/** Quota di ostacoli sospesi su un campione di segmenti. */
function overheadShareOf(rich: boolean, branch: 'main' | 'left', lateProgress: number): number {
  let overhead = 0;
  let total = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const out: Entity[] = [];
    createSpawner(createRng(seed)).populateSegment(0, 3000, 1, branch, rich, out, lateProgress);
    for (const obstacle of obstaclesByZ(out)) {
      total += 1;
      if (isOverhead(obstacle.kind)) overhead += 1;
    }
  }
  expect(total).toBeGreaterThan(500);
  return overhead / total;
}

describe('varianza della spaziatura', () => {
  it('a difficoltà PIENA il passo continua a variare, invece di collassare su un unico valore', () => {
    // Senza il pavimento alla varianza, il termine che decresce con la
    // difficoltà arrivava esattamente al passo minimo: l'intervallo di
    // estrazione collassava e il gap diventava DETERMINISTICO — stesso
    // identico valore, per sempre, su entrambi i rami. Dagli 84 secondi in poi
    // non c'era più un ritmo da leggere, solo un pattern da eseguire.
    const out: Entity[] = [];
    createSpawner(createRng(77)).populateSegment(0, 6000, 1, 'main', false, out);
    const gaps = gapsOf(obstaclesByZ(out));
    expect(gaps.length).toBeGreaterThan(50);

    const distinct = new Set(gaps.map((gap) => gap.toFixed(3)));
    expect(distinct.size).toBeGreaterThan(gaps.length / 2);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(1);
  });
});

describe('i due rami di un bivio non convergono', () => {
  it('a difficoltà PIENA il ramo sgombro resta più rado del ramo ricco, senza eccezioni', () => {
    // La differenza di spaziatura svaniva con la difficoltà: a difficoltà
    // piena entrambi finivano allo stesso gap, quindi il ramo ricco (4×
    // fiocchi, 2,2× buff, unico che può contenere il campanaccio) diventava
    // strettamente dominante e la scelta di firma del gioco una formalità.
    for (let seed = 1; seed <= 30; seed++) {
      const richOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 1, 'left', true, richOut);
      const clearOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 1, 'right', false, clearOut);

      const richGaps = gapsOf(obstaclesByZ(richOut));
      const clearGaps = gapsOf(obstaclesByZ(clearOut));
      expect(Math.min(...clearGaps)).toBeGreaterThan(Math.max(...richGaps));
      expect(Math.min(...clearGaps)).toBeGreaterThanOrEqual(
        CONFIG.spawn.minObstacleGap * CONFIG.spawn.clearBranchGapRatio,
      );
    }
  });

  it('il pavimento più alto è del RAMO sgombro, non del tronco', () => {
    // `rich === false` vale anche per il tronco, che il gioco popola fuori dai
    // bivi: applicargli il pavimento del ramo sgombro sarebbe uno sconto
    // generale sulla difficoltà, non la contropartita di una scelta.
    const out: Entity[] = [];
    createSpawner(createRng(9)).populateSegment(0, 4000, 1, 'main', false, out);
    const gaps = gapsOf(obstaclesByZ(out));
    const clearFloor = CONFIG.spawn.minObstacleGap * CONFIG.spawn.clearBranchGapRatio;
    expect(Math.max(...gaps)).toBeLessThan(clearFloor);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(CONFIG.spawn.minObstacleGap);
  });
});

describe('rampa tardiva', () => {
  it('alza la quota di ostacoli sospesi oltre lateRampStart', () => {
    const early = overheadShareOf(false, 'main', 0);
    const late = overheadShareOf(false, 'main', 1);
    expect(early).toBeCloseTo(CONFIG.spawn.overheadShare, 1);
    expect(late).toBeGreaterThan(early + 0.05);
    expect(late).toBeCloseTo(CONFIG.spawn.overheadShareLate, 1);
  });

  it('il ramo ricco chiede già la scivolata più spesso, anche prima della rampa', () => {
    // I due rami non si distinguono solo per QUANTO chiedono ma per QUALE
    // abilità chiedono.
    const trunk = overheadShareOf(false, 'main', 0);
    const rich = overheadShareOf(true, 'left', 0);
    expect(rich).toBeGreaterThan(trunk + 0.05);
  });

  it('fa nascere COPPIE STRETTE, mai sotto il limite di traversabilità e mai due di fila', () => {
    let tightPairs = 0;
    let pairs = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 1, 'main', false, out, 1);
      const obstacles = obstaclesByZ(out);
      let previousWasTight = false;
      for (let i = 1; i < obstacles.length; i++) {
        const previous = obstacles[i - 1];
        const current = obstacles[i];
        if (previous === undefined || current === undefined) throw new Error('ostacolo mancante');
        const gap = current.z - previous.z;
        const limit = requiredGap(previous.kind);
        // L'INVARIANTE regge anche qui: la coppia stretta sta esattamente AL
        // limite, non sotto. È tutta la differenza fra una manovra da imparare
        // e una morte impossibile da evitare.
        expect(gap).toBeGreaterThanOrEqual(limit);
        const tight = gap < limit * 1.001;
        if (tight) {
          tightPairs += 1;
          expect(previousWasTight, 'due coppie strette di fila sarebbero un muro').toBe(false);
        }
        previousWasTight = tight;
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    expect(tightPairs).toBeGreaterThan(50);
  });

  it('senza rampa tardiva non esiste nessuna coppia stretta', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 1, 'main', false, out);
      for (const gap of gapsOf(obstaclesByZ(out))) {
        expect(gap).toBeGreaterThanOrEqual(CONFIG.spawn.minObstacleGap);
      }
    }
  });

  it('il ramo sgombro non riceve coppie strette nemmeno a rampa piena', () => {
    // Lì il respiro in più è la contropartita promessa a chi rinuncia al
    // bottino: una coppia stretta la cancellerebbe.
    const floor = CONFIG.spawn.minObstacleGap * CONFIG.spawn.clearBranchGapRatio;
    for (let seed = 1; seed <= 30; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 4000, 1, 'right', false, out, 1);
      for (const gap of gapsOf(obstaclesByZ(out))) {
        expect(gap).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});

describe('profili di difficoltà', () => {
  it('ogni profilo rispetta la PROPRIA invariante di traversabilità, anche a rampa piena', () => {
    for (const name of ['calf', 'normal', 'bull']) {
      const profile = resolveDifficultyProfile(name);
      for (let seed = 1; seed <= 30; seed++) {
        for (const rich of [true, false]) {
          const out: Entity[] = [];
          createSpawner(createRng(seed), profile).populateSegment(0, 3000, 1, 'main', rich, out, 1);
          const obstacles = obstaclesByZ(out);
          for (let i = 1; i < obstacles.length; i++) {
            const previous = obstacles[i - 1];
            const current = obstacles[i];
            if (previous === undefined || current === undefined) {
              throw new Error('ostacolo mancante');
            }
            expect(current.z - previous.z).toBeGreaterThanOrEqual(
              requiredGap(previous.kind, profile.maxSpeed),
            );
          }
        }
      }
    }
  });

  it('"Vitellino" dà davvero più spazio di "Normale", e "Toro" meno', () => {
    // È la ragione per cui i profili esistono: con la spaziatura normale una
    // bambina piccola arriva a una decina di secondi, ogni volta.
    const gapsFor = (name: string): number[] => {
      const out: Entity[] = [];
      createSpawner(createRng(123), resolveDifficultyProfile(name)).populateSegment(
        0,
        4000,
        1,
        'main',
        false,
        out,
      );
      return gapsOf(obstaclesByZ(out));
    };
    const calf = gapsFor('calf');
    const normal = gapsFor('normal');
    const bull = gapsFor('bull');

    expect(Math.min(...calf)).toBeGreaterThan(Math.min(...normal));
    expect(Math.min(...bull)).toBeLessThan(Math.min(...normal));
    // Meno spazio significa più ostacoli sulla stessa distanza.
    expect(bull.length).toBeGreaterThan(calf.length);
  });

  it('senza profilo esplicito si gioca esattamente come con "Normale"', () => {
    const withDefault: Entity[] = [];
    createSpawner(createRng(404)).populateSegment(0, 2000, 0.7, 'main', false, withDefault);
    const withNormal: Entity[] = [];
    createSpawner(createRng(404), resolveDifficultyProfile('normal')).populateSegment(
      0,
      2000,
      0.7,
      'main',
      false,
      withNormal,
    );
    expect(withDefault).toEqual(withNormal);
  });
});

describe('zona franca dopo la biforcazione', () => {
  it('branchSpawnStartZ arretra l-inizio dei rami di branchClearanceAfterFork', () => {
    expect(branchSpawnStartZ(200)).toBe(200 + CONFIG.path.branchClearanceAfterFork);
  });

  it('nessuna entità di un ramo nasce nel tratto in cui il mondo non ha ancora traslato', () => {
    // Il ramo scelto diventa solido al punto di non ritorno, ma la traslazione
    // laterale parte solo alla biforcazione e dura realignSeconds: un ostacolo
    // nato lì uccide mentre è disegnato fino a 6 unità fuori da un corridoio
    // largo 4. Era il 3,43% degli ostacoli letali.
    for (let seed = 1; seed <= 40; seed++) {
      const spawner = createSpawner(createRng(seed));
      const trunk: Entity[] = [];
      spawner.populateSegment(0, 200, 1, 'main', false, trunk);

      const forkZ = 200;
      const startZ = branchSpawnStartZ(forkZ);
      spawner.copyCursor('main', 'left', startZ);
      const branch: Entity[] = [];
      spawner.populateSegment(startZ, 300, 1, 'left', true, branch);

      expect(branch.length).toBeGreaterThan(0);
      for (const entity of branch) {
        expect(entity.z).toBeGreaterThanOrEqual(startZ);
      }
      // ...e il primo ostacolo del ramo resta superabile rispetto all'ultimo
      // del tronco: la zona franca allarga il passo, non lo accorcia.
      const last = obstaclesByZ(trunk)[obstaclesByZ(trunk).length - 1];
      const first = obstaclesByZ(branch)[0];
      if (last === undefined || first === undefined) throw new Error('ostacolo mancante');
      expect(first.z - last.z).toBeGreaterThanOrEqual(requiredGap(last.kind));
    }
  });
});

describe('primo ostacolo del tutorial', () => {
  it('con firstObstacleZ il primissimo ostacolo nasce oltre quella z', () => {
    // Senza, il primo ostacolo cade fra 37 e 48 unità, cioè ~2,3 s dopo
    // l'avvio: chi non ha mai giocato deve reagire prima di aver finito di
    // leggere il prompt.
    const floor = CONFIG.tutorial.firstObstacleZ;
    for (let seed = 1; seed <= 40; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed), undefined, { firstObstacleZ: floor }).populateSegment(
        0,
        400,
        0,
        'main',
        false,
        out,
      );
      const obstacles = obstaclesByZ(out);
      const first = obstacles[0];
      if (first === undefined) throw new Error('nessun ostacolo generato');
      expect(first.z).toBeGreaterThanOrEqual(floor);
    }
  });

  it('vale SOLO per il primo: dal secondo in poi la spaziatura è quella normale', () => {
    const floor = CONFIG.tutorial.firstObstacleZ;
    for (let seed = 1; seed <= 40; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed), undefined, { firstObstacleZ: floor }).populateSegment(
        0,
        400,
        0,
        'main',
        false,
        out,
      );
      const gaps = gapsOf(obstaclesByZ(out));
      expect(gaps.length).toBeGreaterThan(3);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThanOrEqual(CONFIG.spawn.minObstacleGap);
        expect(gap).toBeLessThanOrEqual(CONFIG.spawn.maxObstacleGap);
      }
    }
  });

  it('regge anche quando i chunk sono popolati uno alla volta, come fa startRun', () => {
    // Il pavimento deve sopravvivere alle chiamate che non emettono nulla:
    // i primi chunk finiscono tutti PRIMA di firstObstacleZ.
    const floor = CONFIG.tutorial.firstObstacleZ;
    const spawner = createSpawner(createRng(5), undefined, { firstObstacleZ: floor });
    const out: Entity[] = [];
    for (let i = 0; i < CONFIG.world.chunkCount; i++) {
      spawner.populateSegment(
        i * CONFIG.world.chunkLength,
        CONFIG.world.chunkLength,
        0,
        'main',
        false,
        out,
      );
    }
    const first = obstaclesByZ(out)[0];
    if (first === undefined) throw new Error('nessun ostacolo generato');
    expect(first.z).toBeGreaterThanOrEqual(floor);
  });

  it('senza l-opzione il risultato è identico a prima, bit per bit', () => {
    const plain: Entity[] = [];
    createSpawner(createRng(909)).populateSegment(0, 2000, 0.4, 'main', false, plain);
    const empty: Entity[] = [];
    createSpawner(createRng(909), undefined, {}).populateSegment(
      0,
      2000,
      0.4,
      'main',
      false,
      empty,
    );
    expect(empty).toEqual(plain);
  });

  it('reset riarma il pavimento: la corsa successiva ricomincia col tutorial', () => {
    const floor = CONFIG.tutorial.firstObstacleZ;
    const spawner = createSpawner(createRng(3), undefined, { firstObstacleZ: floor });
    const first: Entity[] = [];
    spawner.populateSegment(0, 400, 0, 'main', false, first);

    spawner.reset();
    const second: Entity[] = [];
    spawner.populateSegment(0, 400, 0, 'main', false, second);
    const firstOfSecond = obstaclesByZ(second)[0];
    if (firstOfSecond === undefined) throw new Error('nessun ostacolo dopo il reset');
    expect(firstOfSecond.z).toBeGreaterThanOrEqual(floor);
  });
});
