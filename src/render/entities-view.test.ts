import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import {
  createPath,
  forkApproaching,
  forkCommitted,
  forkRealigning,
  type PathNone,
  type PathState,
} from '../game/path';
import { type Entity, type EntityKind, isOverhead } from '../game/types';
import {
  CHASM_Y_BIAS,
  contactShadowSize,
  createEntitiesView,
  type EntitiesView,
  entityWorldOffsetX,
  signpostStateFor,
  type ViewKind,
} from './entities-view';
import { INSTANCE_CAPACITY } from './instancing';
import { MODELS } from './models';
import { trackCenterOffsets } from './terrain';

/** Percorso dritto, cioè lo stato in cui si passa la maggior parte del tempo.
 *  `PathState` è un'unione discriminata su `phase` (vedi game/path.ts): gli
 *  stati di bivio non si ottengono più sovrascrivendo campi su questo, ma con
 *  i costruttori `forkApproaching` / `forkCommitted` / `forkRealigning`, che
 *  chiedono esattamente i campi che quella fase possiede. */
function straight(): PathNone {
  return { ...createPath(), nextForkIn: 100 };
}

describe('entityWorldOffsetX', () => {
  it("un'entità sul ramo main resta sempre al centro", () => {
    expect(entityWorldOffsetX(straight(), { branch: 'main' })).toBe(0);
    expect(entityWorldOffsetX(straight(), { branch: 'main', z: 90 })).toBe(0);
  });

  it("un'entità di ramo sta dove sta il NASTRO su cui è appoggiata, alla sua z", () => {
    // È l'unica proprietà che conta davvero: se questa formula divergesse da
    // quella della pista (render/terrain.ts, trackCenterOffsets, che chiama la
    // stessa branchCenterAt), gli ostacoli galleggerebbero di lato rispetto
    // alla strada su cui stanno. Si verifica confrontando i due, non
    // ricopiando un numero atteso.
    const paths: readonly PathState[] = [
      forkApproaching({ forkZ: 40 }),
      forkCommitted({ forkZ: CONFIG.path.commitZ, activeBranch: 'right' }),
      forkCommitted({ forkZ: 6, activeBranch: 'right' }),
      forkRealigning({ forkZ: -10, activeBranch: 'right', realignProgress: 0.36 }),
    ];
    for (const path of paths) {
      for (const z of [0, 20, 50, 90, 150]) {
        const [leftRibbon, rightRibbon] = trackCenterOffsets(path, z);
        expect(entityWorldOffsetX(path, { branch: 'left', z })).toBe(leftRibbon);
        expect(entityWorldOffsetX(path, { branch: 'right', z })).toBe(rightRibbon);
      }
    }
  });

  it('prima della biforcazione i due rami coincidono col tronco, e si aprono dopo', () => {
    const path = forkApproaching({ forkZ: 40 });
    expect(entityWorldOffsetX(path, { branch: 'left', z: 30 })).toBe(0);
    expect(entityWorldOffsetX(path, { branch: 'left', z: 40 })).toBe(0);
    const opening = entityWorldOffsetX(path, { branch: 'left', z: 54 });
    expect(opening).toBeLessThan(0);
    expect(opening).toBeGreaterThan(-CONFIG.path.branchSeparation);
  });

  it('un ostacolo del ramo scelto arriva sulla mucca disegnato ESATTAMENTE al centro', () => {
    // La mucca è ancorata a x = 0: se l'entità che la sta per colpire fosse
    // disegnata altrove, si morirebbe per un ostacolo che sullo schermo passa
    // di lato. Vale già dalla fase impegnata, dove il ramo scelto scivola al
    // centro, e per tutto il riallineamento.
    for (let step = 0; step <= 10; step++) {
      const committed = forkCommitted({
        forkZ: CONFIG.path.commitZ * (1 - step / 10),
        activeBranch: 'right',
      });
      // Alla quota della mucca l'apertura è nulla finché la biforcazione non è
      // superata, quindi il ramo coincide col tronco: 0 esatto.
      expect(entityWorldOffsetX(committed, { branch: 'right', z: 0 })).toBe(0);

      const realigning = forkRealigning({
        forkZ: -(step / 10) * CONFIG.path.forkBlendZ,
        activeBranch: 'right',
        realignProgress: step / 10,
      });
      expect(entityWorldOffsetX(realigning, { branch: 'right', z: 0 })).toBe(0);
    }
  });

  it('a bivio chiuso il ramo scelto, ora tronco, coincide col centro', () => {
    const path = straight();
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
const ENTITY_ORDER: readonly ViewKind[] = [
  'rock',
  'log',
  'fence',
  'crevasse',
  'chasm',
  'signpost',
  'branch',
  'arch',
  'cornice',
  'snowflake',
  'crystal',
  'star',
  'magnet',
  'bell',
];

function meshFor(view: EntitiesView, kind: ViewKind): THREE.InstancedMesh {
  const child = view.group.children[ENTITY_ORDER.indexOf(kind)];
  if (!(child instanceof THREE.InstancedMesh)) throw new Error(`nessuna mesh per ${kind}`);
  return child;
}

/** Le ombre di contatto dei sospesi: una sola InstancedMesh, in coda a
 *  quelle dei tipi (vedi createEntitiesView). */
function shadowMesh(view: EntitiesView): THREE.InstancedMesh {
  const child = view.group.children[ENTITY_ORDER.length];
  if (!(child instanceof THREE.InstancedMesh)) throw new Error('nessuna mesh di ombre');
  return child;
}

/** Traslazione (x, y, z) dell'istanza `index`. */
function positionOf(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3(
    matrix.elements[12] ?? 0,
    matrix.elements[13] ?? 0,
    matrix.elements[14] ?? 0,
  );
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

describe('createEntitiesView — ombre di contatto dei sospesi', () => {
  const overheadY = CONFIG.spawn.overheadY;

  it("ogni sospeso ha un'ombra a terra ESATTAMENTE sotto di sé", () => {
    // È l'informazione che il giocatore legge: l'ombra sta alla stessa (x, z)
    // dell'ostacolo ma a terra, e lo scarto verticale fra le due è la quota.
    const view = createEntitiesView();
    view.sync([entity('cornice', { y: overheadY, z: 42 })], straight(), 1 / 60);

    const shadows = shadowMesh(view);
    expect(shadows.count).toBe(1);
    const obstacle = positionOf(meshFor(view, 'cornice'), 0);
    const shadow = positionOf(shadows, 0);
    expect(shadow.x).toBeCloseTo(obstacle.x, 6);
    expect(shadow.z).toBeCloseTo(obstacle.z, 6);
    expect(shadow.y).toBeGreaterThan(0);
    expect(shadow.y).toBeLessThan(0.1);
    expect(obstacle.y - shadow.y).toBeGreaterThan(1);
  });

  it("segue l'ostacolo di lato durante un bivio, invece di restare al centro", () => {
    // Se l'ombra non passasse dalla stessa entityWorldOffsetX dell'ostacolo,
    // durante un bivio direbbe la quota di qualcosa che sta da un'altra parte.
    const view = createEntitiesView();
    const path = forkCommitted({ forkZ: CONFIG.path.commitZ, activeBranch: 'right' });
    view.sync([entity('arch', { y: overheadY, z: 80, branch: 'left' })], path, 1 / 60);

    const obstacle = positionOf(meshFor(view, 'arch'), 0);
    const shadow = positionOf(shadowMesh(view), 0);
    expect(Math.abs(obstacle.x)).toBeGreaterThan(1);
    expect(shadow.x).toBeCloseTo(obstacle.x, 6);
  });

  it('la riceve UN sospeso su tre tipi e nessun altro: è quello il segno', () => {
    // Se la prendessero anche gli ostacoli a terra smetterebbe di distinguere
    // alcunché, che è tutto il suo scopo.
    for (const kind of ENTITY_ORDER) {
      const view = createEntitiesView();
      view.sync([entity(kind, { y: isOverhead(kind) ? overheadY : 0 })], straight(), 1 / 60);
      expect(shadowMesh(view).count, `ombra di contatto per '${kind}'`).toBe(
        isOverhead(kind) ? 1 : 0,
      );
    }
  });

  it('costa UNA sola draw call per tutti e tre i tipi di sospeso', () => {
    const view = createEntitiesView();
    expect(view.group.children).toHaveLength(ENTITY_ORDER.length + 1);

    view.sync(
      [
        entity('branch', { y: overheadY }),
        entity('arch', { y: overheadY }),
        entity('cornice', { y: overheadY }),
        entity('branch', { y: overheadY }),
      ],
      straight(),
      1 / 60,
    );
    expect(shadowMesh(view).count).toBe(4);
  });

  it('sparisce di scena quando non c e nessun sospeso, non resta a count 0', () => {
    const view = createEntitiesView();
    const shadows = shadowMesh(view);
    expect(shadows.visible).toBe(false);

    view.sync([entity('branch', { y: overheadY })], straight(), 1 / 60);
    expect(shadows.visible).toBe(true);

    view.sync([entity('rock')], straight(), 1 / 60);
    expect(shadows.visible).toBe(false);
  });

  it("è larga quanto l'ostacolo che la getta, non un disco uguale per tutti", () => {
    const view = createEntitiesView();
    view.sync(
      [entity('branch', { y: overheadY }), entity('arch', { y: overheadY, z: 40 })],
      straight(),
      1 / 60,
    );
    const shadows = shadowMesh(view);
    const first = new THREE.Matrix4();
    const second = new THREE.Matrix4();
    shadows.getMatrixAt(0, first);
    shadows.getMatrixAt(1, second);
    const branchWidth = first.elements[0] ?? 0;
    const archWidth = second.elements[0] ?? 0;
    expect(archWidth).toBeGreaterThan(branchWidth);
  });

  it("non è mai più stretta del minimo, e altrimenti allarga l'ingombro", () => {
    // Il ramo è profondo mezza unità: senza il minimo la sua ombra sarebbe un
    // trattino, cioè nessun contatto.
    expect(contactShadowSize(0.5)).toBeGreaterThan(1);
    expect(contactShadowSize(4)).toBeGreaterThan(4);
    expect(contactShadowSize(4)).toBeLessThan(4 * 2);
  });
});

describe('crepaccio: affondato, non appoggiato', () => {
  const cell = CONFIG.render.voxelSize * (MODELS.chasm.cellScale ?? 1);

  it('il fondo scuro finisce a filo della neve e il bordo resta sopra', () => {
    // Il modello ha lo strato di fondo spesso una cella: appoggiato sulla neve
    // sarebbe una piattaforma scura, non un buco (vedi buildChasm).
    expect(CHASM_Y_BIAS).toBeLessThan(0);
    // faccia superiore del fondo: appena sopra la neve, mai sotto
    expect(CHASM_Y_BIAS + cell).toBeGreaterThan(0);
    expect(CHASM_Y_BIAS + cell).toBeLessThan(0.05);
  });

  it('la vista lo disegna affondato, e nessun altro ostacolo a terra lo è', () => {
    const view = createEntitiesView();
    view.sync([entity('chasm', { z: 30 }), entity('rock', { z: 30 })], straight(), 1 / 60);
    expect(positionOf(meshFor(view, 'chasm'), 0).y).toBeCloseTo(CHASM_Y_BIAS, 6);
    expect(positionOf(meshFor(view, 'rock'), 0).y).toBeCloseTo(0, 6);
  });

  it('nessuna ombra di contatto: non è sospeso, è un buco', () => {
    const view = createEntitiesView();
    view.sync([entity('chasm'), entity('signpost')], straight(), 1 / 60);
    expect(shadowMesh(view).count).toBe(0);
  });
});

describe('signpostStateFor', () => {
  it('senza bivio non c e nessuna scelta da mostrare', () => {
    expect(signpostStateFor(straight())).toBe('none');
  });

  it("in avvicinamento mostra la scelta solo quando c'è", () => {
    expect(signpostStateFor(forkApproaching({ forkZ: 40 }))).toBe('none');
    expect(signpostStateFor(forkApproaching({ forkZ: 40, choice: 'left' }))).toBe('left');
    expect(signpostStateFor(forkApproaching({ forkZ: 40, choice: 'right' }))).toBe('right');
  });

  it('dopo il punto di non ritorno continua a mostrarla, mentre sfila accanto', () => {
    // È lì che serve di più: la mucca sta ancora andando verso la
    // biforcazione e il cartello è l'unica conferma di dove finirà.
    expect(
      signpostStateFor(forkCommitted({ forkZ: CONFIG.path.commitZ, activeBranch: 'right' })),
    ).toBe('right');
    expect(
      signpostStateFor(forkRealigning({ forkZ: -8, activeBranch: 'left', realignProgress: 0.4 })),
    ).toBe('left');
  });
});

describe('createEntitiesView — il cartello mostra la scelta', () => {
  function colorsOf(view: EntitiesView): THREE.BufferAttribute | THREE.InterleavedBufferAttribute {
    return meshFor(view, 'signpost').geometry.getAttribute('color');
  }

  it('cambia i colori quando cambia la scelta, senza toccare la geometria', () => {
    const view = createEntitiesView();
    const sign = [entity('signpost', { z: 30 })];
    const positions = meshFor(view, 'signpost').geometry.getAttribute('position');

    view.sync(sign, forkApproaching({ forkZ: 40 }), 1 / 60);
    const neutral = colorsOf(view);

    view.sync(sign, forkApproaching({ forkZ: 40, choice: 'left' }), 1 / 60);
    const chosen = colorsOf(view);
    expect(chosen).not.toBe(neutral);
    // Stessa geometria: è ciò che rende il cambio di stato gratuito e che
    // evita un salto di sagoma nel frame in cui la freccia si accende.
    expect(meshFor(view, 'signpost').geometry.getAttribute('position')).toBe(positions);
    expect(chosen.count).toBe(neutral.count);

    view.sync(sign, forkApproaching({ forkZ: 40, choice: 'right' }), 1 / 60);
    expect(colorsOf(view)).not.toBe(chosen);

    // e tornando allo stato neutro si rimonta lo STESSO attributo di prima:
    // i tre buffer restano tre, non se ne creano a ogni bivio.
    view.sync(sign, straight(), 1 / 60);
    expect(colorsOf(view)).toBe(neutral);
  });

  it('non rimonta nulla se la scelta non cambia', () => {
    // Il confronto per frame deve costare un confronto, non un caricamento di
    // buffer: qui si verifica proprio che l'attributo resti lo stesso oggetto.
    const view = createEntitiesView();
    const path = forkApproaching({ forkZ: 40, choice: 'left' });
    view.sync([entity('signpost')], path, 1 / 60);
    const first = colorsOf(view);
    for (let i = 0; i < 5; i += 1) view.sync([entity('signpost')], path, 1 / 60);
    expect(colorsOf(view)).toBe(first);
  });

  it('resta UNA sola mesh e una sola draw call per tutti e tre gli stati', () => {
    const view = createEntitiesView();
    expect(view.group.children).toHaveLength(ENTITY_ORDER.length + 1);
    view.sync([entity('signpost')], forkApproaching({ forkZ: 40, choice: 'left' }), 1 / 60);
    expect(meshFor(view, 'signpost').count).toBe(1);
  });
});
