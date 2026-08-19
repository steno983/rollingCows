import * as THREE from 'three';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import type { WorldState } from '../game/world';
import { worldToViewX } from './camera-rig';
import { MODELS, buildGeometry } from './models';

/** Modelli usati solo come decorazione: non sono entità di gioco. */
export type SceneryKind = 'cabin' | 'tree' | 'hay';

export interface SceneryItem {
  kind: SceneryKind;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

const KINDS: readonly SceneryKind[] = ['tree', 'cabin', 'hay'];

/**
 * Layout deterministico per un chunk. Il seed deriva dall'id del chunk, quindi
 * un chunk riciclato ricompare sempre identico e la decorazione non "sfarfalla"
 * quando il mondo scorre.
 */
export function sceneryForChunk(chunkId: number, out: SceneryItem[]): void {
  const cfg = CONFIG.render.scenery;
  const rng = createRng(0x5ce7e * 1 + chunkId * 7919);
  out.length = 0;

  const totalWeight = cfg.weights.tree + cfg.weights.cabin + cfg.weights.hay;

  for (let i = 0; i < cfg.itemsPerChunk; i += 1) {
    let roll = rng.next() * totalWeight;
    let kind: SceneryKind = 'tree';
    for (let k = 0; k < KINDS.length; k += 1) {
      const candidate = KINDS[k];
      if (candidate === undefined) continue;
      roll -= cfg.weights[candidate];
      if (roll <= 0) {
        kind = candidate;
        break;
      }
    }

    const side = rng.chance(0.5) ? -1 : 1;
    const lateral = cfg.minLateral + rng.next() * (cfg.maxLateral - cfg.minLateral);

    out.push({
      kind,
      x: side * lateral,
      z: rng.next() * CONFIG.world.chunkLength,
      yaw: rng.next() * Math.PI * 2,
      scale: cfg.minScale + rng.next() * (cfg.maxScale - cfg.minScale),
    });
  }
}

export interface SceneryView {
  group: THREE.Group;
  sync(world: WorldState): void;
}

/**
 * Una InstancedMesh per modello decorativo, dimensionata al caso peggiore
 * (tutti gli oggetti di tutti i chunk dello stesso tipo): tre draw call in
 * totale, indipendenti da quanti oggetti sono a schermo.
 */
export function createScenery(): SceneryView {
  const cfg = CONFIG.render.scenery;
  const capacity = cfg.itemsPerChunk * CONFIG.world.chunkCount;
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const buffer: SceneryItem[] = [];

  const meshes = new Map<SceneryKind, THREE.InstancedMesh>();
  for (const kind of KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    // Stesso motivo di entities-view/terrain: il volume di bounding di
    // un'InstancedMesh non segue le istanze, che qui oltretutto vivono ben
    // fuori dalla geometria base — senza questo la scenografia sparirebbe
    // appena la camera si allontana.
    mesh.frustumCulled = false;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  const counters = new Map<SceneryKind, number>();

  function sync(world: WorldState): void {
    for (const kind of KINDS) counters.set(kind, 0);

    for (let c = 0; c < world.chunks.length; c += 1) {
      const chunk = world.chunks[c];
      if (chunk === undefined) continue;
      sceneryForChunk(chunk.id, buffer);

      for (let i = 0; i < buffer.length; i += 1) {
        const item = buffer[i];
        if (item === undefined) continue;
        const mesh = meshes.get(item.kind);
        const used = counters.get(item.kind) ?? 0;
        if (mesh === undefined || used >= capacity) continue;

        // chunk.z è il bordo del chunk più vicino al giocatore (vedi
        // game/world.ts): stessa convenzione di terrain.ts/entities-view.ts,
        // nessuna negazione di z. item.x passa da worldToViewX come ogni
        // altra X di mondo (vedi camera-rig.ts): è l'unica funzione
        // autorizzata a specchiare l'asse per questa inquadratura.
        dummy.position.set(worldToViewX(item.x), 0, chunk.z + item.z);
        dummy.rotation.set(0, item.yaw, 0);
        dummy.scale.setScalar(item.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(used, dummy.matrix);
        counters.set(item.kind, used + 1);
      }
    }

    for (const kind of KINDS) {
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;
      mesh.count = counters.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, sync };
}
