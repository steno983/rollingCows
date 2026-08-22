import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../core/rng';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraHeightFor,
  cameraPitchFor,
  slopeTiltY,
  slopeTiltZ,
  WORLD_SLOPE,
} from './camera-rig';

export interface BackdropView {
  group: THREE.Group;
  /** Riposiziona lo sfondo sul piano orizzontale (x, z) rispetto alla camera:
   *  MAI l'altezza della camera (che piegherebbe l'orizzonte a ogni cambio di
   *  taglia; la quota del gruppo è una costante, vedi backdropDrop) e
   *  MAI lo shake (che qui produrrebbe un sobbalzo innaturale su elementi che
   *  devono restare immobili come un fondale dipinto). Il chiamante passa
   *  `scene.rigPosition`, che esclude entrambi apposta. `yaw` è invece
   *  voluto: è lo stesso angolo (radianti) applicato al gruppo-mondo durante
   *  un bivio (vedi render/curve.ts, worldYawFor, e main.ts), e deve seguirlo
   *  di pari passo — altrimenti l'orizzonte resterebbe immobile mentre pendio
   *  ed entità curvano, smascherando il trucco invece di venderlo. Ruotare
   *  attorno all'origine locale del gruppo (che `sync` stesso sposta sulla
   *  camera) invece che sulla mucca è un'approssimazione voluta: lo sfondo è
   *  così lontano (150+ unità) che la manciata di unità fra camera e mucca è
   *  impercettibile. Zero allocazioni: si chiama ogni frame. */
  sync(cameraX: number, cameraZ: number, yaw: number): void;
}

/* ------------------------------------------------------------------------ *
 * Logica pura, testabile senza three.js: stesso seed → stesso panorama.
 * ------------------------------------------------------------------------ */

/**
 * Fin dove arriva il pendio davanti alla mucca, GARANTITO. I chunk scorrono
 * verso la camera e vengono riciclati quando la loro coda supera
 * despawnBehindZ, quindi il bordo lontano oscilla fra questo valore e uno
 * `chunkLength` più in là: il conto che segue deve reggere anche nel momento
 * peggiore del ciclo, cioè quando il pendio è più corto (180 unità).
 */
const TERRAIN_FAR_Z =
  CONFIG.world.chunkLength * (CONFIG.world.chunkCount - 1) + CONFIG.world.despawnBehindZ;

/** Margine fra la cima più alta del fondale e il bordo alto dello schermo:
 *  un grado, cioè una ventina di pixel su uno schermo 1080p. Serve perché i
 *  picchi sono triangoli — una cima tagliata di piatto si riconosce
 *  immediatamente come un errore, molto più di una cima bassa. */
const CREST_TOP_MARGIN = (1 * Math.PI) / 180;

/** Passo con cui si campionano le taglie nei vincoli qui sotto. La camera
 *  interpola con continuità fra una taglia e l'altra (render/scene.ts), quindi
 *  non basta guardare i due estremi per dire «vale sempre». */
const SIZE_STEP = 0.5;

/** La cima più alta di UN piano di creste, alla sua profondità: è tutto ciò
 *  che serve sapere del piano per decidere se esce dal quadro. */
export interface RidgeCrest {
  /** Profondità del piano, in unità davanti alla camera. */
  depth: number;
  /** Quota della cima più alta, nel sistema di riferimento del gruppo-fondale
   *  (cioè comprensiva di ridgeBaseY e PRIMA dell'abbassamento). */
  topY: number;
}

/** Posizione della camera nel mondo alla taglia data, con il rig già
 *  inclinato sul pendio (vedi WORLD_SLOPE in camera-rig.ts). */
function cameraOnSlope(size: number, slope: number): { y: number; z: number } {
  const height = cameraHeightFor(size);
  const distance = cameraDistanceFor(size);
  return {
    y: slopeTiltY(height, -distance, slope),
    z: slopeTiltZ(height, -distance, slope),
  };
}

