import { CONFIG } from './config';
import { speedAt } from './speed';

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

export function createWorld(): WorldState {
  const { chunkCount, chunkLength } = CONFIG.world;
  const chunks: Chunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push({ id: i, z: i * chunkLength });
  }
  return {
    distance: 0,
    speed: speedAt(0),
    chunks,
    recycled: [],
  };
}

/** Avanza distanza e scorre i chunk. I chunk usciti dietro vengono riposizionati
 *  in coda e messi in `world.recycled` (array riusato, svuotato a ogni chiamata). */
export function updateWorld(world: WorldState, dt: number): void {
  const { chunkLength, despawnBehindZ } = CONFIG.world;
  const chunks = world.chunks;

  world.recycled.length = 0;
  world.speed = speedAt(world.distance);

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
