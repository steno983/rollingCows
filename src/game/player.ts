import type { EventBus } from '../core/events';
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
  /**
   * Secondi di vita residui di un salto chiesto mentre si era già in aria.
   *
   * BUFFER D'AZIONE. Prima `jump()` usciva e basta se `player.airborne`, e
   * l'azione non veniva ritentata all'atterraggio: era persa per sempre. Il
   * buffer d'input di CONFIG.input.bufferSeconds non scadeva mai in pratica
   * perché veniva svuotato a ogni passo del loop (16,7 ms), quindi la
   * costante era di fatto morta. Il risultato è che il giocatore che
   * ANTICIPA la pressione — cioè quello che sta giocando bene — veniva
   * punito: a piena difficoltà il gap minimo lascia due decimi di secondo fra
   * atterraggio e ostacolo successivo. Misurato su 60 seed × 240 s con un
   * modello di giocatore umano con 80 ms di errore di timing: senza buffer
   * sopravvive 1 corsa su 60, con buffer 16 su 60.
   */
  bufferedJump: number;
  /** Come `bufferedJump`, per una scivolata chiesta mentre una scivolata è
   *  ancora in corso. Prima la richiesta ri-armava il timer all'istante, cioè
   *  tenere premuto valeva scivolata infinita; ora aspetta la fine di quella
   *  in corso, come farebbe la coda di comandi di qualunque runner. */
  bufferedSlide: number;
}

export function createPlayer(): PlayerState {
  return {
    y: 0,
    vy: 0,
    airborne: false,
    sliding: false,
    slideTimer: 0,
    jumpTimer: 0,
    // Un buffer non sopravvive a un inizio corsa: game.ts crea un giocatore
    // nuovo a ogni startRun, quindi azzerarli qui è anche l'azzeramento di
    // inizio corsa. Senza, la mucca partirebbe saltando per un tasto premuto
    // durante la schermata di morte.
    bufferedJump: 0,
    bufferedSlide: 0,
  };
}

/** Fa partire davvero il salto. Separata da `jump` perché è il punto in cui
 *  entra anche il salto bufferizzato, consumato all'atterraggio. */
function startJump(player: PlayerState, bus: EventBus): void {
  const wasSliding = player.sliding;
  player.airborne = true;
  player.vy = JUMP_SPEED;
  player.jumpTimer = 0;
  player.bufferedJump = 0;
  // Un salto interrompe sempre una scivolata a terra in corso (stessa scelta
  // della v1 per slam→jump): dà al giocatore una via d'uscita immediata.
  player.sliding = false;
  player.slideTimer = 0;
  // ...e con essa cade la scivolata che era in coda dietro di lei: era una
  // richiesta di prolungare QUELLA scivolata, non di scivolare all'atterraggio.
  player.bufferedSlide = 0;
  // 'player:slid' e 'player:slideEnded' si alternano sempre, così chi tiene un
  // rumore in loop non deve inseguire lo stato: se la scivolata era viva, la
  // sua fine va annunciata anche quando è un salto a chiuderla.
  if (wasSliding) bus.emit('player:slideEnded', {});
  bus.emit('player:jumped', {});
}

/** Fa partire davvero la scivolata a terra. Punto d'ingresso unico: ci passano
 *  la richiesta diretta, quella bufferizzata e la coda automatica del tuffo. */
function startSlide(player: PlayerState, bus: EventBus): void {
  player.sliding = true;
  player.slideTimer = CONFIG.player.slideSeconds;
  player.bufferedSlide = 0;
  bus.emit('player:slid', {});
}

/** A terra salta; in aria la richiesta non è più buttata via, ma resta armata
 *  per `CONFIG.input.bufferSeconds` e parte da sola all'atterraggio. */
export function jump(player: PlayerState, bus: EventBus): void {
  if (player.airborne) {
    player.bufferedJump = CONFIG.input.bufferSeconds;
    return;
  }
  startJump(player, bus);
}

/** A terra avvia la scivolata (o la mette in coda, se una è già in corso); in
 *  aria fa il tuffo rapido, che atterra prima del previsto e prosegue
 *  automaticamente in scivolata. */
export function slide(player: PlayerState, bus: EventBus): void {
  if (player.airborne) {
    // Il tuffo non tocca slideTimer: la scivolata "vera", a terra, parte da
    // sola all'atterraggio (vedi updatePlayer). `sliding` funge qui da
    // marcatore "sto tuffandomi", letto sotto per la gravità maggiorata, e
    // non è la scivolata che 'player:slid' annuncia — quella nasce
    // all'atterraggio, e annunciarla due volte romperebbe l'alternanza con
    // 'player:slideEnded'.
    player.sliding = true;
    return;
  }
  if (player.slideTimer > 0) {
    player.bufferedSlide = CONFIG.input.bufferSeconds;
    return;
  }
  startSlide(player, bus);
}

/** Decadimento dei buffer: è ciò che rende `CONFIG.input.bufferSeconds` un
 *  numero vivo. Prima il buffer d'input veniva svuotato a ogni passo del loop,
 *  quindi la finestra non scadeva mai e la costante non voleva dire nulla. */
function decayBuffers(player: PlayerState, dt: number): void {
  if (player.bufferedJump > 0) player.bufferedJump = Math.max(0, player.bufferedJump - dt);
  if (player.bufferedSlide > 0) player.bufferedSlide = Math.max(0, player.bufferedSlide - dt);
}

export function updatePlayer(player: PlayerState, dt: number, bus: EventBus): void {
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
      const airborneSeconds = player.jumpTimer;
      player.y = 0;
      player.vy = 0;
      player.airborne = false;
      player.jumpTimer = 0;
      player.sliding = false;
      bus.emit('player:landed', { airborneSeconds });
      if (wasDiving) {
        // Il tuffo che concatena salto e scivolata: è la manovra che permette
        // di superare ostacoli ravvicinati (vedi design doc, sezione Azioni).
        startSlide(player, bus);
      }
      // Il salto bufferizzato si consuma QUI, dopo che l'atterraggio ha
      // sistemato lo stato: è tutto il senso del buffer, e viene dopo la coda
      // del tuffo perché una pressione di salto è più recente della scivolata
      // che il tuffo mette in coda da solo (startJump la interrompe come
      // farebbe un salto chiesto a mano).
      if (player.bufferedJump > 0) startJump(player, bus);
    }
    decayBuffers(player, dt);
    return;
  }

  if (player.slideTimer > 0) {
    player.slideTimer = Math.max(0, player.slideTimer - dt);
    if (player.slideTimer === 0) {
      player.sliding = false;
      bus.emit('player:slideEnded', {});
      // La scivolata messa in coda parte adesso: la fine di quella precedente
      // resta comunque annunciata, così l'alternanza slid/slideEnded regge
      // anche per chi scivola senza mai staccare il dito.
      if (player.bufferedSlide > 0) startSlide(player, bus);
    }
  }

  decayBuffers(player, dt);
}
