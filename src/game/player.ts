import { CONFIG } from './config';

/** Velocità iniziale e gravità del salto scriptato. Da y(t) = v0*t - g*t^2/2, per
 *  durare T = jumpSeconds e culminare a h = jumpHeight servono v0 = 4h/T e g = 8h/T^2. */
const JUMP_SPEED = (4 * CONFIG.player.jumpHeight) / CONFIG.player.jumpSeconds;
const JUMP_GRAVITY =
  (8 * CONFIG.player.jumpHeight) / (CONFIG.player.jumpSeconds * CONFIG.player.jumpSeconds);

export interface PlayerState {
  y: number;
  vy: number;
  airborne: boolean;
  sliding: boolean;
  slideTimer: number;
  /** Secondi trascorsi dall'inizio del salto in corso, azzerato
   *  all'atterraggio. Non guida l'atterraggio (che resta legato a `y`, così un
   *  tuffo con gravità maggiorata atterra prima del previsto senza bisogno di
   *  ricalcolare una parabola diversa a metà volo): è per chi consuma lo stato
   *  dall'esterno (la vista, per l'inclinazione a mezz'aria) senza doverlo
   *  ricavare da vy. */
  jumpTimer: number;
}

export function createPlayer(): PlayerState {
  return {
    y: 0,
    vy: 0,
    airborne: false,
    sliding: false,
    slideTimer: 0,
    jumpTimer: 0,
  };
}

export function jump(player: PlayerState): void {
  if (player.airborne) return;
  player.airborne = true;
  player.vy = JUMP_SPEED;
  player.jumpTimer = 0;
  // Un salto interrompe sempre una scivolata a terra in corso (stessa scelta
  // della v1 per slam→jump): dà al giocatore una via d'uscita immediata.
  player.sliding = false;
  player.slideTimer = 0;
}

/** A terra avvia (o ri-avvia) la scivolata; in aria fa il tuffo rapido, che
 *  atterra prima del previsto e prosegue automaticamente in scivolata. */
export function slide(player: PlayerState): void {
  if (player.airborne) {
    // Il tuffo non tocca slideTimer: la scivolata "vera", a terra, parte da
    // sola all'atterraggio (vedi updatePlayer). `sliding` funge qui da
    // marcatore "sto tuffandomi", letto sotto per la gravità maggiorata.
    player.sliding = true;
    return;
  }
  player.sliding = true;
  player.slideTimer = CONFIG.player.slideSeconds;
}

export function updatePlayer(player: PlayerState, dt: number): void {
  if (player.airborne) {
    player.jumpTimer += dt;
    const gravity = JUMP_GRAVITY * (player.sliding ? CONFIG.player.diveGravityMultiplier : 1);
    // Aggiornamento esatto per accelerazione costante: riproduce la parabola
    // analitica senza l'errore di integrazione dell'Eulero semplice.
    player.y += player.vy * dt - 0.5 * gravity * dt * dt;
    player.vy -= gravity * dt;
    // Soglia con epsilon: la somma in virgola mobile di decine di passi lascia
    // un residuo dell'ordine di 1e-15 invece di uno zero esatto all'apice
    // previsto, che ritarderebbe l'atterraggio di un intero step senza questa
    // tolleranza.
    if (player.y <= 1e-9) {
      const wasDiving = player.sliding;
      player.y = 0;
      player.vy = 0;
      player.airborne = false;
      player.jumpTimer = 0;
      if (wasDiving) {
        // Il tuffo che concatena salto e scivolata: è la manovra che permette
        // di superare ostacoli ravvicinati (vedi design doc, sezione Azioni).
        player.sliding = true;
        player.slideTimer = CONFIG.player.slideSeconds;
      } else {
        player.sliding = false;
      }
    }
    return;
  }

  if (player.slideTimer > 0) {
    player.slideTimer = Math.max(0, player.slideTimer - dt);
    if (player.slideTimer === 0) player.sliding = false;
  }
}
