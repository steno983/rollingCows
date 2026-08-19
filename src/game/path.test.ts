import { describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import type { EventBus, GameEvents } from '../core/events';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import {
  branchIsSolid,
  branchOffsetX,
  chooseBranch,
  rememberChoice,
  createPath,
  updatePath,
} from './path';
import type { PathState } from './path';
import { speedAt } from './speed';

const STEP = 1 / 60;

/** Bus di test: accumula i payload di un evento, nell'ordine di emissione. */
function recordedBus<K extends keyof GameEvents>(
  name: K,
): { bus: EventBus; payloads: GameEvents[K][] } {
  const bus = createEventBus();
  const payloads: GameEvents[K][] = [];
  bus.on(name, (payload) => payloads.push(payload));
  return { bus, payloads };
}

/** Avanza il percorso di `distance` unità a velocità costante, a passi di STEP
 *  (l'ultimo passo può essere più corto, per chiudere esattamente su `distance`). */
function travel(
  path: PathState,
  distance: number,
  speed: number,
  rng: ReturnType<typeof createRng>,
  bus: EventBus,
): void {
  let remaining = distance;
  while (remaining > 0) {
    const step = Math.min(speed * STEP, remaining);
    updatePath(path, step, speed, rng, bus);
    remaining -= step;
  }
}

describe('createPath', () => {
  it('parte senza bivio, sul ramo main, offset zero', () => {
    const path = createPath();
    expect(path.phase).toBe('none');
    expect(path.activeBranch).toBe('main');
    expect(path.offsetX).toBe(0);
    expect(path.choice).toBeNull();
  });
});

describe('updatePath — comparsa del bivio', () => {
  it('non compare prima della distanza attesa', () => {
    const { bus } = recordedBus('fork:appeared');
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap - 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('none');
  });

  it('compare dopo la distanza attesa', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(payloads.length).toBe(1);
    expect(['left', 'right']).toContain(payloads[0]?.richBranch);
  });

  it('emette fork:appeared una sola volta per bivio, dalla comparsa alla chiusura', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    const path = createPath();
    const rng = createRng(1);
    const totalToClose =
      CONFIG.path.minGap +
      CONFIG.path.previewZ +
      CONFIG.path.realignSeconds * CONFIG.world.startSpeed +
      5;
    travel(path, totalToClose, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('none');
    expect(payloads.length).toBe(1);
  });
});

describe('chooseBranch', () => {
  it('prima del punto di non ritorno cambia la scelta, anche più volte', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');

    expect(chooseBranch(path, 'left')).toBe(true);
    expect(path.choice).toBe('left');

    expect(chooseBranch(path, 'right')).toBe(true);
    expect(path.choice).toBe('right');

    expect(chooseBranch(path, 'left')).toBe(true);
    expect(path.choice).toBe('left');
  });

  it('dopo il punto di non ritorno restituisce false e non cambia più nulla', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );
    expect(path.phase).not.toBe('approaching');

    const lockedChoice = path.choice;
    expect(chooseBranch(path, lockedChoice === 'left' ? 'right' : 'left')).toBe(false);
    expect(path.choice).toBe(lockedChoice);
  });

  it('restituisce false se non c-è alcun bivio in corso', () => {
    const path = createPath();
    expect(chooseBranch(path, 'left')).toBe(false);
    expect(path.choice).toBeNull();
  });
});

describe('senza scelta', () => {
  it('al punto di non ritorno impone il ramo NON ricco', () => {
    const { bus, payloads } = recordedBus('fork:resolved');
    const path = createPath();
    const rng = createRng(7);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    const rich = path.richBranch;
    const expectedChoice = rich === 'left' ? 'right' : 'left';

    travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.choice).toBe(expectedChoice);
    expect(path.activeBranch).toBe(expectedChoice);
    expect(payloads.length).toBe(1);
    expect(payloads[0]?.side).toBe(expectedChoice);
  });
});

describe('branchIsSolid', () => {
  it('main è sempre solido, in ogni fase', () => {
    const bus = createEventBus();
    const path = createPath();
    expect(branchIsSolid(path, 'main')).toBe(true);

    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(branchIsSolid(path, 'main')).toBe(true);
  });

  it('durante approaching nessun ramo laterale è solido', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(branchIsSolid(path, 'left')).toBe(false);
    expect(branchIsSolid(path, 'right')).toBe(false);
  });

  it('dopo il commit solo il ramo scelto è solido', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.activeBranch).toBe('left');
    expect(branchIsSolid(path, 'left')).toBe(true);
    expect(branchIsSolid(path, 'right')).toBe(false);
  });
});

