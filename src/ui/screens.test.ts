// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreens } from './screens';

let root: HTMLElement;

function need(selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`Elemento mancante nelle schermate: ${selector}`);
  }
  return el;
}

function visible(name: string): boolean {
  return !need(`[data-screen="${name}"]`).classList.contains('screen--hidden');
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('createScreens', () => {
  it('mostra una sola schermata alla volta', () => {
    const screens = createScreens(root);

    screens.show('menu');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([true, false, false]);

    screens.show('paused');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, true, false]);

    screens.show('gameover');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, false, true]);
  });

  it('durante il gioco nasconde tutte le schermate', () => {
    const screens = createScreens(root);

    screens.show('menu');
    screens.show('playing');

    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, false, false]);
  });

  it('invoca onStart al click su PARTI', () => {
    const screens = createScreens(root);
    const onStart = vi.fn();
    screens.onStart(onStart);

    need('[data-action="start"]').click();

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('invoca onRestart al click su RIGIOCA e onResume su RIPRENDI', () => {
    const screens = createScreens(root);
    const onRestart = vi.fn();
    const onResume = vi.fn();
    screens.onRestart(onRestart);
    screens.onResume(onResume);

    need('[data-action="restart"]').click();
    need('[data-action="resume"]').click();

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('BUG: dopo il click su PARTI/RIGIOCA/RIPRENDI il focus non deve restare sul bottone (altrimenti la tastiera smette di arrivare al gioco)', () => {
    const screens = createScreens(root);
    screens.onStart(() => {});
    screens.onRestart(() => {});
    screens.onResume(() => {});

    const start = need('[data-action="start"]');
    start.focus();
    expect(document.activeElement).toBe(start);
    start.click();
    expect(document.activeElement).not.toBe(start);

    const restart = need('[data-action="restart"]');
    restart.focus();
    expect(document.activeElement).toBe(restart);
    restart.click();
    expect(document.activeElement).not.toBe(restart);

    const resume = need('[data-action="resume"]');
    resume.focus();
    expect(document.activeElement).toBe(resume);
    resume.click();
    expect(document.activeElement).not.toBe(resume);
  });

  it('invoca onMenu da entrambi i bottoni MENU', () => {
    const screens = createScreens(root);
    const onMenu = vi.fn();
    screens.onMenu(onMenu);

    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-action="menu"]');
    expect(buttons.length).toBe(2);
    buttons.forEach((button) => button.click());

    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it('notifica il toggle del mute alternando lo stato', () => {
    const screens = createScreens(root);
    const onToggleMute = vi.fn();
    screens.onToggleMute(onToggleMute);

    const button = need('[data-action="mute"]');
    button.click();
    button.click();

    expect(onToggleMute).toHaveBeenNthCalledWith(1, true);
    expect(onToggleMute).toHaveBeenNthCalledWith(2, false);
  });

  it('scrive record e punteggio finale (troncati per difetto)', () => {
    const screens = createScreens(root);

    screens.setMenuRecord(1234.6);
    expect(need('[data-menu-record]').textContent).toBe('1234');

    screens.setGameOver(880.2, 1235, false);
    expect(need('[data-final-points]').textContent).toBe('880');
    expect(need('[data-final-record]').textContent).toBe('1235');
  });

  it('mostra NUOVO RECORD solo quando isRecord è true', () => {
    const screens = createScreens(root);
    const banner = need('[data-new-record]');

    screens.setGameOver(100, 500, false);
    expect(banner.classList.contains('screen--hidden')).toBe(true);

    screens.setGameOver(900, 900, true);
    expect(banner.classList.contains('screen--hidden')).toBe(false);
    expect(banner.textContent).toBe('NUOVO RECORD!');
  });
});
