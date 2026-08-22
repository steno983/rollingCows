import { describe, expect, it } from 'vitest';
import { CONFIG } from './game/config';
import type { EntityKind } from './game/types';
import * as instancing from './render/instancing';
import { buildGeometry, MODELS } from './render/models';

/**
 * Guardie di budget grafico.
 *
 * Il gioco stampa in console «budget: <60 draw call / <150000 triangoli» e il
 * README lo promette, ma finora nessuno lo verificava: il budget era una buona
 * intenzione, non un vincolo. Questi test lo rendono un vincolo, e lo fanno
 * senza WebGL — si contano i triangoli delle geometrie e le capacità dichiarate
 * delle InstancedMesh, che sono numeri deterministici calcolabili in node.
 *
 * Le soglie sono TETTI, non misure: vanno alzate consapevolmente quando un
 * modello cresce per una buona ragione, mai per far ripassare il test.
 */

/** Un cubetto voxel, se completamente esposto, costa 12 triangoli. */
const TRIANGLES_PER_VOXEL = 12;

/**
 * Modelli che esistono in models.ts ma non sono entità di gioco: la mucca è
 * disegnata dal player-view (una sola istanza), baita/abete/fieno sono
 * scenografia con la loro capacità separata.
 */
const NON_ENTITY_MODELS: readonly string[] = ['cow', 'cabin', 'tree', 'hay'];

/** Tetto sulla somma dei triangoli di UNA istanza di ogni modello.
 *  Misurato oggi: 7816. */
const TOTAL_MODEL_TRIANGLES_MAX = 11000;

/** Tetto per singolo modello: serve a far emergere subito CHI è cresciuto.
 *  Il più caro oggi è la baita, 1748 triangoli. */
const PER_MODEL_TRIANGLES_MAX = 2400;

/**
 * Tetto sulle istanze allocate per le entità. Ogni istanza è memoria e lavoro
 * per frame anche quando `count` è basso, perché i buffer sono allocati alla
 * capacità piena. Misurato oggi: 315, dopo il passaggio a capacità per famiglia
 * (fiocco, ostacoli, buff); con lo scalare unico precedente erano 1404, ed è
 * proprio quel ritorno indietro che il tetto deve intercettare.
 */
const ENTITY_INSTANCE_CAPACITY_MAX = 600;

/** Tetto sulle istanze allocate per la scenografia (tre modelli decorativi).
 *  Misurato oggi: 126 (7 per chunk × 6 chunk × 3 modelli). */
const SCENERY_INSTANCE_CAPACITY_MAX = 200;

/** Modelli decorativi istanziati da render/scenery.ts. */
const SCENERY_KIND_COUNT = 3;

function triangleCount(kind: keyof typeof MODELS): number {
  const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
  const index = geometry.getIndex();
  if (index !== null) return index.count / 3;
  const position = geometry.getAttribute('position');
  return position === undefined ? 0 : position.count / 3;
}

const MODEL_KINDS = Object.keys(MODELS) as (keyof typeof MODELS)[];

const ENTITY_KINDS = MODEL_KINDS.filter(
  (kind) => !NON_ENTITY_MODELS.includes(kind),
) as EntityKind[];

/**
 * La capacità delle entità è passata da uno scalare unico
 * (`MAX_INSTANCES_PER_KIND`) a una capacità per famiglia (`INSTANCE_CAPACITY`),
 * e potrebbe cambiare ancora. Il test legge il modulo in modo tollerante alla
 * forma — numero, mappa o funzione — così misura il budget vero invece di
 * rompersi sulla firma. Se non riconosce nulla fallisce con un messaggio che
 * elenca cosa il modulo esporta davvero: meglio un test da aggiornare che un
 * test che passa a vuoto.
 */
const CAPACITY_EXPORTS: readonly string[] = [
  'INSTANCE_CAPACITY',
  'MAX_INSTANCES_PER_KIND',
  'maxInstancesFor',
  'capacityFor',
];

const instancingExports = instancing as unknown as Record<string, unknown>;

