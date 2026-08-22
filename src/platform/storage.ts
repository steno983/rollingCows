import { CONFIG } from '../game/config';

/**
 * Unico punto del progetto in cui vive una API del browser che non sia il
 * rendering o l'input: la persistenza.
 *
 * Prima stava in game/score.ts, cioè dentro il livello delle regole — che per
 * vincolo architetturale non conosce né three né il DOM, ma conosceva
 * localStorage. Non era un dettaglio formale: `saveRecord` era chiamata dentro
 * `hitObstacle`, quindi "il giocatore ha sbattuto" e "scrivi su disco" erano
 * la stessa istruzione, e chi abbandonava la corsa da vivo (Esc a 8000 punti)
 * non salvava niente. Qui la persistenza è un servizio che il livello di
 * piattaforma offre a chi ASCOLTA gli eventi del gioco.
 *
 * Ogni funzione accetta uno `Storage` esplicito (per i test) e altrimenti usa
 * quello ambientale; se non c'è, o se lancia (Safari in navigazione privata,
 * quota esaurita), degrada in silenzio: un record non salvato non deve mai
 * fermare una partita.
 */
function resolveStorage(storage?: Storage): Storage | null {
  if (storage !== undefined) return storage;
  const ambient = (globalThis as { localStorage?: Storage }).localStorage;
  return ambient ?? null;
}

function readRaw(key: string, storage?: Storage): string | null {
  const target = resolveStorage(storage);
  if (target === null) return null;
  try {
    return target.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string, storage?: Storage): boolean {
  const target = resolveStorage(storage);
  if (target === null) return false;
  try {
    target.setItem(key, value);
  } catch {
    return false;
  }
  return true;
}

export function loadRecord(storage?: Storage): number {
  const raw = readRaw(CONFIG.score.recordKey, storage);
  if (raw === null) return 0;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Salva se maggiore del record; restituisce true se è un nuovo record. */
export function saveRecord(points: number, storage?: Storage): boolean {
  if (!Number.isFinite(points)) return false;
  if (points <= loadRecord(storage)) return false;
  return writeRaw(CONFIG.score.recordKey, String(points), storage);
}

/**
 * Record separati per contesto di gioco.
 *
 * Un punteggio è confrontabile solo con punteggi ottenuti alle stesse
 * condizioni: "Vitellino" corre più piano e con gli ostacoli più radi, quindi
 * un suo record cancellerebbe di continuo quello fatto su "Toro" pur valendo
 * molto meno; e la corsa del giorno ha un seed condiviso da tutti, quindi il
 * suo numero significa qualcosa solo confrontato con altre corse dello stesso
 * giorno. Il record generale (sopra) resta quello complessivo della sessione
 * libera, ed è quello che il gioco mostra durante la partita.
 */
function scopedRecordKey(scope: string): string {
  return `${CONFIG.score.profileRecordPrefix}${scope}`;
}

export function loadScopedRecord(scope: string, storage?: Storage): number {
  const raw = readRaw(scopedRecordKey(scope), storage);
  if (raw === null) return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function saveScopedRecord(scope: string, points: number, storage?: Storage): boolean {
  if (!Number.isFinite(points)) return false;
  if (points <= loadScopedRecord(scope, storage)) return false;
  return writeRaw(scopedRecordKey(scope), String(points), storage);
}

export function loadDailyRecord(storage?: Storage): number {
  const raw = readRaw(CONFIG.score.dailyRecordKey, storage);
  if (raw === null) return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function saveDailyRecord(points: number, storage?: Storage): boolean {
  if (!Number.isFinite(points)) return false;
  if (points <= loadDailyRecord(storage)) return false;
  return writeRaw(CONFIG.score.dailyRecordKey, String(points), storage);
}

/**
 * Profilo di difficoltà scelto. Restituisce una stringa non verificata: chi la
 * usa la passa a `resolveDifficultyProfile`, che ricade su "normale" per
 * qualunque valore ignoto — così un valore scritto a mano nel localStorage, o
 * rimasto da una versione futura con più profili, non può impedire l'avvio.
 */
export function loadDifficultyName(storage?: Storage): string | undefined {
  return readRaw(CONFIG.difficultyKey, storage) ?? undefined;
}

export function saveDifficultyName(name: string, storage?: Storage): boolean {
  return writeRaw(CONFIG.difficultyKey, name, storage);
}

/**
 * Distanza dell'ultima corsa e distanza della corsa che detiene il record: due
 * numeri che servono solo alla schermata di fine partita, per dire "+340 m
 * rispetto alla corsa precedente" e "−12 m dal record". È il confronto che dà
 * una ragione per premere RIGIOCA, e sono dati che il gioco già conosce ma
 * buttava via a ogni morte.
 */
export function loadLastDistance(storage?: Storage): number | null {
  const raw = readRaw(CONFIG.score.lastDistanceKey, storage);
  if (raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function saveLastDistance(meters: number, storage?: Storage): boolean {
  if (!Number.isFinite(meters)) return false;
  return writeRaw(CONFIG.score.lastDistanceKey, String(meters), storage);
}

export function loadRecordDistance(storage?: Storage): number | null {
  const raw = readRaw(CONFIG.score.recordDistanceKey, storage);
  if (raw === null) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function saveRecordDistance(meters: number, storage?: Storage): boolean {
  if (!Number.isFinite(meters)) return false;
  return writeRaw(CONFIG.score.recordDistanceKey, String(meters), storage);
}

/**
 * Prompt del tutorial già superati, per nome dell'azione. Si spengono per
 * sempre appena l'azione riesce una volta: un giocatore che sa già saltare non
 * deve rivedere "SALTA" a ogni partita.
 */
export function loadTaughtActions(storage?: Storage): string[] {
  const raw = readRaw(CONFIG.tutorial.storageKey, storage);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

export function saveTaughtActions(actions: readonly string[], storage?: Storage): boolean {
  return writeRaw(CONFIG.tutorial.storageKey, JSON.stringify(actions), storage);
}

/**
 * Missioni già completate, per id. Il modulo game/quests.ts è puro e non sa
 * dove finiscano: espone `completedQuestIds` / `restoreCompleted` e la
 * traversata verso il disco è tutta qui.
 */
export function loadCompletedQuests(storage?: Storage): string[] {
  const raw = readRaw(CONFIG.quests.storageKey, storage);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Il contenuto è dato dell'utente, potenzialmente di una versione
  // precedente del gioco: si tiene solo ciò che è davvero una stringa.
  return parsed.filter((item): item is string => typeof item === 'string');
}

export function saveCompletedQuests(ids: readonly string[], storage?: Storage): boolean {
  return writeRaw(CONFIG.quests.storageKey, JSON.stringify([...ids]), storage);
}
