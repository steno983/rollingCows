import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { branchOffsetX, type PathState } from '../game/path';
import type { Entity, EntityKind } from '../game/types';
import { worldToViewX } from './camera-rig';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';
import { MODELS, buildGeometry } from './models';

export interface EntitiesView {
  sync(entities: Entity[], path: PathState): void;
  group: THREE.Group;
}

/**
 * Un'InstancedMesh per ogni EntityKind di v2. `cabin`, `tree`, `hay` e `cow`
 * NON sono più entità di gioco: restano modelli disponibili in models.ts,
 * questa vista non li istanzia.
 */
const ENTITY_KINDS: readonly EntityKind[] = [
  'rock', 'log', 'fence', 'crevasse', 'branch', 'arch', 'cornice',
  'snowflake', 'crystal', 'star', 'magnet', 'bell',
];

/** Il crepaccio è complanare alla neve: un pelo sopra per non sfarfallare. */
const CREVASSE_Y_BIAS = 0.02;

/** Tipi che proiettano ombra: gli ostacoli sì; i raccoglibili — piccoli e
 *  spesso numerosi in fila — no, per risparmiare draw call di shadow map
 *  senza perdita percepibile. */
const CASTS_SHADOW: Record<EntityKind, boolean> = {
  rock: true,
  log: true,
  fence: true,
  crevasse: false,
  branch: true,
  arch: true,
  cornice: true,
  snowflake: false,
  crystal: false,
  star: false,
  magnet: false,
  bell: false,
};

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
}

/**
 * Scostamento laterale di MONDO (non ancora convertito in coordinate vista)
 * a cui va disegnata un'entità: dipende solo dal suo ramo e dallo stato
 * corrente del percorso. Logica pura, testabile senza three — la
 * conversione in X di schermo resta a worldToViewX, chiamata solo in sync.
 */
export function entityWorldOffsetX(path: PathState, entity: Pick<Entity, 'branch'>): number {
  return branchOffsetX(path, entity.branch) + path.offsetX;
}

export function createEntitiesView(): EntitiesView {
  const group = new THREE.Group();
  // Un solo materiale per tutte le entità: i colori arrivano dai vertici,
  // quindi non c'è alcun motivo di cambiare stato fra un tipo e l'altro.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = new Map<EntityKind, THREE.InstancedMesh>();
  const dummy = new THREE.Object3D();

  for (const kind of ENTITY_KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES_PER_KIND);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Il bounding volume di un InstancedMesh non segue le istanze: senza
    // questo, gli ostacoli sparirebbero appena la geometria base esce dal frustum.
    mesh.frustumCulled = false;
    mesh.castShadow = CASTS_SHADOW[kind];
    mesh.receiveShadow = false;
    mesh.count = 0;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  function sync(entities: Entity[], path: PathState): void {
    const time = nowSeconds();

    for (let k = 0; k < ENTITY_KINDS.length; k++) {
      const kind = ENTITY_KINDS[k];
      if (kind === undefined) continue;
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;

      const count = instanceCountFor(entities, kind, MAX_INSTANCES_PER_KIND);
      let index = 0;

      for (let e = 0; e < entities.length; e++) {
        if (index >= count) break;
        const entity = entities[e];
        // Le entità di un ramo non (ancora) attivo si disegnano comunque: è
        // il senso del bivio, mostrare cosa contiene ciascun ramo prima
        // della scelta. Il filtro per solidità (branchIsSolid) appartiene
        // alle collisioni/raccolta, non a questa vista.
        if (entity === undefined || !entity.alive || entity.kind !== kind) continue;

        const yBias = kind === 'crevasse' ? CREVASSE_Y_BIAS : 0;

        let yaw = 0;
        if (entity.category === 'pickup') yaw = time * 2.2;
        else if (kind === 'rock') yaw = (entity.id % 4) * (Math.PI / 2);

        dummy.position.set(
          worldToViewX(entityWorldOffsetX(path, entity)),
          entity.y + yBias,
          entity.z,
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        index += 1;
      }

      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { sync, group };
}
