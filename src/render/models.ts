import * as THREE from 'three';
import type { EntityKind } from '../game/types';

export interface VoxelModel {
  /** [x, y, z, colorIndex] per cubetto */
  voxels: readonly number[][];
  palette: readonly number[];
  /**
   * Quanto è grande un cubetto di QUESTO modello rispetto a
   * CONFIG.render.voxelSize. Vale 1 per tutti i modelli tranne il crepaccio.
   *
   * Non è un vezzo: buildGeometry emette una faccia per ogni lato esposto,
   * senza greedy meshing, quindi il costo di una superficie cresce col
   * QUADRATO della risoluzione. Un crepaccio largo 4,4 unità e profondo 6,9
   * disegnato con cubetti da 0,25 sono 27 × 17 celle di solo fondo, cioè oltre
   * 1500 triangoli per un buco: dieci volte una mucca intera. Con cubetti più
   * grossi la stessa forma costa un quinto e legge anche meglio, perché un
   * ghiacciaio spezzato è fatto di blocchi grandi, non di granelli.
   */
  cellScale?: number;
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
  0x081826, // 23 abisso: il fondo del crepaccio, più cupo del buio 11
  0x33200f, // 24 ombra del legno, per la faccia inferiore del ramo sospeso
  0xd3d9de, // 25 legno sbiancato: la freccia SPENTA del cartello, quasi neve
  0x442c1b, // 26 legno del cartello ACCESO, gradino basso della pulsazione
  0x322014, // 27 legno del cartello acceso, gradino medio
  0x22160e, // 28 legno del cartello acceso, gradino profondo: quasi silhouette
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
const ABYSS = 23;
const WOOD_SHADOW = 24;
const PALE_WOOD = 25;
const WOOD_LIT_1 = 26;
const WOOD_LIT_2 = 27;
const WOOD_LIT_3 = 28;

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
  /** `cellScale` finisce nel modello: vedi VoxelModel.cellScale. */
  build(cellScale?: number): VoxelModel;
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

