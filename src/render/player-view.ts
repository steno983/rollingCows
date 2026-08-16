import * as THREE from 'three';
import { CONFIG } from '../game/config';
import type { PlayerState } from '../game/player';
import { worldToViewX } from './camera-rig';
import { MODELS, buildGeometry } from './models';

export interface PlayerView {
  sync(player: PlayerState, size: number, speed: number, dt: number): void;
  group: THREE.Group;
}

/**
 * Crescita visiva per taglia. È una costante di resa, non di bilanciamento:
 * l'hitbox reale cresce secondo CONFIG.player.halfWidthPerSize e heightPerSize.
 */
const PLAYER_SCALE_PER_SIZE = 0.18;

export function createPlayerView(): PlayerView {
  const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
  const box = geometry.boundingBox;
  const halfHeight = box === null ? 0.5 : (box.max.y - box.min.y) / 2;

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Il modello poggia a y = 0: abbassandolo di mezza altezza, il centro
  // geometrico finisce esattamente sull'origine del perno.
  mesh.position.y = -halfHeight;

  const pivot = new THREE.Group();
  pivot.add(mesh);
  const group = new THREE.Group();
  group.add(pivot);

  let roll = 0;

  function sync(player: PlayerState, size: number, speed: number, dt: number): void {
    const scale = 1 + (size - 1) * PLAYER_SCALE_PER_SIZE;
    pivot.scale.setScalar(scale);

    const radius = Math.max(halfHeight * scale, 0.001);
    // Segno POSITIVO, non invertirlo (era il difetto segnalato: la mucca
    // sembrava rotolare all'indietro). Il mondo scorre verso la camera lungo
    // -z (world.ts: chunk.z -= delta) mentre la mucca resta ferma a schermo,
    // come su un tapis roulant: perché rotoli in avanti senza slittare, il suo
    // punto di contatto deve muoversi in accordo con quello scorrimento, cioè
    // verso -z. Con rotation.x crescente un punto in cima alla sfera si sposta
    // verso +z (si veda scene.ts, la camera guarda verso +z) mentre il punto a
    // terra si sposta verso -z: è il verso corretto. A schermo si legge come
    // la sommità della mucca che scivola verso il fondo (per lo scorcio
    // prospettico, un punto che si allontana in z appare più in basso), non
    // verso l'alto.
    roll = (roll + (speed * dt) / radius) % (Math.PI * 2);
    pivot.rotation.x = roll;

    group.position.set(worldToViewX(player.x), player.y + radius, 0);
  }

  return { sync, group };
}
