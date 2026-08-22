import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { gestureToAction } from './gesture';

const LONG = CONFIG.input.swipeMinPixelsHorizontal * 3;
const FAST = CONFIG.input.swipeMaxMs / 2;
/** Durata di un tocco secco: deve stare sotto tapMaxMs, non sotto swipeMaxMs. */
const TAP_MS = CONFIG.input.tapMaxMs / 2;

describe('gestureToAction', () => {
  it('riconosce uno swipe netto verso destra come CHOOSE_RIGHT', () => {
    expect(gestureToAction(LONG, 0, FAST)).toBe('CHOOSE_RIGHT');
  });

  it('riconosce uno swipe netto verso sinistra come CHOOSE_LEFT', () => {
    expect(gestureToAction(-LONG, 0, FAST)).toBe('CHOOSE_LEFT');
  });

  it('riconosce lo swipe verso l alto come JUMP (dy negativo in coordinate schermo)', () => {
    expect(gestureToAction(0, -LONG, FAST)).toBe('JUMP');
  });

  it('riconosce lo swipe verso il basso come SLIDE (dy positivo in coordinate schermo)', () => {
    expect(gestureToAction(0, LONG, FAST)).toBe('SLIDE');
  });

  it('ignora un gesto lungo ma troppo lento', () => {
    expect(gestureToAction(LONG, 0, CONFIG.input.swipeMaxMs + 1)).toBeNull();
  });

  it('accetta un gesto esattamente alla soglia di distanza e di durata', () => {
    expect(gestureToAction(CONFIG.input.swipeMinPixelsHorizontal, 0, CONFIG.input.swipeMaxMs)).toBe(
      'CHOOSE_RIGHT',
    );
    expect(gestureToAction(0, -CONFIG.input.swipeMinPixels, CONFIG.input.swipeMaxMs)).toBe('JUMP');
  });

  it('accetta uno swipe lento ma deliberato, che con il vecchio limite di 400 ms si perdeva', () => {
    expect(gestureToAction(0, -LONG, 500)).toBe('JUMP');
  });

  describe('il tap salta', () => {
    it('un tocco secco senza spostamento produce JUMP', () => {
      expect(gestureToAction(0, 0, TAP_MS)).toBe('JUMP');
    });

    it('tollera il micro-tremolio del dito sotto la soglia di swipe', () => {
      const jitter = CONFIG.input.swipeMinPixels - 1;
      expect(gestureToAction(jitter, jitter, TAP_MS)).toBe('JUMP');
      expect(gestureToAction(-jitter, jitter, TAP_MS)).toBe('JUMP');
    });

    it('un dito appoggiato a lungo e sollevato sul posto non è un tap', () => {
      expect(gestureToAction(0, 0, CONFIG.input.tapMaxMs + 1)).toBeNull();
    });
  });

  describe('i gesti diagonali non devono mai rubare il salto', () => {
    /**
     * Il caso che uccideva: pollice di una mano sola, flick verso l'alto con
     * pari deriva laterale. Prima il pareggio andava all'orizzontale e usciva
     * una scelta di ramo al posto del salto.
     */
    it('30 px in alto con 30 px di deriva laterale è un JUMP, non una scelta di ramo', () => {
      expect(gestureToAction(30, -30, FAST)).toBe('JUMP');
      expect(gestureToAction(-30, -30, FAST)).toBe('JUMP');
    });

    it('stessa protezione verso il basso: resta SLIDE', () => {
      expect(gestureToAction(30, 30, FAST)).toBe('SLIDE');
      expect(gestureToAction(-30, 30, FAST)).toBe('SLIDE');
    });

    it('serve un margine netto perché il gesto conti come orizzontale', () => {
      const y = 30;
      // Appena SOTTO il rapporto richiesto: vince ancora il verticale.
      const notEnough = y * CONFIG.input.horizontalDominance - 1;
      expect(gestureToAction(notEnough, -y, FAST)).toBe('JUMP');
      // Appena SOPRA: ora è una scelta di ramo.
      const enough = y * CONFIG.input.horizontalDominance + 1;
      expect(gestureToAction(enough, -y, FAST)).toBe('CHOOSE_RIGHT');
    });

    it('un gesto laterale dominante ma corto non sceglie un ramo', () => {
      const shortX = CONFIG.input.swipeMinPixelsHorizontal - 1;
      expect(gestureToAction(shortX, 0, FAST)).toBeNull();
    });
  });
});