describe('riallineamento', () => {
  it('finisce sempre con offsetX esattamente 0, phase none, activeBranch main', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(3);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    travel(
      path,
      CONFIG.path.previewZ + CONFIG.path.realignSeconds * CONFIG.world.startSpeed + 5,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.phase).toBe('none');
    expect(path.offsetX).toBe(0);
    expect(path.activeBranch).toBe('main');
  });

  it('durante il riallineamento la posizione a schermo del ramo scelto converge al centro monotonamente', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(3);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    travel(path, CONFIG.path.previewZ, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase === 'committed' || path.phase === 'realigning').toBe(true);

    // "Posizione a schermo del ramo scelto" = branchOffsetX('right') + offsetX:
    // parte da +branchSeparation (ramo ancora tutto spostato) e deve scendere
    // verso 0 senza mai risalire. Il confronto vale solo MENTRE il ramo è
    // ancora 'right': appena il riallineamento finisce, activeBranch torna a
    // 'main' e offsetX viene azzerato nello stesso frame (fine di un
    // riallineamento, non un nuovo movimento da misurare), quindi il loop si
    // ferma lì e verifica l'esito finale a parte.
    const chosenOffset = CONFIG.path.branchSeparation; // branchOffsetX(path, 'right')
    let previous = Math.abs(chosenOffset + path.offsetX);
    for (let i = 0; i < 60; i++) {
      updatePath(path, CONFIG.world.startSpeed * STEP, CONFIG.world.startSpeed, rng, bus);
      if (path.phase === 'none') break;
      const current = Math.abs(chosenOffset + path.offsetX);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
    expect(path.phase).toBe('none');
    expect(path.offsetX).toBe(0);
  });
});

describe('simulazione lunga', () => {
  it('a 60 s con velocità crescente, i bivi non si sovrappongono mai e si chiudono sempre', () => {
    const bus = createEventBus();
    let forkOpen = false;
    let appearedCount = 0;
    let closedCount = 0;
    let lastCloseDistance = 0;
    const gapsSinceLastClose: number[] = [];

    bus.on('fork:appeared', () => {
      // Nessuna sovrapposizione possibile per costruzione (un solo PathState,
      // una sola fase alla volta), ma lo si verifica comunque a runtime.
      expect(forkOpen).toBe(false);
      forkOpen = true;
      appearedCount += 1;
    });

    const path = createPath();
    const rng = createRng(42);
    let distance = 0;
    const steps = Math.round(60 / STEP);

    for (let i = 0; i < steps; i++) {
      const speed = speedAt(distance);
      const travelled = speed * STEP;
      const wasNone = path.phase === 'none';
      updatePath(path, travelled, speed, rng, bus);
      distance += travelled;

      if (!wasNone && path.phase === 'none' && path.offsetX === 0) {
        expect(forkOpen).toBe(true);
        forkOpen = false;
        closedCount += 1;
        gapsSinceLastClose.push(distance - lastCloseDistance);
        lastCloseDistance = distance;
      }
    }

    // Con la curva di velocità di CONFIG.world (18→40 u/s) e gapPerSpeed=6, il
    // costo di un bivio (minGap + gapPerSpeed*speed + previewZ + realignSeconds*speed)
    // cresce con la velocità: in 60 s simulati un seed qualsiasi ne produce
    // stabilmente 4 (verificato su più seed). La soglia resta comunque sotto
    // quel valore, per non legare il test a un numero magico ottenuto per tentativi.
    expect(appearedCount).toBeGreaterThanOrEqual(3);
    // Ogni bivio si chiude, salvo eventualmente l'ultimo se la simulazione
    // finisce a metà del suo riallineamento.
    expect(closedCount).toBeGreaterThanOrEqual(appearedCount - 1);
    for (const gap of gapsSinceLastClose) {
      expect(gap).toBeGreaterThanOrEqual(CONFIG.path.minGap - 1);
    }
  });
});

describe('determinismo', () => {
  it('a parità di seed la sequenza di richBranch è identica', () => {
    function run(seed: number): Array<'left' | 'right'> {
      const bus = createEventBus();
      const sequence: Array<'left' | 'right'> = [];
      bus.on('fork:appeared', (payload) => sequence.push(payload.richBranch));

      const path = createPath();
      const rng = createRng(seed);
      let distance = 0;
      const steps = Math.round(40 / STEP);
      for (let i = 0; i < steps; i++) {
        const speed = speedAt(distance);
        const travelled = speed * STEP;
        updatePath(path, travelled, speed, rng, bus);
        distance += travelled;
      }
      return sequence;
    }

    const first = run(123);
    expect(first.length).toBeGreaterThan(0);
    expect(run(123)).toEqual(first);
  });
});

