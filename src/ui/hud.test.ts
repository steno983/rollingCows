// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameStateName } from '../core/state-machine';
import { CONFIG } from '../game/config';
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

  it('setFork mostra e nasconde il pannello del bivio', () => {
    const hud = createHud(root);
    const fork = need('.hud__fork');

    hud.setFork(true);
    expect(fork.classList.contains('hud__fork--visible')).toBe(true);

    hud.setFork(false);
    expect(fork.classList.contains('hud__fork--visible')).toBe(false);
  });

  it('il pannello del bivio non evidenzia più il ramo ricco (quello lo dice già il pendio)', () => {
    const hud = createHud(root);

    hud.setFork(true);

    // Nessuna delle due frecce nasce accesa: l'informazione che il mondo sa
    // già dare non va ripetuta, quella che non sa dare arriva da
    // setForkDefault/setForkChoice.
    for (const side of ['left', 'right']) {
      const el = need(`[data-side="${side}"]`);
      expect(el.classList.contains('hud__fork-side--chosen')).toBe(false);
      expect(el.classList.contains('hud__fork-side--default')).toBe(false);
    }
  });

  it('setForkChoice illumina solo il lato scelto', () => {
    const hud = createHud(root);

    hud.setFork(true);
    hud.setForkChoice('left');
    expect(need('[data-side="left"]').classList.contains('hud__fork-side--chosen')).toBe(true);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--chosen')).toBe(false);

    hud.setForkChoice('right');
    expect(need('[data-side="left"]').classList.contains('hud__fork-side--chosen')).toBe(false);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--chosen')).toBe(true);

    hud.setForkChoice(null);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--chosen')).toBe(false);
  });

  it('setForkDefault lampeggia sul ramo che si ottiene restando fermi, e si spegne da solo', () => {
    vi.useFakeTimers();
    const hud = createHud(root);

    hud.setFork(true);
    hud.setForkDefault('right');
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--default')).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--default')).toBe(false);

    vi.useRealTimers();
  });

  it('nascondere il bivio azzera scelta e lato di default', () => {
    vi.useFakeTimers();
    const hud = createHud(root);

    hud.setFork(true);
    hud.setForkChoice('left');
    hud.setForkDefault('left');
    hud.setFork(false);

    const left = need('[data-side="left"]');
    expect(left.classList.contains('hud__fork-side--chosen')).toBe(false);
    expect(left.classList.contains('hud__fork-side--default')).toBe(false);

    // Il timer pendente non deve riaccendere nulla dopo la chiusura.
    vi.advanceTimersByTime(1000);
    expect(left.classList.contains('hud__fork-side--default')).toBe(false);

    vi.useRealTimers();
  });

  it('setMultiplier mostra il moltiplicatore TOTALE e lo accende solo sopra ×1', () => {
    const hud = createHud(root);
    const el = need('.hud__multiplier');

    hud.setMultiplier(1);
    expect(el.textContent).toBe('×1');
    expect(el.classList.contains('hud__multiplier--boosted')).toBe(false);

    hud.setMultiplier(8);
    expect(el.textContent).toBe('×8');
    expect(el.classList.contains('hud__multiplier--boosted')).toBe(true);
  });

  it('setMultiplier tiene i gradini frazionari della serie leggibili', () => {
    const hud = createHud(root);
    const el = need('.hud__multiplier');

    hud.setMultiplier(1.25);
    expect(el.textContent).toBe('×1.25');

    hud.setMultiplier(1.5);
    expect(el.textContent).toBe('×1.5');

    // Prodotto di numeri in virgola mobile: mai "×2.5000000000000004".
    hud.setMultiplier(1.25 * 2);
    expect(el.textContent).toBe('×2.5');
  });

  it('setDistance mostra i metri troncati e non scende mai sotto zero', () => {
    const hud = createHud(root);

    hud.setDistance(340.9);
    expect(need('.hud__distance-value').textContent).toBe('340');

    hud.setDistance(-5);
    expect(need('.hud__distance-value').textContent).toBe('0');
  });

  it('setStreak mostra la serie solo da 1 in su', () => {
    const hud = createHud(root);
    const streak = need('.hud__streak');

    hud.setStreak(0);
    expect(streak.classList.contains('hud__streak--visible')).toBe(false);

    hud.setStreak(2);
    expect(streak.classList.contains('hud__streak--visible')).toBe(true);
    expect(need('.hud__streak-value').textContent).toBe('SERIE 2');
  });

  it('il record superato in corsa si annuncia e lascia il punteggio marcato', () => {
    vi.useFakeTimers();
    const hud = createHud(root);
    const banner = need('[data-record-beaten]');
    const points = need('.hud__points');

    hud.showRecordBeaten();
    expect(banner.classList.contains('hud__record--visible')).toBe(true);
    expect(points.classList.contains('hud__points--record')).toBe(true);

    // L'avviso passa, il marcatore sul numero resta per tutta la corsa.
    vi.advanceTimersByTime(5000);
    expect(banner.classList.contains('hud__record--visible')).toBe(false);
    expect(points.classList.contains('hud__points--record')).toBe(true);

    hud.clearRecordBeaten();
    expect(points.classList.contains('hud__points--record')).toBe(false);

    vi.useRealTimers();
  });

  it('setBuffExpiring fa lampeggiare il badge e il lampeggio muore col buff', () => {
    const hud = createHud(root);
    const star = need('[data-buff="star"]');

    hud.setBuffs(false, 1.5, 0);
    hud.setBuffExpiring('star');
    expect(star.classList.contains('hud__buff--expiring')).toBe(true);

    // Scaduto il buff, il badge si spegne e con lui l'avviso: chi chiama non
    // deve ricordarsi di annullarlo.
    hud.setBuffs(false, 0, 0);
    expect(star.classList.contains('hud__buff--expiring')).toBe(false);
  });

  it('setAvalancheFx accende e spegne la vignetta', () => {
    const hud = createHud(root);
    const vignette = need('.hud__vignette');

    hud.setAvalancheFx(true);
    expect(vignette.classList.contains('hud__vignette--on')).toBe(true);

    hud.setAvalancheFx(false);
    expect(vignette.classList.contains('hud__vignette--on')).toBe(false);
  });

  it('la vignetta prende opacità e periodo dalla configurazione della valanga', () => {
    createHud(root);
    const vignette = need('.hud__vignette');

    expect(vignette.style.getPropertyValue('--vignette-opacity')).toBe(
      String(CONFIG.render.avalancheFx.vignetteOpacity),
    );
    expect(vignette.style.getPropertyValue('--vignette-period')).toBe(
      `${1 / CONFIG.render.avalancheFx.vignettePulseHz}s`,
    );
  });

  describe('bottone di pausa', () => {
    /**
     * Su telefono la pausa non esisteva: PAUSE stava solo su Esc/P e nessun
     * gesto la produceva, quindi dalla schermata di pausa si poteva soltanto
     * USCIRE da una pausa in cui non si poteva entrare.
     */
    it('esiste nell HUD e invoca onPause al tap', () => {
      const hud = createHud(root);
      const onPause = vi.fn();
      hud.onPause(onPause);

      need('.hud__pause').click();

      expect(onPause).toHaveBeenCalledTimes(1);
    });

    it('è l unico elemento interattivo dell HUD, per non rubare gli swipe al canvas', () => {
      createHud(root);

      // Tutto il resto dell'HUD resta inerte: #ui-root è pointer-events:none
      // e solo .hud__pause lo riattiva su di sé (vedi style.css). Se qui
      // comparisse un secondo bersaglio cliccabile, sopra al canvas ci sarebbe
      // di nuovo qualcosa capace di intercettare uno swipe.
      const interactive = need('.hud').querySelectorAll('button, a, input, select, textarea');
      expect(interactive.length).toBe(1);

      const pause = need('.hud__pause');
      expect(interactive[0]).toBe(pause);
      expect(pause.getAttribute('aria-label')).toBe('Pausa');
    });

    it('non trattiene il focus dopo il click (altrimenti la tastiera smette di arrivare al gioco)', () => {
      const hud = createHud(root);
      hud.onPause(() => {});

      const pause = need('.hud__pause');
      pause.focus();
      expect(document.activeElement).toBe(pause);
      pause.click();
      expect(document.activeElement).not.toBe(pause);
    });
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
