import * as THREE from 'three';
import type { ObstacleKind, PickupKind } from '../game/types';

export interface VoxelModel {
  /** [x, y, z, colorIndex] per cubetto */
  voxels: readonly number[][];
  palette: readonly number[];
}

/** Palette condivisa da tutti i modelli: 13 colori, alta montagna. */
export const PALETTE: readonly number[] = [
  0xffffff, //  0 neve / pelo bianco
  0x1c1c22, //  1 nero
  0xff9ec4, //  2 rosa del muso
  0xf2d6a2, //  3 corno / legno chiaro
  0x8d8f96, //  4 roccia
  0x6b6d74, //  5 roccia scura
  0x5a3a24, //  6 legno
  0x2f7a46, //  7 abete
  0x1f5c34, //  8 abete scuro
  0xb43a3a, //  9 tetto della baita
  0xe0c060, // 10 fieno
  0x123048, // 11 buio del crepaccio
  0x9fd8ff, // 12 ghiaccio
];

const SNOW = 0;
const BLACK = 1;
const PINK = 2;
const LIGHT_WOOD = 3;
const ROCK = 4;
const ROCK_DARK = 5;
const WOOD = 6;
const PINE = 7;
const PINE_DARK = 8;
const ROOF = 9;
const HAY = 10;
const VOID = 11;
const ICE = 12;

/**
 * Griglia logica in cui vivono i modelli: 64³ celle centrate sull'origine.
 * La chiave impacchettata evita di allocare stringhe per ogni cubetto.
 */
const GRID = 64;
const GRID_ORIGIN = 32;

function packKey(x: number, y: number, z: number): number {
  return ((x + GRID_ORIGIN) * GRID + (y + GRID_ORIGIN)) * GRID + (z + GRID_ORIGIN);
}

interface VoxelBuilder {
  set(x: number, y: number, z: number, color: number): void;
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number): void;
  build(): VoxelModel;
}

function createBuilder(): VoxelBuilder {
  const cells = new Map<number, number>();

  const set = (x: number, y: number, z: number, color: number): void => {
    cells.set(packKey(x, y, z), color);
  };

  const box = (
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    color: number,
  ): void => {
    for (let i = 0; i < w; i += 1) {
      for (let j = 0; j < h; j += 1) {
        for (let k = 0; k < d; k += 1) set(x + i, y + j, z + k, color);
      }
    }
  };

  const build = (): VoxelModel => {
    const voxels: number[][] = [];
    for (const [key, color] of cells) {
      const z = (key % GRID) - GRID_ORIGIN;
      const y = (Math.floor(key / GRID) % GRID) - GRID_ORIGIN;
      const x = Math.floor(key / (GRID * GRID)) - GRID_ORIGIN;
      voxels.push([x, y, z, color]);
    }
    return { voxels, palette: PALETTE };
  };

  return { set, box, build };
}

/** Mucca: 8 largo × 7 alto × 11 profondo. Il muso guarda verso +z. */
function buildCow(): VoxelModel {
  const b = createBuilder();
  // corpo
  b.box(0, 2, 0, 8, 3, 8, SNOW);
  // macchie nere, dipinte sopra al corpo già riempito
  b.box(1, 2, 1, 2, 2, 2, BLACK);
  b.box(5, 3, 4, 2, 2, 2, BLACK);
  b.box(3, 4, 1, 2, 1, 2, BLACK);
  b.box(0, 2, 5, 1, 2, 2, BLACK);
  b.box(7, 2, 2, 1, 2, 2, BLACK);
  // testa e muso
  b.box(2, 3, 8, 4, 3, 2, SNOW);
  b.box(2, 3, 9, 4, 1, 1, PINK);
  b.set(2, 5, 9, BLACK);
  b.set(5, 5, 9, BLACK);
  // orecchie e corna
  b.set(1, 4, 8, BLACK);
  b.set(6, 4, 8, BLACK);
  b.set(2, 6, 8, LIGHT_WOOD);
  b.set(5, 6, 8, LIGHT_WOOD);
  // quattro zampe
  b.box(0, 0, 1, 2, 2, 2, BLACK);
  b.box(6, 0, 1, 2, 2, 2, BLACK);
  b.box(0, 0, 5, 2, 2, 2, BLACK);
  b.box(6, 0, 5, 2, 2, 2, BLACK);
  // coda
  b.set(3, 4, -1, BLACK);
  b.set(3, 5, -1, BLACK);
  return b.build();
}

