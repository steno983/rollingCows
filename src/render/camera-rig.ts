import { CONFIG } from '../game/config';

/**
 * Rapporto fra altezza e distanza della camera. È una scelta di inquadratura,
 * non un numero di bilanciamento: tenendolo costante l'inclinazione della
 * camera resta identica a ogni taglia, e cambia solo quanto mondo si vede.
 *
 * A 0.42 la camera era quasi a filo del pendio (pitch ≈ -7.5°): tutto oltre
 * ~40 unità si schiacciava in pochi pixel verticali proprio dove iniziava la
 * nebbia, lasciando meno di un secondo di lettura utile su un ostacolo a 40
 * u/s. Alzata a 0.68 (pitch ≈ -12.7°) si vede più pendio davanti alla mucca:
 * vedi anche render.fogNear/fogFar in game/config.ts, spostati in coppia con
 * questo valore.
 */
export const CAMERA_HEIGHT_RATIO = 0.68;

/** Distanza della camera dietro la mucca per la taglia data (1..maxSize). */
export function cameraDistanceFor(size: number): number {
  const clamped = Math.min(CONFIG.avalanche.maxSize, Math.max(1, size));
  return (
    CONFIG.render.cameraBaseDistance + (clamped - 1) * CONFIG.render.cameraDistancePerSize
  );
}

/** Altezza della camera sopra il pendio per la taglia data. */
export function cameraHeightFor(size: number): number {
  return cameraDistanceFor(size) * CAMERA_HEIGHT_RATIO;
}

/**
 * FOV durante la transizione verso lo stato corrente.
 * `t` è l'avanzamento della transizione in [0,1]: 0 = stato appena cambiato,
 * 1 = transizione conclusa. Entrando in valanga si va da cameraBaseFov a
 * cameraAvalancheFov, uscendo si torna indietro.
 */
export function cameraFovFor(avalanche: boolean, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const eased = clamped * clamped * (3 - 2 * clamped);
  const from = avalanche ? CONFIG.render.cameraBaseFov : CONFIG.render.cameraAvalancheFov;
  const to = avalanche ? CONFIG.render.cameraAvalancheFov : CONFIG.render.cameraBaseFov;
  return from + (to - from) * eased;
}

/**
 * Smorzamento esponenziale dello scuotimento: indipendente dal frame rate,
 * con snap a zero sotto la soglia percettibile per non tenere la camera
 * perennemente "viva" con oscillazioni infinitesime.
 */
export function decayShake(current: number, dt: number): number {
  const next = current * Math.exp(-CONFIG.render.shakeDecay * dt);
  return next < 1e-4 ? 0 : next;
}

/**
 * Converte una X di mondo nella X della vista. La camera sta a z negativo e
 * guarda verso +z: in quell'inquadratura l'asse +X del mondo cade a sinistra
 * dello schermo. Questa è l'unica funzione autorizzata a specchiare l'asse.
 */
export function worldToViewX(x: number): number {
  // `+ 0` normalizza -0 a 0 (es. worldToViewX(0)): -x da solo produrrebbe -0,
  // che Object.is (e quindi toBe) distingue da 0.
  return -x + 0;
}
