import * as THREE from 'three';
import type { EntityKind } from '../game/types';

export interface VoxelModel {
  /** [x, y, z, colorIndex] per cubetto */
  voxels: readonly number[][];
  palette: readonly number[];
}

/**
 * Palette condivisa da tutti i modelli, alta montagna.
 *
 * Regola che la governa: caldo e saturo significa "buff da prendere", e basta.
 * La scenografia (tetto della baita, fieno) è deliberatamente desaturata,
 * altrimenti il rosso del tetto e l'oro della balla di fieno danno al giocatore
 * lo stesso segnale a colpo d'occhio della calamita e della stella. Al
 * contrario, gli ostacoli chiari su neve chiara (cornicione, arco) hanno un
 * bordo scuro dedicato che li stacca dallo sfondo.
 */
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
  0x6c7f91, //  9 tetto della baita, blu-grigio spento
  0xbfae86, // 10 fieno, oro sporco
  0x123048, // 11 buio del crepaccio
  0x9fd8ff, // 12 ghiaccio
  0x2fe6d0, // 13 cristallo di ghiaccio (buff)
  0xd8fffa, // 14 riflesso del cristallo
  0xffcf3d, // 15 stella (buff), oro acceso
  0xfff3b0, // 16 nucleo della stella, oro chiaro
  0xe6483c, // 17 calamita (buff), rosso
  0xd7dde3, // 18 punte della calamita, acciaio
  0xc98f36, // 19 campanaccio (buff), ottone
  0x2b4a63, // 20 ombra del ghiaccio, per staccare il cornicione dalla neve
  0x3c4149, // 21 ombra della roccia, per staccare l'arco dalla neve
  0x4aa8d8, // 22 nucleo del fiocco di neve, azzurro saturo
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
const CRYSTAL = 13;
const CRYSTAL_LIGHT = 14;
const GOLD = 15;
const GOLD_LIGHT = 16;
const MAGNET_RED = 17;
const STEEL = 18;
const BRASS = 19;
const ICE_SHADOW = 20;
const ROCK_SHADOW = 21;
const ICE_CORE = 22;

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
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
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
 * Baita: 15 largo (3.75 unità, dentro il tracciato), volume PIENO.
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
  // Tetto a due falde, che rientra di due celle per ogni palco. È dello stesso
  // blu-grigio dei tetti del villaggio lontano (CONFIG.render.backdrop.village
  // .roofColor = 0x6c7f91), scelto lì proprio per non farli somigliare a un
  // ostacolo: la baita vicina aveva bisogno della stessa regola, perché il
  // rosso saturo che aveva prima è il colore della calamita.
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

/**
 * Fiocco di neve: croce 5×5 con un accenno di spessore.
 *
 * È il raccoglibile più frequente del gioco ed era bianco su neve bianca: le
 * braccia restano di neve, ma il nucleo — le due calotte in profondità, che
 * sono quelle che il giocatore vede di faccia, e i quattro raccordi diagonali —
 * passa a un azzurro saturo. Non è il verde-acqua del cristallo: quello deve
 * restare il segnale esclusivo di un buff.
 */
