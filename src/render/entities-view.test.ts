import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPath, forkApproaching, forkCommitted, type PathNone } from '../game/path';
import type { Entity, EntityKind } from '../game/types';
import { createEntitiesView, type EntitiesView, entityWorldOffsetX } from './entities-view';
import { INSTANCE_CAPACITY } from './instancing';

/** Percorso dritto, cioè lo stato in cui si passa la maggior parte del tempo.
 *  `PathState` è un'unione discriminata su `phase` (vedi game/path.ts): gli
 *  stati di bivio non si ottengono più sovrascrivendo campi su questo, ma con
 *  i costruttori `forkApproaching` / `forkCommitted` / `forkRealigning`, che
 *  chiedono esattamente i campi che quella fase possiede. */
function straight(offsetX = 0): PathNone {
  return { ...createPath(), nextForkIn: 100, offsetX };
}

describe('entityWorldOffsetX', () => {
  it("un'entità sul ramo main resta sempre a offset 0, qualunque offsetX", () => {
    expect(entityWorldOffsetX(straight(), { branch: 'main' })).toBe(0);
    expect(entityWorldOffsetX(straight(-3.2), { branch: 'main' })).toBeCloseTo(-3.2, 6);
  });

  it("un'entità sul ramo sinistro sta a -branchSeparation quando offsetX è 0", () => {
    const path = forkApproaching({ forkZ: 40 });
    const x = entityWorldOffsetX(path, { branch: 'left' });
    expect(x).toBeCloseTo(-CONFIG.path.branchSeparation, 6);
  });

  it("un'entità sul ramo destro sta a +branchSeparation quando offsetX è 0", () => {
    const path = forkApproaching({ forkZ: 40 });
    const x = entityWorldOffsetX(path, { branch: 'right' });
    expect(x).toBeCloseTo(CONFIG.path.branchSeparation, 6);
  });

  it("durante il riallineamento l'offsetX del percorso si somma alla posizione del ramo", () => {
    const path = forkCommitted({ forkZ: 5, activeBranch: 'right', offsetX: -4 });
    const x = entityWorldOffsetX(path, { branch: 'right' });
    expect(x).toBeCloseTo(CONFIG.path.branchSeparation - 4, 6);
  });

  it('a riallineamento concluso (offsetX tornato a 0) il ramo scelto coincide col centro', () => {
    // A bivio chiuso lo stato è di nuovo un percorso dritto: 'activeBranch'
    // non esiste proprio, invece di valere 'main' come segnaposto.
    const path = straight(0);
    expect(entityWorldOffsetX(path, { branch: 'main' })).toBe(0);
  });
});

let nextId = 1;
const PICKUP_KINDS: readonly EntityKind[] = ['snowflake', 'crystal', 'star', 'magnet', 'bell'];

function entity(kind: EntityKind, overrides: Partial<Entity> = {}): Entity {
  return {
    id: nextId++,
    kind,
    category: PICKUP_KINDS.includes(kind) ? 'pickup' : 'obstacle',
    branch: 'main',
    z: 20,
    y: 0,
    alive: true,
    ...overrides,
  };
}

/** Stesso ordine di ENTITY_KINDS in entities-view.ts: la vista aggiunge le
 *  mesh al gruppo in quell'ordine e non espone la mappa. */
