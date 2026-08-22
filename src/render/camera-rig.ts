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
  return CONFIG.render.cameraBaseDistance + (clamped - 1) * CONFIG.render.cameraDistancePerSize;
}

/** Altezza della camera sopra il pendio per la taglia data. */
export function cameraHeightFor(size: number): number {
  return cameraDistanceFor(size) * CAMERA_HEIGHT_RATIO;
}

/**
 * Velocità del mondo normalizzata in [0,1] fra world.startSpeed e
 * world.maxSpeed. È il parametro con cui la vista reagisce a "quanto si sta
 * andando forte": FOV e micro-vibrazione escono entrambi da qui, così non
 * possono scollarsi l'uno dall'altra.
 *
 * Il riferimento è sempre il profilo normale (world.*) e non il profilo di
 * difficoltà in corso: su "Vitellino" (14 → 28 u/s) il rapporto si ferma a
 * ~0.45, ed è voluto — la vista deve dire quanto si va forte in assoluto, non
 * quanto ci si è avvicinati al proprio tetto personale.
 */
export function speedRatio(speed: number): number {
  const span = CONFIG.world.maxSpeed - CONFIG.world.startSpeed;
  if (span <= 0) return 0;
  const t = (speed - CONFIG.world.startSpeed) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * FOV OBIETTIVO dell'inquadratura: la transizione verso questo valore la fa
 * il rig (render/scene.ts) con la stessa costante di tempo di distanza e
 * altezza, quindi qui non c'è nessun avanzamento `t` da gestire.
 *
 * Due contributi che si SOMMANO, invece di sovrascriversi come faceva la
 * coppia cameraBaseFov/cameraAvalancheFov: la velocità apre l'obiettivo fra
 * cameraMinFov e cameraMaxFov, e la valanga ci aggiunge sopra
 * cameraAvalancheFovDelta. Prima la valanga imponeva un FOV assoluto, cioè
 * cancellava l'apertura da velocità proprio nel momento in cui si va più
 * forte di tutti.
 *
 * `avalancheScale` è il moltiplicatore della riduzione del movimento
 * (render.reducedMotion.fovDeltaScale): scala SOLO il contributo della
 * valanga, perché è la pompa di FOV a dare disagio vestibolare, non il
 * respiro lento legato alla velocità.
 */
export function cameraFovFor(speed: number, avalanche: boolean, avalancheScale = 1): number {
  const { cameraMinFov, cameraMaxFov, cameraAvalancheFovDelta } = CONFIG.render;
  const base = cameraMinFov + (cameraMaxFov - cameraMinFov) * speedRatio(speed);
  return avalanche ? base + cameraAvalancheFovDelta * avalancheScale : base;
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
