import { CONFIG } from '../game/config';
import type { Entity, EntityKind } from '../game/types';

/** Profondità di mondo in cui possono vivere entità: dal punto in cui
 *  spariscono dietro al bordo più lontano dei chunk. */
const POPULATED_DEPTH =
  CONFIG.world.chunkLength * CONFIG.world.chunkCount - CONFIG.world.despawnBehindZ;

/** Passo minimo fra due ostacoli (vedi game/spawner.ts: è il maggiore fra il
 *  minimo di config e il minimo superabile alla velocità massima). */
const MIN_OBSTACLE_GAP = Math.max(
  CONFIG.spawn.minObstacleGap,
  Math.max(CONFIG.player.jumpSeconds, CONFIG.player.slideSeconds) * CONFIG.world.maxSpeed,
);

/** Ostacoli al più presenti contemporaneamente su UN ramo. */
const OBSTACLES_PER_BRANCH = Math.floor(POPULATED_DEPTH / MIN_OBSTACLE_GAP) + 1;

/**
 * Quante istanze può contenere l'InstancedMesh di un singolo tipo di entità.
 *
 * Il tipo di gran lunga più numeroso è il fiocco: ogni ostacolo si porta
 * dietro una fila, lunga fino a trailMax sul ramo ricco e fino a
 * ceil(trailMin / 2) su quello sgombro, e durante un bivio i rami popolati
 * sono due. Il tetto è quindi DERIVATO da quei numeri, non scelto a mano:
 * con 32 (il valore della v1, che aveva una sola fila da un fiocco per riga)
 * si misuravano fino a 51 fiocchi vivi, e quelli oltre il tetto erano
 * raccoglibili ma invisibili — il peggior difetto possibile per un
 * raccoglibile.
 */
export const MAX_INSTANCES_PER_KIND =
  OBSTACLES_PER_BRANCH * (CONFIG.spawn.trailMax + Math.ceil(CONFIG.spawn.trailMin / 2));

/**
 * Quante istanze di `kind` vanno disegnate: entità vive di quel tipo, non oltre
 * `max`. Le eccedenti vengono ignorate dalla vista, non muoiono nel gioco.
 */
export function instanceCountFor(entities: Entity[], kind: EntityKind, max: number): number {
  if (max <= 0) return 0;
  let count = 0;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive || entity.kind !== kind) continue;
    count += 1;
    if (count >= max) return max;
  }
  return count;
}
