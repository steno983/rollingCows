import { CONFIG } from './config';
import { clampLane, laneToX } from './lanes';
import type { Lane } from './types';

/** Durata della finestra di schiacciata a terra: quanto la mucca resta abbassata. */
export const SLAM_GROUND_SECONDS = 0.25;

/** Velocità iniziale e gravità del salto scriptato. Da y(t) = v0*t - g*t^2/2, per
 *  durare T = jumpSeconds e culminare a h = jumpHeight servono v0 = 4h/T e g = 8h/T^2. */
const JUMP_SPEED = (4 * CONFIG.player.jumpHeight) / CONFIG.player.jumpSeconds;
const JUMP_GRAVITY =
  (8 * CONFIG.player.jumpHeight) / (CONFIG.player.jumpSeconds * CONFIG.player.jumpSeconds);

/** Ease-out cubica: parte veloce e frena in arrivo. */
function easeOutCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

export interface PlayerState {
  lane: Lane;
  /** X interpolato durante il cambio corsia. */
  x: number;
  laneFromX: number;
  laneChangeT: number; // avanzamento in [0,1]
  y: number;
  vy: number;
  airborne: boolean;
  slamming: boolean;
  /** Secondi residui della schiacciata a terra. Estensione del contratto: senza
   *  questo campo non c'è dove misurare i 0,25 s richiesti da slam() a terra. */
  slamTimer: number;
}

export function createPlayer(): PlayerState {
  const x = laneToX(1);
  return {
    lane: 1,
    x,
    laneFromX: x,
    laneChangeT: 1,
    y: 0,
    vy: 0,
    airborne: false,
    slamming: false,
    slamTimer: 0,
  };
}

export function moveLane(player: PlayerState, direction: -1 | 1): void {
  const next = clampLane(player.lane + direction);
  if (next === player.lane) return;
  player.lane = next;
  // Si riparte dalla posizione corrente: un secondo cambio non fa scattare la mucca.
  player.laneFromX = player.x;
  player.laneChangeT = 0;
}

export function jump(player: PlayerState): void {
  if (player.airborne) return;
  player.airborne = true;
  player.vy = JUMP_SPEED;
  player.slamming = false;
  player.slamTimer = 0;
}

export function slam(player: PlayerState): void {
  player.slamming = true;
  // In aria lo slam dura finché non si tocca terra: nessun timer da armare.
  player.slamTimer = player.airborne ? 0 : SLAM_GROUND_SECONDS;
}

export function updatePlayer(player: PlayerState, dt: number): void {
  if (player.laneChangeT < 1) {
    player.laneChangeT = Math.min(1, player.laneChangeT + dt / CONFIG.player.laneChangeSeconds);
    const target = laneToX(player.lane);
    player.x = player.laneFromX + (target - player.laneFromX) * easeOutCubic(player.laneChangeT);
  }

  if (player.airborne) {
    const gravity = JUMP_GRAVITY * (player.slamming ? CONFIG.player.slamGravityMultiplier : 1);
    // Aggiornamento esatto per accelerazione costante: riproduce la parabola
    // analitica senza l'errore di integrazione dell'Eulero semplice.
    player.y += player.vy * dt - 0.5 * gravity * dt * dt;
    player.vy -= gravity * dt;
    // Soglia con epsilon: la somma in virgola mobile di ~33 passi lascia un
    // residuo dell'ordine di 1e-15 invece di uno zero esatto all'apice previsto,
    // che ritarderebbe l'atterraggio di un intero step senza questa tolleranza.
    if (player.y <= 1e-9) {
      player.y = 0;
      player.vy = 0;
      player.airborne = false;
      player.slamming = false;
      player.slamTimer = 0;
    }
    return;
  }

  if (player.slamTimer > 0) {
    player.slamTimer = Math.max(0, player.slamTimer - dt);
    if (player.slamTimer === 0) player.slamming = false;
  }
}
