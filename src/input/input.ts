import { CONFIG } from '../game/config';
import type { Action } from '../game/types';
import { gestureToAction } from './gesture';

export interface InputSource {
  /** Consuma e restituisce l'azione in buffer, se presente e non scaduta. */
  consume(): Action | null;
  dispose(): void;
}

/**
 * Tastiera desktop: frecce + WASD (sinistra/destra scelgono un ramo, solo utile a un bivio), spazio per saltare, Esc (o P) per la pausa.
 * Le chiavi sono i valori di KeyboardEvent.key.
 */
const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'CHOOSE_LEFT',
  a: 'CHOOSE_LEFT',
  A: 'CHOOSE_LEFT',
  ArrowRight: 'CHOOSE_RIGHT',
  d: 'CHOOSE_RIGHT',
  D: 'CHOOSE_RIGHT',
  ArrowUp: 'JUMP',
  w: 'JUMP',
  W: 'JUMP',
  ' ': 'JUMP',
  Spacebar: 'JUMP',
  ArrowDown: 'SLIDE',
  s: 'SLIDE',
  S: 'SLIDE',
  Escape: 'PAUSE',
  Esc: 'PAUSE',
  p: 'PAUSE',
  P: 'PAUSE',
};

/** Tag su cui il browser lascia digitare l'utente: qui la tastiera è del
 *  campo, non del gioco (niente scelte di bivio mentre si scrive un nome). */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextEditingTarget(target: HTMLElement): boolean {
  return target.isContentEditable || TEXT_INPUT_TAGS.has(target.tagName);
}

/** Tag su cui Spazio/Invio attivano il default del browser (i bottoni delle
 *  schermate: PARTI, RIGIOCA, MENU, RIPRENDI, Audio, ed eventuali link). */
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A']);

function isActivationKey(key: string): boolean {
  return key === ' ' || key === 'Spacebar' || key === 'Enter';
}

/**
 * Sorgente di input unificata: swipe (touch), trascinamento (mouse/penna) e
 * tastiera producono le stesse azioni astratte. Il resto del gioco non sa da
 * dove arriva l'azione.
 *
 * Il buffer contiene UNA sola azione: l'ultima ricevuta. Serve a non perdere un
 * comando dato un istante prima che sia eseguibile (swipe appena prima
 * dell'atterraggio). Scade dopo CONFIG.input.bufferSeconds per non eseguire
 * comandi ormai vecchi.
 *
 * `nowMs` è iniettabile: i test controllano il tempo senza timer reali.
 */
export function createInput(target: HTMLElement, nowMs: () => number = () => performance.now()): InputSource {
  const view: Window = target.ownerDocument.defaultView ?? window;

  let buffered: Action | null = null;
  let bufferedAt = 0;

  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;

  function push(action: Action): void {
    buffered = action;
    bufferedAt = nowMs();
  }

  function begin(x: number, y: number): void {
    startX = x;
    startY = y;
    startedAt = nowMs();
    tracking = true;
  }

  function end(x: number, y: number): void {
    if (!tracking) {
      return;
    }
    tracking = false;
    const action = gestureToAction(x - startX, y - startY, nowMs() - startedAt);
    if (action !== null) {
      push(action);
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement) {
      // Un campo di testo (input, textarea, select, contenteditable) tiene la
      // tastiera per sé: qui non va intercettato nulla.
      if (isTextEditingTarget(target)) {
        return;
      }
      // Dopo un click su PARTI/RIGIOCA/RIPRENDI il focus del browser resta sul
      // bottone: se qui scartassimo OGNI tasto (come faceva la versione
      // precedente) il gioco diventerebbe ingiocabile da tastiera subito dopo
      // il primo click. Le frecce e gli altri comandi devono arrivare
      // comunque; solo Spazio/Invio restano riservati, per lasciare che il
      // browser attivi il bottone via tastiera (attivazione di default sul
      // keyup, che scatta SOLO se non viene prevenuto qui).
      if (ACTIVATABLE_TAGS.has(target.tagName) && isActivationKey(event.key)) {
        return;
      }
    }
    const action = KEY_ACTIONS[event.key];
    if (action === undefined) {
      return;
    }
    // Evita lo scroll della pagina con spazio e frecce.
    event.preventDefault();
    push(action);
  };

  const onTouchStart = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (touch === undefined) {
      return;
    }
    // preventDefault su touchstart/touchmove: niente scroll, niente
    // pull-to-refresh, niente zoom a doppio tap durante il gioco.
    event.preventDefault();
    begin(touch.clientX, touch.clientY);
  };

  const onTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
  };

  const onTouchEnd = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (touch === undefined) {
      return;
    }
    event.preventDefault();
    end(touch.clientX, touch.clientY);
  };

  const onTouchCancel = (): void => {
    tracking = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Su mobile i pointer event arrivano DUPLICATI insieme ai touch event:
    // ignoriamo qui il touch, che è già gestito sopra.
    if (event.pointerType === 'touch') {
      return;
    }
    begin(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      return;
    }
    end(event.clientX, event.clientY);
  };

  const onPointerCancel = (): void => {
    tracking = false;
  };

  const active = { passive: false } as const;

  target.addEventListener('touchstart', onTouchStart, active);
  target.addEventListener('touchmove', onTouchMove, active);
  target.addEventListener('touchend', onTouchEnd, active);
  target.addEventListener('touchcancel', onTouchCancel);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);
  view.addEventListener('keydown', onKeyDown);

  return {
    consume(): Action | null {
      if (buffered === null) {
        return null;
      }
      if (nowMs() - bufferedAt > CONFIG.input.bufferSeconds * 1000) {
        buffered = null;
        return null;
      }
      const action = buffered;
      buffered = null;
      return action;
    },

    dispose(): void {
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchmove', onTouchMove);
      target.removeEventListener('touchend', onTouchEnd);
      target.removeEventListener('touchcancel', onTouchCancel);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      view.removeEventListener('keydown', onKeyDown);
      buffered = null;
      tracking = false;
    },
  };
}
