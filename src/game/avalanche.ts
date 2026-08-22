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
  /** Carica raccolta DURANTE la valanga, in attesa di essere versata sulla
   *  barra alla fine (vedi addCharge). Prima veniva semplicemente buttata: nel
   *  profilo che sceglie sempre il ramo ricco erano 607 fiocchi per corsa,
   *  cioè più carica di quanta se ne accumuli utilmente, e niente lo
   *  comunicava — la barra è piena e lampeggia, quindi lo spreco era
   *  invisibile e la strategia ottimale ("smetti di raccogliere durante la
   *  valanga") antintuitiva e comunque ineseguibile. */
  carryOver: number;
}

export function createAvalanche(): AvalancheState {
  return { charge: 0, size: 1, phase: 'idle', timeLeft: 0, carryOver: 0 };
}

/** Tetto del riporto, in unità di carica. */
function carryOverCap(): number {
  return CONFIG.avalanche.threshold * CONFIG.avalanche.carryOverRatio;
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

  // Durante la valanga la barra resta congelata — altrimenti la fase si
  // autoprolungherebbe — ma la carica non si perde più: finisce nel
  // serbatoio, che si versa alla fine (vedi updateAvalanche). Il tetto tiene
  // il riporto una ricompensa e non una scorciatoia: al massimo
  // carryOverRatio della soglia, cioè mai una valanga quasi gratis.
  if (state.phase !== 'idle') {
    state.carryOver = Math.min(carryOverCap(), state.carryOver + amount);
    return;
  }

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
    // La barra riparte dal riporto, non da zero: il tetto è sotto la soglia
    // per costruzione, quindi versarlo non può innescare subito la valanga
    // successiva. La taglia segue la carica come sempre — è sizeForCharge la
    // definizione di "quanto è grossa la mucca", non un valore a parte.
    state.charge = Math.min(CONFIG.avalanche.threshold, state.carryOver);
    state.carryOver = 0;
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
  // Anche il serbatoio: il perdono azzera la corsa alla valanga, non solo la
  // parte di corsa che si vede.
  state.carryOver = 0;
  setSize(state, state.size - CONFIG.forgiveness.sizePenalty, bus);
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
