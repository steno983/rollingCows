import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../game/config';
import type { WorldState } from '../game/world';

export interface TerrainView {
  sync(world: WorldState): void;
  group: THREE.Group;
}

const SNOW_COLOR = 0xf4fbff;
const BANK_HEIGHT = 3.2;
const BANK_WIDTH = 3;
const BANK_TILT = 0.3;
const SEGMENTS_X = 12;
const SEGMENTS_Z = 24;
/** Semilarghezza del corridoio percorribile: 3 unità con la config di default. */
const CORRIDOR_HALF = (CONFIG.world.laneCount * CONFIG.world.laneWidth) / 2;
const GROUND_WIDTH = CONFIG.world.laneCount * CONFIG.world.laneWidth + 4;

function displaceGround(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const length = CONFIG.world.chunkLength;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const lateral = Math.abs(x) / CORRIDOR_HALF;
    const outside = Math.max(0, lateral - 1);
    // Periodica su chunkLength: a z = 0 e a z = chunkLength il seno vale 0,
    // quindi i bordi di due chunk adiacenti combaciano esattamente.
    const wave =
      Math.sin((z / length) * Math.PI * 2) * 0.18 +
      Math.sin((z / length) * Math.PI * 6 + x * 0.6) * 0.09;
    position.setY(i, wave * outside * 3 + outside * outside * 2.2);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createChunkGeometry(): THREE.BufferGeometry {
  const length = CONFIG.world.chunkLength;

  const ground = new THREE.PlaneGeometry(GROUND_WIDTH, length, SEGMENTS_X, SEGMENTS_Z);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, length / 2);
  displaceGround(ground);

  const leftBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  leftBank.rotateZ(BANK_TILT);
  leftBank.translate(-(GROUND_WIDTH / 2 + 0.9), BANK_HEIGHT * 0.35 - 0.5, length / 2);

  const rightBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  rightBank.rotateZ(-BANK_TILT);
  rightBank.translate(GROUND_WIDTH / 2 + 0.9, BANK_HEIGHT * 0.35 - 0.5, length / 2);

  const merged = mergeGeometries([ground, leftBank, rightBank], false);
  if (merged === null) {
    throw new Error('Impossibile unire le geometrie del chunk di terreno');
  }
  ground.dispose();
  leftBank.dispose();
  rightBank.dispose();
  merged.computeBoundingSphere();
  return merged;
}

export function createTerrain(): TerrainView {
  const geometry = createChunkGeometry();
  const material = new THREE.MeshLambertMaterial({ color: SNOW_COLOR });
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];

  for (let i = 0; i < CONFIG.world.chunkCount; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.position.z = i * CONFIG.world.chunkLength;
    meshes.push(mesh);
    group.add(mesh);
  }

  function sync(world: WorldState): void {
    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const chunk = world.chunks[i];
      if (mesh === undefined || chunk === undefined) continue;
      mesh.position.z = chunk.z;
    }
  }

  return { sync, group };
}