/**
 * Tangente dell'angolo (negativo: sotto l'orizzonte) a cui si vede svanire il
 * pendio. Su un mondo piatto è quasi zero — il pendio muore sull'orizzonte, ed
 * è esattamente il motivo per cui sembrava una pianura. Inclinato, tende a
 * -slope: sopra quella linea non c'è più terreno, e quel che si vede lì è
 * tutto e solo fondale.
 */
function slopeVanishTan(size: number, slope: number): number {
  const camera = cameraOnSlope(size, slope);
  const edgeY = -TERRAIN_FAR_Z * Math.sin(slope);
  const edgeZ = TERRAIN_FAR_Z * Math.cos(slope);
  return (edgeY - camera.y) / (edgeZ - camera.z);
}

/**
 * Quota massima del gruppo-fondale perché il suo bordo VICINO resti nascosto
 * dietro il pendio. È il vincolo che chiude il buco: il fondovalle è un
 * quadrilatero orizzontale che comincia a `valleyDistance` dalla camera, e se
 * il suo bordo vicino spuntasse sopra la linea in cui il pendio svanisce si
 * vedrebbe una striscia di cielo incastrata fra i due.
 */
function valleyHiddenCeiling(slope: number): number {
  const cfg = CONFIG.render.backdrop;
  let ceiling = Number.POSITIVE_INFINITY;
  for (let size = 1; size <= CONFIG.avalanche.maxSize; size += SIZE_STEP) {
    const camera = cameraOnSlope(size, slope);
    const limit = camera.y + cfg.valleyDistance * slopeVanishTan(size, slope) - cfg.valleyY;
    if (limit < ceiling) ceiling = limit;
  }
  return ceiling;
}

/**
 * Quota massima del gruppo-fondale perché nessuna cima esca dal bordo alto
 * dello schermo. Il caso peggiore è la taglia 1 con il FOV minimo, cioè
 * l'inquadratura di partenza: alle taglie alte la camera guarda più in basso
 * (cameraPitchFor), ma per arrivarci serve una corsa lunga, quindi la velocità
 * è già cresciuta e il FOV si è aperto più di quanto la camera sia scesa —
 * verificato in backdrop.test.ts su tutte le taglie.
 */
function crestsInFrameCeiling(slope: number, crests: readonly RidgeCrest[]): number {
  const camera = cameraOnSlope(1, slope);
  const headroom =
    (CONFIG.render.cameraMinFov / 2) * (Math.PI / 180) -
    cameraPitchFor(1, slope) -
    CREST_TOP_MARGIN;
  let ceiling = Number.POSITIVE_INFINITY;
  for (const crest of crests) {
    const limit = camera.y + crest.depth * Math.tan(headroom) - crest.topY;
    if (limit < ceiling) ceiling = limit;
  }
  return ceiling;
}

/**
 * DI QUANTO SCENDE IL FONDALE, in unità di mondo (valore negativo).
 *
 * Tutti i numeri di CONFIG.render.backdrop sono tarati su un mondo piatto, in
 * cui il pendio muore sull'orizzonte: creste e fondovalle stanno appena sotto
 * quella linea (ridgeBaseY = valleyY = 5) perché è lì che, da quel punto di
 * vista, sta la valle. Con il pendio inclinato la geometria cambia due volte:
 * il terreno svanisce `slope` gradi SOTTO l'orizzonte — e sotto quella linea
 * il fondale sarebbe nascosto dal pendio, che è opaco e più vicino — e la
 * camera scende con il pendio, quindi l'orizzonte sale sullo schermo e sopra
 * di esso resta molto meno spazio.
 *
 * L'abbassamento è il più piccolo che soddisfa entrambe le cose:
 *
 *  - il bordo vicino del fondovalle sotto la linea in cui il pendio svanisce
 *    (valleyHiddenCeiling), altrimenti si apre un vuoto fra pendio e fondale;
 *  - la cima più alta dentro il bordo dello schermo (crestsInFrameCeiling),
 *    altrimenti le montagne si vedono tagliate di piatto.
 *
 * Il primo vincolo è RELATIVO al mondo piatto: a pendenza zero la funzione
 * restituisce esattamente 0 e il panorama resta quello di prima, filo di cielo
 * sopra l'orizzonte compreso — il fondale non è mai stato perfettamente a
 * tenuta, e non è questo il momento di cambiarlo di nascosto. Il secondo è
 * assoluto, perché uscire dal quadro non è una questione di confronto con
 * prima: a pendenza zero non è vincolante e non tocca nulla.
 *
 * Il limite dell'impianto è il paese: sta appoggiato sul fondovalle, quindi
 * scende insieme a lui, e oltre gli 8° circa finisce interamente dietro il
 * pendio. Un pendio più ripido richiede prima di abbassare
 * render.backdrop.ridgePeakHeight (che è ciò che spinge in giù il fondale).
 */
