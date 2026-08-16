import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { gestureToAction } from './gesture';

const LONG = CONFIG.input.swipeMinPixels * 3;
const FAST = CONFIG.input.swipeMaxMs / 2;

describe('gestureToAction', () => {
  it('riconosce uno swipe netto verso destra come MOVE_RIGHT', () => {
    expect(gestureToAction(LONG, 0, FAST)).toBe('MOVE_RIGHT');
  });

  it('riconosce uno swipe netto verso sinistra come MOVE_LEFT', () => {
    expect(gestureToAction(-LONG, 0, FAST)).toBe('MOVE_LEFT');
  });

  it('riconosce lo swipe verso l alto come JUMP (dy negativo in coordinate schermo)', () => {
    expect(gestureToAction(0, -LONG, FAST)).toBe('JUMP');
  });

  it('riconosce lo swipe verso il basso come SLAM (dy positivo in coordinate schermo)', () => {
    expect(gestureToAction(0, LONG, FAST)).toBe('SLAM');
  });

  it('ignora uno spostamento sotto la soglia minima in pixel', () => {
    const short = CONFIG.input.swipeMinPixels - 1;
    expect(gestureToAction(short, short, FAST)).toBeNull();
  });

  it('ignora un gesto troppo lento', () => {
    expect(gestureToAction(LONG, 0, CONFIG.input.swipeMaxMs + 1)).toBeNull();
  });

  it('sceglie l asse dominante in un gesto diagonale', () => {
    expect(gestureToAction(LONG, -LONG / 2, FAST)).toBe('MOVE_RIGHT');
    expect(gestureToAction(-LONG / 2, LONG, FAST)).toBe('SLAM');
  });

  it('accetta un gesto esattamente alla soglia di distanza e di durata', () => {
    expect(gestureToAction(CONFIG.input.swipeMinPixels, 0, CONFIG.input.swipeMaxMs)).toBe('MOVE_RIGHT');
  });
});