function buildSnowflake(): VoxelModel {
  const b = createBuilder();
  for (let i = -2; i <= 2; i += 1) {
    b.set(i, 2, 0, SNOW);
    b.set(0, 2 + i, 0, SNOW);
  }
  b.set(0, 2, 1, ICE_CORE);
  b.set(0, 2, -1, ICE_CORE);
  b.set(1, 3, 0, ICE_CORE);
  b.set(-1, 3, 0, ICE_CORE);
  b.set(1, 1, 0, ICE_CORE);
  b.set(-1, 1, 0, ICE_CORE);
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

/** Tronco caduto: cilindro orizzontale, con gli anelli di crescita segnati
 *  ai due tagli e due monconi di rami spezzati sul dorso. */
function buildLog(): VoxelModel {
  const b = createBuilder();
  const half = 7;
  const ry = 2;
  const rz = 2;
  for (let x = -half; x <= half; x += 1) {
    for (let y = 0; y <= ry * 2; y += 1) {
      for (let z = -rz; z <= rz; z += 1) {
        const dy = (y - ry) / (ry + 0.5);
        const dz = z / (rz + 0.5);
        if (dy * dy + dz * dz > 1) continue;
        const cutEnd = x === -half || x === half;
        const ring = Math.round(Math.hypot(y - ry, z)) % 2 === 0;
        b.set(x, y, z, cutEnd && ring ? LIGHT_WOOD : WOOD);
      }
    }
  }
  b.box(-3, ry * 2, -1, 1, 2, 2, WOOD);
  b.box(2, ry * 2, -1, 1, 2, 2, WOOD);
  return b.build();
}

/**
 * Arco di roccia: architrave che si ispessisce verso il centro. È SOLO
 * l'architrave (nessun pilastro): come `branch`, il modello vive vicino a
 * y = 0 nel proprio spazio locale, e la vista lo alza in quota con
 * `entity.y` (CONFIG.spawn.overheadY). Un pilastro che tocchi terra andrebbe
 * disegnato appeso a mezz'aria per qualunque `entity.y` diverso da 0, che è
 * esattamente il difetto da evitare.
 */
function buildArch(): VoxelModel {
  const b = createBuilder();
  const half = 8;
  for (let x = -half; x <= half; x += 1) {
    const rise = Math.round(Math.cos((x / half) * (Math.PI / 2)) * 2);
    const thickness = 2 + rise;
    for (let y = 0; y < thickness; y += 1) {
      for (let z = -2; z <= 2; z += 1) {
        // Stessa cura del cornicione: la fila più bassa è in ombra, perché
        // anche questo è un ostacolo sospeso e il grigio su bianco non basta
        // a segnalare da lontano dove finisce l'architrave.
        const shade = y === 0 ? ROCK_SHADOW : (x + y + z) % 4 === 0 ? ROCK_DARK : ROCK;
        b.set(x, y, z, shade);
      }
    }
  }
  return b.build();
}

/**
 * Cornicione di ghiaccio: mensola larga con una fila di ghiaccioli di
 * lunghezza variabile che pendono verso il basso.
 *
 * È l'ostacolo che richiede la reazione più anticipata di tutte (è sospeso) ed
 * era il meno leggibile del gioco: ghiaccio azzurro chiaro su neve azzurrina.
 * Resta di ghiaccio — è quello che è — ma la fila inferiore della mensola e la
 * punta di ogni ghiacciolo passano all'ombra scura, che gli disegna sotto una
 * linea netta contro lo sfondo.
 */
function buildCornice(): VoxelModel {
  const b = createBuilder();
  const half = 8;
  b.box(-half, 3, -2, half * 2 + 1, 1, 4, ICE);
  b.box(-half, 2, -2, half * 2 + 1, 1, 4, ICE_SHADOW);
  for (let x = -half + 1; x <= half - 1; x += 2) {
    const spike = 1 + (Math.abs(x * 7) % 3);
    for (let d = 0; d < spike; d += 1) {
      b.set(x, 1 - d, 0, d === spike - 1 ? ICE_SHADOW : ICE);
    }
  }
  return b.build();
}

/** Cristallo di ghiaccio (buff): tre schegge affusolate di taglia diversa,
 *  a sezione romboidale, con la punta più chiara. */
function buildCrystal(): VoxelModel {
  const b = createBuilder();
  const shards: readonly [number, number, number][] = [
    [0, 0, 5],
    [-2, 0, 3],
    [2, 1, 4],
  ];
  for (const [ox, oz, height] of shards) {
    for (let y = 0; y < height; y += 1) {
      const radius = Math.max(1, Math.round((height - y) * 0.4));
      for (let x = -radius; x <= radius; x += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          if (Math.abs(x) + Math.abs(z) > radius) continue;
          b.set(ox + x, y, oz + z, y === height - 1 ? CRYSTAL_LIGHT : CRYSTAL);
        }
      }
    }
  }
  return b.build();
}

/** Stella (buff): nucleo dorato con quattro punte lunghe (cardinali) e
 *  quattro corte (diagonali), come una scintilla a otto raggi. */
