import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng, type Rng } from '../core/rng';
import { CONFIG } from '../game/config';
import {
  activeBranchOf,
  branchCenterAt,
  type ForkPhase,
  forkZOf,
  type PathState,
  realignProgressOf,
} from '../game/path';
import type { Branch } from '../game/types';
import type { WorldState } from '../game/world';

export interface TerrainView {
  sync(world: WorldState, path: PathState): void;
  /** L'anisotropia massima è una capacità del RENDERER
   *  (renderer.capabilities.getMaxAnisotropy()), che questo modulo non ha e
   *  non vuole avere. La texture nasce con un valore prudente e chi possiede
   *  il renderer lo alza al massimo consentito: senza anisotropia il pendio,
   *  visto di sbieco e quasi di taglio verso l'orizzonte, sfarina in un grigio
   *  brulicante proprio dove servirebbe leggere il movimento. */
  setMaxAnisotropy(max: number): void;
  group: THREE.Group;
}

/** Neve non battuta: la base sempre-piatta che deve poter ospitare qualunque
 *  ramo, anche quando non è la pista "ufficiale" del momento.
 *
 *  Scurita da 0xdce9f2: contro SNOW_COLOR erano 24 livelli su 255 PRIMA
 *  dell'illuminazione, che dopo il Lambert scendevano sotto i 15 — cioè il
 *  bordo della pista battuta, l'unica cosa che dice al giocatore dove finisce
 *  il ramo che sta percorrendo durante un bivio, era di fatto invisibile. Il
 *  delta di luminanza passa da ~19 a ~39 livelli (fino a 49 sul solo rosso),
 *  e la texture della neve toglie alla sola neve non battuta altri ~7 livelli
 *  in media. Conta il RAPPORTO, non la differenza assoluta: il Lambert
 *  moltiplica, quindi il contrasto relativo resta questo qualunque intensità
 *  abbiano le luci. */
const VERGE_COLOR = 0xc3d6e6;
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

/**
 * Rumore a valori su un reticolo PERIODICO: i vertici del reticolo sono
 * campionati con indici presi modulo `cells`, quindi il bordo destro combacia
 * con quello sinistro e quello inferiore con quello superiore. Non è un
 * dettaglio: la stessa texture si ripete dieci volte per chunk, e una qualsiasi
 * discontinuità al bordo diventerebbe una griglia di cuciture larga quattro
 * unità stampata su tutto il pendio.
 */
function createLattice(rng: Rng, cells: number): Float32Array {
  const values = new Float32Array(cells * cells);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = rng.next();
  }
  return values;
}

function sampleLattice(values: Float32Array, cells: number, u: number, v: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  // Interpolazione con smoothstep e non lineare: con la lineare si vedono i
  // bordi delle celle del reticolo, perché la derivata salta a ogni vertice.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const ix0 = x0 % cells;
  const iy0 = y0 % cells;
  const ix1 = (ix0 + 1) % cells;
  const iy1 = (iy0 + 1) % cells;
  const v00 = values[iy0 * cells + ix0] ?? 0;
  const v10 = values[iy0 * cells + ix1] ?? 0;
  const v01 = values[iy1 * cells + ix0] ?? 0;
  const v11 = values[iy1 * cells + ix1] ?? 0;
  const top = v00 + (v10 - v00) * sx;
  const bottom = v01 + (v11 - v01) * sx;
  return top + (bottom - top) * sy;
}

/** Celle del reticolo per le due ottave del rumore. Devono DIVIDERE la
 *  dimensione della texture, altrimenti il campionamento non ricade sui
 *  vertici del reticolo al bordo e la tileabilità si perde. */
const NOISE_CELLS_COARSE = 8;
const NOISE_CELLS_FINE = 16;
/** Peso dell'ottava grossa: la fine dà la grana, la grossa le chiazze larghe
 *  che rendono leggibile lo scorrimento a distanza. */
const NOISE_COARSE_WEIGHT = 0.65;
/** Valore prudente finché main.ts non passa il massimo del renderer (vedi
 *  TerrainView.setMaxAnisotropy): 4 è supportato ovunque, incluse le GPU
 *  mobili più modeste, e già toglie il grosso dello sfarinamento. */
const DEFAULT_ANISOTROPY = 4;

