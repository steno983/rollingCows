import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { MODELS, PALETTE, buildGeometry, type VoxelModel } from './models';

function solidCube(size: number, colorIndex = 0): VoxelModel {
  const voxels: number[][] = [];
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) voxels.push([x, y, z, colorIndex]);
    }
  }
  return { voxels, palette: PALETTE };
}

function faceCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  expect(index).not.toBeNull();
  return (index?.count ?? 0) / 6;
}

describe('buildGeometry — omissione delle facce interne', () => {
  it('un cubo pieno 2x2x2 genera esattamente 24 facce esterne e nessuna interna', () => {
    const geometry = buildGeometry(solidCube(2), 1);
    // 8 cubetti x 3 facce esposte ciascuno = 24 facce (senza culling sarebbero 48).
    expect(faceCount(geometry)).toBe(24);
    expect(geometry.getAttribute('position').count).toBe(24 * 4);
    expect(geometry.getIndex()?.count).toBe(24 * 6);
  });

  it('un cubo pieno 3x3x3 espone solo la superficie: 54 facce, il cubetto centrale sparisce', () => {
    const geometry = buildGeometry(solidCube(3), 1);
    expect(faceCount(geometry)).toBe(6 * 9);
  });

  it('un singolo cubetto isolato ha tutte e 6 le facce', () => {
    const geometry = buildGeometry({ voxels: [[0, 0, 0, 0]], palette: PALETTE }, 1);
    expect(faceCount(geometry)).toBe(6);
  });
});

describe('buildGeometry — forma degli attributi', () => {
  it('ogni modello ha 4 vertici per faccia e 6 indici per faccia', () => {
    for (const model of Object.values(MODELS)) {
      const geometry = buildGeometry(model, CONFIG.render.voxelSize);
      const faces = faceCount(geometry);
      expect(faces).toBeGreaterThan(0);
      expect(geometry.getAttribute('position').count).toBe(faces * 4);
      expect(geometry.getAttribute('normal').count).toBe(faces * 4);
      expect(geometry.getAttribute('color').count).toBe(faces * 4);
      expect(geometry.getIndex()?.count).toBe(faces * 6);
    }
  });

  it('nessun modello sfora il budget di triangoli per istanza', () => {
    for (const model of Object.values(MODELS)) {
      const geometry = buildGeometry(model, CONFIG.render.voxelSize);
      expect(faceCount(geometry) * 2).toBeLessThan(4000);
    }
  });
});

describe('buildGeometry — centratura', () => {
  it('ogni modello è centrato su X e Z e appoggiato a y = 0', () => {
    for (const model of Object.values(MODELS)) {
      const geometry = buildGeometry(model, CONFIG.render.voxelSize);
      const box = geometry.boundingBox;
      expect(box).not.toBeNull();
      if (box === null) continue;
      expect(box.min.x).toBeCloseTo(-box.max.x, 6);
      expect(box.min.z).toBeCloseTo(-box.max.z, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(0);
    }
  });

  it('la scala è quella di voxelSize', () => {
    const geometry = buildGeometry(solidCube(4), 0.25);
    const box = geometry.boundingBox;
    expect(box?.max.y).toBeCloseTo(1, 6);
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeCloseTo(1, 6);
  });
});

describe('MODELS', () => {
  it('la mucca sta dentro una corsia e ha la profondità di un animale', () => {
    const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
    const box = geometry.boundingBox;
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    const depth = (box?.max.z ?? 0) - (box?.min.z ?? 0);
    expect(width).toBeLessThanOrEqual(CONFIG.world.laneWidth);
    expect(depth).toBeGreaterThan(width);
  });

  it('la baita occupa due corsie senza sforarle', () => {
    const geometry = buildGeometry(MODELS.cabin, CONFIG.render.voxelSize);
    const box = geometry.boundingBox;
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    expect(width).toBeGreaterThan(CONFIG.world.laneWidth);
    expect(width).toBeLessThanOrEqual(CONFIG.world.laneWidth * 2);
  });

  it('espone un modello per ogni kind usato dal gioco', () => {
    const kinds = [
      'cow', 'rock', 'tree', 'fence', 'cabin', 'crevasse', 'branch', 'snowflake', 'hay',
    ] as const;
    for (const kind of kinds) {
      expect(MODELS[kind].voxels.length).toBeGreaterThan(0);
    }
  });
});

describe('palette', () => {
  it('i colori nei vertici corrispondono alla palette del modello', () => {
    const pinkIndex = 2;
    const geometry = buildGeometry({ voxels: [[0, 0, 0, pinkIndex]], palette: PALETTE }, 1);
    const expected = new THREE.Color().setHex(PALETTE[pinkIndex] ?? 0, THREE.SRGBColorSpace);
    const colors = geometry.getAttribute('color');
    expect(colors.count).toBe(24);
    for (let i = 0; i < colors.count; i += 1) {
      expect(colors.getX(i)).toBeCloseTo(expected.r, 6);
      expect(colors.getY(i)).toBeCloseTo(expected.g, 6);
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 6);
    }
  });

  it('ogni indice colore usato dai modelli esiste nella palette', () => {
    for (const model of Object.values(MODELS)) {
      for (const voxel of model.voxels) {
        const index = voxel[3] ?? -1;
        expect(model.palette[index]).toBeTypeOf('number');
      }
    }
  });
});
