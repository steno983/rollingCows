import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import type { EntityKind } from '../game/types';
import { buildGeometry, MODELS, PALETTE, type VoxelModel } from './models';

type ModelKind = 'cow' | 'cabin' | 'tree' | 'hay' | EntityKind;

const ALL_KINDS: readonly ModelKind[] = [
  'cow',
  'cabin',
  'tree',
  'hay',
  'rock',
  'log',
  'fence',
  'crevasse',
  'branch',
  'arch',
  'cornice',
  'snowflake',
  'crystal',
  'star',
  'magnet',
  'bell',
];

const OBSTACLE_KINDS = ['rock', 'log', 'fence', 'crevasse', 'branch', 'arch', 'cornice'] as const;
const BUFF_KINDS = ['crystal', 'star', 'magnet', 'bell'] as const;
const SCENERY_KINDS = ['cow', 'cabin', 'tree', 'hay'] as const;

/** Indice del ghiaccio pallido nella palette (vedi il commento su PALETTE). */
const ICE_INDEX = 12;

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

/** Il colore più frequente di un modello: usato per verificare che i buff si
 *  distinguano a colpo d'occhio, non solo che abbiano una palette diversa. */
function dominantColorHex(kind: ModelKind): number {
  const model = MODELS[kind];
  const counts = new Map<number, number>();
  for (const voxel of model.voxels) {
    const index = voxel[3] ?? 0;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [index, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = index;
    }
  }
  return model.palette[best] ?? 0;
}

/**
 * Cromaticità di un colore sRGB, 0 = grigio. Non uso la saturazione HSL perché
 * per i colori pallidi vale 1 (il ghiaccio 0x9fd8ff è "saturo al 100%" in HSL),
 * e qui interessa proprio distinguere un pastello da un colore acceso.
 */
function chroma(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Luminanza percepita 0..1 di un colore sRGB. */
function luma(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** I colori davvero usati da un modello, non tutta la palette condivisa. */
function usedColors(kind: ModelKind): readonly number[] {
  const model = MODELS[kind];
  const set = new Set<number>();
  for (const voxel of model.voxels) {
    const hex = model.palette[voxel[3] ?? 0];
    if (hex !== undefined) set.add(hex);
  }
  return [...set];
}

describe('buildGeometry — omissione delle facce interne', () => {
  it('un cubo pieno 2x2x2 genera esattamente 24 facce esterne e nessuna interna', () => {
    const geometry = buildGeometry(solidCube(2), 1);
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
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      const faces = faceCount(geometry);
      expect(faces).toBeGreaterThan(0);
      expect(geometry.getAttribute('position').count).toBe(faces * 4);
      expect(geometry.getAttribute('normal').count).toBe(faces * 4);
      expect(geometry.getAttribute('color').count).toBe(faces * 4);
      expect(geometry.getIndex()?.count).toBe(faces * 6);
    }
  });

  it('nessun modello sfora il budget di triangoli per istanza', () => {
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      expect(faceCount(geometry) * 2).toBeLessThan(4000);
    }
  });
});

describe('buildGeometry — occlusione ambientale nei vertici', () => {
  /** Il colore del vertice i, diviso per il colore nominale: è il fattore di
   *  AO applicato in fase di build. */
  function shadeAt(geometry: THREE.BufferGeometry, nominal: THREE.Color, i: number): number {
    const colors = geometry.getAttribute('color');
    return colors.getX(i) / nominal.r;
  }

  function minShade(geometry: THREE.BufferGeometry, nominal: THREE.Color): number {
    let min = Infinity;
    for (let i = 0; i < geometry.getAttribute('color').count; i += 1) {
      min = Math.min(min, shadeAt(geometry, nominal, i));
    }
    return min;
  }

  const nominal = new THREE.Color().setHex(PALETTE[0] ?? 0, THREE.SRGBColorSpace);

  it('un cubetto isolato non ha nessun vicino, quindi nessun vertice è occluso', () => {
    const geometry = buildGeometry({ voxels: [[0, 0, 0, 0]], palette: PALETTE }, 1);
    expect(minShade(geometry, nominal)).toBeCloseTo(1, 6);
  });

  it('una faccia piatta senza concavità resta al colore pieno', () => {
    const geometry = buildGeometry(solidCube(3), 1);
    // il cubo pieno ha solo spigoli convessi: nessun vicino occlude nulla
    expect(minShade(geometry, nominal)).toBeCloseTo(1, 6);
  });

  it('una concavità scurisce i vertici che vi si affacciano', () => {
    // gradino: il vertice del pavimento contro il muretto vede un vicino
    const geometry = buildGeometry(
      {
        voxels: [
          [0, 0, 0, 0],
          [1, 0, 0, 0],
          [0, 1, 0, 0],
        ],
        palette: PALETTE,
      },
      1,
    );
    expect(minShade(geometry, nominal)).toBeLessThan(1);
  });

  it('uno spigolo interno chiuso arriva al livello di occlusione massimo', () => {
    // i due laterali dell'angolo sono entrambi pieni: livello 0, senza che il
    // diagonale conti nulla
    const geometry = buildGeometry(
      {
        voxels: [
          [0, 0, 0, 0],
          [1, 0, 1, 0],
          [0, 1, 1, 0],
        ],
        palette: PALETTE,
      },
      1,
    );
    expect(minShade(geometry, nominal)).toBeCloseTo(0.55, 6);
  });

  it('i modelli con concavità vere hanno vertici scuri sulla stessa faccia', () => {
    // sotto la falda del tetto, nella rientranza della porta, fra le zampe
    for (const kind of ['cabin', 'cow', 'tree'] as const) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      const colors = geometry.getAttribute('color');
      let facesWithGradient = 0;
      for (let face = 0; face * 4 < colors.count; face += 1) {
        let min = Infinity;
        let max = -Infinity;
        for (let v = 0; v < 4; v += 1) {
          const lum =
            colors.getX(face * 4 + v) + colors.getY(face * 4 + v) + colors.getZ(face * 4 + v);
          min = Math.min(min, lum);
          max = Math.max(max, lum);
        }
        if (max - min > 1e-6) facesWithGradient += 1;
      }
      expect(facesWithGradient).toBeGreaterThan(0);
    }
  });

  it("l'AO non aggiunge né toglie triangoli: restano 2 per faccia visibile", () => {
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      const vertices = geometry.getAttribute('position').count;
      expect(geometry.getIndex()?.count).toBe((vertices / 4) * 6);
    }
  });

  it('il ribaltamento della diagonale non inverte nessun triangolo', () => {
    // la diagonale si ribalta quando i quattro AO sono anisotropi: se sbagliasse
    // l'ordine dei vertici, il backface culling mangerebbe la faccia
    const edgeA = new THREE.Vector3();
    const edgeB = new THREE.Vector3();
    const geometric = new THREE.Vector3();
    const declared = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      const positions = geometry.getAttribute('position');
      const normals = geometry.getAttribute('normal');
      const index = geometry.getIndex();
      expect(index).not.toBeNull();
      if (index === null) continue;
      for (let t = 0; t < index.count; t += 3) {
        const i0 = index.getX(t);
        a.fromBufferAttribute(positions, i0);
        b.fromBufferAttribute(positions, index.getX(t + 1));
        c.fromBufferAttribute(positions, index.getX(t + 2));
        edgeA.subVectors(b, a);
        edgeB.subVectors(c, a);
        geometric.crossVectors(edgeA, edgeB).normalize();
        declared.fromBufferAttribute(normals, i0);
        expect(geometric.dot(declared)).toBeGreaterThan(0.99);
      }
    }
  });
});