function buildStar(): VoxelModel {
  const b = createBuilder();
  b.box(-1, -1, -1, 3, 3, 3, GOLD_LIGHT);
  const long: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const short: readonly [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dx, dy] of long) {
    for (let i = 1; i <= 4; i += 1) {
      b.set(dx * (i + 1), dy * (i + 1), 0, i === 4 ? GOLD_LIGHT : GOLD);
    }
  }
  for (const [dx, dy] of short) {
    for (let i = 1; i <= 2; i += 1) {
      b.set(dx * (i + 1), dy * (i + 1), 0, GOLD);
    }
  }
  return b.build();
}

/** Calamita a ferro di cavallo (buff): due gambe piene, una curva alla base
 *  che le unisce (più bassa verso il centro, per leggersi come un arco), e
 *  punte in acciaio sulle due gambe. */
function buildMagnet(): VoxelModel {
  const b = createBuilder();
  const legHeight = 6;
  b.box(-3, 0, -1, 2, legHeight, 2, MAGNET_RED);
  b.box(1, 0, -1, 2, legHeight, 2, MAGNET_RED);
  for (let x = -3; x <= 2; x += 1) {
    const dx = (x + 0.5) / 3;
    const height = Math.max(1, Math.round((1 - dx * dx) * 3));
    b.box(x, 0, -1, 1, height, 2, MAGNET_RED);
  }
  b.box(-3, legHeight, -1, 2, 1, 2, STEEL);
  b.box(1, legHeight, -1, 2, 1, 2, STEEL);
  return b.build();
}

/** Campanaccio (buff scudo): corpo troncopiramidale in ottone, maniglia e
 *  batacchio in vista sotto l'apertura. */
function buildBell(): VoxelModel {
  const b = createBuilder();
  for (let layer = 0; layer < 4; layer += 1) {
    const radius = Math.max(1, 3 - layer);
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        if (Math.abs(x) + Math.abs(z) > radius + 1) continue;
        b.set(x, layer, z, BRASS);
      }
    }
  }
  b.box(-1, 4, 0, 3, 1, 1, BLACK);
  b.set(-1, 5, 0, BLACK);
  b.set(1, 5, 0, BLACK);
  b.set(0, -1, 0, BLACK);
  return b.build();
}

/**
 * `cow` resta per la mucca del giocatore e per l'eventuale scenografia
 * laterale: NON è più un raccoglibile (in v2 `PickupKind` non la contiene).
 * `cabin`, `tree` e `hay` restano per lo stesso motivo — scenografia, non
 * entità di gioco. Tutti gli altri kind sono gli `EntityKind` di v2.
 */
export const MODELS: Record<'cow' | 'cabin' | 'tree' | 'hay' | EntityKind, VoxelModel> = {
  cow: buildCow(),
  cabin: buildCabin(),
  tree: buildTree(),
  hay: buildHay(),
  rock: buildRock(),
  log: buildLog(),
  fence: buildFence(),
  crevasse: buildCrevasse(),
  branch: buildBranch(),
  arch: buildArch(),
  cornice: buildCornice(),
  snowflake: buildSnowflake(),
  crystal: buildCrystal(),
  star: buildStar(),
  magnet: buildMagnet(),
  bell: buildBell(),
};

/**
 * Le sei facce del cubo unitario, con l'ordine dei vertici antiorario visto
 * da fuori: è ciò che rende corretti il backface culling e le normali.
 */
interface CubeFace {
  nx: number;
  ny: number;
  nz: number;
  corners: readonly (readonly [number, number, number])[];
}

