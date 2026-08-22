import { CONFIG } from '../game/config';
import type { EntityKind } from '../game/types';

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
 * Tetto di istanze per il FIOCCO DI NEVE, di gran lunga il tipo più numeroso:
 * ogni ostacolo si porta dietro una fila, lunga fino a trailMax sul ramo ricco
 * e fino a ceil(trailMin / 2) su quello sgombro, e durante un bivio i rami
 * popolati sono due. Il tetto è quindi DERIVATO da quei numeri, non scelto a
 * mano: con 32 (il valore della v1, che aveva una sola fila da un fiocco per
 * riga) si misuravano fino a 51 fiocchi vivi, e quelli oltre il tetto erano
 * raccoglibili ma invisibili — il peggior difetto possibile per un
 * raccoglibile.
 */
export const MAX_SNOWFLAKE_INSTANCES =
  OBSTACLES_PER_BRANCH * (CONFIG.spawn.trailMax + Math.ceil(CONFIG.spawn.trailMin / 2));

/**
 * Tetto per un singolo tipo di OSTACOLO. La derivazione qui sopra è corretta
 * per il fiocco ed era stata estesa a tutti e dodici i tipi senza rifarla:
 * massi e campanacci avevano la stessa capienza del fiocco (117 con i valori
 * correnti di CONFIG), cioè oltre dieci volte il massimo che il gioco può
 * produrne — e un'InstancedMesh alloca comunque capacity × 16 float di
 * matrici, più altrettanti sulla GPU.
 *
 * Rifatta per gli ostacoli: la spaziatura non scende mai sotto
 * MIN_OBSTACLE_GAP, quindi un ramo ne contiene al più OBSTACLES_PER_BRANCH; il
 * caso peggiore è un bivio, dove la profondità popolata è divisa fra il tronco
 * e i due rami. Il doppio del massimo per ramo copre quel caso con margine, ed
 * è comunque il tetto per un SOLO tipo su sette: perché lo si tocchi davvero
 * ogni ostacolo del mondo dovrebbe essere uscito dello stesso tipo.
 *
 * Misurato su 30 semi × 120 s di corsa simulata, il picco vero per tipo è 6
 * (ramo di abete) contro un tetto di 18: tre volte il caso peggiore osservato.
 */
export const MAX_OBSTACLE_INSTANCES = OBSTACLES_PER_BRANCH * 2;

/**
 * Tetto per un singolo tipo di BUFF (cristallo, stella, calamita,
 * campanaccio). Il numero atteso è una manciata — nasce al più un buff ogni
 * ostacolo, e solo con probabilità buffChance (0,22 sul ramo ricco), spartita
 * fra quattro tipi — ma il tetto DURO resta "uno per ostacolo", cioè lo stesso
 * degli ostacoli. Costa una manciata di istanze in più del massimo plausibile
 * e in cambio toglie di mezzo la classe di difetto peggiore per un
 * raccoglibile: esserci, valere punti, ed essere invisibile.
 *
 * Misurato sulle stesse 30 corse: picco 5 per il cristallo, 1 per il
 * campanaccio. Il fiocco, per confronto, tocca 48 su 117.
 */
export const MAX_BUFF_INSTANCES = MAX_OBSTACLE_INSTANCES;

/** Capienza dell'InstancedMesh di ciascun tipo di entità. */
export const INSTANCE_CAPACITY: Readonly<Record<EntityKind, number>> = {
  rock: MAX_OBSTACLE_INSTANCES,
  log: MAX_OBSTACLE_INSTANCES,
  fence: MAX_OBSTACLE_INSTANCES,
  crevasse: MAX_OBSTACLE_INSTANCES,
  branch: MAX_OBSTACLE_INSTANCES,
  arch: MAX_OBSTACLE_INSTANCES,
  cornice: MAX_OBSTACLE_INSTANCES,
  snowflake: MAX_SNOWFLAKE_INSTANCES,
  crystal: MAX_BUFF_INSTANCES,
  star: MAX_BUFF_INSTANCES,
  magnet: MAX_BUFF_INSTANCES,
  bell: MAX_BUFF_INSTANCES,
};
