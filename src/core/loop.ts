export interface LoopCallbacks {
  /** dt è sempre uguale allo step configurato. */
  update(dt: number): void;
  /** alpha in [0, 1): residuo di interpolazione fra due update. */
  render(alpha: number): void;
}

export interface Loop {
  readonly running: boolean;
  /** Avvia il ciclo su requestAnimationFrame, se disponibile. */
  start(): void;
  stop(): void;
  /** Avanza il loop a un timestamp dato. Esposto per i test (niente rAF). */
  advance(nowMs: number): void;
}

const DEFAULT_STEP = 1 / 60;
/** Tetto all'accumulatore dopo uno stallo. Era 0.25 — l'idioma da desktop —
 *  cioè quindici passi in un solo frame: dopo una garbage collection lunga,
 *  una rotazione dello schermo o un ritorno dal background si eseguivano
 *  fino a quindici update completi, e siccome ogni update trascina con sé la
 *  sincronizzazione della vista si arrivava nell'ordine delle 150.000
 *  iterazioni in un frame — che produce un secondo stallo, che alimenta il
 *  primo. Sei passi bastano: perdere un po' di tempo simulato dopo uno stallo
 *  è preferibile a produrne un altro. */
const DEFAULT_MAX_ACCUMULATED = 0.1;
/** Intervallo minimo fra due render. Il loop simula a passo fisso, quindi su
 *  un pannello a 120 Hz (ormai comuni sui telefoni) metà dei frame disegnati
 *  sarebbero identici al precedente: si pagherebbe il doppio in GPU e
 *  batteria per zero movimento aggiuntivo, e la batteria che si scalda
 *  innesca il throttling termico, cioè il problema successivo. 1/72 lascia
 *  passare senza penalità i pannelli a 60 Hz (che chiamerebbero comunque a
 *  1/60 > 1/72) e dimezza quelli a 120. */
const DEFAULT_MIN_RENDER_INTERVAL = 1 / 72;

function getRaf(): ((cb: (nowMs: number) => void) => number) | null {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    return null;
  }
  return globalThis.requestAnimationFrame.bind(globalThis);
}

function getCancelRaf(): ((handle: number) => void) | null {
  if (typeof globalThis.cancelAnimationFrame !== 'function') {
    return null;
  }
  return globalThis.cancelAnimationFrame.bind(globalThis);
}

export function createLoop(
  callbacks: LoopCallbacks,
  options?: { step?: number; maxAccumulated?: number; minRenderInterval?: number },
): Loop {
  const step = options?.step ?? DEFAULT_STEP;
  const maxAccumulated = options?.maxAccumulated ?? DEFAULT_MAX_ACCUMULATED;
  const minRenderInterval = options?.minRenderInterval ?? DEFAULT_MIN_RENDER_INTERVAL;

  // Risolti UNA VOLTA invece che a ogni tick: `bind` restituisce un oggetto
  // funzione nuovo a ogni chiamata, quindi getRaf() dentro tick() allocava
  // sessanta funzioni al secondo — nel file che definisce il loop, cioè il
  // posto in cui la regola "nel loop non si alloca" dovrebbe essere più
  // visibile di tutti.
  const raf = getRaf();
  const cancelRaf = getCancelRaf();

  let accumulated = 0;
  let lastMs: number | null = null;
  let running = false;
  let frameHandle: number | null = null;
  /** Tempo trascorso dall'ultimo render effettivo, per il limitatore. */
  let sinceRender = Number.POSITIVE_INFINITY;

  const advance = (nowMs: number): void => {
    if (lastMs === null) {
      // Primo frame: si registra solo il tempo di partenza, nessun update.
      lastMs = nowMs;
      callbacks.render(0);
      return;
    }

    let elapsed = (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    if (elapsed < 0) {
      elapsed = 0;
    }

    accumulated += elapsed;
    if (accumulated > maxAccumulated) {
      // Clamp anti "spirale della morte" dopo una pausa lunga (tab in background).
      accumulated = maxAccumulated;
    }

    while (accumulated >= step) {
      accumulated -= step;
      callbacks.update(step);
    }

    // Il render si salta soltanto se il frame precedente è stato disegnato da
    // meno di minRenderInterval: su 60 Hz non scatta mai, su 120 Hz elimina i
    // frame che sarebbero identici al precedente.
    sinceRender += elapsed;
    if (sinceRender >= minRenderInterval) {
      sinceRender = 0;
      callbacks.render(accumulated / step);
    }
  };

  const tick = (nowMs: number): void => {
    if (!running) {
      return;
    }
    advance(nowMs);
    frameHandle = raf === null ? null : raf(tick);
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    accumulated = 0;
    lastMs = null;
    // Il primo frame dopo una ripartenza deve disegnare subito, senza
    // aspettare il limitatore: al ritorno da una tab nascosta lo schermo
    // mostrerebbe altrimenti l'ultimo fotogramma di prima.
    sinceRender = Number.POSITIVE_INFINITY;
    frameHandle = raf === null ? null : raf(tick);
  };

  const stop = (): void => {
    running = false;
    if (frameHandle !== null && cancelRaf !== null) {
      cancelRaf(frameHandle);
    }
    frameHandle = null;
  };

  return {
    get running(): boolean {
      return running;
    },
    start,
    stop,
    advance,
  };
}
