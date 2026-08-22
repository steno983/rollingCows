import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import {
  backdropDrop,
  buildValleyFloor,
  generateRidgeProfile,
  generateVillageLayout,
  type RidgeCrest,
} from './backdrop';
import {
  cameraDistanceFor,
  cameraHeightFor,
  cameraPitchFor,
  slopeTiltY,
  slopeTiltZ,
  WORLD_SLOPE,
} from './camera-rig';

describe('generateRidgeProfile', () => {
  it('produce segments + 1 picchi', () => {
    const profile = generateRidgeProfile(createRng(1), 18, 40, 10);
    expect(profile).toHaveLength(19);
  });

  it('stesso seed → stesso profilo', () => {
    const a = generateRidgeProfile(createRng(42), 12, 30, 8);
    const b = generateRidgeProfile(createRng(42), 12, 30, 8);
    expect(a).toEqual(b);
  });

  it('semi diversi → profili diversi', () => {
    const a = generateRidgeProfile(createRng(1), 12, 30, 8);
    const b = generateRidgeProfile(createRng(2), 12, 30, 8);
    expect(a).not.toEqual(b);
  });

  it('nessun picco scende sotto zero anche con varianza grande', () => {
    const profile = generateRidgeProfile(createRng(7), 40, 5, 50);
    for (const peak of profile) {
      expect(peak).toBeGreaterThanOrEqual(0);
    }
  });

  it('resta entro baseHeight ± variance', () => {
    const baseHeight = 40;
    const variance = 10;
    const profile = generateRidgeProfile(createRng(9), 30, baseHeight, variance);
    for (const peak of profile) {
      expect(peak).toBeGreaterThanOrEqual(Math.max(0, baseHeight - variance));
      expect(peak).toBeLessThanOrEqual(baseHeight + variance);
    }
  });
});

describe('generateVillageLayout', () => {
  it('produce esattamente houseCount case', () => {
    const layout = generateVillageLayout(createRng(3), 9, 20);
    expect(layout).toHaveLength(9);
  });

  it('stesso seed → stesso layout', () => {
    const a = generateVillageLayout(createRng(11), 9, 20);
    const b = generateVillageLayout(createRng(11), 9, 20);
    expect(a).toEqual(b);
  });

  it('semi diversi → layout diversi', () => {
    const a = generateVillageLayout(createRng(1), 9, 20);
    const b = generateVillageLayout(createRng(2), 9, 20);
    expect(a).not.toEqual(b);
  });

  it('esattamente una casa ospita il campanile', () => {
    const layout = generateVillageLayout(createRng(5), 9, 20);
    const towers = layout.filter((house) => house.isTower);
    expect(towers).toHaveLength(1);
  });

  it('con houseCount 0 non produce case', () => {
    expect(generateVillageLayout(createRng(1), 0, 20)).toEqual([]);
  });

  it('le case restano ragionevolmente dentro lo spread (con un margine per il jitter)', () => {
    const spread = 20;
    const layout = generateVillageLayout(createRng(4), 16, spread);
    for (const house of layout) {
      expect(Math.abs(house.x)).toBeLessThanOrEqual(spread * 1.5);
      expect(Math.abs(house.z)).toBeLessThanOrEqual(spread * 1.5);
    }
  });
});

describe('buildValleyFloor', () => {
  /** Normale geometrica di un triangolo del fondovalle, calcolata dai vertici
   *  nell'ordine in cui li legge il rasterizzatore: è l'avvolgimento a
   *  decidere quale faccia è quella frontale, non l'attributo `normal`. */
  function triangleNormal(mesh: THREE.Mesh, triangle: number): THREE.Vector3 {
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    const position = geometry.getAttribute('position');
    const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = index?.getX(triangle * 3 + corner) ?? 0;
      vertices[corner]?.fromBufferAttribute(position, slot);
    }
    const [a, b, c] = vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    return new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
  }

  it("entrambi i triangoli guardano verso l'alto, cioè verso la camera", () => {
    // Regressione: con l'avvolgimento sbagliato le normali valevano (0,-1,0) e
    // il fondovalle, disegnato con un materiale a side: FrontSide, spariva.
    const mesh = buildValleyFloor();
    for (const triangle of [0, 1]) {
      expect(triangleNormal(mesh, triangle).y).toBeGreaterThan(0.99);
    }
  });

  it("copre l'intervallo di profondità e la larghezza di config", () => {
    const cfg = CONFIG.render.backdrop;
    const mesh = buildValleyFloor();
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    expect(box).not.toBeNull();
    expect(box?.min.z).toBeCloseTo(cfg.valleyDistance, 6);
    expect(box?.max.z).toBeCloseTo(cfg.valleyDistance + cfg.valleyDepth, 6);
    expect(box?.max.x).toBeCloseTo(cfg.valleyWidth / 2, 6);
    expect(box?.min.y).toBeCloseTo(cfg.valleyY, 6);
  });
});

