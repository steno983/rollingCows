import { CONFIG } from '../game/config';
import { PALETTE, type VoxelModel } from './models';
import type { VoxelPool } from './voxel-pool';

/** Tetto di cubetti per esplosione: oltre, il modello viene campionato. */
export const MAX_BURST_VOXELS = 96;
/** Spinta verso la camera e verso l'alto, in frazioni di `power`. */
const BURST_TOWARD_CAMERA = 0.35;
const BURST_LIFT = 0.6;
const BURST_LIFE = 0.9;
const BURST_LIFE_SPREAD = 0.8;
/** Cubetti al secondo della scia, a intensità 1. */
const TRAIL_PER_SECOND = 70;
/** Tetto per chiamata: impedisce che un frame lungo svuoti il pool. */
const MAX_TRAIL_PER_CALL = 24;
const TRAIL_LIFE = 0.9;
const SNOW_COLOR = PALETTE[0] ?? 0xffffff;

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

let trailAccumulator = 0;

/** Riporta rumore e accumulatore allo stato iniziale (nuova run, test). */
export function resetDebris(): void {
  noiseState = 0x9e3779b9;
  trailAccumulator = 0;
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
    const distance = Math.max(0.25, Math.hypot(localX, localY, localZ));
    const speed = power * (0.6 + noise() * 0.8);
    const color = model.palette[voxel[3] ?? 0] ?? SNOW_COLOR;

    const alive = pool.spawn(
      x + localX,
      y + localY,
      z + localZ,
      (localX / distance) * speed,
      (localY / distance) * speed + power * BURST_LIFT,
      (localZ / distance) * speed - power * BURST_TOWARD_CAMERA,
      color,
      BURST_LIFE + noise() * BURST_LIFE_SPREAD,
    );
    if (!alive) return;
  }
}

/**
 * Scia di neve dietro la mucca durante la valanga. Il rateo è in cubetti al
 * secondo e le frazioni si accumulano fra una chiamata e l'altra: la densità
 * della scia è la stessa a 30, 60 o 120 fps.
 */
export function avalancheTrail(
  pool: VoxelPool,
  dt: number,
  x: number,
  y: number,
  z: number,
  intensity: number,
): void {
  if (intensity <= 0 || dt <= 0) return;

  trailAccumulator += dt * TRAIL_PER_SECOND * intensity;
  let budget = MAX_TRAIL_PER_CALL;

  while (trailAccumulator >= 1 && budget > 0) {
    trailAccumulator -= 1;
    budget -= 1;
    const spread = (noise() * 2 - 1) * 1.2 * intensity;
    const alive = pool.spawn(
      x + spread,
      y + noise() * 0.6,
      z - noise() * 1.5,
      spread * 1.5,
      2 + noise() * 3,
      -2 - noise() * 3,
      SNOW_COLOR,
      TRAIL_LIFE + noise() * 0.4,
    );
    if (!alive) break;
  }

  // Niente debito infinito quando il pool è pieno o il frame è stato lungo.
  if (trailAccumulator > MAX_TRAIL_PER_CALL) trailAccumulator = MAX_TRAIL_PER_CALL;
}