/** Masso: ellissoide riempito per scansione, con venature più scure. */
function buildRock(): VoxelModel {
  const b = createBuilder();
  const rx = 3;
  const ry = 2;
  const rz = 3;
  for (let x = -rx; x <= rx; x += 1) {
    for (let y = 0; y <= ry * 2; y += 1) {
      for (let z = -rz; z <= rz; z += 1) {
        const dx = x / (rx + 0.5);
        const dy = (y - ry) / (ry + 1.2);
        const dz = z / (rz + 0.5);
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        b.set(x, y, z, (x + y + z) % 3 === 0 ? ROCK_DARK : ROCK);
      }
    }
  }
  return b.build();
}

/** Abete: tronco 3×3 e quattro palchi di chioma a rombo, punta innevata. */
function buildTree(): VoxelModel {
  const b = createBuilder();
  b.box(-1, 0, -1, 3, 5, 3, WOOD);
  for (let layer = 0; layer < 4; layer += 1) {
    const radius = 3 - layer;
    const baseY = 4 + layer * 2;
    const color = layer % 2 === 0 ? PINE : PINE_DARK;
    for (let y = baseY; y < baseY + 2; y += 1) {
      const r = y === baseY ? radius : Math.max(0, radius - 1);
      for (let x = -r; x <= r; x += 1) {
        for (let z = -r; z <= r; z += 1) {
          if (Math.abs(x) + Math.abs(z) > r + 1) continue;
          b.set(x, y, z, color);
        }
      }
    }
  }
  b.set(0, 12, 0, SNOW);
  return b.build();
}

/** Staccionata: due pali, due traverse e una diagonale. */
function buildFence(): VoxelModel {
  const b = createBuilder();
  b.box(-3, 0, 0, 1, 5, 2, WOOD);
  b.box(3, 0, 0, 1, 5, 2, WOOD);
  b.box(-3, 2, 0, 7, 1, 2, LIGHT_WOOD);
  b.box(-3, 4, 0, 7, 1, 2, LIGHT_WOOD);
  for (let i = 0; i < 5; i += 1) b.set(-2 + i, i, 0, LIGHT_WOOD);
  b.box(-3, 0, 0, 1, 1, 2, SNOW);
  b.box(3, 0, 0, 1, 1, 2, SNOW);
  return b.build();
}

/**
 * Baita: 15 largo (3.75 unità, dentro le due corsie), volume PIENO.
 * Pieno e non cavo di proposito: il culling delle facce interne elimina tutto
 * ciò che non si vede, mentre una scatola cava esporrebbe anche le pareti
 * interne raddoppiando i triangoli senza che nessuno le veda mai.
 */
function buildCabin(): VoxelModel {
  const b = createBuilder();
  const halfWidth = 7;
  const depth = 9;
  const wallHeight = 8;
  b.box(-halfWidth, 0, 0, halfWidth * 2 + 1, wallHeight, depth, WOOD);
  // travi chiare sul guscio, ogni tre file
  for (let y = 1; y < wallHeight; y += 3) {
    for (let x = -halfWidth; x <= halfWidth; x += 1) {
      b.set(x, y, 0, LIGHT_WOOD);
      b.set(x, y, depth - 1, LIGHT_WOOD);
    }
    for (let z = 0; z < depth; z += 1) {
      b.set(-halfWidth, y, z, LIGHT_WOOD);
      b.set(halfWidth, y, z, LIGHT_WOOD);
    }
  }
  // tetto a due falde, che rientra di due celle per ogni palco
  for (let layer = 0; ; layer += 1) {
    const x0 = -halfWidth + layer * 2;
    const x1 = halfWidth - layer * 2;
    if (x0 > x1) break;
    b.box(x0, wallHeight + layer, -1, x1 - x0 + 1, 1, depth + 2, ROOF);
  }
  // porta sulla facciata rivolta al giocatore
  b.box(-1, 0, depth - 1, 3, 5, 1, VOID);
  return b.build();
}

/** Crepaccio: lastra scura di una cella con il bordo di ghiaccio. */
function buildCrevasse(): VoxelModel {
  const b = createBuilder();
  for (let x = -3; x <= 3; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      const rim = Math.abs(x) === 3 || Math.abs(z) === 3;
      b.set(x, 0, z, rim ? ICE : VOID);
    }
  }
  return b.build();
}

/** Ramo sospeso: sbarra orizzontale con tre ciuffi di aghi. */
function buildBranch(): VoxelModel {
  const b = createBuilder();
  b.box(-4, 0, 0, 9, 2, 2, WOOD);
  b.set(-3, 2, 0, PINE);
  b.set(-3, 2, 1, PINE);
  b.set(0, 2, 0, PINE_DARK);
  b.set(0, 2, 1, PINE_DARK);
  b.set(3, 2, 0, PINE);
  b.set(3, 2, 1, PINE);
  return b.build();
}

