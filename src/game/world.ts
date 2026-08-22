import { CONFIG } from './config';
import { DEFAULT_DIFFICULTY_PROFILE, type DifficultyProfile, speedAt } from './speed';

export interface Chunk {
  id: number;
  /** Bordo iniziale (più vicino al giocatore) del chunk. */
  z: number;
}

export interface WorldState {
  distance: number;
  speed: number;
  chunks: Chunk[];
  /** Riempito da updateWorld a ogni frame: chunk riciclati in questo frame. */
  recycled: Chunk[];
}

/**
 * Il profilo di difficoltà è un parametro e non una lettura di CONFIG perché è
 * lo stato di gioco a possederlo (vedi game/speed.ts): il mondo si limita a
 * usarlo per interrogare la curva di velocità. È opzionale e ricade sul
 * profilo normale, i cui tre numeri coincidono con quelli di CONFIG: chi non
 * lo passa — i test di modulo, per esempio — ottiene il gioco di riferimento.
 */
export function createWorld(profile: DifficultyProfile = DEFAULT_DIFFICULTY_PROFILE): WorldState {
  const { chunkCount, chunkLength } = CONFIG.world;
  const chunks: Chunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push({ id: i, z: i * chunkLength });
  }
  return {
    distance: 0,
    speed: speedAt(0, profile),
    chunks,
    recycled: [],
  };
}

/** Avanza distanza e scorre i chunk. I chunk usciti dietro vengono riposizionati
 *  in coda e messi in `world.recycled` (array riusato, svuotato a ogni chiamata). */
export function updateWorld(
  world: WorldState,
  dt: number,
  profile: DifficultyProfile = DEFAULT_DIFFICULTY_PROFILE,
): void {
  const { chunkLength, despawnBehindZ } = CONFIG.world;
  const chunks = world.chunks;

  world.recycled.length = 0;
  world.speed = speedAt(world.distance, profile);

  const delta = world.speed * dt;
  world.distance += delta;

  // Primo passaggio: scorrimento e ricerca del bordo più lontano.
  let maxZ = -Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    chunk.z -= delta;
    if (chunk.z > maxZ) maxZ = chunk.z;
  }

  // Secondo passaggio: riciclo in coda. `maxZ` avanza a ogni riciclo, così anche
  // più chunk riciclati nello stesso frame restano contigui e senza sovrapposizioni.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    if (chunk.z + chunkLength < despawnBehindZ) {
      maxZ += chunkLength;
      chunk.z = maxZ;
      world.recycled.push(chunk);
    }
  }
}
