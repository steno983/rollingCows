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
 * ASIMMETRIA VOLUTA FRA I DUE ASSI. Le due direzioni non hanno lo stesso
 * costo: sbagliare un salto uccide la mucca, sbagliare un ramo fa solo
 * raccogliere meno fiocchi. Prima il pareggio (`absX >= absY`) andava
 * all'orizzontale, cioè all'azione MENO importante: un flick verso l'alto di
 * 30 px con 30 px di deriva laterale — il gesto normale di un pollice su un
 * telefono tenuto in una mano — diventava una scelta di ramo, il salto non
 * partiva e la mucca moriva. Ora l'orizzontale deve VINCERE nettamente
 * (`horizontalDominance`) e superare una soglia in pixel tutta sua
 * (`swipeMinPixelsHorizontal`, più alta): in ogni caso dubbio decide l'asse
 * verticale.
 *
 * IL TAP SALTA. Sotto la soglia di spostamento e sotto `tapMaxMs` il gesto è
 * un tocco secco, ed è il gesto più istintivo su un telefono: prima non era
 * mappato su nulla e il gioco restava muto. Sopra `tapMaxMs` resta un
 * appoggio del dito (o un trascinamento lento finito dov'era partito) e non
 * deve produrre niente.
 *
 * Lo swipe orizzontale sceglie un ramo (CHOOSE_LEFT/CHOOSE_RIGHT): fuori da
 * un bivio non ha alcun effetto immediato, ma resta comunque il gesto
 * corretto da restituire — è compito della logica di gioco (game/path.ts)
 * decidere se in quel momento esiste un bivio da scegliere, non di questo
 * modulo, che resta un puro traduttore di gesti.
 */
export function gestureToAction(dx: number, dy: number, dtMs: number): Action | null {
  if (dtMs > CONFIG.input.swipeMaxMs) {
    return null;
  }

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // Orizzontale solo se domina davvero E supera la propria soglia, più alta.
  if (
    absX > absY * CONFIG.input.horizontalDominance &&
    absX >= CONFIG.input.swipeMinPixelsHorizontal
  ) {
    return dx > 0 ? 'CHOOSE_RIGHT' : 'CHOOSE_LEFT';
  }

  // Tutto il resto è verticale: basta la componente Y, non la diagonale, così
  // un gesto obliquo corto non passa per somma di componenti.
  if (absY >= CONFIG.input.swipeMinPixels) {
    return dy < 0 ? 'JUMP' : 'SLIDE';
  }

  // Nessuno swipe: se il dito si è mosso poco ed è stato giù poco, è un tap.
  // Si misura sull'asse dominante, non sulla diagonale, per lo stesso motivo.
  if (Math.max(absX, absY) < CONFIG.input.swipeMinPixels && dtMs <= CONFIG.input.tapMaxMs) {
    return 'JUMP';
  }

  return null;
}
