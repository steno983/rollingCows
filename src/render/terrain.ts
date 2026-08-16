import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../game/config';
import type { WorldState } from '../game/world';

export interface TerrainView {
  sync(world: WorldState): void;
  group: THREE.Group;
}

const SNOW_COLOR = 0xf4fbff;
const BANK_WIDTH = 3;
const BANK_TILT = 0.3;
/** Segmenti in z per il rilievo laterale: invariato, serve solo a rendere
 *  leggibile l'ondulazione (il termine `wave` di heightAt) lungo la
 *  profondità del chunk. */
const SEGMENTS_Z = 24;
/** Segmenti in x per il PAVIMENTO del corridoio: 1 solo basta, perché è
 *  piatto per costruzione (vedi corridorFloor in createChunkGeometry, che
 *  NON chiama displaceGround) — con MeshLambertMaterial l'illuminazione è
 *  per-vertice, ma su una normale costante (0,1,0) l'interpolazione non
 *  introduce alcun errore, e le ombre sono per-frammento (shadow map), non
 *  per-vertice: più segmenti qui non migliorerebbero nulla, solo più
 *  triangoli a vuoto. */
const CORRIDOR_SEGMENTS_X = 1;
/** Segmenti in x per il rilievo laterale, PER LATO (non più su tutta la
 *  larghezza: vedi il difetto che questo sostituisce, sotto). */
const OUTER_SEGMENTS_X = 32;
/** Semilarghezza del corridoio percorribile: 3 unità con la config di default. */
const CORRIDOR_HALF = (CONFIG.world.laneCount * CONFIG.world.laneWidth) / 2;
/** Margine originale fra corridoio e banco: invariato, i banchi restano dove
 *  erano. Solo il terreno OLTRE i banchi si allarga (vedi GROUND_WIDTH). */
const BANK_INNER_MARGIN = 2;
const BANK_OFFSET = CORRIDOR_HALF + BANK_INNER_MARGIN + 0.9;
const BANK_HEIGHT = CONFIG.render.bankHeight;
/** Base del banco sempre sotto il punto più basso plausibile del pendio
 *  adiacente (≈0, il pavimento piatto del corridoio, vedi displaceGround):
 *  chiude il taglio invece di lasciare il banco sospeso nel vuoto (si vedeva
 *  il cielo sotto la base con valori troppo alti). Il TETTO del banco
 *  (BANK_BOTTOM_Y + BANK_HEIGHT) va invece tenuto sopra il pendio vicino,
 *  altrimenti il banco sprofonda sotto la neve e sparisce. */
const BANK_BOTTOM_Y = CONFIG.render.bankBottomY;
/** Il corridoio giocabile resta invariato: qui si allarga solo ciò che sta
 *  oltre le corsie, abbastanza da coprire il frustum fino alla nebbia (vedi
 *  render.fogFar) anche alla taglia massima, così sotto i banchi non si vede
 *  più il cielo. */
const GROUND_WIDTH = CONFIG.world.laneCount * CONFIG.world.laneWidth + CONFIG.render.groundExtraWidth;
/** Oltre questa distanza laterale (in unità di CORRIDOR_HALF) il rilievo
 *  smette di crescere e resta un pendio pieno: senza tetto il termine
 *  quadratico produce altezze assurde ai bordi di una mesh così larga. */
const MAX_LATERAL_RISE = CONFIG.render.groundMaxLateralRise;

/** Coefficiente del termine ondulato (wave * outside * WAVE_COEF) e del
 *  termine quadratico (outside² * RISE_COEF): col tetto attuale
 *  (MAX_LATERAL_RISE = 1.2, vedi CONFIG.render.groundMaxLateralRise) danno
 *  un'altezza massima di ~3.8 unità (0.27 * 1.2 * WAVE_COEF + 1.2² *
 *  RISE_COEF, nel caso peggiore in cui il seno vale ±1), contro le mucca alta
 *  ~1.5: una conca larga e bassa, non più una gola alta ~80 unità come prima
 *  che MAX_LATERAL_RISE fosse abbassato da 6 a 1.2. */
const WAVE_COEF = 2;
const RISE_COEF = 2.2;

/**
 * Altezza del pendio in un punto (x, z), fuori dal corridoio: 0 se |x| è
 * dentro il corridoio (lateral <= 1), cresce con la distanza laterale fino
 * al tetto MAX_LATERAL_RISE, modulata dall'ondulazione periodica in z.
 * Logica pura (nessun three.js): usata sia da displaceGround sia dai test.
 * NON è la fonte della piattezza del corridoio — quella è garantita a monte,
 * in createChunkGeometry, dal fatto che il pavimento del corridoio è una
 * geometria a parte che non chiama mai questa funzione (vedi il commento
 * lì): qui sotto il valore risulterebbe comunque 0 per |x| <= CORRIDOR_HALF,
 * ma non è quello a cui ci si affida.
 */
