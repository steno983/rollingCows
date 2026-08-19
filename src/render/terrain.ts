import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../game/config';
import { branchOffsetX, type PathState } from '../game/path';
import type { WorldState } from '../game/world';

export interface TerrainView {
  sync(world: WorldState, path: PathState): void;
  group: THREE.Group;
}

/** Neve non battuta: la base sempre-piatta che deve poter ospitare qualunque
 *  ramo, anche quando non è la pista "ufficiale" del momento. */
const VERGE_COLOR = 0xdce9f2;
/** Neve battuta: il colore della pista vera e propria, invariato da v1. */
const SNOW_COLOR = 0xf4fbff;
const BANK_WIDTH = 3;
const BANK_TILT = 0.3;
const SEGMENTS_Z = 24;
/** Segmenti in x per il PAVIMENTO piatto: 1 solo basta, è piatto per
 *  costruzione (non chiama mai displaceGround). */
const CORRIDOR_SEGMENTS_X = 1;
const OUTER_SEGMENTS_X = 32;

/**
 * Semilarghezza della zona SEMPRE piatta: non è più la sola larghezza del
 * tracciato (world.trackWidth), ma quella più la separazione massima di un
 * ramo durante un bivio (path.branchSeparation). Motivo: durante un bivio le
 * entità del ramo sinistro/destro vivono a ±branchSeparation (vedi
 * game/path.ts, branchOffsetX) e devono poter contare su suolo piatto tanto
 * quanto il tracciato centrale — altrimenti un ramo affonderebbe nella neve
 * rialzata, esattamente il difetto già corretto una volta in v1 (vedi il
 * commento storico più sotto, in createChunkGeometry). Restando una costante
 * FISSA (non dipendente dallo stato del bivio), heightAt resta una funzione
 * pura di (x, z) sola, e il pendio esterno resta un sistema statico a chunk
 * come in v1: solo la PISTA (vedi trackCenterOffsets più sotto) è dinamica.
 */
const FLAT_HALF_WIDTH = CONFIG.path.branchSeparation + CONFIG.world.trackWidth / 2;
const BANK_INNER_MARGIN = 2;
const BANK_OFFSET = FLAT_HALF_WIDTH + BANK_INNER_MARGIN + 0.9;
const BANK_HEIGHT = CONFIG.render.bankHeight;
const BANK_BOTTOM_Y = CONFIG.render.bankBottomY;
const GROUND_WIDTH = FLAT_HALF_WIDTH * 2 + CONFIG.render.groundExtraWidth;
const MAX_LATERAL_RISE = CONFIG.render.groundMaxLateralRise;
const WAVE_COEF = 2;
const RISE_COEF = 2.2;

/**
 * Altezza del pendio in un punto (x, z), fuori dalla zona sempre piatta: 0 se
 * |x| è dentro FLAT_HALF_WIDTH, cresce con la distanza laterale fino al
 * tetto MAX_LATERAL_RISE, modulata dall'ondulazione periodica in z. Logica
 * pura (nessun three.js): usata sia da displaceGround sia dai test.
 * NON è la fonte della piattezza della zona centrale — quella è garantita a
 * monte, in createChunkGeometry, dal fatto che il pavimento (corridorFloor)
 * è una geometria a parte che non chiama mai questa funzione.
 */
