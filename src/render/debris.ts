import { CONFIG } from '../game/config';
import { PALETTE, type VoxelModel } from './models';
import type { VoxelPool } from './voxel-pool';

/** Tetto di cubetti per esplosione: oltre, il modello viene campionato. */
export const MAX_BURST_VOXELS = 96;
/**
 * Spinta verso la camera e verso l'alto, in frazioni di `power`.
 *
 * Perché sono così generose. Un burst nasce quasi sempre DENTRO il volume di
 * qualcosa di solido: il raccoglibile che lo genera può stare sopra un masso,
 * la mucca può stare scavalcando un tronco nell'istante in cui salta. Da lì i
 * cubetti scorrono all'indietro alla stessa identica velocità dell'ostacolo,
 * perché `pool.update(dt, worldSpeed)` applica a loro la stessa deriva che il
 * mondo applica a lui: la posizione RELATIVA fra cubetto e ostacolo non cambia
 * MAI, e il cubetto resta conficcato a sporgere dalle sue facce finché non
 * scade. L'unica via d'uscita è una velocità PROPRIA che copra in fretta il
 * mezzo metro scarso di semi-spessore di un ostacolo; la componente verso la
 * camera è quella che conta di più, perché fa sfilare i cubetti dalla faccia
 * frontale invece che restare nel mezzo.
 */
const BURST_TOWARD_CAMERA = 0.85;
const BURST_LIFT = 1.1;
/** Vita di un cubetto di esplosione, accorciata rispetto alle 0.9 + 0.8 di
 *  quando i burst erano solo quelli di impatto: ora ne parte uno anche a ogni
 *  salto, atterraggio, crescita di taglia e raccolta, e i cubetti
 *  contemporaneamente in scena sono molti di più. */
const BURST_LIFE = 0.75;
const BURST_LIFE_SPREAD = 0.55;
/** Tetto per chiamata: impedisce che un frame lungo svuoti il pool. */
const MAX_TRAIL_PER_CALL = 24;
const SNOW_COLOR = PALETTE[0] ?? 0xffffff;
/** I due ori con cui la stella è disegnata (models.ts, PALETTE 15 e 16): la
 *  scia si riconosce come "quella cosa che ho appena raccolto" solo se è dei
 *  colori del buff, non di un oro qualunque. */
const STAR_COLORS: readonly number[] = [PALETTE[15] ?? 0xffcf3d, PALETTE[16] ?? 0xfff3b0];

/**
 * Forma di una scia continua. Le due scie del gioco (neve della valanga, oro
 * della stella) hanno la stessa identica infrastruttura — accumulatore in
 * frazioni di cubetto, tetto per chiamata, rumore locale — e differiscono
 * solo per questi numeri: tenerle come due funzioni gemelle scritte a mano
 * significherebbe correggere ogni bug due volte.
 */
interface TrailSpec {
  /** Cubetti al secondo a intensità 1. */
  perSecond: number;
  /** Semi-ampiezza laterale della nuvola, in unità di mondo. */
  spread: number;
  /** Quota massima di nascita sopra il punto passato. */
  rise: number;
  /** Quanto indietro (verso la camera) può nascere un cubetto. */
  depth: number;
  /** Componente verticale iniziale: minimo più una parte casuale. */
  liftMin: number;
  liftSpread: number;
  /** Componente all'indietro iniziale, stesso schema (segno già negato). */
  backMin: number;
  backSpread: number;
  life: number;
  lifeSpread: number;
  /** Colori estratti a rotazione, NON dal rumore: alternarli in modo
   *  deterministico costa zero e lascia intatta la sequenza di noise(), che
   *  la scia della valanga consumava già in un ordine preciso. */
  colors: readonly number[];
}

/** Muro di neve della valanga: numeri invariati rispetto a quando questa era
 *  l'unica scia del gioco. */
const AVALANCHE_TRAIL: TrailSpec = {
  perSecond: 70,
  spread: 1.2,
  rise: 0.6,
  depth: 1.5,
  liftMin: 2,
  liftSpread: 3,
  backMin: 2,
  backSpread: 3,
  life: 0.9,
  lifeSpread: 0.4,
  colors: [SNOW_COLOR],
};