export function heightAt(x: number, z: number): number {
  const length = CONFIG.world.chunkLength;
  const lateral = Math.abs(x) / CORRIDOR_HALF;
  const outside = Math.min(MAX_LATERAL_RISE, Math.max(0, lateral - 1));
  // Periodica su chunkLength: a z = 0 e a z = chunkLength il seno vale 0,
  // quindi i bordi di due chunk adiacenti combaciano esattamente.
  const wave =
    Math.sin((z / length) * Math.PI * 2) * 0.18 +
    Math.sin((z / length) * Math.PI * 6 + x * 0.6) * 0.09;
  return wave * outside * WAVE_COEF + outside * outside * RISE_COEF;
}

function displaceGround(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createChunkGeometry(): THREE.BufferGeometry {
  const length = CONFIG.world.chunkLength;
  // Larghezza del rilievo laterale, per lato: dal bordo del corridoio al
  // bordo del terreno.
  const outerWidth = GROUND_WIDTH / 2 - CORRIDOR_HALF;

  // BUG CORRETTO: prima il corridoio e il rilievo laterale erano un'unica
  // PlaneGeometry larga GROUND_WIDTH con soli SEGMENTS_X segmenti: a quella
  // larghezza (226 unità) i vertici cadevano ogni 5.65 unità, ben più radi
  // del corridoio (6 unità). Senza un vertice esattamente al bordo del
  // corridoio (|x| = CORRIDOR_HALF = 3), la mesh INTERPOLAVA linearmente fra
  // il vertice centrale (x=0, y=0) e quello successivo (x=±5.65, già dentro
  // il rilievo, y fino a ~2.2): il pavimento del corridoio risultava
  // "gonfiato" fino a ~1.2 unità proprio al suo bordo, seppellendo a metà
  // ostacoli bassi come la staccionata (altezza 1.2). Verificato
  // numericamente prima di questa correzione: a x=3 l'altezza interpolata
  // arrivava fino a 1.165 (contro lo 0 atteso).
  //
  // Ora il corridoio è una geometria A PARTE che non chiama MAI
  // displaceGround/heightAt: resta piatta per costruzione, non perché la
  // formula valuti a 0 lì. Il rilievo laterale è un pezzo per lato, che
  // parte esattamente dal bordo del corridoio (heightAt(±CORRIDOR_HALF, z) =
  // 0 per costruzione: outside = 0 a quella distanza), quindi la saldatura
  // fra i due pezzi è continua per costruzione, non per una densità di
  // vertici scelta a occhio.
  const corridorFloor = new THREE.PlaneGeometry(CORRIDOR_HALF * 2, length, CORRIDOR_SEGMENTS_X, 1);
  corridorFloor.rotateX(-Math.PI / 2);
  corridorFloor.translate(0, 0, length / 2);

  const leftOuter = new THREE.PlaneGeometry(outerWidth, length, OUTER_SEGMENTS_X, SEGMENTS_Z);
  leftOuter.rotateX(-Math.PI / 2);
  leftOuter.translate(-(CORRIDOR_HALF + outerWidth / 2), 0, length / 2);
  displaceGround(leftOuter);

  const rightOuter = new THREE.PlaneGeometry(outerWidth, length, OUTER_SEGMENTS_X, SEGMENTS_Z);
  rightOuter.rotateX(-Math.PI / 2);
  rightOuter.translate(CORRIDOR_HALF + outerWidth / 2, 0, length / 2);
  displaceGround(rightOuter);

  const leftBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  leftBank.rotateZ(BANK_TILT);
  leftBank.translate(-BANK_OFFSET, BANK_BOTTOM_Y + BANK_HEIGHT / 2, length / 2);

  const rightBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  rightBank.rotateZ(-BANK_TILT);
  rightBank.translate(BANK_OFFSET, BANK_BOTTOM_Y + BANK_HEIGHT / 2, length / 2);

  const merged = mergeGeometries([corridorFloor, leftOuter, rightOuter, leftBank, rightBank], false);
  if (merged === null) {
    throw new Error('Impossibile unire le geometrie del chunk di terreno');
  }
  corridorFloor.dispose();
  leftOuter.dispose();
  rightOuter.dispose();
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
