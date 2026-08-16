import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Entity, EntityKind, Lane, ObstacleKind, PickupKind } from './types';

/** Quota della base del ramo sospeso: sotto ci si passa con lo slam. */
export const BRANCH_Y: number = CONFIG.spawn.branchY;

/** Ostacoli che poggiano a terra e bloccano la corsia. */
const GROUND_OBSTACLES: readonly ObstacleKind[] = ['rock', 'tree', 'fence', 'crevasse'];

const PICKUP_BY_ROLL: readonly PickupKind[] = ['cow', 'hay', 'snowflake'];

export interface Spawner {
  /** Popola un chunk appena riciclato, aggiungendo entità a `out`. */
  populateChunk(chunkZ: number, difficulty: number, out: Entity[]): void;
  reset(): void;
}

export function createSpawner(rng: Rng): Spawner {
  const { laneCount, chunkLength } = CONFIG.world;
  const { rowSpacing, rowFillChanceMin, rowFillChanceMax, maxBlockedLanes } = CONFIG.spawn;
  const { pickupChance, cowChance, hayChance } = CONFIG.spawn;

  const rowCount = Math.max(1, Math.floor(chunkLength / rowSpacing));
  /** Tetto reale di corsie bloccabili: almeno una resta sempre percorribile. */
  const blockLimit = Math.min(maxBlockedLanes, laneCount - 1);
  /** Scratch riusato per ogni riga: nessuna allocazione durante la generazione. */
  const laneBlocked: boolean[] = new Array<boolean>(laneCount).fill(false);

  let nextId = 0;

  function clearLanes(): void {
    for (let lane = 0; lane < laneCount; lane++) {
      laneBlocked[lane] = false;
    }
  }

  function freeLaneCount(): number {
    let free = 0;
    for (let lane = 0; lane < laneCount; lane++) {
      if (!laneBlocked[lane]) free++;
    }
    return free;
  }

  /** Corsia libera scelta a caso, oppure -1 se non ce ne sono. */
  function pickFreeLane(): number {
    const free = freeLaneCount();
    if (free === 0) return -1;
    let target = rng.int(0, free);
    for (let lane = 0; lane < laneCount; lane++) {
      if (laneBlocked[lane]) continue;
      if (target === 0) return lane;
      target--;
    }
    return -1;
  }

  function emit(
    out: Entity[],
    kind: EntityKind,
    category: 'obstacle' | 'pickup',
    lane: number,
    width: 1 | 2,
    z: number,
    y: number,
  ): void {
    out.push({
      id: nextId++,
      kind,
      category,
      lane: lane as Lane,
      width,
      z,
      y,
      alive: true,
    });
  }

  function pickPickupKind(): PickupKind {
    const roll = rng.next();
    if (roll < cowChance) return PICKUP_BY_ROLL[0] as PickupKind;
    if (roll < cowChance + hayChance) return PICKUP_BY_ROLL[1] as PickupKind;
    return PICKUP_BY_ROLL[2] as PickupKind;
  }

  function populateRow(rowZ: number, difficulty: number, out: Entity[]): void {
    clearLanes();

    // 1. Ostacoli a terra. La cabin occupa due corsie e da sola satura il budget.
    const cabinChance =
      CONFIG.spawn.cabinChanceBase + CONFIG.spawn.cabinChancePerDifficulty * difficulty;
    if (blockLimit >= 2 && laneCount >= 3 && rng.chance(cabinChance)) {
      const lane = rng.int(0, laneCount - 1); // 0 o 1: la cabin sfora a destra
      emit(out, 'cabin', 'obstacle', lane, 2, rowZ, 0);
      laneBlocked[lane] = true;
      laneBlocked[lane + 1] = true;
    } else {
      const secondChance =
        CONFIG.spawn.secondObstacleChanceBase +
        CONFIG.spawn.secondObstacleChancePerDifficulty * difficulty;
      const wanted = rng.chance(secondChance) ? 2 : 1;
      const count = Math.min(wanted, blockLimit);
      for (let i = 0; i < count; i++) {
        const lane = pickFreeLane();
        if (lane < 0) break;
        emit(out, rng.pick(GROUND_OBSTACLES), 'obstacle', lane, 1, rowZ, 0);
        laneBlocked[lane] = true;
      }
    }

    // 2. Ramo sospeso: non blocca la corsia (ci si passa sotto con lo slam), ma lo
    //    generiamo solo se resta almeno una corsia completamente sgombra.
    const blocked = laneCount - freeLaneCount();
    const branchChance =
      CONFIG.spawn.branchChanceBase + CONFIG.spawn.branchChancePerDifficulty * difficulty;
    if (blocked < blockLimit && rng.chance(branchChance)) {
      const lane = pickFreeLane();
      if (lane >= 0) {
        emit(out, 'branch', 'obstacle', lane, 1, rowZ, BRANCH_Y);
      }
    }

    // 3. Un raccoglibile al massimo, mai in una corsia occupata da un ostacolo a terra.
    if (rng.chance(pickupChance)) {
      const lane = pickFreeLane();
      if (lane >= 0) {
        emit(out, pickPickupKind(), 'pickup', lane, 1, rowZ, 0);
        laneBlocked[lane] = true;
      }
    }
  }

  return {
    populateChunk(chunkZ: number, difficulty: number, out: Entity[]): void {
      const clamped = Math.min(1, Math.max(0, difficulty));
      const fillChance = rowFillChanceMin + (rowFillChanceMax - rowFillChanceMin) * clamped;
      for (let row = 0; row < rowCount; row++) {
        if (!rng.chance(fillChance)) continue;
        populateRow(chunkZ + row * rowSpacing, clamped, out);
      }
    },
    reset(): void {
      nextId = 0;
    },
  };
}