/** Scintille della stella: molto più rade (è un effetto che dura 8 secondi,
 *  non un'esplosione), strette addosso alla mucca e con poca spinta
 *  all'indietro, così restano riconoscibili come un'aura che la accompagna e
 *  non come un altro muro di detriti. */
const STAR_SPARKLE_TRAIL: TrailSpec = {
  perSecond: 11,
  spread: 0.75,
  rise: 1.5,
  depth: 0.8,
  liftMin: 1.6,
  liftSpread: 2.2,
  backMin: 0.4,
  backSpread: 1.2,
  life: 0.55,
  lifeSpread: 0.35,
  colors: STAR_COLORS,
};

/**
 * Rumore locale della vista: volutamente separato dall'Rng di gioco, che è a
 * seed per rendere le run riproducibili nei test. Gli effetti non devono
 * consumarne la sequenza.
 */
let noiseState = 0x9e3779b9;

function noise(): number {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) % 4096) / 4096;
}

/** Frazioni di cubetto non ancora emesse, UNA PER SCIA: con un accumulatore
 *  solo, accendere la stella durante la valanga avrebbe fatto emettere alla
 *  stella il debito accumulato dalla neve (e viceversa), cioè uno sbuffo di
 *  cubetti al momento sbagliato. */
const avalancheTrailState = { accumulator: 0 };
const starTrailState = { accumulator: 0 };
/** Indice del prossimo colore, per scia: vedi TrailSpec.colors. */
const trailColorCursor = { avalanche: 0, star: 0 };

/** Riporta rumore e accumulatori allo stato iniziale (nuova run, test). */
export function resetDebris(): void {
  noiseState = 0x9e3779b9;
  avalancheTrailState.accumulator = 0;
  starTrailState.accumulator = 0;
  trailColorCursor.avalanche = 0;
  trailColorCursor.star = 0;
}

/**
 * Disintegra un modello: un cubetto per voxel (campionando i modelli grandi),
 * scagliato radialmente dal centro con una componente verso la camera. Le
 * coordinate (x, y, z) sono già quelle della VISTA: chi chiama ha applicato
 * worldToViewX.
 */
export function burstFromModel(
  pool: VoxelPool,
  model: VoxelModel,
  x: number,
  y: number,
  z: number,
  power: number,
): void {
  const voxels = model.voxels;
  if (voxels.length === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const voxel of voxels) {
    const vxCoord = voxel[0] ?? 0;
    const vyCoord = voxel[1] ?? 0;
    const vzCoord = voxel[2] ?? 0;
    if (vxCoord < minX) minX = vxCoord;
    if (vxCoord > maxX) maxX = vxCoord;
    if (vyCoord < minY) minY = vyCoord;
    if (vzCoord < minZ) minZ = vzCoord;
    if (vzCoord > maxZ) maxZ = vzCoord;
  }

  // Stessa centratura di buildGeometry: i cubetti nascono dove c'era la mesh.
  const size = CONFIG.render.voxelSize;
  const offsetX = -(minX + maxX + 1) / 2;
  const offsetY = -minY;
  const offsetZ = -(minZ + maxZ + 1) / 2;
  const step = Math.max(1, Math.ceil(voxels.length / MAX_BURST_VOXELS));

  for (let i = 0; i < voxels.length; i += step) {
    const voxel = voxels[i];
    if (voxel === undefined) continue;
    const localX = ((voxel[0] ?? 0) + 0.5 + offsetX) * size;
    const localY = ((voxel[1] ?? 0) + 0.5 + offsetY) * size;
    const localZ = ((voxel[2] ?? 0) + 0.5 + offsetZ) * size;
    const distance = Math.hypot(localX, localY, localZ);
    const speed = power * (0.6 + noise() * 0.8);
    const color = model.palette[voxel[3] ?? 0] ?? SNOW_COLOR;
    // Versore vero, non più diviso per una distanza con pavimento a 0.25: quel
    // pavimento tagliava la spinta proprio ai voxel vicini al centro del
    // modello, cioè a quelli più in profondità nel solido, che erano quindi i
    // primi a restare incastrati. Il ripiego per il voxel esattamente al
    // centro dipende dall'indice: deterministico, e soprattutto non consuma
    // noise() — la sequenza pseudocasuale della scia della valanga è protetta
    // da un test e passa da questo stesso generatore.
    const inverse = distance > 1e-3 ? 1 / distance : 0;
    const dirX = inverse === 0 ? (i % 2 === 0 ? 1 : -1) : localX * inverse;
    const dirY = inverse === 0 ? 1 : localY * inverse;
    const dirZ = inverse === 0 ? 0 : localZ * inverse;

    const alive = pool.spawn(
      x + localX,
      y + localY,
      z + localZ,
      dirX * speed,
      dirY * speed + power * BURST_LIFT,
      dirZ * speed - power * BURST_TOWARD_CAMERA,
      color,
      BURST_LIFE + noise() * BURST_LIFE_SPREAD,
    );
    if (!alive) return;
  }
}

