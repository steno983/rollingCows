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
const DEFAULT_MAX_ACCUMULATED = 0.25;

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
  options?: { step?: number; maxAccumulated?: number },
): Loop {
  const step = options?.step ?? DEFAULT_STEP;
  const maxAccumulated = options?.maxAccumulated ?? DEFAULT_MAX_ACCUMULATED;

  let accumulated = 0;
  let lastMs: number | null = null;
  let running = false;
  let frameHandle: number | null = null;

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

    callbacks.render(accumulated / step);
  };

  const tick = (nowMs: number): void => {
    if (!running) {
      return;
    }
    advance(nowMs);
    const raf = getRaf();
    frameHandle = raf === null ? null : raf(tick);
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    accumulated = 0;
    lastMs = null;
    const raf = getRaf();
    frameHandle = raf === null ? null : raf(tick);
  };

  const stop = (): void => {
    running = false;
    const cancel = getCancelRaf();
    if (frameHandle !== null && cancel !== null) {
      cancel(frameHandle);
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