/* ------------------------------------------------------------------------ *
 * Abbassamento del fondale sul pendio inclinato.
 *
 * I conti qui sotto sono rifatti da capo, non richiamati da backdrop.ts: il
 * punto di questi test è che la geometria TORNI, non che la funzione sia
 * uguale a se stessa. La camera è quella con il rig già inclinato
 * (render/scene.ts), gli angoli sono misurati rispetto all'orizzonte e sono
 * negativi sotto di esso.
 * ------------------------------------------------------------------------ */

/** Fin dove arriva il pendio nel momento peggiore del ciclo di riciclo dei
 *  chunk: è la stessa definizione di TERRAIN_FAR_Z in backdrop.ts. */
const TERRAIN_FAR_Z =
  CONFIG.world.chunkLength * (CONFIG.world.chunkCount - 1) + CONFIG.world.despawnBehindZ;

const SIZES: readonly number[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

function cameraAt(size: number, slope: number): { y: number; z: number } {
  const height = cameraHeightFor(size);
  const distance = cameraDistanceFor(size);
  return {
    y: slopeTiltY(height, -distance, slope),
    z: slopeTiltZ(height, -distance, slope),
  };
}

/** Angolo a cui il pendio svanisce. `farZ` è il bordo lontano del terreno:
 *  oscilla di un chunk mentre i chunk si riciclano, e i due estremi danno il
 *  caso peggiore per i due vincoli opposti (vuoto e occlusione). */
function vanishAngle(size: number, slope: number, farZ: number): number {
  const camera = cameraAt(size, slope);
  return Math.atan((-farZ * Math.sin(slope) - camera.y) / (farZ * Math.cos(slope) - camera.z));
}

/** Angolo a cui si vede un punto del fondale, già abbassato di `drop`. */
function backdropAngle(
  size: number,
  slope: number,
  drop: number,
  y: number,
  depth: number,
): number {
  return Math.atan((y + drop - cameraAt(size, slope).y) / depth);
}

/** Le creste come le genera davvero createBackdrop: stesso seed, stesso
 *  ordine di consumo dell'rng, stesse cime. */
function realCrests(): RidgeCrest[] {
  const cfg = CONFIG.render.backdrop;
  const rng = createRng(cfg.seed);
  const crests: RidgeCrest[] = [];
  for (let layer = 0; layer < cfg.ridgeLayers; layer += 1) {
    const depth = cfg.ridgeBaseDistance + layer * cfg.ridgeLayerSpacing;
    const depthScale = depth / cfg.ridgeBaseDistance;
    const profile = generateRidgeProfile(
      rng,
      cfg.ridgeSegments,
      cfg.ridgePeakHeight * depthScale,
      cfg.ridgePeakVariance * depthScale,
    );
    crests.push({ depth, topY: cfg.ridgeBaseY + Math.max(...profile) });
  }
  return crests;
}

const CRESTS = realCrests();
const DROP = backdropDrop(WORLD_SLOPE, CRESTS);
const HALF_MIN_FOV = ((CONFIG.render.cameraMinFov / 2) * Math.PI) / 180;
const HALF_MAX_FOV = ((CONFIG.render.cameraMaxFov / 2) * Math.PI) / 180;

describe('backdropDrop', () => {
  it('a mondo piatto non muove nulla: il panorama resta esattamente quello tarato in config', () => {
    expect(backdropDrop(0, CRESTS)).toBe(0);
  });

  it('più ripido è il pendio, più il fondale scende', () => {
    const gentle = backdropDrop((3 * Math.PI) / 180, CRESTS);
    const steep = backdropDrop((9 * Math.PI) / 180, CRESTS);
    expect(gentle).toBeLessThan(0);
    expect(steep).toBeLessThan(gentle);
  });

  it('NIENTE VUOTO: il bordo vicino del fondovalle resta nascosto dietro il pendio, a ogni taglia', () => {
    for (const size of SIZES) {
      // Caso peggiore: il pendio più corto del ciclo, cioè quello che lascia
      // scoperta la fascia più ampia.
      const vanish = vanishAngle(size, WORLD_SLOPE, TERRAIN_FAR_Z);
      const valleyNear = backdropAngle(
        size,
        WORLD_SLOPE,
        DROP,
        CONFIG.render.backdrop.valleyY,
        CONFIG.render.backdrop.valleyDistance,
      );
      expect(valleyNear).toBeLessThanOrEqual(vanish);
    }
  });

  it('NIENTE CIME TAGLIATE nell inquadratura di partenza (taglia 1, FOV minimo)', () => {
    for (const crest of CRESTS) {
      const angle = backdropAngle(1, WORLD_SLOPE, DROP, crest.topY, crest.depth);
      expect(angle + cameraPitchFor(1)).toBeLessThan(HALF_MIN_FOV);
    }
  });

  it('NIENTE CIME TAGLIATE a qualunque taglia, quando la velocità ha aperto il FOV', () => {
    // Alle taglie alte la camera guarda più in basso, ma per ingrassare serve
    // una corsa lunga: a quel punto la velocità è alta e il FOV è aperto. È
    // l'unica accoppiata che questo impianto garantisce — taglia massima a
    // velocità di partenza resta scoperta, e lì le cime più alte del piano
    // più lontano escono di un paio di gradi dal bordo.
    for (const size of SIZES) {
      for (const crest of CRESTS) {
        const angle = backdropAngle(size, WORLD_SLOPE, DROP, crest.topY, crest.depth);
        expect(angle + cameraPitchFor(size)).toBeLessThan(HALF_MAX_FOV);
      }
    }
  });

  it('il paese resta visibile: non finisce dietro il pendio', () => {
    const cfg = CONFIG.render.backdrop;
    for (const size of SIZES) {
      // Caso peggiore per la visibilità: il pendio più lungo del ciclo, che è
      // quello che nasconde di più. Si guarda il campanile sul bordo lontano
      // del villaggio, cioè l'edificio più in alto in quadro: se sparisce
      // anche lui il paese non c'è più. Le case vicine, più basse e più in
      // giù, spuntano da dietro il bordo del pendio solo in parte, ed è
      // giusto così — sono appoggiate nella valle, non incollate sopra.
      const vanish = vanishAngle(size, WORLD_SLOPE, TERRAIN_FAR_Z + CONFIG.world.chunkLength);
      const tower = backdropAngle(
        size,
        WORLD_SLOPE,
        DROP,
        cfg.valleyY + cfg.village.towerHeight,
        cfg.village.distance + cfg.village.spread,
      );
      expect(tower).toBeGreaterThan(vanish);
    }
  });

  it('LA DISCESA SI VEDE: fra il punto in cui il pendio svanisce e l orizzonte c è una fascia larga', () => {
    // È la misura di ciò che il proprietario ha chiesto. Su un mondo piatto
    // quella fascia vale un grado e mezzo — un filo — e il pendio sembra una
    // pianura infinita; qui dentro ci devono stare fondovalle, paese e la base
    // delle creste.
    for (const size of SIZES) {
      const flat = -vanishAngle(size, 0, TERRAIN_FAR_Z);
      const tilted = -vanishAngle(size, WORLD_SLOPE, TERRAIN_FAR_Z);
      expect(flat).toBeLessThan((3 * Math.PI) / 180);
      expect(tilted).toBeGreaterThan((5 * Math.PI) / 180);
    }
  });

  it('e in quella fascia ci finisce davvero il fondovalle, non del cielo vuoto', () => {
    for (const size of SIZES) {
      const vanish = vanishAngle(size, WORLD_SLOPE, TERRAIN_FAR_Z);
      // La base della cresta più vicina sta sopra la linea del pendio: fra le
      // due si vede il fondovalle, che è esattamente il punto.
      const ridgeBase = backdropAngle(
        size,
        WORLD_SLOPE,
        DROP,
        CONFIG.render.backdrop.ridgeBaseY,
        CONFIG.render.backdrop.ridgeBaseDistance,
      );
      expect(ridgeBase).toBeGreaterThan(vanish);
      expect(ridgeBase).toBeLessThan(0);
    }
  });
});
