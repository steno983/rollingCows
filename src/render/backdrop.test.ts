import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import { buildValleyFloor, generateRidgeProfile, generateVillageLayout } from './backdrop';

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
