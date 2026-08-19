import type { EventBus } from '../core/events';
import { CONFIG } from './config';
import type { BuffKind } from './types';

export interface BuffState {
  shield: boolean;
  /** Secondi residui della stella (moltiplicatore di punteggio). */
  starTimeLeft: number;
  /** Secondi residui della calamita (attira i fiocchi). */
  magnetTimeLeft: number;
}

export function createBuffs(): BuffState {
  return { shield: false, starTimeLeft: 0, magnetTimeLeft: 0 };
}

export function resetBuffs(state: BuffState): void {
  state.shield = false;
  state.starTimeLeft = 0;
  state.magnetTimeLeft = 0;
}

/**
 * Applica un buff raccolto. 'crystal' NON passa di qui: dà carica alla
 * valanga, non stato (vedi game.ts, che per 'crystal' chiama addCharge
 * direttamente). Raccogliere stella o calamita mentre sono già attive
 * RICARICA la durata invece di sommarla: un tetto fisso è leggibile
 * ("hai ancora N secondi"), una somma illimitata no. Il campanaccio è un
 * interruttore, non un contatore: raccoglierne un secondo mentre lo scudo
 * è già acceso lascia lo stato identico, senza scorta accumulata.
 */
export function applyBuff(state: BuffState, kind: BuffKind, bus: EventBus): void {
  switch (kind) {
    case 'star':
      state.starTimeLeft = CONFIG.buffs.starSeconds;
      break;
    case 'magnet':
      state.magnetTimeLeft = CONFIG.buffs.magnetSeconds;
      break;
    case 'bell':
      state.shield = true;
      break;
    case 'crystal':
      // Nessuno stato da aggiornare qui: niente evento, niente effetto.
      return;
  }
  bus.emit('buff:gained', { kind });
}

/**
 * Scala i tempi residui del delta time. `buff:expired` viene emesso UNA SOLA
 * VOLTA per buff, esattamente nel frame in cui il tempo passa da positivo a
 * zero: la guardia `> 0` all'ingresso di ciascun blocco impedisce che i
 * frame successivi (dopo la scadenza) rientrino nel ramo e remittano
 * l'evento, stesso pattern di avalanche:ended in avalanche.ts.
 */
export function updateBuffs(state: BuffState, dt: number, bus: EventBus): void {
  if (state.starTimeLeft > 0) {
    state.starTimeLeft = Math.max(0, state.starTimeLeft - dt);
    if (state.starTimeLeft === 0) bus.emit('buff:expired', { kind: 'star' });
  }
  if (state.magnetTimeLeft > 0) {
    state.magnetTimeLeft = Math.max(0, state.magnetTimeLeft - dt);
    if (state.magnetTimeLeft === 0) bus.emit('buff:expired', { kind: 'magnet' });
  }
}

/** Consuma lo scudo se presente. Restituisce true se ha assorbito il colpo. */
export function consumeShield(state: BuffState, bus: EventBus): boolean {
  if (!state.shield) return false;
  state.shield = false;
  bus.emit('shield:consumed', {});
  return true;
}

export function buffMultiplier(state: BuffState): number {
  return state.starTimeLeft > 0 ? CONFIG.buffs.starMultiplier : 1;
}

export function magnetActive(state: BuffState): boolean {
  return state.magnetTimeLeft > 0;
}
