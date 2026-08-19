// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createInput } from './input';

/** Orologio controllato dal test: niente timer reali, niente flakiness. */
let now = 0;
const nowMs = (): number => now;

let target: HTMLElement;

beforeEach(() => {
  now = 0;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
});

function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/**
 * jsdom non implementa il costruttore PointerEvent: dispatchiamo un MouseEvent
 * con il tipo 'pointerdown'/'pointerup'. I listener registrati su quei tipi
 * scattano lo stesso e clientX/clientY sono supportati.
 */
function pointer(type: 'pointerdown' | 'pointerup', x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

describe('createInput', () => {
  it('traduce ArrowLeft in CHOOSE_LEFT e consuma il buffer una sola volta', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    expect(input.consume()).toBe('CHOOSE_LEFT');
    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('mappa i tasti di gioco sulle azioni astratte', () => {
    const input = createInput(target, nowMs);

    pressKey('ArrowRight');
    expect(input.consume()).toBe('CHOOSE_RIGHT');
    pressKey('d');
    expect(input.consume()).toBe('CHOOSE_RIGHT');
    pressKey(' ');
    expect(input.consume()).toBe('JUMP');
    pressKey('ArrowDown');
    expect(input.consume()).toBe('SLIDE');
    pressKey('Escape');
    expect(input.consume()).toBe('PAUSE');

    input.dispose();
  });

  it('scarta un azione più vecchia di bufferSeconds', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    now = CONFIG.input.bufferSeconds * 1000 + 1;

    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('mantiene un azione ancora dentro la finestra di buffer', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    now = CONFIG.input.bufferSeconds * 1000 - 1;

    expect(input.consume()).toBe('CHOOSE_LEFT');

    input.dispose();
  });

  it('un nuovo input sostituisce quello in buffer', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');
    pressKey('ArrowRight');

    expect(input.consume()).toBe('CHOOSE_RIGHT');
    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('riconosce uno swipe da puntatore sul target', () => {
    const input = createInput(target, nowMs);

    pointer('pointerdown', 200, 200);
    now = 80;
    pointer('pointerup', 200 + CONFIG.input.swipeMinPixels * 3, 205);

    expect(input.consume()).toBe('CHOOSE_RIGHT');

    input.dispose();
  });

  it('lascia Spazio al bottone a fuoco (resta attivabile da tastiera) senza generare JUMP', () => {
    const input = createInput(target, nowMs);
    const button = document.createElement('button');
    document.body.appendChild(button);

    const event = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: button });
    window.dispatchEvent(event);

    // Niente preventDefault: è quello che permette al browser di attivare il
    // bottone via tastiera (il click di default su keyup di Spazio/Invio).
    expect(event.defaultPrevented).toBe(false);
    expect(input.consume()).toBeNull();

    button.remove();
    input.dispose();
  });

  it('Spazio senza focus su un bottone produce comunque JUMP', () => {
    const input = createInput(target, nowMs);
    pressKey(' ');

    expect(input.consume()).toBe('JUMP');

    input.dispose();
  });

  it('BUG: le frecce e Esc devono raggiungere il gioco anche se il focus è rimasto su un bottone dopo un click (PARTI/RIGIOCA)', () => {
    const input = createInput(target, nowMs);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    function pressOnButton(key: string): void {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: button });
      window.dispatchEvent(event);
    }

    pressOnButton('ArrowLeft');
    expect(input.consume()).toBe('CHOOSE_LEFT');

    pressOnButton('ArrowUp');
    expect(input.consume()).toBe('JUMP');

    pressOnButton('Escape');
    expect(input.consume()).toBe('PAUSE');

    button.remove();
    input.dispose();
  });

  it('non genera azioni di gioco quando il focus è su un campo di testo (input/textarea/select restano digitabili)', () => {
    const input = createInput(target, nowMs);
    const textInput = document.createElement('input');
    textInput.type = 'text';
    document.body.appendChild(textInput);

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: textInput });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(input.consume()).toBeNull();

    textInput.remove();
    input.dispose();
  });

  it('dopo dispose nessun evento produce più azioni', () => {
    const input = createInput(target, nowMs);
    input.dispose();

    pressKey('ArrowLeft');
    pointer('pointerdown', 10, 10);
    now = 50;
    pointer('pointerup', 10 + CONFIG.input.swipeMinPixels * 3, 10);

    expect(input.consume()).toBeNull();
  });
});
