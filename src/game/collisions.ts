import { CONFIG } from './config';
import { entityCenterX, entityHalfWidth } from './lanes';
import type { Entity, EntityKind } from './types';

/** AABB allineato agli assi. `x` e `z` sono centri, `y` è la base: il box occupa
 *  [x-halfWidth, x+halfWidth] x [y, y+height] x [z-depth/2, z+depth/2]. */
export interface Box {
  x: number;
  halfWidth: number;
  y: number;
  height: number;
  z: number;
  depth: number;
}

/** Quanto si abbassa la mucca in schiacciata: dimezza l'altezza del box, il che
 *  la porta sotto la base del ramo sospeso (1.6) fino a taglia 5. */
export const SLAM_HEIGHT_RATIO = 0.5;

/** Ingombro verticale e in profondità di ogni tipo di entità. La larghezza non
 *  serve: deriva dalle corsie occupate (`entityHalfWidth`). */
export const ENTITY_BOX: Record<EntityKind, { height: number; depth: number }> = {
  /** Masso basso e tozzo: si scavalca solo saltando. */
  rock: { height: 1.4, depth: 1.4 },
  /** Albero: troppo alto per essere saltato, va aggirato o sfondato da taglia 3. */
  tree: { height: 3, depth: 1.2 },
  /** Staccionata: bassa e sottile, il salto ci passa sopra comodamente. */
  fence: { height: 1.2, depth: 0.8 },
  /** Baita: muro invalicabile, profondo, che occupa due corsie. */
  cabin: { height: 3.5, depth: 4 },
  /** Crepaccio: praticamente piatto, quindi collide solo con chi è a terra;
   *  molto profondo, così va anticipato con il salto. */
  crevasse: { height: 0.1, depth: 3 },
  /** Ramo sospeso: base a 1.6 (vedi BRANCH_Y), spesso quanto una staccionata. */
  branch: { height: 1.2, depth: 0.8 },
  /** Fiocco di neve: piccolo, ma la raccolta è generosa. */
  snowflake: { height: 0.8, depth: 0.8 },
  /** Balla di fieno: cubo di un metro. */
  hay: { height: 1, depth: 1 },
  /** Altra mucca: stesse proporzioni del giocatore a taglia 1. */
  cow: { height: 1.4, depth: 1.6 },
};

/** Box del giocatore. `slamming` (estensione additiva del contratto) riduce
 *  l'altezza: è così che si passa sotto al ramo sospeso. */
export function playerBox(x: number, y: number, size: number, slamming = false): Box {
  const { baseHalfWidth, halfWidthPerSize, baseHeight, heightPerSize, depth } = CONFIG.player;
  const height = baseHeight + heightPerSize * size;
  return {
    x,
    halfWidth: baseHalfWidth + halfWidthPerSize * size,
    y,
    height: slamming ? height * SLAM_HEIGHT_RATIO : height,
    // Il giocatore è fermo sull'asse di scorrimento: è il mondo a muoversi.
    z: 0,
    depth,
  };
}

export function entityBox(entity: Entity): Box {
  const measures = ENTITY_BOX[entity.kind];
  return {
    x: entityCenterX(entity.lane, entity.width),
    halfWidth: entityHalfWidth(entity.width),
    y: entity.y,
    height: measures.height,
    z: entity.z,
    depth: measures.depth,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  if (Math.abs(a.x - b.x) >= a.halfWidth + b.halfWidth) return false;
  if (Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2) return false;
  if (a.y + a.height <= b.y) return false;
  if (b.y + b.height <= a.y) return false;
  return true;
}
