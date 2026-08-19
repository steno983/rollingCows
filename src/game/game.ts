import type { EventBus } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import {
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  createAvalanche,
  scoreMultiplier,
  updateAvalanche,
  type AvalancheState,
} from './avalanche';
import {
  applyBuff,
  buffMultiplier,
  consumeShield,
  createBuffs,
  magnetActive,
  updateBuffs,
  type BuffState,
} from './buffs';
import { boxesOverlap, entityBox, playerBox, ENTITY_BOX } from './collisions';
import { CONFIG } from './config';
import {
  branchIsSolid,
  chooseBranch,
  createPath,
  updatePath,
  type ForkPhase,
  type PathState,
} from './path';
import { createPlayer, jump, slide, updatePlayer, type PlayerState } from './player';
import { addBonus, addDistance, createScore, saveRecord, type ScoreState } from './score';
import { createSpawner, type Spawner } from './spawner';
import { difficultyAt } from './speed';
import type { Action, Branch, Entity, EntityKind, ObstacleKind, PickupKind } from './types';
import { createWorld, updateWorld, type WorldState } from './world';

export interface GameState {
  /** Seed della run corrente: va in `run:started` e permette di rigiocarla identica. */
  seed: number;
  rng: Rng;
  bus: EventBus;
  world: WorldState;
  path: PathState;
  player: PlayerState;
  avalanche: AvalancheState;
  buffs: BuffState;
  score: ScoreState;
  spawner: Spawner;
  entities: Entity[];
  alive: boolean;
  forgivenessUsed: boolean;
}

/**
 * Semi-finestra lungo z entro cui vale la pena costruire le AABB. Derivata
 * dalle profondità dichiarate, non da un numero scelto a mano: a 40 u/s con
 * passo 1/60 un'entità si sposta di 0,67 unità per frame, quindi non può
 * saltare questa finestra senza essere testata.
 */
const MAX_ENTITY_DEPTH = Math.max(...Object.values(ENTITY_BOX).map((box) => box.depth));
const COLLISION_Z_WINDOW = CONFIG.player.depth + MAX_ENTITY_DEPTH;

function isPickupKind(kind: EntityKind): kind is PickupKind {
  return (
    kind === 'snowflake' || kind === 'crystal' || kind === 'star' || kind === 'magnet' || kind === 'bell'
  );
}

export function createGame(seed: number, bus: EventBus): GameState {
  const rng = createRng(seed);
  return {
    seed,
    rng,
    bus,
    world: createWorld(),
    path: createPath(),
    player: createPlayer(),
    avalanche: createAvalanche(),
    buffs: createBuffs(),
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
  game.path = createPath();
  game.player = createPlayer();
  game.avalanche = createAvalanche();
  game.buffs = createBuffs();
  game.score = createScore();
  game.entities.length = 0;
  game.alive = true;
  game.forgivenessUsed = false;

  // Il tronco esiste già (i chunk di world.ts) ma è vuoto: senza popolarlo
  // subito, il primo riciclo di chunk sarebbe l'unica occasione di
  // generazione e la partenza sarebbe un pendio vuoto per diversi secondi.
  const difficulty = difficultyAt(game.world.distance);
  const chunks = game.world.chunks;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    game.spawner.populateSegment(chunk.z, CONFIG.world.chunkLength, difficulty, 'main', false, game.entities);
  }

  // Zona franca: nessuna entità nasce addosso al giocatore.
  const spawnSafeZ = CONFIG.world.spawnSafeZ;
  for (let i = 0; i < game.entities.length; i++) {
    const entity = game.entities[i];
    if (entity !== undefined && entity.z < spawnSafeZ) entity.alive = false;
  }
  compactEntities(game.entities);

  game.bus.emit('run:started', { seed: game.seed });
}

