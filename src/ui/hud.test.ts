// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHud } from './hud';

let root: HTMLElement;

/** Recupera un elemento obbligatorio: fallisce forte se il markup cambia. */
function need(selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`Elemento mancante nel HUD: ${selector}`);
  }
  return el;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('createHud', () => {
  it('scrive il punteggio arrotondato all intero', () => {
    const hud = createHud(root);

    hud.setPoints(1234.7);
    expect(need('.hud__points').textContent).toBe('1235');

    hud.setPoints(0);
    expect(need('.hud__points').textContent).toBe('0');
  });

  it('riempie la barra di carica in proporzione al ratio', () => {
    const hud = createHud(root);

    hud.setCharge(0.5);
    expect(need('.hud__charge-fill').style.width).toBe('50%');

    hud.setCharge(0);
    expect(need('.hud__charge-fill').style.width).toBe('0%');
  });

  it('clampa il ratio della barra fuori da [0,1]', () => {
    const hud = createHud(root);

    hud.setCharge(1.8);
    expect(need('.hud__charge-fill').style.width).toBe('100%');

    hud.setCharge(-2);
    expect(need('.hud__charge-fill').style.width).toBe('0%');
  });

  it('mostra la taglia corrente', () => {
    const hud = createHud(root);

    hud.setSize(3);
    expect(need('.hud__size').textContent).toBe('TAGLIA 3');
  });

  it('aggiunge e rimuove le classi della fase valanga', () => {
    const hud = createHud(root);
    const container = need('.hud');

    hud.setAvalanche(true, false);
    expect(container.classList.contains('hud--avalanche')).toBe(true);
    expect(container.classList.contains('hud--warning')).toBe(false);

    hud.setAvalanche(true, true);
    expect(container.classList.contains('hud--avalanche')).toBe(true);
    expect(container.classList.contains('hud--warning')).toBe(true);

    hud.setAvalanche(false, false);
    expect(container.classList.contains('hud--avalanche')).toBe(false);
    expect(container.classList.contains('hud--warning')).toBe(false);
  });
});
