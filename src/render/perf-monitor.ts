import { CONFIG } from '../game/config';

export interface PerfMonitor {
  /** true dal momento in cui il degrado è stato richiesto. */
  readonly degraded: boolean;
  /** Campiona un frame. Restituisce true SOLO nel frame in cui scatta il degrado. */
  sample(dt: number): boolean;
  reset(): void;
}

/**
 * Logica pura (niente three, niente DOM): decide quando abbassare la qualità.
 *
 * Gli FPS istantanei sono rumorosissimi — un singolo frame lungo per un garbage
 * collect non deve spegnere le ombre. Si usa quindi una media mobile
 * esponenziale con costante di tempo `CONFIG.perf.smoothingSeconds`, e il
 * degrado scatta solo se la media resta sotto soglia per
 * `CONFIG.perf.lowFpsSeconds` CONSECUTIVI. Scatta una volta sola: la qualità si
 * abbassa, non si mette a oscillare.
 */
export function createPerfMonitor(): PerfMonitor {
  let averageFps = 0;
  let seeded = false;
  let belowSeconds = 0;
  let degraded = false;

  return {
    get degraded(): boolean {
      return degraded;
    },

    sample(dt: number): boolean {
      if (dt <= 0) {
        return false;
      }

      // Un singolo campione anomalo (ripresa da una tab sospesa, un GC molto
      // lungo) non deve poter contribuire più di un frame "ragionevole": senza
      // questo tetto, UN solo sample(8) supera da solo lowFpsSeconds e spegne
      // la qualità per sempre, anche su un dispositivo che non è mai stato
      // lento. main.ts clampa già il dt reale prima di chiamare sample(), ma il
      // monitor si difende comunque da sé, per restare fedele al proprio
      // contratto anche se chiamato altrove con un dt non clampato.
      const effectiveDt = Math.min(dt, CONFIG.perf.maxSampleSeconds);

      const fps = 1 / effectiveDt;
      if (!seeded) {
        averageFps = fps;
        seeded = true;
      } else {
        const alpha = Math.min(1, effectiveDt / CONFIG.perf.smoothingSeconds);
        averageFps += (fps - averageFps) * alpha;
      }

      if (averageFps < CONFIG.perf.lowFpsThreshold) {
        belowSeconds += effectiveDt;
      } else {
        belowSeconds = 0;
      }

      if (!degraded && belowSeconds >= CONFIG.perf.lowFpsSeconds) {
        degraded = true;
        return true;
      }
      return false;
    },

    reset(): void {
      averageFps = 0;
      seeded = false;
      belowSeconds = 0;
      degraded = false;
    },
  };
}