/** Fiocco di neve: croce 5×5 con un accenno di spessore. */
function buildSnowflake(): VoxelModel {
  const b = createBuilder();
  for (let i = -2; i <= 2; i += 1) {
    b.set(i, 2, 0, SNOW);
    b.set(0, 2 + i, 0, SNOW);
  }
  b.set(0, 2, 1, ICE);
  b.set(0, 2, -1, ICE);
  b.set(1, 3, 0, ICE);
  b.set(-1, 3, 0, ICE);
  b.set(1, 1, 0, ICE);
  b.set(-1, 1, 0, ICE);
  return b.build();
}

/** Balla di fieno: cilindro con asse X, legature più chiare. */
function buildHay(): VoxelModel {
  const b = createBuilder();
  const r = 3;
  for (let x = -r; x <= r; x += 1) {
    for (let y = 0; y <= r * 2; y += 1) {
      for (let z = -r; z <= r; z += 1) {
        const dy = (y - r) / (r + 0.5);
        const dz = z / (r + 0.5);
        if (dy * dy + dz * dz > 1) continue;
        b.set(x, y, z, (y + z) % 4 === 0 ? LIGHT_WOOD : HAY);
      }
    }
  }
  return b.build();
}

/**
 * `cow` è una voce sola: la mucca del giocatore e il raccoglibile "altra mucca"
 * condividono il modello, il raccoglibile viene solo disegnato in scala ridotta
 * da entities-view.ts.
 */
export const MODELS: Record<'cow' | ObstacleKind | PickupKind, VoxelModel> = {
  cow: buildCow(),
  rock: buildRock(),
  tree: buildTree(),
  fence: buildFence(),
  cabin: buildCabin(),
  crevasse: buildCrevasse(),
  branch: buildBranch(),
  snowflake: buildSnowflake(),
  hay: buildHay(),
};

/**
 * Le sei facce del cubo unitario, con l'ordine dei vertici antiorario visto
 * da fuori: è ciò che rende corretti il backface culling e le normali.
 */
const FACES: readonly {
  nx: number;
  ny: number;
  nz: number;
  corners: readonly (readonly [number, number, number])[];
}[] = [
  { nx: 1, ny: 0, nz: 0, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { nx: -1, ny: 0, nz: 0, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { nx: 0, ny: 1, nz: 0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { nx: 0, ny: -1, nz: 0, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { nx: 0, ny: 0, nz: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { nx: 0, ny: 0, nz: -1, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/**
 * "Cuoce" un modello in UNA sola BufferGeometry indicizzata con i colori nei
 * vertici: un albero intero costa una draw call. Le facce con un cubetto
 * adiacente vengono omesse, e la geometria esce centrata su X e Z e appoggiata
 * a y = 0, così una entità si posiziona semplicemente con la sua (x, y, z).
 */
export function buildGeometry(model: VoxelModel, voxelSize: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (model.voxels.length === 0) return geometry;

  const occupied = new Set<number>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const voxel of model.voxels) {
    const x = voxel[0] ?? 0;
    const y = voxel[1] ?? 0;
    const z = voxel[2] ?? 0;
    occupied.add(packKey(x, y, z));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // Un cubetto in posizione x occupa l'intervallo [x, x+1): da qui il +1.
  const offsetX = -(minX + maxX + 1) / 2;
  const offsetY = -minY;
  const offsetZ = -(minZ + maxZ + 1) / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  let vertexCount = 0;

  for (const voxel of model.voxels) {
    const x = voxel[0] ?? 0;
    const y = voxel[1] ?? 0;
    const z = voxel[2] ?? 0;
    color.setHex(model.palette[voxel[3] ?? 0] ?? 0xff00ff, THREE.SRGBColorSpace);

    for (const face of FACES) {
      // faccia interna: c'è un cubetto attaccato, nessuno la vedrà mai
      if (occupied.has(packKey(x + face.nx, y + face.ny, z + face.nz))) continue;
      for (const corner of face.corners) {
        positions.push(
          (x + corner[0] + offsetX) * voxelSize,
          (y + corner[1] + offsetY) * voxelSize,
          (z + corner[2] + offsetZ) * voxelSize,
        );
        normals.push(face.nx, face.ny, face.nz);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(
        vertexCount, vertexCount + 1, vertexCount + 2,
        vertexCount, vertexCount + 2, vertexCount + 3,
      );
      vertexCount += 4;
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
