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

/** Ingombro verticale e in profondità di ogni tipo di entità.
 *
 *  `Readonly` su entrambi i livelli, e non un `Record` scrivibile: CONFIG è
 *  `as const`, quindi profondamente readonly, ma TypeScript non controlla il
 *  readonly in assegnabilità — l'annotazione scrivibile precedente
 *  trasformava a livello di tipo un oggetto congelato in uno modificabile, e
 *  offriva a chiunque una scorciatoia per "aggiustare" un ingombro a runtime
 *  invece che in config. Il `Record` per EntityKind resta, perché è ciò che
 *  garantisce che nessun tipo di entità sia senza misure. */
export const ENTITY_BOX: Readonly<Record<EntityKind, Readonly<{ height: number; depth: number }>>> =
  CONFIG.collisions.entityBox;

/**
 * Box riusati da `playerBox` e `entityBox`.
 *
 * Le due funzioni restituivano un oggetto letterale nuovo a ogni chiamata, cioè
 * da 2 a 5 allocazioni per frame nel loop di collisione: poca roba, ma è la
 * stessa regola di progetto che vale per tutto il resto del ciclo caldo (vedi
 * il buffer di render/terrain.ts) e il costo di rispettarla qui è nullo.
 *
 * ATTENZIONE: chi chiama non deve conservare il riferimento fra una chiamata e
 * l'altra della STESSA funzione — il valore restituito vale fino alla chiamata
 * successiva. È sicuro perché l'unico consumatore, il ciclo di collisione di
 * game.ts, calcola il box del giocatore una volta e lo confronta con un box di
 * entità alla volta: due scratch distinti proprio perché quei due usi si
 * sovrappongono nel tempo.
 */
const playerScratch: Box = { y: 0, height: 0, z: 0, depth: 0 };
const entityScratch: Box = { y: 0, height: 0, z: 0, depth: 0 };

/** Box del giocatore. In scivolata l'altezza è ridotta di slideHeightRatio: è così
 *  che si passa sotto agli ostacoli sospesi, a qualunque taglia (vedi l'invariante
 *  di design documentata sopra il task). */
export function playerBox(y: number, size: number, sliding: boolean): Box {
  const { baseHeight, heightPerSize, depth, slideHeightRatio } = CONFIG.player;
  const height = baseHeight + heightPerSize * size;
  playerScratch.y = y;
  playerScratch.height = sliding ? height * slideHeightRatio : height;
  // Il giocatore è fermo sull'asse di scorrimento: è il mondo a muoversi.
  playerScratch.z = 0;
  playerScratch.depth = depth;
  return playerScratch;
}

export function entityBox(entity: Entity): Box {
  const measures = ENTITY_BOX[entity.kind];
  entityScratch.y = entity.y;
  entityScratch.height = measures.height;
  entityScratch.z = entity.z;
  entityScratch.depth = measures.depth;
  return entityScratch;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  if (Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2) return false;
  if (a.y + a.height <= b.y) return false;
  if (b.y + b.height <= a.y) return false;
  return true;
}