const ENTITY_ORDER: readonly EntityKind[] = [
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

function meshFor(view: EntitiesView, kind: EntityKind): THREE.InstancedMesh {
  const child = view.group.children[ENTITY_ORDER.indexOf(kind)];
  if (!(child instanceof THREE.InstancedMesh)) throw new Error(`nessuna mesh per ${kind}`);
  return child;
}

/** Angolo attorno a y letto dalla matrice. Non via Euler: la decomposizione
 *  XYZ ripiega gli angoli oltre 90° e qui la rotazione accumulata li supera. */
function yawOf(mesh: THREE.InstancedMesh, index: number): number {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return Math.atan2(matrix.elements[8] ?? 0, matrix.elements[0] ?? 1);
}

describe('createEntitiesView — sync', () => {
  it('smista le entità per tipo in una sola passata', () => {
    const view = createEntitiesView();
    view.sync(
      [entity('rock'), entity('snowflake'), entity('rock'), entity('bell')],
      straight(),
      1 / 60,
    );

    expect(meshFor(view, 'rock').count).toBe(2);
    expect(meshFor(view, 'snowflake').count).toBe(1);
    expect(meshFor(view, 'bell').count).toBe(1);
    expect(meshFor(view, 'log').count).toBe(0);
  });

  it('ignora le entità morte e riparte da zero a ogni frame', () => {
    const view = createEntitiesView();
    view.sync([entity('rock'), entity('rock'), entity('rock')], straight(), 1 / 60);
    expect(meshFor(view, 'rock').count).toBe(3);

    view.sync([entity('rock'), entity('rock', { alive: false })], straight(), 1 / 60);
    expect(meshFor(view, 'rock').count).toBe(1);
  });

  it('una mesh senza istanze viene tolta di scena, non solo lasciata a count 0', () => {
    const view = createEntitiesView();
    const rocks = meshFor(view, 'rock');
    expect(rocks.visible).toBe(false);

    view.sync([entity('rock')], straight(), 1 / 60);
    expect(rocks.visible).toBe(true);

    view.sync([], straight(), 1 / 60);
    expect(rocks.visible).toBe(false);
  });

  it('non supera mai la capienza del tipo, e le eccedenti non muoiono', () => {
    const view = createEntitiesView();
    const entities: Entity[] = [];
    for (let i = 0; i < INSTANCE_CAPACITY.rock + 20; i += 1) entities.push(entity('rock'));

    view.sync(entities, straight(), 1 / 60);

    expect(meshFor(view, 'rock').count).toBe(INSTANCE_CAPACITY.rock);
    for (const item of entities) expect(item.alive).toBe(true);
  });

  it('carica solo la regione scritta, e solo per i tipi che hanno istanze', () => {
    const view = createEntitiesView();
    const rocks = meshFor(view, 'rock');
    const logs = meshFor(view, 'log');
    rocks.instanceMatrix.clearUpdateRanges();
    logs.instanceMatrix.clearUpdateRanges();
    const logsVersion = logs.instanceMatrix.version;

    view.sync([entity('rock'), entity('rock')], straight(), 1 / 60);

    expect(rocks.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 2 * 16 }]);
    expect(logs.instanceMatrix.updateRanges).toHaveLength(0);
    expect(logs.instanceMatrix.version).toBe(logsVersion);
  });

  it('i raccoglibili girano col tempo di GIOCO, non con l orologio da parete', () => {
    // Il difetto: con performance.now() i fiocchi giravano a velocità piena
    // durante il rallentatore della morte e continuavano a girare in pausa.
    const view = createEntitiesView();
    const flakes = [entity('snowflake')];

    view.sync(flakes, straight(), 0.5);
    const spun = yawOf(meshFor(view, 'snowflake'), 0);
    expect(spun).not.toBeCloseTo(0, 6);

    // dt zero (pausa): la rotazione non avanza di un radiante.
    view.sync(flakes, straight(), 0);
    expect(yawOf(meshFor(view, 'snowflake'), 0)).toBeCloseTo(spun, 6);

    // dt dimezzato (rallentatore): avanza della metà.
    view.sync(flakes, straight(), 0.25);
    const slowed = yawOf(meshFor(view, 'snowflake'), 0) - spun;
    expect(slowed).toBeCloseTo(spun / 2, 6);
  });

  it('disegna ogni entità alla z che ha in quel momento (la calamita trascina)', () => {
    const view = createEntitiesView();
    const flake = entity('snowflake', { z: 30 });
    const matrix = new THREE.Matrix4();

    view.sync([flake], straight(), 1 / 60);
    meshFor(view, 'snowflake').getMatrixAt(0, matrix);
    expect(matrix.elements[14]).toBeCloseTo(30, 6);

    flake.z = 12;
    view.sync([flake], straight(), 1 / 60);
    meshFor(view, 'snowflake').getMatrixAt(0, matrix);
    expect(matrix.elements[14]).toBeCloseTo(12, 6);
  });
});
