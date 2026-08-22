import type { Branch, BuffKind, ObstacleKind, PickupKind } from '../game/types';

export interface GameEvents {
  'run:started': { seed: number };
  'run:ended': { points: number; distance: number; isRecord: boolean };
  /** Run abbandonata da viva (es. il giocatore torna al menu con Esc/MENU
   *  mentre è ancora vivo): DIVERSO da 'run:ended', che è riservato alla morte
   *  e fa scattare il rallentatore in main.ts. Serve ai consumatori del bus
   *  (l'audio, per spegnere il rombo della valanga) per sapere che la run è
   *  finita anche quando non c'è stata una morte. */
  'run:stopped': Record<string, never>;
  /** `branch`, `z` e `y` sono la posizione REALE del raccoglibile nel momento
   *  in cui sparisce. Servono a chi disegna l'esplosione di cubetti: prima non
   *  c'erano e la vista era costretta a inventarsi una quota fissa addosso
   *  alla mucca, così i cubetti nascevano anche a mezzo metro dal fiocco che
   *  li aveva generati — spesso DENTRO l'ostacolo che la mucca stava
   *  scavalcando in quell'istante. Da lì i cubetti non uscivano più, perché
   *  scorrono all'indietro alla stessa velocità dell'ostacolo e la loro
   *  posizione relativa non cambia mai: restavano conficcati nel legno per
   *  tutta la loro vita. */
  'pickup:collected': { kind: PickupKind; charge: number; branch: Branch; z: number; y: number };
  'obstacle:hit': {
    kind: ObstacleKind;
    outcome: 'death' | 'forgiven' | 'smashed' | 'shielded';
    branch: Branch;
    z: number;
    /** Quota della base dell'ostacolo colpito. Stessa ragione della `y` di
     *  'pickup:collected': un arco o un cornicione stanno a `spawn.overheadY`,
     *  e sfondandoli i cubetti comparivano all'altezza delle ginocchia. */
    y: number;
  };
  'size:changed': { size: number; previous: number };
  'avalanche:triggered': { size: number };
  'avalanche:ending': Record<string, never>;
  'avalanche:ended': Record<string, never>;
  /** Un bivio è appena diventato visibile all'orizzonte del giocatore. */
  'fork:appeared': { richBranch: 'left' | 'right' };
  /** Il giocatore ha scelto (o cambiato scelta) un ramo prima del punto di non ritorno. */
  'fork:chosen': { side: 'left' | 'right' };
  /** Il bivio è stato risolto (dal giocatore o imposto): il ramo `side` è ora solido. */
  'fork:resolved': { side: 'left' | 'right' };
  'buff:gained': { kind: BuffKind };
  'buff:expired': { kind: BuffKind };
  /** Un buff a tempo sta per scadere: emesso una sola volta per buff, a
   *  `CONFIG.buffs.expiryWarnSeconds` dalla fine. Serve perché il tempo
   *  residuo nell'HUD è arrotondato per eccesso: si legge "1s" per un secondo
   *  intero e poi il badge sparisce, senza alcun preavviso. */
  'buff:expiring': { kind: BuffKind };
  'shield:consumed': Record<string, never>;
  /** Le tre azioni del giocatore. Non producevano alcun evento, quindi salto e
   *  scivolata — le due cose che si fanno più spesso in tutto il gioco —
   *  erano completamente mute: nessun suono, nessuna particella, nessuna
   *  deformazione. `airborneSeconds` sull'atterraggio permette di dosare il
   *  tonfo in base a quanto si è saltato in alto. */
  'player:jumped': Record<string, never>;
  'player:landed': { airborneSeconds: number };
  'player:slid': Record<string, never>;
  /** La scivolata è finita (per scadenza o interrotta da un salto): chiude il
   *  rumore in loop che accompagna lo scivolamento. */
  'player:slideEnded': Record<string, never>;
  /** Serie di ostacoli superati senza subire colpi: cambia di gradino. Il
   *  moltiplicatore è già quello nuovo. */
  'streak:changed': { streak: number; multiplier: number };
  /** Il punteggio ha superato il record precedente, durante la corsa. Era il
   *  momento più gratificante di una partita e non lo comunicava nessuno:
   *  lo si scopriva morendo. */
  'record:beaten': { points: number };
  /** Una missione è stata completata durante la corsa. */
  'quest:completed': { id: string; label: string };
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
