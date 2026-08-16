import * as THREE from 'three';
import { createRng, type Rng } from '../core/rng';
import { CONFIG } from '../game/config';

export interface BackdropView {
  group: THREE.Group;
  /** Riposiziona lo sfondo sul piano orizzontale (x, z) rispetto alla camera:
   *  MAI y (l'altezza reale della camera non deve mai piegare l'orizzonte) e
   *  MAI lo shake (che qui produrrebbe un sobbalzo innaturale su elementi che
   *  devono restare immobili come un fondale dipinto). Il chiamante passa
   *  `scene.rigPosition`, che esclude entrambi apposta. Zero allocazioni: si
   *  chiama ogni frame. */
  sync(cameraX: number, cameraZ: number): void;
}

/* ------------------------------------------------------------------------ *
 * Logica pura, testabile senza three.js: stesso seed → stesso panorama.
 * ------------------------------------------------------------------------ */

/**
 * Profilo altimetrico di UNA cresta: `segments + 1` picchi equidistanti fra
 * loro, ciascuno a `baseHeight + jitter` con `jitter` in [-variance, variance).
 * Mai sotto 0. Deterministico: stesso `rng` (stesso seed) e stessi parametri
 * producono sempre la stessa sequenza di altezze.
 */
export function generateRidgeProfile(
  rng: Rng,
  segments: number,
  baseHeight: number,
  variance: number,
): number[] {
  const peaks: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const jitter = (rng.next() * 2 - 1) * variance;
    peaks.push(Math.max(0, baseHeight + jitter));
  }
  return peaks;
}

export interface HouseLayout {
  /** Offset dal centro del villaggio, in unità di mondo. */
  x: number;
  z: number;
  /** Scala individuale della casa, attorno a 1. */
  scale: number;
  /** Questa è la casa scelta per ospitare il campanile. */
  isTower: boolean;
}

/**
 * Posizioni deterministiche delle case del villaggio: una griglia larga
 * quanto `spread` con un piccolo jitter per casa, così non restano allineate
 * a scacchiera né si accavallano. Una sola casa (scelta dall'rng) ospita il
 * campanile.
 */
export function generateVillageLayout(rng: Rng, houseCount: number, spread: number): HouseLayout[] {
  if (houseCount <= 0) return [];
  const houses: HouseLayout[] = [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(houseCount)));
  const cell = (spread * 2) / columns;
  const towerIndex = rng.int(0, houseCount);

  for (let i = 0; i < houseCount; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const jitterX = (rng.next() * 2 - 1) * cell * 0.3;
    const jitterZ = (rng.next() * 2 - 1) * cell * 0.3;
    const x = -spread + cell * (col + 0.5) + jitterX;
    const z = -spread + cell * (row + 0.5) + jitterZ;
    const scale = 0.85 + rng.next() * 0.3;
    houses.push({ x, z, scale, isTower: i === towerIndex });
  }
  return houses;
}

/* ------------------------------------------------------------------------ *
 * Resa: costruzione three.js, non testata unitariamente (verifica visiva).
 * ------------------------------------------------------------------------ */

function lerpColor(a: number, b: number, t: number): number {
  const color = new THREE.Color(a);
  color.lerp(new THREE.Color(b), t);
  return color.getHex();
}

/** Materiale piatto, mai affetto dalla nebbia del corridoio (altrimenti lo
 *  sfondo diventerebbe una macchia bianca: fogFar è più vicino di quanto
 *  questi elementi siano posizionati) e mai dalla luce di scena (deve
 *  restare uniforme, coerente con la prospettiva atmosferica data dal solo
 *  colore). */
function flatMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, fog: false });
}

/** Come `flatMaterial`, ma il colore arriva dai vertici: serve per le
 *  sfumature verso la foschia (base delle creste, bordo vicino del
 *  fondovalle), dove un colore piatto lascerebbe un bordo netto contro il
 *  resto della scena. */
function gradientMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
}

function pushColor(target: number[], color: THREE.Color): void {
  target.push(color.r, color.g, color.b);
}

/**
 * Un piano di cresta: una striscia verticale (base piatta, cima frastagliata
 * secondo `peaks`) a profondità `depth` fissa. Non è un vero volume 3D — è la
 * stessa tecnica delle quinte dipinte: a quella distanza, con la camera quasi
 * frontale, la mancanza di spessore non si nota mai. La base è sfumata verso
 * `hazeColor` (vedi `hazeMix`): senza, il punto dove il pendio incontra le
 * creste sarebbe un blocco di colore piatto che stacca di netto.
 */
