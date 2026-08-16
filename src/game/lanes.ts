import { CONFIG } from './config';
import type { Lane } from './types';

const { laneCount, laneWidth } = CONFIG.world;

/** Indice della corsia centrale espresso come numero reale: con 3 corsie vale 1. */
const CENTER_LANE = (laneCount - 1) / 2;

/** Centro X della corsia (corsia 1 = 0). */
export function laneToX(lane: number): number {
  return (lane - CENTER_LANE) * laneWidth;
}

/** Centro X di un'entità larga `width` corsie che parte da `lane`. */
export function entityCenterX(lane: number, width: number): number {
  return laneToX(lane) + ((width - 1) * laneWidth) / 2;
}

/** Semi-larghezza in unità di mondo di un'entità larga `width` corsie. */
export function entityHalfWidth(width: number): number {
  return (width * laneWidth) / 2;
}

/** Corsia valida più vicina, clampata in [0, laneCount-1]. */
export function clampLane(lane: number): Lane {
  const rounded = Math.round(lane);
  if (rounded <= 0) return 0;
  if (rounded >= laneCount - 1) return (laneCount - 1) as Lane;
  return rounded as Lane;
}
