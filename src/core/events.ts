import type { Lane, ObstacleKind, PickupKind } from '../game/types';

export interface GameEvents {
  'run:started': { seed: number };
  'run:ended': { points: number; distance: number; isRecord: boolean };
  /** Run abbandonata da viva (es. il giocatore torna al menu con Esc/MENU
   *  mentre è ancora vivo): DIVERSO da 'run:ended', che è riservato alla morte
   *  e fa scattare il rallentatore in main.ts. Serve ai consumatori del bus
   *  (l'audio, per spegnere il rombo della valanga) per sapere che la run è
   *  finita anche quando non c'è stata una morte. */
  'run:stopped': Record<string, never>;
  'pickup:collected': { kind: PickupKind; charge: number };
  'obstacle:hit': {
    kind: ObstacleKind;
    outcome: 'death' | 'forgiven' | 'smashed';
    lane: Lane;
    z: number;
  };
  'size:changed': { size: number; previous: number };
  'avalanche:triggered': { size: number };
  'avalanche:ending': Record<string, never>;
  'avalanche:ended': Record<string, never>;
}

export type EventName = keyof GameEvents;

export interface EventBus {
  /** Restituisce una funzione di disiscrizione. */
  on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}

/**
 * Firma interna, volutamente opaca: la mappa non può essere tipizzata per chiave
 * senza perdere la relazione nome→payload dell'API pubblica.
 */
type AnyHandler = (payload: unknown) => void;

export function createEventBus(): EventBus {
  const handlers = new Map<EventName, Set<AnyHandler>>();

  const on = <K extends EventName>(
    name: K,
    handler: (payload: GameEvents[K]) => void,
  ): (() => void) => {
    const wrapped = handler as AnyHandler;
    let set = handlers.get(name);
    if (set === undefined) {
      set = new Set<AnyHandler>();
      handlers.set(name, set);
    }
    const target = set;
    target.add(wrapped);
    return (): void => {
      target.delete(wrapped);
    };
  };

  const emit = <K extends EventName>(name: K, payload: GameEvents[K]): void => {
    const set = handlers.get(name);
    if (set === undefined) {
      return;
    }
    // Si itera il Set direttamente (nessuna copia, nessuna allocazione nel loop).
    // Un handler che lancia viene isolato: gli altri devono comunque ricevere l'evento.
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[events] handler failed for "${name}"`, error);
      }
    }
  };

  const clear = (): void => {
    handlers.clear();
  };

  return { on, emit, clear };
}