export function backdropDrop(slope: number, crests: readonly RidgeCrest[]): number {
  const flatCeiling = valleyHiddenCeiling(0);
  return Math.min(valleyHiddenCeiling(slope) - flatCeiling, crestsInFrameCeiling(slope, crests), 0);
}

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
 *
 * Esportata solo per il test di regressione sull'avvolgimento dei vertici
 * (vedi backdrop.test.ts): il difetto qui sotto era invisibile a occhio nudo
 * perché il quadrilatero semplicemente non veniva disegnato.
 */
export function buildValleyFloor(): THREE.Mesh {
  const cfg = CONFIG.render.backdrop;
  const halfWidth = cfg.valleyWidth / 2;
  const zNear = cfg.valleyDistance;
  const zFar = cfg.valleyDistance + cfg.valleyDepth;
  const near = new THREE.Color(cfg.hazeColor);
  const far = new THREE.Color(cfg.valleyColor);

  const positions = [
    -halfWidth,
    cfg.valleyY,
    zNear,
    halfWidth,
    cfg.valleyY,
    zNear,
    halfWidth,
    cfg.valleyY,
    zFar,
    -halfWidth,
    cfg.valleyY,
    zFar,
  ];
  const colors: number[] = [];
  pushColor(colors, near);
  pushColor(colors, near);
  pushColor(colors, far);
  pushColor(colors, far);
  // Avvolgimento invertito rispetto a [0,1,2, 0,2,3]: con quell'ordine
  // entrambi i triangoli avevano normale (0,-1,0), cioè faccia frontale
  // rivolta verso il BASSO, mentre la camera sta sempre sopra il fondovalle
  // (y fra 6,1 e 8,6 contro valleyY = 5). Con un MeshBasicMaterial a
  // side: FrontSide il quadrilatero veniva quindi scartato integralmente dal
  // rasterizzatore: il fondovalle non è mai stato disegnato, il villaggio era
  // appoggiato sul nulla e valleyColor non finiva su un solo pixel del gioco.
  // Si corregge l'ordine e non si passa a side: DoubleSide, per non pagare il
  // culling delle facce posteriori disattivato su un quad grande quanto tutto
  // lo schermo.
  const indices = [0, 2, 1, 0, 3, 2];

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

/**
 * Villaggio: corpi e tetti/guglie di TUTTI gli edifici (case + campanile)
 * condividono lo stesso wallColor/roofColor (vedi CONFIG.render.backdrop.
 * village), quindi si fondono in UNA mesh per parte invece di una coppia di
 * mesh per edificio (9 edifici × 2 mesh = 18 draw call, contro il budget di
 * 60 draw call totali della scena). Le forme restano quelle di
 * buildHouse/buildCampanile, invariate: qui si "cuoce" solo la trasformazione
 * (posizione, rotazione, scala) di ciascun pezzo nei suoi vertici, PRIMA di
 * unirli — l'aspetto finale del villaggio non cambia, solo il numero di
 * draw call per disegnarlo (18 → 2).
 */
function buildVillage(rng: Rng): THREE.Group {
  const valleyY = CONFIG.render.backdrop.valleyY;
  const cfg = CONFIG.render.backdrop.village;
  const group = new THREE.Group();
  const layout = generateVillageLayout(rng, cfg.houseCount, cfg.spread);
  if (layout.length === 0) return group;

  const bodyGeometries: THREE.BufferGeometry[] = [];
  const roofGeometries: THREE.BufferGeometry[] = [];

  for (const house of layout) {
    const targetHeight = (house.isTower ? cfg.towerHeight : cfg.houseHeight) * house.scale;
    const piece = house.isTower
      ? buildCampanile(targetHeight, cfg.wallColor, cfg.roofColor)
      : buildHouse(targetHeight, cfg.wallColor, cfg.roofColor);
    // Appoggiata sul fondovalle, non sulla linea dell'orizzonte: valleyY è
    // già tarato (vedi config.ts) perché la cima resti sotto l'orizzonte.
    piece.position.set(house.x, valleyY, cfg.distance + house.z);
    piece.updateMatrixWorld(true);

    // buildHouse/buildCampanile aggiungono sempre corpo e tetto/guglia in
    // quest'ordine (group.add(body, roof/spire)): vedi le due funzioni sopra.
    const [body, roof] = piece.children as [THREE.Mesh, THREE.Mesh];
    bodyGeometries.push(
      (body.geometry as THREE.BufferGeometry).clone().applyMatrix4(body.matrixWorld),
    );
    roofGeometries.push(
      (roof.geometry as THREE.BufferGeometry).clone().applyMatrix4(roof.matrixWorld),
    );
    body.geometry.dispose();
    roof.geometry.dispose();
    (body.material as THREE.Material).dispose();
    (roof.material as THREE.Material).dispose();
  }

  const mergedBodies = mergeGeometries(bodyGeometries, false);
  const mergedRoofs = mergeGeometries(roofGeometries, false);
  for (const geometry of bodyGeometries) geometry.dispose();
  for (const geometry of roofGeometries) geometry.dispose();
  if (mergedBodies === null || mergedRoofs === null) {
    throw new Error('Impossibile unire le geometrie del villaggio');
  }
  mergedBodies.computeBoundingSphere();
  mergedRoofs.computeBoundingSphere();

  const bodyMesh = new THREE.Mesh(mergedBodies, flatMaterial(cfg.wallColor));
  const roofMesh = new THREE.Mesh(mergedRoofs, flatMaterial(cfg.roofColor));
  bodyMesh.castShadow = false;
  bodyMesh.receiveShadow = false;
  roofMesh.castShadow = false;
  roofMesh.receiveShadow = false;
  group.add(bodyMesh, roofMesh);

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
  const crests: RidgeCrest[] = [];

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
    // La cima VERA di questo piano, non quella teorica (base + varianza
    // piena): il profilo è deterministico, quindi l'abbassamento può essere
    // tarato sulla montagna che si vede davvero invece che sulla peggiore che
    // il generatore potrebbe produrre. Sul piano più lontano il divario vale
    // un grado e mezzo di quadro.
    crests.push({ depth, topY: cfg.ridgeBaseY + Math.max(...profile) });
    group.add(
      buildRidgeMesh(profile, width, depth, cfg.ridgeBaseY, color, cfg.hazeColor, cfg.ridgeHazeMix),
    );
  }

  group.add(buildValleyFloor());
  group.add(buildVillage(rng));

  // Calcolato una volta sola: dipende dalla pendenza (una costante) e dal
  // panorama generato (che ha un seed fisso), non dal frame.
  const drop = backdropDrop(WORLD_SLOPE, crests);

  function sync(cameraX: number, cameraZ: number, yaw: number): void {
    group.position.set(cameraX, drop, cameraZ);
    group.rotation.y = yaw;
  }

  return { group, sync };
}
