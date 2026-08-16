import type { EventBus } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import {
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  createAvalanche,
  scoreMultiplier,
  sizeForCharge,
  updateAvalanche,
  type AvalancheState,
} from './avalanche';
import { boxesOverlap, entityBox, playerBox, ENTITY_BOX } from './collisions';
import { CONFIG } from './config';
import {
  createPlayer,
  jump,
  moveLane,
  slam,
  updatePlayer,
  type PlayerState,
} from './player';
import { addBonus, addDistance, createScore, saveRecord, type ScoreState } from './score';
import { createSpawner, type Spawner } from './spawner';
import { difficultyAt } from './speed';
import type { Action, Entity, EntityKind, ObstacleKind, PickupKind } from './types';
import { createWorld, updateWorld, type WorldState } from './world';

export interface GameState {
  /** Seed della run corrente: va in `run:started` e permette di rigiocarla identica. */
  seed: number;
  rng: Rng;
  bus: EventBus;
  world: WorldState;
  player: PlayerState;
  avalanche: AvalancheState;
  score: ScoreState;
  spawner: Spawner;
  entities: Entity[];
  alive: boolean;
  forgivenessUsed: boolean;
}

/**
 * Semi-finestra lungo z entro cui vale la pena costruire le AABB. Derivata dalle
 * profondità dichiarate, non da un numero scelto a mano, e volutamente più larga
 * della condizione di sovrapposizione: a 40 u/s con passo 1/60 un'entità si
 * sposta di 0,67 unità per frame, quindi non può saltarla.
 */
const MAX_ENTITY_DEPTH = Math.max(...Object.values(ENTITY_BOX).map((box) => box.depth));
const COLLISION_Z_WINDOW = CONFIG.player.depth + MAX_ENTITY_DEPTH;

function isPickupKind(kind: EntityKind): kind is PickupKind {
  return kind === 'snowflake' || kind === 'hay' || kind === 'cow';
}

export function createGame(seed: number, bus: EventBus): GameState {
  const rng = createRng(seed);
  return {
    seed,
    rng,
    bus,
    world: createWorld(),
    player: createPlayer(),
    avalanche: createAvalanche(),
    score: createScore(),
    spawner: createSpawner(rng),
    entities: [],
    // Uno stato appena creato non è in corsa: serve startRun.
    alive: false,
    forgivenessUsed: false,
  };
}

export function startRun(game: GameState, seed?: number): void {
  if (seed !== undefined) game.seed = seed;

  game.rng = createRng(game.seed);
  game.spawner = createSpawner(game.rng);
  game.world = createWorld();
  game.player = createPlayer();
  game.avalanche = createAvalanche();
  game.score = createScore();
  game.entities.length = 0;
  game.alive = true;
  game.forgivenessUsed = false;

  // I chunk esistono già ma sono vuoti: senza questo, il primo riciclo (dopo
  // ~60 unità) è l'unica occasione di generazione, e la partenza è un pendio
  // vuoto per ~15 secondi. Popoliamo subito con la difficoltà a distanza 0,
  // poi ripuliamo la zona franca davanti al giocatore per non nascere addosso
  // a un ostacolo.
  const difficulty = difficultyAt(game.world.distance);
  const chunks = game.world.chunks;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    game.spawner.populateChunk(chunk.z, difficulty, game.entities);
  }
  const spawnSafeZ = CONFIG.world.spawnSafeZ;
  for (let i = 0; i < game.entities.length; i++) {
    const entity = game.entities[i];
    if (entity !== undefined && entity.z < spawnSafeZ) entity.alive = false;
  }
  compactEntities(game.entities);

  // Il popolamento sopra resta probabilistico (rowFillChance): su 3000 seed,
  // l'11,1% delle run non aveva NULLA entro 4 secondi simulati perché tutte le
  // righe nella cintura subito dopo la zona franca mancavano per sfortuna. Si
  // forza quindi sempre almeno una riga lì: mai più una partenza silenziosa.
  const beltEnd = spawnSafeZ + CONFIG.spawn.rowSpacing * CONFIG.startBelt.rows;
  let beltHasEntity = false;
  for (let i = 0; i < game.entities.length; i++) {
    const entity = game.entities[i];
    if (entity !== undefined && entity.z >= spawnSafeZ && entity.z < beltEnd) {
      beltHasEntity = true;
      break;
    }
  }
  if (!beltHasEntity) {
    game.spawner.forceRow(spawnSafeZ + CONFIG.spawn.rowSpacing, difficulty, game.entities);
  }

  game.bus.emit('run:started', { seed: game.seed });
}

/**
 * Interrompe la run corrente SENZA che sia stata una morte: es. il giocatore
 * torna al menu (Esc → MENU) mentre è ancora vivo, magari a metà valanga.
 * Emette 'run:stopped', non 'run:ended' — quest'ultimo è riservato alla morte
 * e in main.ts fa scattare il rallentatore: riusarlo qui farebbe partire un
 * game over fasullo. L'audio (consumatore puro del bus) ascolta 'run:stopped'
 * per spegnere il rombo della valanga senza che main.ts lo chiami mai
 * direttamente.
 */
export function abandonRun(game: GameState): void {
  if (!game.alive) return;
  game.alive = false;
  game.bus.emit('run:stopped', {});
}

export function handleAction(game: GameState, action: Action): void {
  if (!game.alive) return;

  switch (action) {
    case 'MOVE_LEFT':
      moveLane(game.player, -1);
      break;
    case 'MOVE_RIGHT':
      moveLane(game.player, 1);
      break;
    case 'JUMP':
      jump(game.player);
      break;
    case 'SLAM':
      slam(game.player);
      break;
    case 'PAUSE':
      // La pausa è una transizione della macchina a stati, non un'azione di gioco.
      break;
  }
}

