import type { EventBus } from '../core/events';
import { CONFIG } from './config';
import type { ObstacleKind } from './types';

export type AvalanchePhase = 'idle' | 'active' | 'warning';

export interface AvalancheState {
  /** Carica accumulata, 0..CONFIG.avalanche.threshold. */
  charge: number;
  /** Taglia della mucca, 1..CONFIG.avalanche.maxSize. */
  size: number;
  phase: AvalanchePhase;
  /** Secondi rimanenti nella fase active/warning. */
  timeLeft: number;
}

export function createAvalanche(): AvalancheState {
  return { charge: 0, size: 1, phase: 'idle', timeLeft: 0 };
}

export function sizeForCharge(charge: number): number {
  const thresholds = CONFIG.avalanche.sizeThresholds;
  let size = 1;
  for (let index = 0; index < thresholds.length; index += 1) {
    const threshold = thresholds[index];
    if (threshold === undefined) continue;
    if (charge >= threshold) size = index + 1;
  }
  return Math.min(size, CONFIG.avalanche.maxSize);
}

/** Unico punto in cui la taglia cambia: clampa ed emette `size:changed`. */
function setSize(state: AvalancheState, next: number, bus: EventBus): void {
  const clamped = Math.max(1, Math.min(CONFIG.avalanche.maxSize, Math.floor(next)));
  if (clamped === state.size) return;
  const previous = state.size;
  state.size = clamped;
  bus.emit('size:changed', { size: clamped, previous });
}

export function addCharge(state: AvalancheState, amount: number, bus: EventBus): void {
  // Durante la valanga la carica è congelata: la fase non si autoprolunga.
  if (state.phase !== 'idle') return;
  if (amount <= 0) return;

  const threshold = CONFIG.avalanche.threshold;
  state.charge = Math.min(threshold, state.charge + amount);
  setSize(state, sizeForCharge(state.charge), bus);

  if (state.charge >= threshold) {
    state.phase = 'active';
    state.timeLeft = CONFIG.avalanche.durationSeconds;
    bus.emit('avalanche:triggered', { size: state.size });
  }
}

export function updateAvalanche(state: AvalancheState, dt: number, bus: EventBus): void {
  if (state.phase === 'idle') return;

  state.timeLeft -= dt;

  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.phase = 'idle';
    state.charge = 0;
    bus.emit('avalanche:ended', {});
    setSize(state, 1, bus);
    return;
  }

  if (state.phase === 'active' && state.timeLeft <= CONFIG.avalanche.warningSeconds) {
    state.phase = 'warning';
    bus.emit('avalanche:ending', {});
  }
}

/** Penalità del "primo impatto perdonato": carica a zero e taglia scalata. */
export function applyForgivenessPenalty(state: AvalancheState, bus: EventBus): void {
  state.charge = 0;
  setSize(state, state.size - CONFIG.forgiveness.sizePenalty, bus);
}

export function isInvulnerable(state: AvalancheState): boolean {
  return state.phase !== 'idle';
}

export function canSmash(state: AvalancheState, kind: ObstacleKind): boolean {
  if (isInvulnerable(state)) return true;
  if (kind !== 'tree' && kind !== 'fence') return false;
  return state.size >= CONFIG.avalanche.smashMinSize;
}

export function scoreMultiplier(state: AvalancheState): number {
  return isInvulnerable(state) ? CONFIG.avalanche.scoreMultiplier : 1;
}
