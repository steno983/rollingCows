import { CONFIG } from './config';

/** Velocità di scorrimento del mondo alla distanza data (u/s). */
export function speedAt(distance: number): number {
  const { startSpeed, maxSpeed, speedGrowth, speedRefDistance } = CONFIG.world;
  const grown = startSpeed + speedGrowth * Math.log1p(Math.max(0, distance) / speedRefDistance);
  return Math.min(maxSpeed, grown);
}

/** Difficoltà normalizzata in [0,1] alla distanza data. */
export function difficultyAt(distance: number): number {
  const ratio = distance / CONFIG.spawn.difficultyRampDistance;
  if (ratio <= 0) return 0;
  return Math.min(1, ratio);
}
