import type { EventBus } from '../core/events';
import { CONFIG } from './config';

export interface ScoreState {
  /**
   * Punteggio grezzo, tenuto in virgola mobile per non perdere le frazioni di
   * metro sommate a ogni frame. È la vista (HUD, schermata di game over) ad
   * arrotondare con Math.floor.
   */
  points: number;
  /** Metri percorsi nella run corrente. */
  distance: number;
  /** Ostacoli superati di fila senza subire colpi. Si azzera a qualunque
   *  impatto che non sia uno sfondamento. */
  streak: number;
  /** Gradino corrente della serie: indice in CONFIG.score.streakMultipliers.
   *  Tenuto a parte dal conteggio perché è ciò che cambia il moltiplicatore
   *  (e quindi ciò che vale la pena annunciare con 'streak:changed'): la
   *  serie sale di uno a ogni ostacolo, il gradino ogni streakStep. */
  streakTier: number;
  /** Sfondamenti concatenati durante la valanga, 0..smashChainMax. */
  smashChain: number;
  /** Secondi che restano per sfondare il prossimo e tenere viva la catena. */
  smashChainTimeLeft: number;
}

export function createScore(): ScoreState {
  return {
    points: 0,
    distance: 0,
    streak: 0,
    streakTier: 0,
    smashChain: 0,
    smashChainTimeLeft: 0,
  };
}

export function addDistance(score: ScoreState, meters: number, multiplier: number): void {
  score.distance += meters;
  score.points += meters * CONFIG.score.pointsPerUnit * multiplier;
}

export function addBonus(score: ScoreState, amount: number, multiplier: number): void {
  score.points += amount * multiplier;
}

/** Gradino corrispondente a una serie, saturato all'ultimo moltiplicatore. */
function tierFor(streak: number): number {
  const last = CONFIG.score.streakMultipliers.length - 1;
  return Math.min(last, Math.floor(streak / CONFIG.score.streakStep));
}

/**
 * Moltiplicatore della serie. Si combina (moltiplicandosi) con quello della
 * stella e con quello della valanga: schivare trenta ostacoli di fila valeva
 * esattamente quanto schivarne trenta con tre perdoni in mezzo, e l'unica cosa
 * che moltiplicava era la valanga — che da sola faceva fino all'80% dei punti
 * di una corsa.
 */
export function streakMultiplier(score: ScoreState): number {
  const value = CONFIG.score.streakMultipliers[score.streakTier];
  // Il ?? non è difensivismo: con noUncheckedIndexedAccess l'accesso a un
  // array è `number | undefined` e tierFor garantisce già l'indice valido.
  return value ?? 1;
}

/** Un ostacolo solido ha oltrepassato il giocatore senza toccarlo. */
export function registerPassedObstacle(score: ScoreState, bus: EventBus): void {
  score.streak += 1;
  const tier = tierFor(score.streak);
  if (tier === score.streakTier) return;
  score.streakTier = tier;
  bus.emit('streak:changed', { streak: score.streak, multiplier: streakMultiplier(score) });
}

/**
 * Il giocatore ha subito un colpo: la serie riparte da zero. Lo sfondamento NON
 * passa di qui — sfondare è il premio della valanga, non un errore.
 */
export function breakStreak(score: ScoreState, bus: EventBus): void {
  if (score.streak === 0) return;
  const hadTier = score.streakTier;
  score.streak = 0;
  score.streakTier = 0;
  if (hadTier === 0) return;
  bus.emit('streak:changed', { streak: 0, multiplier: streakMultiplier(score) });
}

/**
 * Registra uno sfondamento e restituisce il bonus in punti, catena compresa.
 * Durante l'invulnerabilità nessun input conta: sono secondi passivi in cui si
 * guarda soltanto. La catena è la cosa da GIOCARE in quei secondi — restare
 * addosso agli ostacoli invece di lasciarli arrivare.
 */
export function registerSmash(score: ScoreState): number {
  // La catena cresce solo se il precedente sfondamento è ancora "caldo":
  // altrimenti questo è il primo di una catena nuova, non il secondo della
  // vecchia.
  score.smashChain =
    score.smashChainTimeLeft > 0 ? Math.min(CONFIG.score.smashChainMax, score.smashChain + 1) : 0;
  score.smashChainTimeLeft = CONFIG.score.smashChainSeconds;
  return CONFIG.score.smashBonus + score.smashChain * CONFIG.score.smashChainStep;
}

/** Fa scadere la catena dopo smashChainSeconds senza sfondare nulla. */
export function updateSmashChain(score: ScoreState, dt: number): void {
  if (score.smashChainTimeLeft <= 0) return;
  score.smashChainTimeLeft = Math.max(0, score.smashChainTimeLeft - dt);
  if (score.smashChainTimeLeft === 0) score.smashChain = 0;
}