function buildRidgeMesh(
  peaks: readonly number[],
  width: number,
  depth: number,
  baseY: number,
  peakColor: number,
  hazeColor: number,
  hazeMix: number,
): THREE.Mesh {
  const segments = peaks.length - 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const top = new THREE.Color(peakColor);
  const bottom = new THREE.Color(peakColor).lerp(new THREE.Color(hazeColor), hazeMix);

  for (let i = 0; i <= segments; i += 1) {
    const x = -width / 2 + (width * i) / segments;
    const peak = peaks[i] ?? 0;
    positions.push(x, baseY, depth, x, baseY + peak, depth);
    pushColor(colors, bottom);
    pushColor(colors, top);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, gradientMaterial());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Fondovalle: un unico quadrilatero che sfuma da `hazeColor` (bordo vicino,
 * verso la camera: qui deve confondersi con la nebbia del corridoio, che a
 * queste distanze ha già sbiancato il pendio) a `valleyColor` (bordo
 * lontano, verso le creste). Senza questa sfumatura il fondovalle sarebbe un
 * blocco di colore piatto che stacca di netto dal pendio: il "bordo netto
 * orizzontale" segnalato.
 */
function buildValleyFloor(): THREE.Mesh {
  const cfg = CONFIG.render.backdrop;
  const halfWidth = cfg.valleyWidth / 2;
  const zNear = cfg.valleyDistance;
  const zFar = cfg.valleyDistance + cfg.valleyDepth;
  const near = new THREE.Color(cfg.hazeColor);
  const far = new THREE.Color(cfg.valleyColor);

  const positions = [
    -halfWidth, cfg.valleyY, zNear,
    halfWidth, cfg.valleyY, zNear,
    halfWidth, cfg.valleyY, zFar,
    -halfWidth, cfg.valleyY, zFar,
  ];
  const colors: number[] = [];
  pushColor(colors, near);
  pushColor(colors, near);
  pushColor(colors, far);
  pushColor(colors, far);
  const indices = [0, 1, 2, 0, 2, 3];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, gradientMaterial());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Altezza nominale (prima della scala) del modello costruito da
 *  `buildHouse`: corpo (0.7) + tetto (0.55). Serve a convertire
 *  `village.houseHeight` (un'altezza assoluta in unità di mondo, non uno
 *  scalare) nel fattore di scala da applicare al gruppo. */
const HOUSE_NOMINAL_HEIGHT = 0.7 + 0.55;
/** Come sopra, per `buildCampanile`: corpo (2.4) + guglia (0.9). */
const TOWER_NOMINAL_HEIGHT = 2.4 + 0.9;

/** Casa a due falde: corpo scatolare e tetto piramidale a 4 lati (un cono a 4
 *  segmenti radiali è già una piramide a base quadrata). `height` è
 *  l'altezza assoluta finale (in unità di mondo) del modello scalato. */
function buildHouse(height: number, wallColor: number, roofColor: number): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 1), flatMaterial(wallColor));
  body.position.y = 0.35;

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.55, 4), flatMaterial(roofColor));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.7 + 0.275;

  group.add(body, roof);
  group.scale.setScalar(height / HOUSE_NOMINAL_HEIGHT);
  return group;
}

/** Campanile: torre stretta e alta con una guglia, per farsi notare come
 *  l'edificio più alto del paese senza confondersi con le case (ma niente
 *  vicino alla scala delle creste: `height` resta un'altezza da villaggio,
 *  vedi CONFIG.render.backdrop.village.towerHeight). */
function buildCampanile(height: number, wallColor: number, roofColor: number): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.6), flatMaterial(wallColor));
  body.position.y = 1.2;

  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 4), flatMaterial(roofColor));
  spire.rotation.y = Math.PI / 4;
  spire.position.y = 2.4 + 0.45;

  group.add(body, spire);
  group.scale.setScalar(height / TOWER_NOMINAL_HEIGHT);
  return group;
}

function buildVillage(rng: Rng): THREE.Group {
  const valleyY = CONFIG.render.backdrop.valleyY;
  const cfg = CONFIG.render.backdrop.village;
  const group = new THREE.Group();
  const layout = generateVillageLayout(rng, cfg.houseCount, cfg.spread);

  for (const house of layout) {
    const targetHeight = (house.isTower ? cfg.towerHeight : cfg.houseHeight) * house.scale;
    const piece = house.isTower
      ? buildCampanile(targetHeight, cfg.wallColor, cfg.roofColor)
      : buildHouse(targetHeight, cfg.wallColor, cfg.roofColor);
    // Appoggiata sul fondovalle, non sulla linea dell'orizzonte: valleyY è
    // già tarato (vedi config.ts) perché la cima resti sotto l'orizzonte.
    piece.position.set(house.x, valleyY, cfg.distance + house.z);
    piece.traverse((obj) => {
      obj.castShadow = false;
      obj.receiveShadow = false;
    });
    group.add(piece);
  }

  return group;
}

/**
 * Sfondo lontano: creste innevate su più piani + fondovalle + un piccolo
 * paese voxel. Costruito una sola volta all'avvio (le allocazioni qui non
 * contano: il vincolo "zero allocazioni" riguarda `sync`, chiamata ogni
 * frame, non la creazione).
 */
export function createBackdrop(): BackdropView {
  const cfg = CONFIG.render.backdrop;
  const rng = createRng(cfg.seed);
  const group = new THREE.Group();

  for (let layer = 0; layer < cfg.ridgeLayers; layer += 1) {
    const t = cfg.ridgeLayers <= 1 ? 0 : layer / (cfg.ridgeLayers - 1);
    const depth = cfg.ridgeBaseDistance + layer * cfg.ridgeLayerSpacing;
    // Larghezza E altezza scalano con la distanza (come ridgeWidth): senza,
    // a parità di altezza assoluta i piani più lontani si vedrebbero sempre
    // più piccoli in proporzione, fino a un filo appena leggibile.
    const depthScale = depth / cfg.ridgeBaseDistance;
    const width = cfg.ridgeWidth * depthScale;
    const profile = generateRidgeProfile(
      rng,
      cfg.ridgeSegments,
      cfg.ridgePeakHeight * depthScale,
      cfg.ridgePeakVariance * depthScale,
    );
    const color = lerpColor(cfg.ridgeColorNear, cfg.ridgeColorFar, t);
    group.add(buildRidgeMesh(profile, width, depth, cfg.ridgeBaseY, color, cfg.hazeColor, cfg.ridgeHazeMix));
  }

  group.add(buildValleyFloor());
  group.add(buildVillage(rng));

  function sync(cameraX: number, cameraZ: number): void {
    group.position.set(cameraX, 0, cameraZ);
  }

  return { group, sync };
}
