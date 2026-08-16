import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { entityCenterX } from '../game/lanes';
import type { Entity, EntityKind } from '../game/types';
import { worldToViewX } from './camera-rig';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';
import { MODELS, buildGeometry } from './models';

export interface EntitiesView {
  sync(entities: Entity[]): void;
  group: THREE.Group;
}

const ENTITY_KINDS: readonly EntityKind[] = [
  'rock', 'tree', 'fence', 'cabin', 'crevasse', 'branch', 'snowflake', 'hay', 'cow',
];

/** Quante corsie è largo il MODELLO di ogni tipo (la baita è disegnata a due). */
const MODEL_LANES: Record<EntityKind, 1 | 2> = {
  rock: 1, tree: 1, fence: 1, cabin: 2, crevasse: 1, branch: 1,
  snowflake: 1, hay: 1, cow: 1,
};

/** La mucca-raccoglibile è la stessa della giocante, disegnata più piccola. */
const PICKUP_COW_SCALE = 0.55;
/** Il crepaccio è complanare alla neve: un pelo sopra per non sfarfallare. */
const CREVASSE_Y_BIAS = 0.02;
/** Tipi che proiettano ombra: le lastre piatte non ne hanno bisogno. */
const CASTS_SHADOW: Record<EntityKind, boolean> = {
  rock: true, tree: true, fence: true, cabin: true, crevasse: false, branch: true,
  snowflake: false, hay: true, cow: true,
};

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
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

  function sync(entities: Entity[]): void {
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
        if (entity === undefined || !entity.alive || entity.kind !== kind) continue;

        const baseScale = entity.width / MODEL_LANES[kind];
        const scale = kind === 'cow' ? baseScale * PICKUP_COW_SCALE : baseScale;
        const yBias = kind === 'crevasse' ? CREVASSE_Y_BIAS : 0;

        let yaw = 0;
        if (entity.category === 'pickup') yaw = time * 2.2;
        else if (kind === 'rock' || kind === 'tree') yaw = (entity.id % 4) * (Math.PI / 2);

        dummy.position.set(
          worldToViewX(entityCenterX(entity.lane, entity.width)),
          entity.y + yBias,
          entity.z,
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(scale);
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
