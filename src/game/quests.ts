import type { EventBus } from '../core/events';
import { createRng } from '../core/rng';
import { CONFIG } from './config';

/**
 * Missioni: tre alla volta, estratte da un seed che cambia con il giorno.
 *
 * Il modulo è PURO in senso stretto — niente three, niente DOM, niente
 * localStorage — e soprattutto non conosce il gioco: non riceve GameState, non
 * chiama nulla di game.ts, e verifica ogni missione ASCOLTANDO gli eventi che
 * esistono già sul bus. È quello che permette di aggiungere una missione senza
 * toccare una riga di regole, ed è anche il motivo per cui l'elenco delle
 * missioni possibili qui sotto è vincolato a ciò che il bus racconta davvero.
 *
 * La persistenza (quali missioni sono già state completate) è di
 * platform/storage.ts: qui si entra con `createQuests(seed, completate)` e si
 * esce con `completedQuestIds(state)`.
 */

export type QuestKind =
  /** Raccogli N fiocchi in una corsa ('pickup:collected'). */
  | 'flakes'
  /** Attiva N valanghe ('avalanche:triggered'). */
  | 'avalanches'
  /** Arriva alla taglia N ('size:changed'). */
  | 'size'
  /** Scegli il ramo ricco N volte ('fork:appeared' + 'fork:resolved'). */
  | 'richBranch'
  /** Sfonda N ostacoli in una SOLA valanga ('obstacle:hit' con 'smashed'). */
  | 'smashes'
  /** Arriva a N metri senza essere perdonato ('obstacle:hit' con 'forgiven'). */
  | 'cleanDistance';

export interface Quest {
  /** Stabile nel tempo (`kind-target`): è la chiave con cui il livello
   *  platform ricorda che è stata completata, quindi non può dipendere dal
   *  giorno in cui è uscita. */
  id: string;
  kind: QuestKind;
  target: number;
  label: string;
  /** Avanzamento nella corsa in corso, 0..target. */
  progress: number;
  done: boolean;
}

/** Contatori della corsa in corso: azzerati da 'run:started'. */
interface RunCounters {
  flakes: number;
  avalanches: number;
  maxSize: number;
  richChoices: number;
  /** Sfondamenti nella valanga ATTUALE, e il record fra quelle della corsa:
   *  la missione chiede "N in una sola valanga", quindi il conteggio corrente
   *  riparte a ogni valanga ma il migliore va conservato. */
  smashesInAvalanche: number;
  bestSmashes: number;
  /** Vero appena un impatto viene perdonato: chiude la missione "pulita" per
   *  il resto della corsa, e la sua barra torna a zero. */
  forgiven: boolean;
  distance: number;
  /** Siamo dentro una valanga: serve a non contare come "sfondamento in
   *  valanga" la staccionata sfondata a taglia 3 fuori da una valanga. */
  inAvalanche: boolean;
  /** Ramo ricco dell'ultimo bivio annunciato: 'fork:resolved' porta il lato
   *  scelto ma non dice quale dei due era quello ricco. */
  richBranch: 'left' | 'right' | null;
}

export interface QuestsState {
  quests: Quest[];
  counters: RunCounters;
}

interface QuestTemplate {
  kind: QuestKind;
  /** Varianti di difficoltà: il seed del giorno ne sceglie una. */
  targets: readonly number[];
  label: (target: number) => string;
}

/**
 * Catalogo delle missioni possibili. I bersagli stanno qui e non in
 * CONFIG.quests (che espone `count` e `storageKey`) perché sono la
 * DEFINIZIONE delle missioni, non una manopola di bilanciamento: cambiarne uno
 * cambia quale missione esiste, e l'id — che è `kind-target` e vive su disco —
 * cambia con essa. Stesso trattamento dell'elenco degli ostacoli in
 * spawner.ts. Dove un bersaglio è già un numero di gioco (la taglia massima)
 * si legge da CONFIG invece di ricopiarlo.
 */