/**
 * Interrompe la run corrente SENZA che sia stata una morte: es. il giocatore
 * torna al menu mentre è ancora vivo. Emette 'run:stopped', non 'run:ended'
 * (riservato alla morte, fa scattare il rallentatore in main.ts).
 */
export function abandonRun(game: GameState): void {
  if (!game.alive) return;
  game.alive = false;
  game.bus.emit('run:stopped', {});
}

export function handleAction(game: GameState, action: Action): void {
  if (!game.alive) return;

  switch (action) {
    case 'CHOOSE_LEFT':
      chooseBranch(game.path, 'left');
      break;
    case 'CHOOSE_RIGHT':
      chooseBranch(game.path, 'right');
      break;
    case 'JUMP':
      jump(game.player);
      break;
    case 'SLIDE':
      slide(game.player);
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
  const moved = game.world.distance - distanceBefore;

  // path: si cattura la fase (e il ramo attivo) PRIMA di aggiornare, perché
  // updatePath può farli scattare nello stesso frame e altrimenti perderemmo
  // il "prima" necessario a rilevare la transizione.
  const phaseBefore = game.path.phase;
  const activeBranchBefore = game.path.activeBranch;
  updatePath(game.path, moved, game.world.speed, game.rng, game.bus);

  updatePlayer(game.player, dt);
  updateAvalanche(game.avalanche, dt, game.bus);
  updateBuffs(game.buffs, dt, game.bus);

  // spawn: rifornimento di routine sul tronco, poi le eventuali transizioni
  // del bivio (nascita, risoluzione, chiusura) che sostituiscono o
  // rietichettano le entità coinvolte.
  const difficulty = difficultyAt(game.world.distance);
  const recycled = game.world.recycled;
  for (let i = 0; i < recycled.length; i++) {
    const chunk = recycled[i];
    if (chunk === undefined) continue;
    game.spawner.populateSegment(chunk.z, CONFIG.world.chunkLength, difficulty, 'main', false, game.entities);
  }
  handleForkTransitions(game, phaseBefore, activeBranchBefore, difficulty);

  // avanzamento entità
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }

  // calamita
  applyMagnet(game);

  // collisioni: solo con entità il cui ramo è solido.
  const box = playerBox(game.player.y, game.avalanche.size, game.player.sliding);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (!branchIsSolid(game.path, entity.branch)) continue;
    if (Math.abs(entity.z) > COLLISION_Z_WINDOW) continue;
    if (!boxesOverlap(box, entityBox(entity))) continue;

    resolveCollision(game, entity);
    if (!game.alive) break;
  }

  compactEntities(game.entities);

  // punteggio
  if (game.alive) {
    const multiplier = scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs);
    addDistance(game.score, moved, multiplier);
  }
}

/**
 * Reagisce alle transizioni di fase del bivio appena avvenute in updatePath.
 * Le tre transizioni rilevanti:
 * - 'none' -> 'approaching': nasce un bivio. La finestra [0, previewZ] non è
 *   più tronco: le entità 'main' già lì (da un riciclo di chunk avvenuto
 *   prima, ignaro del bivio) vengono rimosse e la finestra viene ripopolata
 *   due volte, una per ramo.
 * - 'approaching' -> 'committed': la scelta è fissata. Le entità del ramo
 *   scartato vengono rimosse subito: nessun leak.
 * - da 'committed'/'realigning' a 'none': il bivio è chiuso, il ramo scelto
 *   è il nuovo tronco. Le sue entità sopravvissute vengono rietichettate
 *   'main', altrimenti branchIsSolid le renderebbe di nuovo inerti.
 */