/**
 * Texture della neve, generata a runtime come tutto il resto (nessun asset
 * esterno). Il pavimento era un solo quad a tinta unita con normale costante:
 * quando i chunk scorrevano, del pendio non si muoveva NIENTE sullo schermo, e
 * in un endless runner la percezione della velocità viene per la maggior parte
 * da lì — a 18 u/s il gioco sembrava fermo e la rampa fino a 40 non si leggeva.
 *
 * La texture è quasi bianca e SOTTRAE luce (parte da 255 e scurisce): il
 * materiale la moltiplica per il proprio colore, quindi la stessa mappa serve
 * sia la neve non battuta sia qualunque altra tinta senza spostarne la
 * cromia — solo la luminanza.
 *
 * `grainScale` e `grooveCount` esistono perché servono DUE nevi diverse, non
 * due copie della stessa: il fuoripista è mosso e solcato, la pista battuta è
 * per definizione liscia. Vedi TRACK_GRAIN_SCALE.
 */
function createSnowTexture(grainScale: number, grooveCount: number): THREE.CanvasTexture {
  const { size, noiseAmplitude: fullNoise, grooveDarkness, seed } = CONFIG.render.snowTexture;
  const noiseAmplitude = fullNoise * grainScale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Contesto 2D non disponibile per la texture della neve');
  }

  // Mai Math.random: la generazione procedurale del progetto passa tutta da
  // createRng con un seed esplicito, così il pendio è identico a ogni avvio.
  const rng = createRng(seed);
  const coarse = createLattice(rng, NOISE_CELLS_COARSE);
  const fine = createLattice(rng, NOISE_CELLS_FINE);

  // Sastrugi: solchi scavati dal vento, orientati lungo la discesa (u costante,
  // v che percorre tutto il tile), così restano tileabili in verticale per
  // costruzione. L'ondeggiamento è una sinusoide di periodo esattamente 1 sul
  // tile, quindi anche quello si richiude su sé stesso.
  const grooves: { center: number; halfWidth: number; depth: number; phase: number }[] = [];
  for (let i = 0; i < grooveCount; i += 1) {
    grooves.push({
      center: rng.next(),
      halfWidth: 0.02 + rng.next() * 0.03,
      depth: grooveDarkness * (0.6 + rng.next() * 0.4),
      phase: rng.next() * Math.PI * 2,
    });
  }
  const GROOVE_WOBBLE = 0.03;

  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let py = 0; py < size; py += 1) {
    const v = py / size;
    for (let px = 0; px < size; px += 1) {
      const u = px / size;
      const noise =
        sampleLattice(coarse, NOISE_CELLS_COARSE, u, v) * NOISE_COARSE_WEIGHT +
        sampleLattice(fine, NOISE_CELLS_FINE, u, v) * (1 - NOISE_COARSE_WEIGHT);
      let darken = noise * noiseAmplitude;
      for (const groove of grooves) {
        const center = groove.center + Math.sin(v * Math.PI * 2 + groove.phase) * GROOVE_WOBBLE;
        // Distanza toroidale: un solco vicino al bordo deve continuare
        // dall'altra parte, altrimenti si tronca di netto a ogni ripetizione.
        // Il resto per 1 non è ridondante: l'ondeggiamento può spingere il
        // centro fuori da [0, 1) (un solco a 0,99 arriva a 1,02), e senza
        // ripiegarlo `1 - raw` diventa negativo — misurato, produceva una
        // cucitura verticale di 28 livelli a ogni ripetizione della texture.
        const raw = Math.abs(u - center) % 1;
        const distance = Math.min(raw, 1 - raw);
        if (distance >= groove.halfWidth) continue;
        const t = 1 - distance / groove.halfWidth;
        darken += groove.depth * t * t;
      }
      const level = Math.max(0, Math.min(255, Math.round(255 - darken)));
      const offset = (py * size + px) * 4;
      data[offset] = level;
      data[offset + 1] = level;
      data[offset + 2] = level;
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = DEFAULT_ANISOTROPY;
  return texture;
}

/**
 * Riscrive le UV del chunk UNA VOLTA SOLA, dopo il merge, a partire dalla
 * posizione di mondo. Necessario perché mergeGeometries conserva sì
 * l'attributo uv, ma ogni sotto-geometria ha le proprie uv su 0..1 stese su
 * dimensioni di mondo diversissime (il pavimento è largo 16 unità, il pendio
 * esterno 110, i banchi 3): la stessa texture risulterebbe grande dieci volte
 * tanto su un pezzo rispetto all'altro.
 *
 * Il conto della tileabilità in z: chunkLength / tileWorldUnits = 40 / 4 = 10
 * ripetizioni esatte per chunk, e il riciclo di un chunk lo sposta di
 * chunkCount * chunkLength = 240 unità, cioè altre 60 ripetizioni esatte.
 * Entrambi interi, quindi né la giunzione fra due chunk né il riciclo
 * producono una cucitura. In x non serve alcun vincolo: i chunk non sono mai
 * sfalsati lateralmente.
 *
 * Le facce quasi verticali (i fianchi dei banchi) userebbero una proiezione
 * dall'alto degenere — x quasi costante lungo tutta l'altezza, cioè la texture
 * spalmata in striscioni — quindi lì si proietta di lato usando y al posto di
 * x. La scelta è per vertice ma si fa in costruzione: a runtime costa zero. Un
 * BoxGeometry non condivide i vertici fra facce, perciò nessuna faccia si
 * ritrova metà vertici proiettati in un modo e metà nell'altro.
 */
function writeWorldUvs(geometry: THREE.BufferGeometry): void {
  const tile = CONFIG.render.snowTexture.tileWorldUnits;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (Math.abs(normal.getY(i)) >= 0.5) {
      uv.setXY(i, x / tile, z / tile);
    } else {
      uv.setXY(i, z / tile, y / tile);
    }
  }
  uv.needsUpdate = true;
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
  const corridorFloor = new THREE.PlaneGeometry(
    FLAT_HALF_WIDTH * 2,
    length,
    CORRIDOR_SEGMENTS_X,
    1,
  );
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

  const merged = mergeGeometries(
    [corridorFloor, leftOuter, rightOuter, leftBank, rightBank],
    false,
  );
  if (merged === null) {
    throw new Error('Impossibile unire le geometrie del chunk di terreno');
  }
  corridorFloor.dispose();
  leftOuter.dispose();
  rightOuter.dispose();
  leftBank.dispose();
  rightBank.dispose();
  writeWorldUvs(merged);
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
/** Massima distanza laterale che un bordo del nastro può raggiungere: un ramo
 *  a branchSeparation, più mezza larghezza di pista, più la traslazione del
 *  mondo durante il riallineamento (che vale al più branchSeparation).
 *  Serve solo a dimensionare la sfera di delimitazione, quindi è deliberatamente
 *  il caso peggiore e non il valore istantaneo. */
const TRACK_MAX_LATERAL = CONFIG.path.branchSeparation * 2 + CONFIG.world.trackWidth / 2;
/**
 * Quanto la grana della neve è attenuata sulla PISTA BATTUTA rispetto al
 * fuoripista (e i solchi spariscono del tutto: una pista battuta è liscia per
 * definizione, i sastrugi li scava il vento sulla neve che nessuno tocca).
 *
 * Non è un vezzo estetico ma la tutela di un'informazione di gioco. Il bordo
 * della pista dice al giocatore dove finisce il ramo che sta percorrendo, e
 * quel bordo si legge per differenza: se le due nevi avessero la stessa grana,
 * il contrasto appena alzato in VERGE_COLOR verrebbe annacquato da una
 * texture uguale su entrambi i lati. Così invece la differenza è doppia — di
 * tinta e di materia — e la pista resta anche più CHIARA, perché la mappa
 * sottrae luce e sulla pista ne sottrae meno (~3 livelli medi contro ~8).
 */
const TRACK_GRAIN_SCALE = 0.45;

/** Buffer riusato dal valore di ritorno di trackCenterOffsets: la funzione è
 *  chiamata TRACK_ROWS volte per frame (vedi updateTrackGeometry sotto), e un
 *  array letterale nuovo a ogni chiamata violerebbe il vincolo di zero
 *  allocazioni nel loop caldo. Sicuro perché il chiamante destruttura subito
 *  i due numeri: nessuno trattiene un riferimento a questo array fra una
 *  chiamata e l'altra. */
const trackCenterScratch: [number, number] = [0, 0];

/**
 * Scostamento laterale del CENTRO di ciascuno dei due nastri della pista, a
 * una distanza z data: coincidono (nastro unico) prima della biforcazione o
 * quando non c'è alcun bivio, e da path.forkZ in poi si aprono verso i due
 * rami.
 *
 * Questo modulo non decide più nulla di quella geometria: la chiede a
 * `branchCenterAt` (game/path.ts), che è la sola risposta alla domanda "dov'è
 * questo pezzo di strada" e che rispondono anche le entità che ci stanno sopra
 * (render/entities-view.ts). Finché il calcolo viveva qui in copia privata, la
 * pista si apriva secondo la geometria e il mondo traslava secondo un'altra
 * curva: la mucca finiva fino a 4,01 unità fuori dal proprio nastro. Poi, con
 * la traslazione corretta ma pur sempre unica per tutte le z, restava un
 * GOMITO a otto unità dal muso e 1,3 unità di scostamento per tutto il resto
 * della vista — la pista che «si deforma». Ora il ramo scelto è dritto a x = 0
 * per ogni z già prima della biforcazione, e non c'è più alcun termine da
 * sommare.
 */
export function trackCenterOffsets(path: PathState, z: number): readonly [number, number] {
  trackCenterScratch[0] = branchCenterAt(path, 'left', z);
  trackCenterScratch[1] = branchCenterAt(path, 'right', z);
  return trackCenterScratch;
}

function createTrackGeometry(): THREE.BufferGeometry {
  const totalVerts = TRACK_VERTS_PER_RIBBON * 2;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  for (let v = 0; v < totalVerts; v += 1) {
    normals[v * 3 + 1] = 1;
  }

  // UV STATICHE, scritte una volta sola: seguono il NASTRO, non il mondo.
  // Il bordo sinistro sta sempre a u = 0 e il destro a u = trackWidth / tile,
  // qualunque sia lo scostamento laterale del nastro in quel momento — così la
  // grana trasla insieme alla pista durante un bivio, che è il comportamento
  // giusto (la pista è un nastro, la sua materia gli appartiene) ed evita di
  // dover riscrivere e ricaricare un secondo attributo a ogni frame. Lo
  // scorrimento in profondità NON sta qui: lo fa texture.offset.y in sync, un
  // solo numero per frame. Con trackWidth 4 e tileWorldUnits 4 la densità è
  // esattamente la stessa del terreno attorno, altrimenti il salto di scala
  // fra i due si vedrebbe più del salto di tinta.
  const tile = CONFIG.render.snowTexture.tileWorldUnits;
  const edgeU = CONFIG.world.trackWidth / tile;
  const uvs = new Float32Array(totalVerts * 2);

  const indices: number[] = [];
  for (let ribbon = 0; ribbon < 2; ribbon += 1) {
    const base = ribbon * TRACK_VERTS_PER_RIBBON;
    for (let i = 0; i < TRACK_ROWS; i += 1) {
      const v = (i * TRACK_STEP) / tile;
      const uvBase = (base + i * 2) * 2;
      uvs[uvBase] = 0;
      uvs[uvBase + 1] = v;
      uvs[uvBase + 2] = edgeU;
      uvs[uvBase + 3] = v;
    }
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
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  // Sfera di delimitazione ASSEGNATA a mano, non calcolata. Le posizioni
  // nascono tutte a zero e il primo giro del loop chiama solo render() senza
  // update(), quindi three calcolava la sfera su una geometria vuota (centro
  // nell'origine, raggio 0) e non la ricalcolava mai più: la visibilità di un
  // nastro lungo 240 unità dipendeva per sempre da quella di un singolo punto
  // ai piedi della mucca. Non spariva per un pelo (quel punto cade a ~19,5°
  // dall'asse di vista contro una semi-apertura di 30°), ma qualunque ritocco
  // all'altezza della camera, al FOV o al rollio avrebbe fatto sparire di
  // colpo tutta la pista battuta. Assegnarla invece di disattivare il culling
  // costa nulla e lascia il nastro cullabile davvero: three non ricalcola una
  // sfera già presente, e position.needsUpdate non la invalida.
  const halfDepth = TRACK_DEPTH / 2;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, TRACK_Y_BIAS, halfDepth),
    Math.hypot(halfDepth, TRACK_MAX_LATERAL),
  );
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

/**
 * Ultimo stato del percorso da cui la geometria della pista è stata scritta.
 * Tutto ciò che entra nel calcolo di una riga sta qui dentro: i due centri
 * dipendono da phase, forkZ e activeBranch (l'apertura e il raddrizzamento si
 * ricavano da quelli, vedi game/path.ts, branchCenterAt; forkBlendZ e commitZ
 * sono costanti di configurazione), le due semilarghezze da phase,
 * activeBranch e realignProgress.
 */
interface TrackGeometryKey {
  phase: ForkPhase;
  /** null fuori da un bivio: `forkZ` non esiste in quella fase (PathState è
   *  un'unione discriminata, vedi game/path.ts) e la cache confronta ciò che
   *  gli accessori restituiscono, non un segnaposto. */
  forkZ: number | null;
  realignProgress: number;
  activeBranch: Branch;
}

/** forkZ a NaN come sentinella: NaN non è uguale nemmeno a sé stesso, quindi
 *  il primo confronto fallisce sempre e la geometria viene scritta almeno una
 *  volta, senza bisogno di un flag "prima volta" a parte. */
function createTrackGeometryKey(): TrackGeometryKey {
  return { phase: 'none', forkZ: NaN, realignProgress: 0, activeBranch: 'main' };
}

/**
 * Riscrive le 61 righe del nastro. Salta tutto se lo stato del percorso non è
 * cambiato: fuori dai bivi — cioè la maggior parte del tempo — phase è 'none' e
 * forkZ è null a ogni frame, quindi il risultato sarebbe identico al precedente
 * e si spendevano 244 setXYZ più l'upload del buffer alla GPU per riscrivere
 * gli stessi numeri.
 */
function updateTrackGeometry(
  geometry: THREE.BufferGeometry,
  path: PathState,
  last: TrackGeometryKey,
): void {
  const forkZ = forkZOf(path);
  const realignProgress = realignProgressOf(path);
  const activeBranch = activeBranchOf(path);
  if (
    last.phase === path.phase &&
    last.forkZ === forkZ &&
    last.realignProgress === realignProgress &&
    last.activeBranch === activeBranch
  ) {
    return;
  }
  last.phase = path.phase;
  last.forkZ = forkZ;
  last.realignProgress = realignProgress;
  last.activeBranch = activeBranch;

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
  const vergeTexture = createSnowTexture(1, CONFIG.render.snowTexture.grooveCount);
  const material = new THREE.MeshLambertMaterial({ color: VERGE_COLOR, map: vergeTexture });
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
  // La pista ha una texture PROPRIA, non una copia di quella del fuoripista.
  // Due ragioni distinte. La prima è tecnica: le righe del nastro stanno a z
  // fisse (è il pendio a scorrere sotto), quindi la pista non può ereditare lo
  // scorrimento gratuito dei chunk e le serve un offset indipendente, che una
  // THREE.Texture a sé garantisce. La seconda è di lettura: la neve battuta
  // deve restare più liscia e più chiara del fuoripista, perché il bordo fra le
  // due è informazione di gioco (vedi TRACK_GRAIN_SCALE) — e la grana di una
  // texture non si attenua per materiale, si genera attenuata.
  const trackTexture = createSnowTexture(TRACK_GRAIN_SCALE, 0);
  const trackMaterial = new THREE.MeshLambertMaterial({ color: SNOW_COLOR, map: trackTexture });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.receiveShadow = true;
  trackMesh.castShadow = false;
  group.add(trackMesh);

  const lastTrackKey = createTrackGeometryKey();
  const tile = CONFIG.render.snowTexture.tileWorldUnits;

  function sync(world: WorldState, path: PathState): void {
    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const chunk = world.chunks[i];
      if (mesh === undefined || chunk === undefined) continue;
      mesh.position.z = chunk.z;
    }
    // Scorrimento della pista: un solo numero per frame, nessun buffer da
    // ricaricare. Il resto per 1 non è un'ottimizzazione ma una necessità —
    // la ripetizione è periodica, quindi togliere la parte intera non cambia
    // NIENTE di ciò che si vede, mentre lasciarla crescere sì: dopo qualche
    // minuto a 40 u/s l'offset arriva a migliaia di ripetizioni, la parte
    // frazionaria perde bit nel float a 32 bit dello shader e la grana inizia
    // a scattare invece di scorrere.
    trackTexture.offset.y = (world.distance / tile) % 1;
    updateTrackGeometry(trackGeometry, path, lastTrackKey);
  }

  function setMaxAnisotropy(max: number): void {
    const value = Math.max(1, Math.floor(max));
    for (const texture of [vergeTexture, trackTexture]) {
      if (value === texture.anisotropy) continue;
      texture.anisotropy = value;
      texture.needsUpdate = true;
    }
  }

  return { sync, setMaxAnisotropy, group };
}
