import { CONFIG } from './config';
import type { Entity, EntityKind } from './types';

/** AABB su due soli assi: quota e distanza. Niente più X: la mucca è sempre al
 *  centro del ramo attivo (vedi path.ts), quindi il test laterale è sparito insieme
 *  alle corsie. `y` è la base, `height` si estende verso l'alto (occupa
 *  [y, y+height]); `z` è il centro, `depth` la profondità totale (occupa
 *  [z-depth/2, z+depth/2]). */
export interface Box {
  y: number;
  height: number;
  z: number;
  depth: number;
}

/** Ingombro verticale e in profondità di ogni tipo di entità. */
export const ENTITY_BOX: Record<EntityKind, { height: number; depth: number }> =
  CONFIG.collisions.entityBox;

/** Box del giocatore. In scivolata l'altezza è ridotta di slideHeightRatio: è così
 *  che si passa sotto agli ostacoli sospesi, a qualunque taglia (vedi l'invariante
 *  di design documentata sopra il task). */
export function playerBox(y: number, size: number, sliding: boolean): Box {
  const { baseHeight, heightPerSize, depth, slideHeightRatio } = CONFIG.player;
  const height = baseHeight + heightPerSize * size;
  return {
    y,
    height: sliding ? height * slideHeightRatio : height,
    // Il giocatore è fermo sull'asse di scorrimento: è il mondo a muoversi.
    z: 0,
    depth,
  };
}

export function entityBox(entity: Entity): Box {
  const measures = ENTITY_BOX[entity.kind];
  return {
    y: entity.y,
    height: measures.height,
    z: entity.z,
    depth: measures.depth,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  if (Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2) return false;
  if (a.y + a.height <= b.y) return false;
  if (b.y + b.height <= a.y) return false;
  return true;
}