/**
 * Motore comune delle scie. Il rateo è in cubetti al secondo e le frazioni si
 * accumulano fra una chiamata e l'altra: la densità è la stessa a 30, 60 o
 * 120 fps. `state` è l'accumulatore della singola scia, non condiviso.
 */
function emitTrail(
  pool: VoxelPool,
  state: { accumulator: number },
  spec: TrailSpec,
  cursorKey: 'avalanche' | 'star',
  dt: number,
  x: number,
  y: number,
  z: number,
  intensity: number,
): void {
  if (intensity <= 0 || dt <= 0) return;

  state.accumulator += dt * spec.perSecond * intensity;
  let budget = MAX_TRAIL_PER_CALL;

  while (state.accumulator >= 1 && budget > 0) {
    state.accumulator -= 1;
    budget -= 1;
    const cursor = trailColorCursor[cursorKey];
    const color = spec.colors[cursor % spec.colors.length] ?? SNOW_COLOR;
    trailColorCursor[cursorKey] = (cursor + 1) % spec.colors.length;
    const spread = (noise() * 2 - 1) * spec.spread * intensity;
    // L'ordine delle chiamate a noise() è quello originale della scia della
    // valanga e non va cambiato: gli argomenti sono valutati da sinistra a
    // destra, quindi riordinarli cambierebbe la sequenza pseudocasuale e con
    // essa la forma della scia.
    const alive = pool.spawn(
      x + spread,
      y + noise() * spec.rise,
      z - noise() * spec.depth,
      spread * 1.5,
      spec.liftMin + noise() * spec.liftSpread,
      -spec.backMin - noise() * spec.backSpread,
      color,
      spec.life + noise() * spec.lifeSpread,
    );
    if (!alive) break;
  }

  // Niente debito infinito quando il pool è pieno o il frame è stato lungo.
  if (state.accumulator > MAX_TRAIL_PER_CALL) state.accumulator = MAX_TRAIL_PER_CALL;
}

/**
 * Scia di neve dietro la mucca durante la valanga.
 */
export function avalancheTrail(
  pool: VoxelPool,
  dt: number,
  x: number,
  y: number,
  z: number,
  intensity: number,
): void {
  emitTrail(pool, avalancheTrailState, AVALANCHE_TRAIL, 'avalanche', dt, x, y, z, intensity);
}

/**
 * Scintille dorate attorno alla mucca mentre la stella è attiva. Stessa
 * infrastruttura della scia della valanga (emitTrail), altri numeri.
 *
 * Perché esiste: stella e calamita sono i due buff più lunghi del gioco (8
 * secondi) ed esistevano SOLO come chip nell'HUD, che il giocatore non sta
 * guardando — sta guardando gli ostacoli. Il buff più remunerativo del gioco
 * era invisibile nel gioco.
 *
 * `intensity` è anche la leva del lampeggio di scadenza e del degrado
 * prestazionale: chi chiama la abbassa, qui non c'è alcuna logica di tempo.
 */
export function starTrail(
  pool: VoxelPool,
  dt: number,
  x: number,
  y: number,
  z: number,
  intensity: number,
): void {
  emitTrail(pool, starTrailState, STAR_SPARKLE_TRAIL, 'star', dt, x, y, z, intensity);
}
