import type { StateMachine } from '../core/state-machine';

/**
 * Logica pura di orchestrazione fra la macchina a stati e il rallentatore alla
 * morte (niente three, niente DOM: testabile in node). Isolata da main.ts
 * perché è lì che vivevano tre dei cinque difetti trovati in review — main.ts
 * non è coperto da alcun test, questo modulo lo è.
 *
 * Il bug che ha reso necessario questo modulo: il giocatore muore, parte il
 * rallentatore (dyingSeconds). Se entro quella finestra la finestra perde il
 * focus (notifica, alt-tab), blur/visibilitychange mettevano la macchina in
 * 'paused'. Allo scadere del rallentatore si tentava paused → gameover, che la
 * vecchia tabella vietava: la transizione falliva ma pendingGameOver veniva
 * comunque azzerato PRIMA del controllo, quindi il payload spariva nel nulla.
 * Risultato: si tornava a 'playing' con game.alive già false, un softlock
 * silenzioso indistinguibile da un crash.
 *
 * La correzione è in due parti, entrambe necessarie:
 *  - le richieste di pausa non generate dal giocatore vengono ignorate mentre
 *    si è in dying (vedi requestExternalPause);
 *  - pendingGameOver si azzera SOLO quando la transizione riesce davvero (vedi
 *    commitGameOver), e paused → gameover è ora una transizione legittima
 *    nella tabella (vedi core/state-machine.ts).
 */

export interface GameOverPayload {
  points: number;
  distance: number;
  isRecord: boolean;
}

export interface FlowState {
  /** Secondi rimanenti di rallentatore. > 0 mentre si è "in morte". */
  dyingSeconds: number;
  /** Payload del game over in attesa di essere mostrato. */
  pendingGameOver: GameOverPayload | null;
}

export function createFlow(): FlowState {
  return { dyingSeconds: 0, pendingGameOver: null };
}

/** Da chiamare all'inizio di ogni run: azzera un eventuale rallentatore residuo. */
export function resetFlow(flow: FlowState): void {
  flow.dyingSeconds = 0;
  flow.pendingGameOver = null;
}

export function isDying(flow: FlowState): boolean {
  return flow.dyingSeconds > 0;
}

/** Arma il rallentatore quando arriva run:ended dal gioco. */
export function armDeath(flow: FlowState, payload: GameOverPayload, deathSlowSeconds: number): void {
  flow.pendingGameOver = payload;
  flow.dyingSeconds = deathSlowSeconds;
}

/** Fa avanzare il rallentatore di dt. Restituisce true nel frame in cui scade. */
export function tickDeath(flow: FlowState, dt: number): boolean {
  if (flow.dyingSeconds <= 0) return false;
  flow.dyingSeconds -= dt;
  return flow.dyingSeconds <= 0;
}

/**
 * Tenta di completare la transizione a game over usando il payload in sospeso.
 * Lo azzera SOLO se la transizione riesce: se fallisse (stato inatteso), il
 * payload resta lì per un tentativo successivo invece di sparire nel nulla.
 */
export function commitGameOver(machine: StateMachine, flow: FlowState): GameOverPayload | null {
  const payload = flow.pendingGameOver;
  if (payload === null) return null;
  if (!machine.transition('gameover')) return null;
  flow.pendingGameOver = null;
  return payload;
}

/**
 * Richiesta di pausa da un evento NON generato da un tocco/click/tasto del
 * giocatore (blur della finestra, tab nascosta). Va ignorata durante il
 * rallentatore della morte: altrimenti la macchina finirebbe in 'paused'
 * proprio mentre sta per arrivare il game over.
 */
export function requestExternalPause(machine: StateMachine, flow: FlowState): boolean {
  if (isDying(flow)) return false;
  if (machine.current !== 'playing') return false;
  return machine.transition('paused');
}