describe('branchOffsetX', () => {
  it('è simmetrico e nullo per il ramo main', () => {
    const path = createPath();
    expect(branchOffsetX(path, 'main')).toBe(0);
    expect(branchOffsetX(path, 'left')).toBe(-CONFIG.path.branchSeparation);
    expect(branchOffsetX(path, 'right')).toBe(CONFIG.path.branchSeparation);
  });
});

describe('scelta anticipata', () => {
  it('uno swipe dato poco prima che il bivio compaia vale come scelta, ed è annunciato', () => {
    const { bus, payloads } = recordedBus('fork:chosen');
    const path = createPath();
    const rng = createRng(1);
    const speed = 20;

    // A un passo dal bivio: il tracciato è ancora dritto, quindi lo swipe non
    // può essere una scelta vera.
    travel(path, path.nextForkIn - speed * STEP, speed, rng, bus);
    expect(path.phase).toBe('none');
    expect(chooseBranch(path, 'right')).toBe(false);
    rememberChoice(path, 'right');
    expect(payloads).toEqual([]);

    updatePath(path, speed * STEP, speed, rng, bus);

    expect(path.phase).toBe('approaching');
    expect(path.choice).toBe('right');
    expect(payloads).toEqual([{ side: 'right' }]);
  });

  it('uno swipe più vecchio di earlyChoiceSeconds è dimenticato', () => {
    const { bus, payloads } = recordedBus('fork:chosen');
    const path = createPath();
    const rng = createRng(2);
    const speed = 20;

    rememberChoice(path, 'left');
    // Il tempo scorre ben oltre la finestra della scelta anticipata, e comunque
    // molto prima che il bivio compaia (minGap è 120 unità).
    travel(path, speed * CONFIG.path.earlyChoiceSeconds * 2, speed, rng, bus);
    expect(path.pendingChoice).toBeNull();

    travel(path, path.nextForkIn + 1, speed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(path.choice).toBeNull();
    expect(payloads).toEqual([]);
  });

  it('una scelta vera cancella quella anticipata ancora in memoria', () => {
    const path = createPath();
    rememberChoice(path, 'left');
    path.phase = 'approaching';

    expect(chooseBranch(path, 'right')).toBe(true);
    expect(path.pendingChoice).toBeNull();
    expect(path.pendingChoiceTimeLeft).toBe(0);
  });
});

describe('realignProgress', () => {
  it('vale 0 fuori dal riallineamento, sale da 0 a 1 durante, e torna 0 alla chiusura', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(7);
    const speed = 20;

    travel(path, path.nextForkIn + 1, speed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(path.realignProgress).toBe(0);

    const seen: number[] = [];
    let guard = 0;
    while (path.phase !== 'none' && guard < 5000) {
      updatePath(path, speed * STEP, speed, rng, bus);
      if (path.phase === 'realigning') seen.push(path.realignProgress);
      guard += 1;
    }

    expect(seen.length).toBeGreaterThan(10);
    // Cresce in modo monotono e a passi regolari: nessun raddoppio nel primo
    // frame, che è ciò che faceva scattare lateralmente il mondo all'inizio di
    // ogni riallineamento.
    const first = seen[0];
    if (first === undefined) throw new Error('nessun frame di riallineamento');
    const nominalStep = STEP / CONFIG.path.realignSeconds;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(nominalStep + 1e-9);
    for (let i = 1; i < seen.length; i++) {
      const previous = seen[i - 1];
      const current = seen[i];
      if (previous === undefined || current === undefined) throw new Error('campione mancante');
      expect(current).toBeGreaterThan(previous);
      expect(current - previous).toBeLessThanOrEqual(nominalStep + 1e-9);
    }

    // Alla chiusura il riallineamento era praticamente completo: è ciò che
    // permette alla vista di far svanire il nastro scartato senza scatti.
    const last = seen[seen.length - 1];
    if (last === undefined) throw new Error('nessun campione finale');
    expect(last).toBeGreaterThan(1 - nominalStep - 1e-9);
    expect(path.phase).toBe('none');
    expect(path.realignProgress).toBe(0);
  });
});