function entityCapacity(kind: EntityKind): number {
  for (const name of CAPACITY_EXPORTS) {
    const value = instancingExports[name];
    if (typeof value === 'number') return value;
    if (typeof value === 'function') {
      const result = (value as (k: EntityKind) => unknown)(kind);
      if (typeof result === 'number') return result;
    }
    if (value !== null && typeof value === 'object') {
      const entry = (value as Record<string, unknown>)[kind];
      if (typeof entry === 'number') return entry;
    }
  }
  throw new Error(
    `budget.test.ts non sa più leggere la capacità di '${kind}' da render/instancing.ts: ` +
      `esporta ${Object.keys(instancingExports).join(', ')}. Aggiorna entityCapacity().`,
  );
}

describe('budget dei triangoli', () => {
  it('nessun singolo modello supera il tetto per modello', () => {
    for (const kind of MODEL_KINDS) {
      const triangles = triangleCount(kind);
      expect(
        triangles,
        `il modello '${kind}' costa ${triangles} triangoli (tetto ${PER_MODEL_TRIANGLES_MAX})`,
      ).toBeLessThanOrEqual(PER_MODEL_TRIANGLES_MAX);
    }
  });

  it('la somma dei triangoli di tutti i modelli resta sotto il tetto', () => {
    const perModel = MODEL_KINDS.map((kind) => `${kind}=${triangleCount(kind)}`).join(' ');
    const total = MODEL_KINDS.reduce((sum, kind) => sum + triangleCount(kind), 0);
    expect(
      total,
      `totale ${total} triangoli (tetto ${TOTAL_MODEL_TRIANGLES_MAX}) — ${perModel}`,
    ).toBeLessThanOrEqual(TOTAL_MODEL_TRIANGLES_MAX);
  });

  it('la rimozione delle facce interne fa davvero il suo lavoro', () => {
    // Se qualcuno rompesse il greedy meshing la geometria continuerebbe a
    // funzionare, solo più cara: senza questo controllo il regresso passerebbe
    // inosservato fino al tetto complessivo.
    for (const kind of MODEL_KINDS) {
      const model = MODELS[kind];
      const naive = model.voxels.length * TRIANGLES_PER_VOXEL;
      expect(
        triangleCount(kind),
        `'${kind}' non risparmia nulla rispetto ai ${naive} triangoli dei cubetti nudi`,
      ).toBeLessThan(naive);
    }
  });
});

describe('budget delle istanze', () => {
  it('la capacità totale delle InstancedMesh delle entità resta sotto il tetto', () => {
    const perKind = ENTITY_KINDS.map((kind) => `${kind}=${entityCapacity(kind)}`).join(' ');
    const total = ENTITY_KINDS.reduce((sum, kind) => sum + entityCapacity(kind), 0);
    expect(
      total,
      `capacità totale ${total} istanze (tetto ${ENTITY_INSTANCE_CAPACITY_MAX}) — ${perKind}`,
    ).toBeLessThanOrEqual(ENTITY_INSTANCE_CAPACITY_MAX);
  });

  it('la scenografia sta dentro la capacità dichiarata', () => {
    // Stessa formula di render/scenery.ts: capacità = oggetti per chunk × chunk
    // vivi. Se qualcuno alza itemsPerChunk in config senza pensarci, la memoria
    // allocata cresce di tre InstancedMesh alla volta.
    const perKind = CONFIG.render.scenery.itemsPerChunk * CONFIG.world.chunkCount;
    const total = perKind * SCENERY_KIND_COUNT;
    expect(
      total,
      `scenografia: ${perKind} istanze × ${SCENERY_KIND_COUNT} modelli = ${total} ` +
        `(tetto ${SCENERY_INSTANCE_CAPACITY_MAX})`,
    ).toBeLessThanOrEqual(SCENERY_INSTANCE_CAPACITY_MAX);
  });

  it('ogni entità disegnata ha una capacità positiva', () => {
    // Una capacità a zero non fallisce nulla a runtime: le entità di quel tipo
    // diventano semplicemente invisibili pur restando raccoglibili o letali.
    for (const kind of ENTITY_KINDS) {
      expect(entityCapacity(kind), `capacità nulla per '${kind}'`).toBeGreaterThan(0);
    }
  });
});