function handleForkTransitions(
  game: GameState,
  phaseBefore: ForkPhase,
  activeBranchBefore: Branch,
  difficulty: number,
): void {
  const path = game.path;

  if (phaseBefore === 'none' && path.phase === 'approaching') {
    removeMainEntitiesAhead(game.entities, CONFIG.path.previewZ);
    const richLeft = path.richBranch === 'left';
    game.spawner.populateSegment(0, CONFIG.path.previewZ, difficulty, 'left', richLeft, game.entities);
    game.spawner.populateSegment(0, CONFIG.path.previewZ, difficulty, 'right', !richLeft, game.entities);
    return;
  }

  if (phaseBefore === 'approaching' && path.phase === 'committed') {
    const discarded: Branch = path.activeBranch === 'left' ? 'right' : 'left';
    removeEntitiesOnBranch(game.entities, discarded);
    return;
  }

  if (phaseBefore !== 'none' && path.phase === 'none') {
    relabelBranch(game.entities, activeBranchBefore, 'main');
  }
}

function removeMainEntitiesAhead(entities: Entity[], maxZ: number): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.branch === 'main' && entity.z <= maxZ) entity.alive = false;
  }
}

function removeEntitiesOnBranch(entities: Entity[], branch: Branch): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.branch === branch) entity.alive = false;
  }
}

function relabelBranch(entities: Entity[], from: Branch, to: Branch): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined) continue;
    if (entity.branch === from) entity.branch = to;
  }
}

/** Raccoglie direttamente i fiocchi entro magnetRangeZ sul ramo solido: non
 *  c'è un numero di "velocità di trascinamento" in config, quindi la
 *  calamita raccoglie invece di trascinare (vedi Note di progetto). */
function applyMagnet(game: GameState): void {
  if (!magnetActive(game.buffs)) return;

  const rangeZ = CONFIG.buffs.magnetRangeZ;
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.kind !== 'snowflake') continue;
    if (entity.z < 0 || entity.z > rangeZ) continue;
    if (!branchIsSolid(game.path, entity.branch)) continue;
    collectPickup(game, entity, 'snowflake');
  }
}

/**
 * Fa avanzare solo il pendio e le posizioni delle entità esistenti, senza
 * collisioni, punteggio o nuova generazione: usata da main.ts durante il
 * rallentatore alla morte (game.alive è già false, updateGame non fa nulla).
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
 * 'star', 'magnet' e 'bell' passano da applyBuff (stato, non carica).
 * 'snowflake' e 'crystal' danno carica pura: nessuno stato in buffs.ts.
 */
function collectPickup(game: GameState, entity: Entity, kind: PickupKind): void {
  entity.alive = false;

  // Il moltiplicatore è letto prima di qualunque effetto: il pickup che fa
  // scattare la valanga vale ancora il moltiplicatore precedente.
  const multiplier = scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs);
  addBonus(game.score, CONFIG.score.pickupBonus[kind], multiplier);

  if (kind === 'star' || kind === 'magnet' || kind === 'bell') {
    applyBuff(game.buffs, kind, game.bus);
    game.bus.emit('pickup:collected', { kind, charge: 0 });
    return;
  }

  const base = CONFIG.pickups.charge[kind];
  const chargeBefore = game.avalanche.charge;
  addCharge(game.avalanche, base, game.bus);
  game.bus.emit('pickup:collected', { kind, charge: game.avalanche.charge - chargeBefore });
}

function hitObstacle(game: GameState, entity: Entity, kind: ObstacleKind): void {
  const multiplier = scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs);
  const branch = entity.branch;
  const z = entity.z;

  if (canSmash(game.avalanche, kind)) {
    entity.alive = false;
    addBonus(game.score, CONFIG.score.smashBonus, multiplier);
    game.bus.emit('obstacle:hit', { kind, outcome: 'smashed', branch, z });
    return;
  }

  if (consumeShield(game.buffs, game.bus)) {
    entity.alive = false;
    game.bus.emit('obstacle:hit', { kind, outcome: 'shielded', branch, z });
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
    game.bus.emit('obstacle:hit', { kind, outcome: 'forgiven', branch, z });
    return;
  }

  game.alive = false;
  game.bus.emit('obstacle:hit', { kind, outcome: 'death', branch, z });

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