export function updateGame(game: GameState, dt: number): void {
  if (!game.alive) return;

  const distanceBefore = game.world.distance;

  updateWorld(game.world, dt);
  updatePlayer(game.player, dt);
  updateAvalanche(game.avalanche, dt, game.bus);

  const difficulty = difficultyAt(game.world.distance);
  const recycled = game.world.recycled;
  for (let i = 0; i < recycled.length; i++) {
    const chunk = recycled[i];
    if (chunk === undefined) continue;
    game.spawner.populateChunk(chunk.z, difficulty, game.entities);
  }

  const moved = game.world.distance - distanceBefore;
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }

  const box = playerBox(
    game.player.x,
    game.player.y,
    game.avalanche.size,
    game.player.slamming,
  );
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (Math.abs(entity.z) > COLLISION_Z_WINDOW) continue;
    if (!boxesOverlap(box, entityBox(entity))) continue;

    resolveCollision(game, entity);
    if (!game.alive) break;
  }

  compactEntities(game.entities);

  if (game.alive) {
    addDistance(game.score, moved, scoreMultiplier(game.avalanche));
  }
}

/**
 * Fa scorrere solo il pendio e le posizioni delle entità esistenti, senza
 * collisioni, punteggio o nuova generazione: usata da main.ts durante il
 * rallentatore alla morte (game.alive è già false, updateGame non fa nulla).
 * Prima di questa funzione il pendio si fermava di colpo mentre i detriti
 * continuavano a scorrere: un frame congelato in mezzo a un rallentatore
 * sembra un problema di prestazioni, non un effetto voluto.
 */
export function advanceWorldOnly(game: GameState, dt: number): void {
  const distanceBefore = game.world.distance;
  updateWorld(game.world, dt);
  const moved = game.world.distance - distanceBefore;

  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }
  compactEntities(game.entities);
}

function resolveCollision(game: GameState, entity: Entity): void {
  if (isPickupKind(entity.kind)) {
    collectPickup(game, entity, entity.kind);
    return;
  }
  hitObstacle(game, entity, entity.kind);
}

/**
 * Carica extra necessaria a far salire di `levels` livelli la taglia che si
 * avrebbe con `charge`. Lo scatto di taglia della mucca raccolta è espresso
 * nell'unica risorsa del gioco: se alzassimo `size` a parte, il primo ricalcolo
 * da soglia lo cancellerebbe e la barra mentirebbe al giocatore.
 */
function sizeBonusCharge(charge: number, levels: number): number {
  if (levels <= 0) return 0;

  const thresholds = CONFIG.avalanche.sizeThresholds;
  const targetIndex = Math.min(
    sizeForCharge(charge) - 1 + levels,
    CONFIG.avalanche.maxSize - 1,
  );
  const needed = thresholds[targetIndex];
  if (needed === undefined) return 0;

  return Math.max(0, needed - charge);
}

function collectPickup(game: GameState, entity: Entity, kind: PickupKind): void {
  entity.alive = false;

  // Il moltiplicatore è letto prima della carica: il pickup che fa scattare la
  // valanga vale ancora ×1.
  const multiplier = scoreMultiplier(game.avalanche);
  const base = CONFIG.pickups.charge[kind];
  const extra = sizeBonusCharge(
    Math.min(CONFIG.avalanche.threshold, game.avalanche.charge + base),
    CONFIG.pickups.sizeBonus[kind],
  );

  const chargeBefore = game.avalanche.charge;
  addCharge(game.avalanche, base + extra, game.bus);
  addBonus(game.score, CONFIG.score.pickupBonus[kind], multiplier);

  game.bus.emit('pickup:collected', {
    kind,
    charge: game.avalanche.charge - chargeBefore,
  });
}

function hitObstacle(game: GameState, entity: Entity, kind: ObstacleKind): void {
  const multiplier = scoreMultiplier(game.avalanche);
  const lane = entity.lane;
  const z = entity.z;

  if (canSmash(game.avalanche, kind)) {
    entity.alive = false;
    addBonus(game.score, CONFIG.score.smashBonus, multiplier);
    game.bus.emit('obstacle:hit', { kind, outcome: 'smashed', lane, z });
    return;
  }

  const chargeRatio = game.avalanche.charge / CONFIG.avalanche.threshold;
  const forgivable =
    CONFIG.forgiveness.enabled &&
    !game.forgivenessUsed &&
    chargeRatio >= CONFIG.forgiveness.minChargeRatio;

  if (forgivable) {
    game.forgivenessUsed = true;
    // L'ostacolo perdonato sparisce: altrimenti colpirebbe di nuovo il frame dopo.
    entity.alive = false;
    applyForgivenessPenalty(game.avalanche, game.bus);
    game.bus.emit('obstacle:hit', { kind, outcome: 'forgiven', lane, z });
    return;
  }

  game.alive = false;
  game.bus.emit('obstacle:hit', { kind, outcome: 'death', lane, z });

  const isRecord = saveRecord(game.score.points);
  game.bus.emit('run:ended', {
    points: game.score.points,
    distance: game.score.distance,
    isRecord,
  });
}

/** Compattazione a due indici, in place: nessun array nuovo per frame. */
function compactEntities(entities: Entity[]): void {
  let write = 0;
  for (let read = 0; read < entities.length; read += 1) {
    const entity = entities[read];
    if (entity === undefined || !entity.alive) continue;
    if (write !== read) entities[write] = entity;
    write += 1;
  }
  entities.length = write;
}
