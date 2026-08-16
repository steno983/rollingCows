import type { Entity, EntityKind } from '../game/types';

/**
 * Quante istanze può contenere l'InstancedMesh di un singolo tipo di entità.
 * Vedi la nota sul tetto: il massimo teorico su TUTTI i tipi insieme è ~78.
 */
export const MAX_INSTANCES_PER_KIND = 32;

/**
 * Quante istanze di `kind` vanno disegnate: entità vive di quel tipo, non oltre
 * `max`. Le eccedenti vengono ignorate dalla vista, non muoiono nel gioco.
 */
export function instanceCountFor(entities: Entity[], kind: EntityKind, max: number): number {
  if (max <= 0) return 0;
  let count = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.kind !== kind) continue;
    count += 1;
    if (count >= max) return max;
  }
  return count;
}
