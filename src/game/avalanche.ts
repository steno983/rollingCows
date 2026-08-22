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
  if (amount <= 0) return;

  // Durante la valanga i raccoglibili NON caricano: valgono solo i punti.
  //
  // Non è uno spreco lasciato lì per pigrizia, è ciò che rende leggibile la
  // barra: durante la fase la barra non misura più la carica ma il TEMPO che
  // resta (vedi avalancheBarRatio), e una barra che scende per raccontare il
  // tempo mentre risale per raccontare la carica non racconterebbe più niente.
  // Fuori dalla valanga la barra torna a essere la carica, e riparte da zero.
  if (state.phase !== 'idle') return;

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
    // Si riparte da zero: lo sfogo si paga, ed è la regola dichiarata dal
    // design. La taglia segue la carica come sempre — è sizeForCharge la
    // definizione di "quanto è grossa la mucca", non un valore a parte.
    state.charge = 0;
    bus.emit('avalanche:ended', {});
    setSize(state, sizeForCharge(state.charge), bus);
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

/**
 * Riempimento della barra, 0..1 — e NON è sempre la carica.
 *
 * Fuori dalla valanga la barra è la carica che sale verso la soglia. Durante
 * la valanga diventa il TEMPO che resta, e scende: prima restava piena e
 * immobile per tutta la fase, quindi l'unica indicazione che stava per finire
 * era il lampeggio dell'ultimo secondo — troppo tardi per farci qualcosa, in
 * una fase in cui si sta correndo a velocità massima dentro gli ostacoli.
 * Vedendola scendere si sa quanto manca, e il lampeggio diventa la conferma
 * di una cosa che si stava già guardando invece che una sorpresa.
 *
 * Sono due grandezze diverse sulla stessa barra, ed è una scelta: l'alternativa
 * (un secondo indicatore per il tempo) aggiungerebbe un elemento a schermo per
 * dire una cosa che quello esistente, in quel momento, non sta dicendo.
 */
export function avalancheBarRatio(state: AvalancheState): number {
  if (state.phase === 'idle') return chargeRatio(state);
  const duration = CONFIG.avalanche.durationSeconds;
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, state.timeLeft / duration));
}

/** Frazione della soglia già accumulata, 0..1. È il numero su cui è tarato
 *  CONFIG.forgiveness.minChargeRatio. */
export function chargeRatio(state: AvalancheState): number {
  return state.charge / CONFIG.avalanche.threshold;
}

export function isInvulnerable(state: AvalancheState): boolean {
  return state.phase !== 'idle';
}

export function canSmash(state: AvalancheState, kind: ObstacleKind): boolean {
  if (isInvulnerable(state)) return true;
  // 'tree' non è più un ObstacleKind in v2 (è scenografia laterale): resta
  // sfondabile fuori dalla valanga solo 'fence', l'unico kind smashable
  // della vecchia coppia rimasto nel tipo.
  if (kind !== 'fence') return false;
  return state.size >= CONFIG.avalanche.smashMinSize;
}

export function scoreMultiplier(state: AvalancheState): number {
  return isInvulnerable(state) ? CONFIG.avalanche.scoreMultiplier : 1;
}
