import * as THREE from 'three';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import type { WorldState } from '../game/world';
import { cameraDistanceFor, worldToViewX } from './camera-rig';
import { buildGeometry, MODELS } from './models';
import { heightAt } from './terrain';

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
 * Layout deterministico di un chunk a partire da `layoutSeed`. Il seme NON è
 * più per forza l'id del chunk: gli id sono sei e non cambiano mai (createWorld
 * li assegna 0..5 e il riciclo non li riassegna), quindi legare il layout
 * all'id significava un panorama laterale che si ripete con periodo di sei
 * chunk — circa sei secondi — per l'intera corsa. Chi chiama semina i sei
 * layout iniziali con gli id e poi, a ogni riciclo, rigenera il chunk con un
 * contatore crescente (vedi createScenery).
 */
export function sceneryForChunk(layoutSeed: number, out: SceneryItem[]): void {
  const cfg = CONFIG.render.scenery;
  const rng = createRng(0x5ce7e * 1 + layoutSeed * 7919);
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

const DEG2RAD = Math.PI / 180;

/**
 * Quanto è larga MEZZA inquadratura per ogni unità di distanza davanti alla
 * camera. Con `aspect` = larghezza/altezza, la semiapertura orizzontale è
 * atan(aspect · tan(fovVerticale / 2)): qui serve solo la tangente.
 */
export function sceneryHalfSpread(fovDeg: number, aspect: number): number {
  return Math.tan(fovDeg * DEG2RAD * 0.5) * aspect;
}

/**
 * La camera arretra al crescere della mucca: si usa sempre l'arretramento
 * MASSIMO perché l'errore cada dalla parte sicura. Sovrastimare la distanza
 * dalla camera allarga il cono e al più disegna qualcosa che non si vede;
 * sottostimarla toglierebbe di scena un albero visibile.
 */
const CAMERA_PULLBACK = cameraDistanceFor(CONFIG.avalanche.maxSize);

/**
 * Se un elemento decorativo, in coordinate di vista, vada disegnato.
 *
 * Le InstancedMesh della scenografia hanno `frustumCulled = false` — è la
 * scelta giusta, il loro volume di delimitazione non segue le istanze — ma non
 * era stata sostituita da nulla: i ~29.000 triangoli del paesaggio (una baita
 * da sola ne vale 1748, più del doppio della mucca) venivano inviati sempre,
 * comprese le baite dietro la camera e quelle oltre la nebbia, dove sono
 * comunque un blocco di colore uniforme. Il ciclo di sync visita già ogni
 * elemento: qui il culling costa una moltiplicazione.
 *
 * `yawCos`/`yawSin` sono coseno e seno della rotazione del gruppo-mondo
 * durante un bivio (vedi render/curve.ts), passati già calcolati perché sono
 * gli stessi per tutti gli elementi del frame. Tenerne conto non è un
 * dettaglio: 38° spostano di lato un elemento lontano di più di metà della sua
 * distanza, quindi ignorarli farebbe sparire proprio ciò che la piegata sta
 * portando dentro l'inquadratura.
 */
export function isSceneryVisible(
  viewX: number,
  viewZ: number,
  yawCos: number,
  yawSin: number,
  halfSpread: number,
): boolean {
  const cfg = CONFIG.render.scenery;
  const z = -viewX * yawSin + viewZ * yawCos;
  if (z < -cfg.cullBehindZ) return false;
  if (z > CONFIG.render.fogFar) return false;
  const x = viewX * yawCos + viewZ * yawSin;
  const halfWidth = (z + CAMERA_PULLBACK) * halfSpread + cfg.cullMarginX;
  return x <= halfWidth && x >= -halfWidth;
}

export interface SceneryView {
  group: THREE.Group;
  /**
   * `fovDeg` e `aspect` sono quelli della camera in quel frame e `yaw` la
   * rotazione del gruppo-mondo (la stessa che main.ts scrive su
   * worldGroup.rotation.y): servono al culling per distanza, vedi
   * isSceneryVisible. Zero allocazioni: si chiama ogni frame.
   */
  sync(world: WorldState, fovDeg: number, aspect: number, yaw: number): void;
}

/** Quanto sollevare l'ombra di contatto sopra la quota analitica del pendio.
 *  Più del bias del crepaccio (0,02) per un motivo preciso: la superficie
 *  disegnata è l'interpolazione LINEARE di heightAt su un reticolo di 3,4 × 1,7
 *  unità (vedi terrain.ts, OUTER_SEGMENTS_X/SEGMENTS_Z), e su un termine
 *  convesso come il rilievo laterale la corda passa sopra la funzione — fino a
 *  circa un decimo di unità. Con un margine più stretto l'ombra resterebbe
 *  sepolta sotto la neve proprio nella fascia dove la scenografia è più fitta. */
const CONTACT_SHADOW_LIFT = 0.12;

/**
 * Ombra di contatto finta: un gradiente radiale su canvas, generato a runtime
 * come ogni altra texture del progetto (nessun asset esterno). Le ombre VERE
 * sono escluse apposta: la scenografia vive fra 9 e 46 unità di lato e
 * allargare fin lì il frustum della shadow map sacrificherebbe i texel dove
 * servono davvero, sugli ostacoli (vedi CONFIG.render.shadow). Il colore non è
 * nero ma il blu di PALETTE[20] (ombra del ghiaccio): su una distesa di neve
 * un'ombra grigia legge come sporco.
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error("Contesto 2D non disponibile per l'ombra di contatto");
  }

  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(43, 74, 99, 1)');
  gradient.addColorStop(0.45, 'rgba(43, 74, 99, 0.72)');
  gradient.addColorStop(1, 'rgba(43, 74, 99, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Una InstancedMesh per modello decorativo più una per le ombre di contatto:
 * quattro draw call in totale per tutto il paesaggio, indipendenti da quanti
 * oggetti sono a schermo.
 */
export function createScenery(): SceneryView {
  const cfg = CONFIG.render.scenery;
  const capacity = cfg.itemsPerChunk * CONFIG.world.chunkCount;
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();

  const meshes = new Map<SceneryKind, THREE.InstancedMesh>();
  /** Lato dell'ombra di contatto a scala 1, DERIVATO dall'ingombro del
   *  modello: un'ombra grande uguale sotto un abete e sotto una balla di fieno
   *  tradirebbe subito il trucco. */
  const footprints = new Map<SceneryKind, number>();

  for (const kind of KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    footprints.set(kind, box === null ? 1 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z));

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    // Mancava qui mentre è impostato correttamente in entities-view e terrain:
    // le matrici si riscrivono a ogni frame, la GPU deve saperlo.
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    // Stesso motivo di entities-view/terrain: il volume di bounding di
    // un'InstancedMesh non segue le istanze, che qui oltretutto vivono ben
    // fuori dalla geometria base — senza questo la scenografia sparirebbe
    // appena la camera si allontana. Al suo posto c'è isSceneryVisible.
    mesh.frustumCulled = false;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    opacity: cfg.contactShadowOpacity,
    // Il quad è appoggiato sul pendio e va letto attraverso: scrivere la
    // profondità farebbe sparire le ombre che si sovrappongono fra loro.
    depthWrite: false,
  });
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, capacity);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.count = 0;
  shadows.visible = false;
  shadows.frustumCulled = false;
  group.add(shadows);

  // I sei layout, uno per id di chunk, calcolati UNA volta: prima sync
  // chiamava sceneryForChunk per tutti e sei i chunk a ogni frame, cioè
  // costruiva sessanta volte al secondo sei Rng (un oggetto più quattro
  // closure) e quarantadue object literal, più 210 estrazioni di PRNG, per
  // ottenere sempre lo stesso identico risultato. Era la violazione più netta
  // della regola "nel loop non si alloca", e su un telefono è il garbage che
  // produce i frame lunghi da cui parte il degrado permanente di qualità.
  const layouts: SceneryItem[][] = [];
  for (let id = 0; id < CONFIG.world.chunkCount; id += 1) {
    const items: SceneryItem[] = [];
    sceneryForChunk(id, items);
    layouts.push(items);
  }
  // Semi già consumati: i successivi non devono ripeterli.
  let nextLayoutSeed = CONFIG.world.chunkCount;
  const lastChunkZ: number[] = [];

  const counters = new Map<SceneryKind, number>();

  function sync(world: WorldState, fovDeg: number, aspect: number, yaw: number): void {
    for (const kind of KINDS) counters.set(kind, 0);
    let shadowCount = 0;

    const halfSpread = sceneryHalfSpread(fovDeg, aspect);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    for (let c = 0; c < world.chunks.length; c += 1) {
      const chunk = world.chunks[c];
      if (chunk === undefined) continue;
      const layout = layouts[chunk.id];
      if (layout === undefined) continue;

      // Il riciclo si riconosce dalla z che torna IN AVANTI: fuori dal riciclo
      // un chunk può solo avvicinarsi. Non si usa world.recycled perché quello
      // viene svuotato da updateWorld, che in pausa e nei menu non gira,
      // mentre sync gira lo stesso: il paesaggio si rimescolerebbe a ogni
      // frame di pausa. Costa sei confronti per frame e rigenera un layout
      // circa una volta al secondo.
      const previousZ = lastChunkZ[chunk.id];
      if (previousZ !== undefined && chunk.z > previousZ) {
        sceneryForChunk(nextLayoutSeed, layout);
        nextLayoutSeed += 1;
      }
      lastChunkZ[chunk.id] = chunk.z;

      for (let i = 0; i < layout.length; i += 1) {
        const item = layout[i];
        if (item === undefined) continue;
        const mesh = meshes.get(item.kind);
        const used = counters.get(item.kind) ?? 0;
        if (mesh === undefined || used >= capacity) continue;

        // chunk.z è il bordo del chunk più vicino al giocatore (vedi
        // game/world.ts): stessa convenzione di terrain.ts/entities-view.ts,
        // nessuna negazione di z. item.x passa da worldToViewX come ogni
        // altra X di mondo (vedi camera-rig.ts): è l'unica funzione
        // autorizzata a specchiare l'asse per questa inquadratura.
        const viewX = worldToViewX(item.x);
        const viewZ = chunk.z + item.z;
        if (!isSceneryVisible(viewX, viewZ, cos, sin, halfSpread)) continue;

        // Il pendio sale fino a ~3,2 unità al bordo esterno (vedi
        // terrain.heightAt): appoggiare tutto a quota 0 sotterrava gli
        // elementi più lontani e lascerebbe l'ombra di contatto sepolta
        // sotto la neve, cioè invisibile proprio dove serve. z è locale al
        // chunk, come nella geometria del chunk stesso.
        const groundY = heightAt(viewX, item.z);

        dummy.position.set(viewX, groundY, viewZ);
        dummy.rotation.set(0, item.yaw, 0);
        dummy.scale.setScalar(item.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(used, dummy.matrix);
        counters.set(item.kind, used + 1);

        if (shadowCount < capacity) {
          const side = (footprints.get(item.kind) ?? 1) * item.scale * cfg.contactShadowScale;
          dummy.position.set(viewX, groundY + CONTACT_SHADOW_LIFT, viewZ);
          dummy.rotation.set(0, item.yaw, 0);
          dummy.scale.set(side, 1, side);
          dummy.updateMatrix();
          shadows.setMatrixAt(shadowCount, dummy.matrix);
          shadowCount += 1;
        }
      }
    }

    for (const kind of KINDS) {
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;
      writeCount(mesh, counters.get(kind) ?? 0);
    }
    writeCount(shadows, shadowCount);
  }

  /** Con count 0 three risparmia già la draw call ma non setProgram né
   *  l'invio degli attributi; e un needsUpdate senza regioni ricarica
   *  l'attributo INTERO, non le sole istanze scritte. */
  function writeCount(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { group, sync };
}
