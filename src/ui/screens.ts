import type { GameStateName } from '../core/state-machine';
import { CONFIG } from '../game/config';

export interface Screens {
  show(name: GameStateName): void;
  setMenuRecord(record: number): void;
  setGameOver(points: number, record: number, isRecord: boolean): void;
  onStart(fn: () => void): void;
  onRestart(fn: () => void): void;
  onResume(fn: () => void): void;
  onMenu(fn: () => void): void;
  onToggleMute(fn: (muted: boolean) => void): void;
}

const HIDDEN = 'screen--hidden';

/** Stato del mute salvato dall'audio: il bottone deve nascere coerente. */
function readPersistedMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONFIG.audio.mutedKey) === '1';
  } catch {
    return false;
  }
}

/**
 * Menu, pausa e game over in HTML/CSS sopra al canvas.
 *
 * Solo le schermate visibili ricevono i tap (`pointer-events: auto` sul singolo
 * `.screen`, mentre il contenitore #ui-root resta `none`): quando si gioca sono
 * tutte `display: none`, quindi nulla può rubare gli swipe al canvas.
 */
export function createScreens(root: HTMLElement): Screens {
  const layer = document.createElement('div');
  layer.className = 'screens';
  layer.innerHTML = `
    <section class="screen ${HIDDEN}" data-screen="menu">
      <div class="panel">
        <h1 class="title">Rolling Cows</h1>
        <p class="subtitle">Rotola, cresci, travolgi tutto.</p>
        <p class="record">Record: <span data-menu-record>0</span></p>
        <button class="button button--primary" type="button" data-action="start">PARTI</button>
        <button class="button button--ghost" type="button" data-action="mute" aria-pressed="false">Audio: ON</button>
      </div>
    </section>
    <section class="screen ${HIDDEN}" data-screen="paused">
      <div class="panel">
        <h2 class="title title--small">Pausa</h2>
        <button class="button button--primary" type="button" data-action="resume">RIPRENDI</button>
        <button class="button button--ghost" type="button" data-action="menu">MENU</button>
      </div>
    </section>
    <section class="screen ${HIDDEN}" data-screen="gameover">
      <div class="panel">
        <h2 class="title title--small">Fine corsa</h2>
        <p class="record record--new ${HIDDEN}" data-new-record>NUOVO RECORD!</p>
        <p class="score">Punteggio: <span data-final-points>0</span></p>
        <p class="record">Record: <span data-final-record>0</span></p>
        <button class="button button--primary" type="button" data-action="restart">RIGIOCA</button>
        <button class="button button--ghost" type="button" data-action="menu">MENU</button>
      </div>
    </section>
  `;
  root.appendChild(layer);

  function need(selector: string): HTMLElement {
    const el = layer.querySelector<HTMLElement>(selector);
    if (el === null) {
      throw new Error(`Elemento mancante nelle schermate: ${selector}`);
    }
    return el;
  }

  const menuEl = need('[data-screen="menu"]');
  const pausedEl = need('[data-screen="paused"]');
  const gameoverEl = need('[data-screen="gameover"]');
  const menuRecordEl = need('[data-menu-record]');
  const finalPointsEl = need('[data-final-points]');
  const finalRecordEl = need('[data-final-record]');
  const newRecordEl = need('[data-new-record]');
  const muteButton = need('[data-action="mute"]');

  const noop = (): void => {};
  let startFn: () => void = noop;
  let restartFn: () => void = noop;
  let resumeFn: () => void = noop;
  let menuFn: () => void = noop;
  let muteFn: (muted: boolean) => void = () => {};

  let muted = readPersistedMuted();

  function bind(action: string, handler: () => void): void {
    layer.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`).forEach((button) => {
      button.addEventListener('click', handler);
    });
  }

  function renderMuteButton(): void {
    muteButton.textContent = muted ? 'Audio: OFF' : 'Audio: ON';
    muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  bind('start', () => startFn());
  bind('restart', () => restartFn());
  bind('resume', () => resumeFn());
  bind('menu', () => menuFn());
  bind('mute', () => {
    muted = !muted;
    renderMuteButton();
    muteFn(muted);
  });

  renderMuteButton();

  return {
    show(name: GameStateName): void {
      menuEl.classList.toggle(HIDDEN, name !== 'menu');
      pausedEl.classList.toggle(HIDDEN, name !== 'paused');
      gameoverEl.classList.toggle(HIDDEN, name !== 'gameover');
    },

    setMenuRecord(record: number): void {
      // Math.floor come in game/score.ts e ui/hud.ts: mai un punto mostrato che
      // non sia stato davvero guadagnato.
      menuRecordEl.textContent = String(Math.floor(record));
    },

    setGameOver(points: number, record: number, isRecord: boolean): void {
      finalPointsEl.textContent = String(Math.floor(points));
      finalRecordEl.textContent = String(Math.floor(record));
      newRecordEl.classList.toggle(HIDDEN, !isRecord);
    },

    onStart(fn: () => void): void {
      startFn = fn;
    },

    onRestart(fn: () => void): void {
      restartFn = fn;
    },

    onResume(fn: () => void): void {
      resumeFn = fn;
    },

    onMenu(fn: () => void): void {
      menuFn = fn;
    },

    onToggleMute(fn: (muted: boolean) => void): void {
      muteFn = fn;
    },
  };
}