const CATALOGUE: readonly QuestTemplate[] = [
  {
    kind: 'flakes',
    targets: [40, 70, 110],
    label: (target) => `Raccogli ${target} fiocchi in una corsa`,
  },
  {
    kind: 'avalanches',
    targets: [1, 2, 3],
    label: (target) =>
      target === 1 ? 'Scatena una valanga' : `Scatena ${target} valanghe in una corsa`,
  },
  {
    kind: 'size',
    targets: [CONFIG.avalanche.maxSize - 1, CONFIG.avalanche.maxSize],
    label: (target) => `Arriva alla taglia ${target}`,
  },
  {
    kind: 'richBranch',
    targets: [3, 5, 8],
    label: (target) => `Scegli il ramo ricco ${target} volte`,
  },
  {
    kind: 'smashes',
    targets: [4, 7, 10],
    label: (target) => `Sfonda ${target} ostacoli in una sola valanga`,
  },
  {
    kind: 'cleanDistance',
    targets: [800, 1500, 2500],
    label: (target) => `Arriva a ${target} metri senza essere perdonato`,
  },
];

function createCounters(): RunCounters {
  return {
    flakes: 0,
    avalanches: 0,
    maxSize: 1,
    richChoices: 0,
    smashesInAvalanche: 0,
    bestSmashes: 0,
    forgiven: false,
    distance: 0,
    inAvalanche: false,
    richBranch: null,
  };
}

/**
 * Seed del giorno. Deriva dalla data UTC — non da quella locale — perché la
 * promessa è "le stesse tre missioni per tutti", e un fuso orario le farebbe
 * cambiare a mezzanotte diverse per giocatori diversi. Il sale è quello della
 * corsa del giorno: due usi dello stesso giorno che devono restare distinti li
 * separa la funzione, non il numero.
 */
export function dailyQuestSeed(date: Date): number {
  const day = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  return Math.imul(day, CONFIG.daily.seedSalt) >>> 0;
}

/**
 * Estrae `CONFIG.quests.count` missioni DISTINTE per tipo: tre varianti della
 * stessa missione sarebbero una missione sola con tre barre, e il senso di
 * averne tre è che chiedano cose diverse.
 */
export function createQuests(seed: number, completed: readonly string[] = []): QuestsState {
  const rng = createRng(seed);
  const pool = [...CATALOGUE];
  const quests: Quest[] = [];
  const count = Math.min(CONFIG.quests.count, pool.length);
  const alreadyDone = new Set(completed);

  for (let i = 0; i < count; i++) {
    const index = rng.int(0, pool.length);
    const template = pool[index];
    if (template === undefined) continue;
    pool.splice(index, 1);

    const target = rng.pick(template.targets);
    const id = `${template.kind}-${target}`;
    quests.push({
      id,
      kind: template.kind,
      target,
      label: template.label(target),
      progress: 0,
      done: alreadyDone.has(id),
    });
  }

  return { quests, counters: createCounters() };
}

/** Id delle missioni completate, da consegnare al livello di persistenza. */
export function completedQuestIds(state: QuestsState): string[] {
  return state.quests.filter((quest) => quest.done).map((quest) => quest.id);
}

/**
 * Avanzamento corrente di un tipo di missione. Non è sempre un contatore che
 * cresce: "N metri senza essere perdonato" TORNA A ZERO quando arriva il
 * perdono, ed è precisamente ciò che la rende una missione e non una soglia di
 * distanza.
 */
function progressFor(counters: RunCounters, kind: QuestKind): number {
  switch (kind) {
    case 'flakes':
      return counters.flakes;
    case 'avalanches':
      return counters.avalanches;
    case 'size':
      return counters.maxSize;
    case 'richBranch':
      return counters.richChoices;
    case 'smashes':
      return counters.bestSmashes;
    case 'cleanDistance':
      return counters.forgiven ? 0 : counters.distance;
  }
}