export function heightAt(x: number, z: number): number {
  const length = CONFIG.world.chunkLength;
  const lateral = Math.abs(x) / FLAT_HALF_WIDTH;
  const outside = Math.min(MAX_LATERAL_RISE, Math.max(0, lateral - 1));
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
  const outerWidth = GROUND_WIDTH / 2 - FLAT_HALF_WIDTH;

  // BUG CORRETTO IN V1, INVARIANTE CONSERVATA IN V2: corridoio e rilievo
  // laterale sono geometrie SEPARATE apposta. Un'unica PlaneGeometry larga
  // quanto tutto il terreno, con pochi segmenti, interpolerebbe linearmente
  // fra il centro piatto e il rilievo esterno e "gonfierebbe" il pavimento
  // proprio al suo bordo (misurato una volta: fino a 1.165 contro lo 0
  // atteso). Qui il pavimento (verge, larghezza FLAT_HALF_WIDTH * 2) NON
  // chiama mai displaceGround/heightAt: resta piatto per costruzione, non
  // perché la formula valuti a 0 lì.
  const corridorFloor = new THREE.PlaneGeometry(FLAT_HALF_WIDTH * 2, length, CORRIDOR_SEGMENTS_X, 1);
  corridorFloor.rotateX(-Math.PI / 2);
  corridorFloor.translate(0, 0, length / 2);

  const leftOuter = new THREE.PlaneGeometry(outerWidth, length, OUTER_SEGMENTS_X, SEGMENTS_Z);
  leftOuter.rotateX(-Math.PI / 2);
  leftOuter.translate(-(FLAT_HALF_WIDTH + outerWidth / 2), 0, length / 2);
  displaceGround(leftOuter);

  const rightOuter = new THREE.PlaneGeometry(outerWidth, length, OUTER_SEGMENTS_X, SEGMENTS_Z);
  rightOuter.rotateX(-Math.PI / 2);
  rightOuter.translate(FLAT_HALF_WIDTH + outerWidth / 2, 0, length / 2);
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

/** Righe della pista dinamica: una ogni 4 unità, per tutta la profondità
 *  visibile. Più fine non cambierebbe la sagoma percepita (la pista resta
 *  dritta a tratti), più grosso arrotonderebbe visibilmente lo spigolo del
 *  bivio. */
const TRACK_SEGMENTS = 60;
const TRACK_DEPTH = CONFIG.world.chunkLength * CONFIG.world.chunkCount;
const TRACK_STEP = TRACK_DEPTH / TRACK_SEGMENTS;
/** Solleva la pista battuta appena sopra la neve non battuta sottostante,
 *  per evitare z-fighting quando i due nastri coincidono esattamente
 *  (fuori bivio, sono alla stessa X). */
const TRACK_Y_BIAS = 0.02;
const TRACK_ROWS = TRACK_SEGMENTS + 1;
const TRACK_VERTS_PER_RIBBON = TRACK_ROWS * 2;

/** Buffer riusato dal valore di ritorno di trackCenterOffsets: la funzione è
 *  chiamata TRACK_ROWS volte per frame (vedi updateTrackGeometry sotto), e un
 *  array letterale nuovo a ogni chiamata violerebbe il vincolo di zero
 *  allocazioni nel loop caldo. Sicuro perché il chiamante destruttura subito
 *  i due numeri: nessuno trattiene un riferimento a questo array fra una
 *  chiamata e l'altra. */
const trackCenterScratch: [number, number] = [0, 0];

/**
 * Scostamento laterale del CENTRO di ciascuno dei due nastri della pista, a
 * una distanza z data, secondo lo stato del percorso: coincidono (nastro
 * unico) prima della biforcazione o quando non c'è alcun bivio; si separano
 * ai due rami da path.forkZ in poi. Logica pura, testabile senza three.
 */
export function trackCenterOffsets(path: PathState, z: number): readonly [number, number] {
  if (path.phase === 'none' || z <= path.forkZ) {
    trackCenterScratch[0] = path.offsetX;
    trackCenterScratch[1] = path.offsetX;
    return trackCenterScratch;
  }
  trackCenterScratch[0] = branchOffsetX(path, 'left') + path.offsetX;
  trackCenterScratch[1] = branchOffsetX(path, 'right') + path.offsetX;
  return trackCenterScratch;
}

function createTrackGeometry(): THREE.BufferGeometry {
  const totalVerts = TRACK_VERTS_PER_RIBBON * 2;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  for (let v = 0; v < totalVerts; v += 1) {
    normals[v * 3 + 1] = 1;
  }

  const indices: number[] = [];
  for (let ribbon = 0; ribbon < 2; ribbon += 1) {
    const base = ribbon * TRACK_VERTS_PER_RIBBON;
    for (let i = 0; i < TRACK_ROWS - 1; i += 1) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Half-width del tracciato: ogni nastro è largo trackWidth, centrato sul
 *  proprio centro corrente. */
const HALF_TRACK = CONFIG.world.trackWidth / 2;

/**
 * Semi-larghezza dei due nastri, [sinistro, destro]. Vale HALF_TRACK per
 * entrambi tranne durante il riallineamento, dove il nastro SCARTATO si
 * assottiglia fino a sparire.
 *
 * Non è un vezzo: nel frame in cui il bivio si chiude la fase torna 'none' e i
 * due nastri tornano a coincidere al centro. Il nastro scelto ci arriva per
 * gradi (il suo centro è già 0 alla fine del riallineamento), quello scartato
 * no: il suo centro salterebbe di colpo da 2 * branchSeparation a 0, uno
 * scatto laterale di 12 unità in un frame, la pista abbandonata che rientra
 * dentro quella buona. Assottigliato a zero, quel salto non ha più niente da
 * mostrare. Funzione pura: dipende solo dallo stato del percorso, non da z,
 * quindi si valuta UNA volta per frame e non per riga. Riusa uno scratch per
 * lo stesso motivo di trackCenterOffsets: nel loop di frame non si alloca.
 */
const trackHalfScratch: [number, number] = [HALF_TRACK, HALF_TRACK];

export function trackHalfWidths(path: PathState): readonly [number, number] {
  if (path.phase !== 'realigning') {
    trackHalfScratch[0] = HALF_TRACK;
    trackHalfScratch[1] = HALF_TRACK;
    return trackHalfScratch;
  }
  const fading = HALF_TRACK * Math.max(0, 1 - path.realignProgress);
  trackHalfScratch[0] = path.activeBranch === 'left' ? HALF_TRACK : fading;
  trackHalfScratch[1] = path.activeBranch === 'left' ? fading : HALF_TRACK;
  return trackHalfScratch;
}

function updateTrackGeometry(geometry: THREE.BufferGeometry, path: PathState): void {
  const position = geometry.getAttribute('position');
  const [leftHalf, rightHalf] = trackHalfWidths(path);
  for (let i = 0; i < TRACK_ROWS; i += 1) {
    const z = i * TRACK_STEP;
    const [leftCenter, rightCenter] = trackCenterOffsets(path, z);
    const leftBase = i * 2;
    const rightBase = TRACK_VERTS_PER_RIBBON + i * 2;
    position.setXYZ(leftBase, leftCenter - leftHalf, TRACK_Y_BIAS, z);
    position.setXYZ(leftBase + 1, leftCenter + leftHalf, TRACK_Y_BIAS, z);
    position.setXYZ(rightBase, rightCenter - rightHalf, TRACK_Y_BIAS, z);
    position.setXYZ(rightBase + 1, rightCenter + rightHalf, TRACK_Y_BIAS, z);
  }
  position.needsUpdate = true;
}

export function createTerrain(): TerrainView {
  const geometry = createChunkGeometry();
  const material = new THREE.MeshLambertMaterial({ color: VERGE_COLOR });
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

  const trackGeometry = createTrackGeometry();
  const trackMaterial = new THREE.MeshLambertMaterial({ color: SNOW_COLOR });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.receiveShadow = true;
  trackMesh.castShadow = false;
  group.add(trackMesh);

  function sync(world: WorldState, path: PathState): void {
    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const chunk = world.chunks[i];
      if (mesh === undefined || chunk === undefined) continue;
      mesh.position.z = chunk.z;
    }
    updateTrackGeometry(trackGeometry, path);
  }

  return { sync, group };
}