describe('buildGeometry — centratura', () => {
  it('ogni modello è centrato su X e Z e appoggiato a y = 0', () => {
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
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
  it('espone un modello per ogni kind usato dal gioco, più le scenografie laterali', () => {
    for (const kind of ALL_KINDS) {
      expect(MODELS[kind].voxels.length).toBeGreaterThan(0);
    }
  });

  it('la mucca resta più stretta del tracciato', () => {
    const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
    const box = geometry.boundingBox;
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    const depth = (box?.max.z ?? 0) - (box?.min.z ?? 0);
    expect(width).toBeLessThanOrEqual(CONFIG.world.trackWidth);
    expect(depth).toBeGreaterThan(width * 0.5);
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
    for (const kind of ALL_KINDS) {
      const model = MODELS[kind];
      for (const voxel of model.voxels) {
        const index = voxel[3] ?? -1;
        expect(model.palette[index]).toBeTypeOf('number');
      }
    }
  });
});

describe('buff: riconoscibilità cromatica', () => {
  it('ogni buff ha un colore dominante diverso dagli altri tre', () => {
    const colors = BUFF_KINDS.map(dominantColorHex);
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        expect(colors[i]).not.toBe(colors[j]);
      }
    }
  });

  it('il colore dominante di ogni buff non coincide con quello di nessun ostacolo', () => {
    const obstacleColors = OBSTACLE_KINDS.map(dominantColorHex);
    for (const buff of BUFF_KINDS) {
      expect(obstacleColors).not.toContain(dominantColorHex(buff));
    }
  });
});

describe('leggibilità: la scenografia non deve mentire', () => {
  it('nessuna decorazione è accesa quanto un buff', () => {
    // "caldo e saturo" deve significare "da prendere" e basta: il tetto rosso
    // della baita e l'oro della balla di fieno davano lo stesso segnale a
    // colpo d'occhio della calamita e della stella
    const weakest = Math.min(...BUFF_KINDS.map((kind) => chroma(dominantColorHex(kind))));
    for (const kind of SCENERY_KINDS) {
      expect(chroma(dominantColorHex(kind))).toBeLessThan(weakest);
    }
  });

  it('il tetto della baita usa lo stesso blu-grigio dei tetti del villaggio', () => {
    expect(dominantColorHex('cabin')).not.toBe(dominantColorHex('magnet'));
    const roof = usedColors('cabin');
    expect(roof).toContain(CONFIG.render.backdrop.village.roofColor);
  });

  it('gli ostacoli chiari hanno un bordo scuro che li stacca dalla neve', () => {
    // cornicione e arco sono sospesi, cioè richiedono la reazione più
    // anticipata di tutte, ed erano ghiaccio su neve e grigio su bianco
    for (const kind of ['cornice', 'arch'] as const) {
      const darkest = Math.min(...usedColors(kind).map(luma));
      expect(darkest).toBeLessThan(luma(PALETTE[0] ?? 0) * 0.45);
    }
  });

  it('il fiocco di neve ha un nucleo più acceso del ghiaccio pallido', () => {
    // è il raccoglibile più frequente del gioco ed era bianco su neve bianca
    const brightest = Math.max(...usedColors('snowflake').map(chroma));
    expect(brightest).toBeGreaterThan(chroma(PALETTE[ICE_INDEX] ?? 0));
  });
});