  const build = (cellScale = 1): VoxelModel => {
    const voxels: number[][] = [];
    for (const [key, color] of cells) {
      const z = (key % GRID) - GRID_ORIGIN;
      const y = (Math.floor(key / GRID) % GRID) - GRID_ORIGIN;
      const x = Math.floor(key / (GRID * GRID)) - GRID_ORIGIN;
      voxels.push([x, y, z, color]);
    }
    return { voxels, palette: PALETTE, cellScale };
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

/**
 * Cubetto del crepaccio, in multipli di CONFIG.render.voxelSize: 2,5 volte
 * quello di tutti gli altri modelli, cioè 0,625 unità. Vedi VoxelModel
 * .cellScale per il perché (il costo di una superficie va col quadrato della
 * risoluzione, e questo è l'unico modello largo quanto la pista).
 */
export const CHASM_CELL_SCALE = 2.5;

/**
 * Crepaccio VERO, quello in cui si cade — `crevasse` resta la lastra piatta
 * che si salta.
 *
 * Il vincolo che ne detta tutta la forma: il pendio è una mesh continua e
 * nessuno può bucarla (render/terrain.ts). Da una camera che sta SOPRA quel
 * piano, qualunque cosa disegnata sotto y = 0 finisce dietro alla neve e
 * sparisce: un pozzo con pareti che scendono davvero non si vedrebbe affatto.
 * Il buco quindi si recita interamente sopra il piano, e a farlo leggere sono
 * tre cose:
 *
 *  1. un fondo scuro a filo della neve (la vista lo affonda di una cella, vedi
 *     CHASM_Y_BIAS in entities-view.ts, così la faccia superiore combacia col
 *     pendio invece di sporgere come una piattaforma);
 *  2. un gradiente in profondità — abisso vicino, buio in mezzo, ombra del
 *     ghiaccio in fondo. Non è decorazione: da una camera che guarda in basso
 *     di ~13° un pozzo vero mostra il FONDO della parete lontana in basso
 *     sullo schermo (il punto più scuro) e la sua CIMA in alto, verso il bordo
 *     opposto. Il gradiente copia quell'ordine, ed è ciò che distingue un buco
 *     da una macchia di vernice;
 *  3. un bordo di ghiaccio spezzato rialzato di una cella — ma solo sui
 *     fianchi e sul lato LONTANO. Sul lato vicino resta piatto apposta: un
 *     labbro alto h nasconde h·(z+d)/(H−h) unità di terreno dietro di sé, che
 *     a 40 unità di distanza con la camera attuale (H ≈ 6,1, d ≈ 9) fa 5,6
 *     unità su 6,9 di crepaccio. Un bordo tutto intorno, cioè, cancellerebbe
 *     il buio proprio alla distanza da cui il crepaccio va letto.
 */
function buildChasm(): VoxelModel {
  const b = createBuilder();
  const halfX = 3; // 7 celle = 4,375 unità: più largo del corridoio (4)
  const halfZ = 5; // 11 celle = 6,875 unità in profondità

  for (let x = -halfX; x <= halfX; x += 1) {
    for (let z = -halfZ; z <= halfZ; z += 1) {
      const color = z <= -halfZ + 2 ? ABYSS : z <= 1 ? VOID : ICE_SHADOW;
      b.set(x, 0, z, color);
    }
  }

  // Blocchi di bordo alternati fra ghiaccio e ombra: un anello tutto dello
  // stesso azzurro pallido, su neve bianca, non si stacca da niente.
  const rim = (x: number, z: number, y = 1): void => {
    b.set(x, y, z, Math.abs(x * 2 + z) % 3 === 0 ? ICE_SHADOW : ICE);
  };
  for (let z = -halfZ; z <= halfZ; z += 1) {
    rim(-halfX, z);
    rim(halfX, z);
  }
  for (let x = -halfX + 1; x <= halfX - 1; x += 1) rim(x, halfZ);
  // Blocchi accavallati, perché la sagoma di un crepaccio non è un rettangolo:
  // costano cinque facce l'uno e si vedono subito. Stanno TUTTI sui fianchi,
  // a |x| ≥ 1,56 unità: sporgono 1,27 sopra la neve, e la mucca è larga due
  // unità, quindi nemmeno il salto peggiore fra quelli che riescono (quello
  // che esce dal crepaccio con la pancia a 0,1, il minimo che la collisione
  // concede) può attraversarli. In mezzo, dove la mucca passa, il bordo non
  // supera mai una cella.
  rim(-halfX, halfZ, 2);
  rim(-halfX, 1, 2);
  rim(-halfX, -halfZ, 2);
  rim(halfX, 3, 2);
  rim(halfX, -2, 2);
  rim(halfX, -halfZ, 2);

  return b.build(CHASM_CELL_SCALE);
}

/**
 * Cartello del bivio: palo scuro piantato nella neve e due frecce che puntano
 * una a destra e una a sinistra. Va nel cuneo fra i due rami, ed è un elemento
 * FUNZIONALE — ci si schianta se non si sceglie — quindi ha il diritto di
 * essere leggibile; ma resta legno spento, perché caldo e saturo nel gioco
 * significa "da raccogliere" e basta.
 *
 * Quello che si legge per primo, a sessanta unità, è la SAGOMA scura contro la
 * neve: per questo la tavola è tutta di legno scuro e finisce a punta, e la
 * striscia chiara che corre lungo l'asse — leggibile solo più da vicino — sta
 * DENTRO la sagoma, per non mangiarne il contrasto proprio sul bordo.
 *
 * LO STATO DELLA SCELTA. Il cartello è anche il riscontro di "cosa ho scelto",
 * che nessun altro elemento del mondo può dare: `lit` accende una freccia e ne
 * spegne l'altra. Su un fondo BIANCO "acceso" non può voler dire più chiaro —
 * più chiaro vuol dire meno contrasto, cioè meno visibile. Vuol dire più
 * SCURO: la freccia scelta resta legno pieno e prende una striscia di neve
 * dentro (massimo contrasto interno), quella scartata sbianca in un grigio
 * quasi-neve e piatto, senza dettaglio. A quaranta unità restano due macchie
 * con 0,6 di luminanza di differenza, che è un salto che si legge a colpo
 * d'occhio anche quando la freccia è larga pochi pixel.
 *
 * DA CHE PARTE STA "SINISTRA". Il modello vive in coordinate di VISTA, ed è
 * l'unico punto del progetto in cui la mano conta davvero. La camera sta a z
 * negativo e guarda verso +z, quindi il suo asse destro è −x: l'asse +x della
 * vista cade a SINISTRA sullo schermo. È esattamente per questo che esiste
 * worldToViewX (camera-rig.ts), che nega la x di mondo affinché il ramo
 * 'left' — che branchCenterAt mette a x di mondo negativa — finisca a sinistra
 * di chi guarda. Ne segue che il braccio a +x del modello è quello del ramo
 * 'left'. Non è un ragionamento da fidarsene: c'è un test che lo verifica
 * partendo da branchCenterAt e worldToViewX, non ricopiando questa conclusione.
 */
export type SignpostState = 'none' | 'left' | 'right';

export const SIGNPOST_STATES: readonly SignpostState[] = ['none', 'left', 'right'];

/**
 * ACCENSIONE: quanto il cartello è "attivo", cioè se la scelta si può fare
 * ADESSO. È un asse ORTOGONALE alla scelta qui sopra, e va tenuto tale: la
 * scelta dice DOVE si andrà, l'accensione dice SE si può ancora decidere.
 *
 * IL DIFETTO CHE CORREGGE. Le tre facce esistenti raccontano tutte una scelta
 * GIÀ fatta; il momento in cui la scelta diventa possibile non lo diceva
 * nessuno. Le frecce dell'interfaccia sono state tolte apposta e il prompt
 * «SCEGLI» è del tutorial e si spegne per sempre dopo il primo bivio: dal
 * secondo bivio in poi si preme a caso. La finestra vera è
 * `choiceIsOpen(path)` (game/path.ts) e dura ~2 s — il cartello passa da 84 a
 * 38 unità di distanza — quindi è a quella distanza che deve saltare all'occhio
 * di chi sta schivando ostacoli, non a due metri.
 *
 * PERCHÉ TRE GRADINI E NON UNO. Acceso è una PULSAZIONE, non un colore: il
 * cambiamento nel tempo si vede con la coda dell'occhio, un colore fermo no.
 * I tre gradini sono la rampa (li percorre entities-view.ts, SIGNPOST_PULSE);
 * `dormant` è, cella per cella, il cartello di sempre, così spento non è una
 * regressione di leggibilità di un ostacolo in cui ci si schianta.
 *
 * PERCHÉ PIÙ SCURO. Stesso motivo delle frecce: su neve "acceso" non può
 * voler dire più chiaro, perché più chiaro è meno contrasto. E non può voler
 * dire più caldo o più saturo, perché quello nel gioco significa "da
 * raccogliere". Resta la luminanza verso il basso: il legno scende da 0,248 a
 * 0,094 di luminanza (−62%), cioè il cartello si chiude in silhouette. La
 * pulsazione oscilla fra il primo e il terzo gradino, 0,188 → 0,094, e il
 * gradino basso resta comunque più scuro di `dormant`: anche fermo su un
 * fotogramma qualsiasi, acceso e spento non si confondono.
 *
 * COSA NON TOCCA. Solo il LEGNO cambia. La striscia interna, la neve alla base
 * e la freccia sbiancata restano dove sono: sono quelle a portare il segnale
 * della scelta, e schiacciarle insieme al resto avrebbe pagato l'accensione
 * con metà del contrasto fra le due frecce. Di conseguenza accendere ALZA
 * anche il contrasto interno della tavola, che è un di più gratuito.
 */
export type SignpostGlow = 'dormant' | 'lit1' | 'lit2' | 'lit3';

/** In ordine di accensione crescente: `dormant` per primo. */
export const SIGNPOST_GLOWS: readonly SignpostGlow[] = ['dormant', 'lit1', 'lit2', 'lit3'];

/** Il legno di ogni gradino. È l'UNICA differenza fra i quattro. */
const GLOW_WOOD: Readonly<Record<SignpostGlow, number>> = {
  dormant: WOOD,
  lit1: WOOD_LIT_1,
  lit2: WOOD_LIT_2,
  lit3: WOOD_LIT_3,
};

function buildSignpost(lit: SignpostState, glow: SignpostGlow): VoxelModel {
  const b = createBuilder();
  /** Il legno di questo gradino di accensione: sostituisce WOOD ovunque, palo
   *  e tavole, perché è la SILHOUETTE intera a pulsare. */
  const wood = GLOW_WOOD[glow];
  /** 15 celle = 3,75 unità, cioè appena PIÙ del suo ingombro di collisione
   *  (CONFIG.collisions.entityBox.signpost.height = 3,6). Non è un dettaglio
   *  estetico: quell'altezza è tarata sopra l'apice del salto perché non
   *  esista una quota a cui passare, e un modello più basso della propria
   *  sagoma direbbe al giocatore l'esatto contrario — che saltando ci passa. */
  const postTop = 15;
  b.box(-1, 0, -1, 2, postTop, 2, wood);
  // Come la staccionata: la base sparisce nella neve invece di finire netta.
  b.box(-1, 0, -1, 2, 1, 2, SNOW);

  for (const side of [-1, 1]) {
    // Vedi la nota sulla mano qui sopra: +x della vista è la sinistra dello
    // schermo, cioè il ramo 'left'.
    const arm: SignpostState = side > 0 ? 'left' : 'right';
    const off = lit !== 'none' && lit !== arm;
    const board = off ? PALE_WOOD : wood;
    // Freccia spenta: tinta piatta, nessuna striscia. Il dettaglio interno è
    // esso stesso un segnale di "questa conta", e va tolto con la luminanza.
    const stripe = off ? PALE_WOOD : lit === arm ? SNOW : LIGHT_WOOD;

    /** Colonna a distanza `d` dal palo. Con d = 0 si cade sul palo stesso, e
     *  le due frecce restano speculari cella per cella. */
    const col = (d: number): number => (side > 0 ? d : -1 - d);
    const plank = (d: number, from: number, to: number): void => {
      for (let y = from; y <= to; y += 1) b.set(col(d), y, -1, board);
    };
    // asta
    plank(1, 9, 11);
    plank(2, 9, 11);
    plank(3, 9, 11);
    // punta: si allarga e poi si chiude, così la freccia si legge di sagoma
    plank(4, 8, 12);
    plank(5, 9, 11);
    plank(6, 10, 10);
    for (let d = 1; d <= 4; d += 1) b.set(col(d), 10, -1, stripe);
  }

  return b.build();
}

function buildSignpostGlows(lit: SignpostState): Readonly<Record<SignpostGlow, VoxelModel>> {
  return {
    dormant: buildSignpost(lit, 'dormant'),
    lit1: buildSignpost(lit, 'lit1'),
    lit2: buildSignpost(lit, 'lit2'),
    lit3: buildSignpost(lit, 'lit3'),
  };
}

/**
 * Le dodici facce del cartello — tre scelte × quattro gradini di accensione —
 * con la STESSA geometria e soli colori diversi.
 *
 * Che la geometria sia identica non è un caso ma il requisito che rende la
 * cosa gratuita: la vista tiene UNA sola InstancedMesh e, quando la scelta o
 * l'accensione cambiano, scambia solo l'attributo `color` (vedi
 * entities-view.ts). Nessuna mesh in più, nessuna draw call in più, nessun
 * materiale in più — e nessun salto di sagoma nel frame in cui la freccia si
 * accende, che di un cambio di stato sarebbe la lettura sbagliata.
 *
 * Dodici e non tre non cambia nulla di quel conto: sono dodici buffer di
 * colori tenuti in RAM (~15 KB l'uno, cioè meno di 200 KB in tutto) fra cui la
 * vista sceglie un puntatore per frame. Il costo per frame resta zero.
 */
export const SIGNPOST_VARIANTS: Readonly<
  Record<SignpostState, Readonly<Record<SignpostGlow, VoxelModel>>>
> = {
  none: buildSignpostGlows('none'),
  left: buildSignpostGlows('left'),
  right: buildSignpostGlows('right'),
};

/**
 * Ramo sospeso: sbarra orizzontale con tre ciuffi di aghi.
 *
 * La fila più bassa è in ombra, come già l'arco e il cornicione: sono i tre
 * ostacoli SOSPESI, cioè quelli che chiedono la reazione più anticipata, e la
 * linea scura sotto è ciò che dice a colpo d'occhio dove FINISCE l'ostacolo,
 * che è poi l'unica quota che conta per decidere se ci si passa sotto. I due
 * tagli d'estremità sono in legno chiaro come quelli del tronco caduto.
 *
 * Nessun sostegno che arrivi a terra, e nessun ciuffo appeso più in basso: la
 * quota del modello è quella di `entity.y` (CONFIG.spawn.overheadY) e la sua
 * faccia inferiore è la sagoma su cui è tarata la scivolata (vedi i commenti
 * di CONFIG.spawn). Aggiungere celle sotto abbasserebbe l'ostacolo, non lo
 * renderebbe più leggibile: quel lavoro lo fa l'ombra di contatto a terra
 * (render/contact-shadow.ts), che non tocca la geometria.
 */
function buildBranch(): VoxelModel {
  const b = createBuilder();
  b.box(-4, 0, 0, 9, 2, 2, WOOD);
  b.box(-4, 0, 0, 9, 1, 2, WOOD_SHADOW);
  b.box(-4, 1, 0, 1, 1, 2, LIGHT_WOOD);
  b.box(4, 1, 0, 1, 1, 2, LIGHT_WOOD);
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
 *
 * `chasm` e `signpost` sono elencati anche a mano nell'unione delle chiavi:
 * i due tipi arrivano in `EntityKind` (game/types.ts) insieme alle meccaniche
 * che li usano, e nominarli qui fa sì che questo file compili sia prima sia
 * dopo — a unione fatta i due letterali si riassorbono e non cambia nulla.
 */
export const MODELS: Record<
  'cow' | 'cabin' | 'tree' | 'hay' | 'chasm' | 'signpost' | EntityKind,
  VoxelModel
> = {
  cow: buildCow(),
  cabin: buildCabin(),
  tree: buildTree(),
  hay: buildHay(),
  rock: buildRock(),
  log: buildLog(),
  fence: buildFence(),
  crevasse: buildCrevasse(),
  chasm: buildChasm(),
  // Il cartello a riposo: `dormant` è cella per cella quello di sempre.
  signpost: SIGNPOST_VARIANTS.none.dormant,
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
  // Il lato vero del cubetto: quasi sempre voxelSize, più grosso per i modelli
  // che sono pezzi di TERRENO invece che oggetti (vedi VoxelModel.cellScale).
  const cellSize = voxelSize * (model.cellScale ?? 1);

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
          (x + corner[0] + offsetX) * cellSize,
          (y + corner[1] + offsetY) * cellSize,
          (z + corner[2] + offsetZ) * cellSize,
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