/**
 * Riporta i contatori sulle missioni e annuncia quelle appena completate. Una
 * missione completata resta completata: non la si ripiega quando il progresso
 * cala (la distanza "pulita" può tornare a zero), altrimenti 'quest:completed'
 * andrebbe emesso due volte per la stessa impresa.
 */
function refresh(state: QuestsState, bus: EventBus): void {
  for (const quest of state.quests) {
    const value = progressFor(state.counters, quest.kind);
    quest.progress = Math.min(quest.target, value);
    if (quest.done || value < quest.target) continue;
    quest.done = true;
    bus.emit('quest:completed', { id: quest.id, label: quest.label });
  }
}

/**
 * Fa avanzare la missione di distanza. È l'unica cosa che il bus non racconta
 * (non esiste un evento per metro percorso, e sarebbe sessanta eventi al
 * secondo), quindi la passa chi guida il ciclo di gioco.
 */
export function trackDistance(state: QuestsState, distance: number, bus: EventBus): void {
  state.counters.distance = distance;
  refresh(state, bus);
}

/**
 * Aggancia le missioni al bus. Restituisce la funzione che stacca tutto: le
 * sottoscrizioni sopravvivrebbero al cambio di missioni del giorno dopo, e due
 * insiemi di missioni agganciati insieme conterebbero ogni fiocco due volte.
 */
export function attachQuests(state: QuestsState, bus: EventBus): () => void {
  const counters = state.counters;

  const unsubscribes = [
    bus.on('run:started', () => {
      // Le missioni sono per corsa: i contatori ripartono, i completamenti no.
      Object.assign(counters, createCounters());
      for (const quest of state.quests) quest.progress = 0;
    }),

    bus.on('pickup:collected', (payload) => {
      if (payload.kind !== 'snowflake') return;
      counters.flakes += 1;
      refresh(state, bus);
    }),

    bus.on('avalanche:triggered', () => {
      counters.avalanches += 1;
      counters.inAvalanche = true;
      // "In una SOLA valanga": il conteggio riparte a ogni valanga, il
      // migliore resta in bestSmashes.
      counters.smashesInAvalanche = 0;
      refresh(state, bus);
    }),

    bus.on('avalanche:ended', () => {
      counters.inAvalanche = false;
    }),

    bus.on('size:changed', (payload) => {
      counters.maxSize = Math.max(counters.maxSize, payload.size);
      refresh(state, bus);
    }),

    // Il ramo ricco lo annuncia solo 'fork:appeared'; il lato scelto arriva
    // con l'evento del bivio. Servono entrambi, e in quest'ordine — che è
    // quello in cui il gioco li emette.
    bus.on('fork:appeared', (payload) => {
      counters.richBranch = payload.richBranch;
    }),

    // 'fork:resolved' e non 'fork:chosen': il secondo viene emesso a OGNI
    // swipe, quindi cambiare idea due volte conterebbe due scelte per un solo
    // bivio. 'fork:resolved' arriva una volta sola, al punto di non ritorno, e
    // porta il lato definitivo. Non gonfia il conteggio nemmeno quando la
    // scelta è imposta a chi non ha deciso: il ramo imposto è per costruzione
    // quello NON ricco (vedi path.ts).
    bus.on('fork:resolved', (payload) => {
      if (payload.side !== counters.richBranch) return;
      counters.richChoices += 1;
      refresh(state, bus);
    }),

    bus.on('obstacle:hit', (payload) => {
      if (payload.outcome === 'forgiven') {
        counters.forgiven = true;
        refresh(state, bus);
        return;
      }
      if (payload.outcome !== 'smashed' || !counters.inAvalanche) return;
      counters.smashesInAvalanche += 1;
      counters.bestSmashes = Math.max(counters.bestSmashes, counters.smashesInAvalanche);
      refresh(state, bus);
    }),
  ];

  return (): void => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
