// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameStateName } from '../core/state-machine';
import { createHud } from './hud';
import { createScreens } from './screens';

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
  it('scrive il punteggio troncato per difetto (Math.floor, mai un punto non ancora guadagnato)', () => {
    const hud = createHud(root);

    hud.setPoints(1234.7);
    expect(need('.hud__points').textContent).toBe('1234');

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

  it('setVisible nasconde e mostra il contenitore', () => {
    const hud = createHud(root);
    const container = need('.hud');

    hud.setVisible(false);
    expect(container.classList.contains('hud--hidden')).toBe(true);

    hud.setVisible(true);
    expect(container.classList.contains('hud--hidden')).toBe(false);
  });

  it('setBuffs accende solo il badge dello scudo quando è attivo', () => {
    const hud = createHud(root);

    hud.setBuffs(true, 0, 0);
    expect(need('[data-buff="shield"]').classList.contains('hud__buff--active')).toBe(true);
    expect(need('[data-buff="star"]').classList.contains('hud__buff--active')).toBe(false);
    expect(need('[data-buff="magnet"]').classList.contains('hud__buff--active')).toBe(false);

    hud.setBuffs(false, 0, 0);
    expect(need('[data-buff="shield"]').classList.contains('hud__buff--active')).toBe(false);
  });

  it('setBuffs mostra il tempo residuo della stella, arrotondato per eccesso', () => {
    const hud = createHud(root);

    hud.setBuffs(false, 5.4, 0);
    const star = need('[data-buff="star"]');
    expect(star.classList.contains('hud__buff--active')).toBe(true);
    expect(need('[data-buff="star"] .hud__buff-time').textContent).toBe('6s ');

    hud.setBuffs(false, 0, 0);
    expect(star.classList.contains('hud__buff--active')).toBe(false);
  });

  it('setBuffs mostra il tempo residuo della calamita', () => {
    const hud = createHud(root);

    hud.setBuffs(false, 0, 3.2);
    const magnet = need('[data-buff="magnet"]');
    expect(magnet.classList.contains('hud__buff--active')).toBe(true);
    expect(need('[data-buff="magnet"] .hud__buff-time').textContent).toBe('4s ');
  });

  it('un buff spento mostra solo il proprio nome, senza tempo né "s" spuria', () => {
    const hud = createHud(root);

    hud.setBuffs(false, 0, 0);
    expect(need('[data-buff="star"]').textContent).toBe('×2');
    expect(need('[data-buff="magnet"]').textContent).toBe('CALAMITA');

    hud.setBuffs(false, 5.4, 3.2);
    expect(need('[data-buff="star"]').textContent).toBe('6s ×2');
    expect(need('[data-buff="magnet"]').textContent).toBe('4s CALAMITA');
  });

  it('setFork evidenzia il ramo ricco e mostra il pannello solo quando c è un bivio', () => {
    const hud = createHud(root);
    const fork = need('.hud__fork');

    hud.setFork('left');
    expect(fork.classList.contains('hud__fork--visible')).toBe(true);
    expect(need('[data-side="left"]').classList.contains('hud__fork-side--rich')).toBe(true);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--rich')).toBe(false);

    hud.setFork('right');
    expect(need('[data-side="left"]').classList.contains('hud__fork-side--rich')).toBe(false);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--rich')).toBe(true);

    hud.setFork(null);
    expect(fork.classList.contains('hud__fork--visible')).toBe(false);
  });
});

describe('HUD e schermate: mutua esclusione', () => {
  /**
   * Riproduce l'accoppiamento fatto da main.ts (createHud + createScreens
   * sullo stesso #ui-root, hud.setVisible(name === 'playing') a ogni
   * screens.show(name)): prima della correzione l'HUD restava sempre visibile
   * (position: absolute, mai nascosto), quindi su menu/pausa/game over si
   * leggevano "0", la barra di carica e "TAGLIA 1" sopra il pannello.
   */
  function showScreen(
    hud: ReturnType<typeof createHud>,
    screens: ReturnType<typeof createScreens>,
    name: GameStateName,
  ): void {
    screens.show(name);
    hud.setVisible(name === 'playing');
  }

  function screenVisible(name: 'menu' | 'paused' | 'gameover'): boolean {
    const el = root.querySelector<HTMLElement>(`[data-screen="${name}"]`);
    if (el === null) throw new Error(`schermata mancante: ${name}`);
    return !el.classList.contains('screen--hidden');
  }

  it('per ogni stato, HUD e una schermata non sono mai entrambi visibili', () => {
    const hud = createHud(root);
    const screens = createScreens(root);
    const hudContainer = need('.hud');

    const states: GameStateName[] = ['menu', 'playing', 'paused', 'gameover', 'playing', 'boot'];
    for (const state of states) {
      showScreen(hud, screens, state);

      const hudVisible = !hudContainer.classList.contains('hud--hidden');
      const anyScreenVisible =
        screenVisible('menu') || screenVisible('paused') || screenVisible('gameover');

      expect(hudVisible).toBe(state === 'playing');
      expect(hudVisible && anyScreenVisible).toBe(false);
    }
  });
});