const FACES: readonly CubeFace[] = [
  {
    nx: 1,
    ny: 0,
    nz: 0,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    nx: -1,
    ny: 0,
    nz: 0,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    nx: 0,
    ny: 1,
    nz: 0,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    nx: 0,
    ny: -1,
    nz: 0,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    nx: 0,
    ny: 0,
    nz: 1,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    nx: 0,
    ny: 0,
    nz: -1,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

/**
 * Fattore di luminosità per i quattro livelli di occlusione, dal vertice
 * completamente chiuso a quello libero. Il colore dei vertici è già in spazio
 * lineare (`setHex` con SRGBColorSpace e ColorManagement attivo), quindi
 * moltiplicare qui è fisicamente corretto: la curva percepita è molto più
 * dolce di quanto i numeri lascino pensare.
 */
const AO_SHADE: readonly number[] = [0.55, 0.72, 0.87, 1];

/**
 * Livello di occlusione 0..3 di un singolo vertice. I tre vicini che contano
 * sono quelli che circondano l'angolo NEL PIANO davanti alla faccia, cioè a
 * partire dal blocco vuoto in (px, py, pz): i due laterali e il diagonale.
 * Se entrambi i laterali sono pieni lo spigolo è chiuso e il livello è 0 senza
 * guardare il diagonale, che lì dietro non è comunque visibile.
 *
 * Senza questo, tutta l'informazione di forma è delegata alla normale: sotto
 * il tetto della baita, fra le zampe della mucca o negli incastri dei palchi
 * dell'abete non ci sarebbe nessuno scurimento, ed è il motivo per cui un
 * modello voxel senza AO legge come un ammasso di scatole invece che come un
 * volume. Si paga una volta sola in fase di build.
 */
function vertexAo(
  occupied: ReadonlySet<number>,
  px: number,
  py: number,
  pz: number,
  face: CubeFace,
  corner: readonly [number, number, number],
): number {
  // I due assi tangenti alla faccia sono quelli a componente nulla nella
  // normale; u non ha mai componente z e v non ha mai componente x.
  const ux = face.nx !== 0 ? 0 : 1;
  const uy = face.nx !== 0 ? 1 : 0;
  const vy = face.nz !== 0 ? 1 : 0;
  const vz = face.nz !== 0 ? 0 : 1;
  // Da che parte cade l'angolo lungo ciascun asse: -1 o +1.
  const su = 2 * (corner[0] * ux + corner[1] * uy) - 1;
  const sv = 2 * (corner[1] * vy + corner[2] * vz) - 1;

  const sideU = occupied.has(packKey(px + su * ux, py + su * uy, pz)) ? 1 : 0;
  const sideV = occupied.has(packKey(px, py + sv * vy, pz + sv * vz)) ? 1 : 0;
  if (sideU === 1 && sideV === 1) return 0;
  const diagonal = occupied.has(packKey(px + su * ux, py + su * uy + sv * vy, pz + sv * vz))
    ? 1
    : 0;
  return 3 - (sideU + sideV + diagonal);
}

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

      const ao: number[] = [];
      for (const corner of face.corners) {
        const level = vertexAo(occupied, x + face.nx, y + face.ny, z + face.nz, face, corner);
        ao.push(level);
        positions.push(
          (x + corner[0] + offsetX) * voxelSize,
          (y + corner[1] + offsetY) * voxelSize,
          (z + corner[2] + offsetZ) * voxelSize,
        );
        normals.push(face.nx, face.ny, face.nz);
        const shade = AO_SHADE[level] ?? 1;
        colors.push(color.r * shade, color.g * shade, color.b * shade);
      }

      // Con AO anisotropi sui quattro angoli la diagonale 0-2 taglierebbe il
      // gradiente di traverso e si vedrebbe lo spigolo del triangolo: in quel
      // caso si ribalta sulla 1-3, mantenendo l'ordine antiorario.
      const ao0 = ao[0] ?? 3;
      const ao1 = ao[1] ?? 3;
      const ao2 = ao[2] ?? 3;
      const ao3 = ao[3] ?? 3;
      if (ao0 + ao2 === ao1 + ao3) {
        indices.push(
          vertexCount,
          vertexCount + 1,
          vertexCount + 2,
          vertexCount,
          vertexCount + 2,
          vertexCount + 3,
        );
      } else {
        indices.push(
          vertexCount + 1,
          vertexCount + 2,
          vertexCount + 3,
          vertexCount + 1,
          vertexCount + 3,
          vertexCount,
        );
      }
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
