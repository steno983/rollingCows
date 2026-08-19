import { CONFIG } from '../game/config';
import type { Action } from '../game/types';

/**
 * Traduce lo spostamento di un puntatore in un'azione di gioco.
 *
 * ATTENZIONE AL SEGNO: `dx`/`dy` sono in COORDINATE SCHERMO, dove l'asse Y
 * cresce verso il BASSO. Quindi:
 *   - dy < 0  => il dito è andato verso l'ALTO  => JUMP
 *   - dy > 0  => il dito è andato verso il BASSO => SLIDE
 * È l'errore di segno più comune in questo tipo di codice: qui è esplicito e
 * bloccato da un test.
 *
 * Vince l'asse dominante: se |dx| >= |dy| il gesto è orizzontale, altrimenti
 * verticale. La distanza considerata è quella dell'asse dominante, non la
 * diagonale: un gesto obliquo corto non deve passare per somma di componenti.
 *
 * Lo swipe orizzontale sceglie un ramo (CHOOSE_LEFT/CHOOSE_RIGHT): fuori da
 * un bivio non ha alcun effetto immediato, ma resta comunque il gesto
 * corretto da restituire — è compito della logica di gioco (game/path.ts)
 * decidere se in quel momento esiste un bivio da scegliere, non di questo
 * modulo, che resta un puro traduttore di gesti.
 *
 * Restituisce null se il gesto è troppo corto (< swipeMinPixels) o troppo
 * lento (> swipeMaxMs): in quel caso è un tap o un trascinamento, non uno swipe.
 */
export function gestureToAction(dx: number, dy: number, dtMs: number): Action | null {
  if (dtMs > CONFIG.input.swipeMaxMs) {
    return null;
  }

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const dominant = Math.max(absX, absY);

  if (dominant < CONFIG.input.swipeMinPixels) {
    return null;
  }

  if (absX >= absY) {
    return dx > 0 ? 'CHOOSE_RIGHT' : 'CHOOSE_LEFT';
  }

  return dy < 0 ? 'JUMP' : 'SLIDE';
}
