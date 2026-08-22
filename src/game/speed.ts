import { CONFIG } from './config';

/** Nome di un profilo di difficoltà, derivato da config: aggiungerne uno lì lo
 *  rende automaticamente un valore legale qui. */
export type DifficultyName = keyof typeof CONFIG.difficultyProfiles;

/**
 * I tre soli numeri che un profilo di difficoltà scala, più la sua identità.
 *
 * Esiste perché con la spaziatura normale una bambina piccola arriva a una
 * decina di secondi ogni volta, e il gioco nasce dall'idea di una bambina.
 * Il profilo NON è una variante del gioco: è la stessa curva di velocità e la
 * stessa generazione, letta con tre costanti diverse. Per questo viaggia come
 * un valore passato in giro (dallo stato di gioco a `speedAt` e allo spawner)
 * invece di essere una lettura diretta di CONFIG sparsa nei moduli: il giorno
 * in cui la difficoltà cambia a metà corsa, o due stati di gioco convivono,
 * non c'è nulla da riscrivere.
 *
 * `name` serve al punteggio: ogni profilo ha il proprio record, altrimenti
 * "Vitellino" cancellerebbe di continuo quello fatto su "Toro"
 * (CONFIG.score.profileRecordPrefix).
 */
export interface DifficultyProfile {
  readonly name: DifficultyName;
  readonly label: string;
  readonly startSpeed: number;
  readonly maxSpeed: number;
  readonly minObstacleGap: number;
}

/** Elenco esaustivo dei profili. Record chiave→chiave invece di un array di
 *  stringhe: l'array perderebbe la verifica di copertura (il compilatore
 *  controllerebbe solo che ogni voce sia un nome legale, non che ci siano
 *  TUTTI), mentre questo mapped type rompe la compilazione se domani un
 *  profilo nuovo in config non viene elencato anche qui. `Object.values`
 *  conserva il tipo delle chiavi, quindi non serve alcun cast. */
const DIFFICULTY_NAMES: readonly DifficultyName[] = Object.values({
  calf: 'calf',
  normal: 'normal',
  bull: 'bull',
} satisfies { [K in DifficultyName]: K });

/** Profili già costruiti una volta sola: `resolveDifficultyProfile` è chiamata
 *  a ogni avvio di corsa e non deve allocare un oggetto nuovo ogni volta. */
const PROFILES: Readonly<Record<DifficultyName, DifficultyProfile>> = {
  calf: { name: 'calf', ...CONFIG.difficultyProfiles.calf },
  normal: { name: 'normal', ...CONFIG.difficultyProfiles.normal },
  bull: { name: 'bull', ...CONFIG.difficultyProfiles.bull },
};

/** Il profilo con cui si gioca se nessuno ne sceglie uno. I suoi tre numeri
 *  coincidono con CONFIG.world.startSpeed/maxSpeed e CONFIG.spawn.minObstacleGap:
 *  è la taratura di riferimento del gioco, non una quarta variante. */
export const DEFAULT_DIFFICULTY_PROFILE: DifficultyProfile = PROFILES.normal;

/**
 * Risolve un nome (tipicamente letto da localStorage o da un pulsante di
 * interfaccia, quindi `string` non verificata) nel profilo corrispondente,
 * ricadendo sul profilo normale per qualunque valore sconosciuto o assente.
 * Il confronto passa per l'elenco esaustivo, così il restringimento di tipo lo
 * fa il compilatore e non serve né un type guard né un cast.
 */
export function resolveDifficultyProfile(name: string | undefined): DifficultyProfile {
  for (const candidate of DIFFICULTY_NAMES) {
    if (candidate === name) return PROFILES[candidate];
  }
  return DEFAULT_DIFFICULTY_PROFILE;
}

/** Velocità di scorrimento del mondo alla distanza data (u/s). La forma della
 *  curva (crescita logaritmica) è del gioco, non del profilo: il profilo ne
 *  sposta solo il punto di partenza e il tetto. */
export function speedAt(
  distance: number,
  profile: DifficultyProfile = DEFAULT_DIFFICULTY_PROFILE,
): number {
  const { speedGrowth, speedRefDistance } = CONFIG.world;
  const grown =
    profile.startSpeed + speedGrowth * Math.log1p(Math.max(0, distance) / speedRefDistance);
  return Math.min(profile.maxSpeed, grown);
}

/** Difficoltà normalizzata in [0,1] alla distanza data. */
export function difficultyAt(distance: number): number {
  const ratio = distance / CONFIG.spawn.difficultyRampDistance;
  if (ratio <= 0) return 0;
  return Math.min(1, ratio);
}

/**
 * Secondo asse di difficoltà, normalizzato in [0,1]: vale 0 fino a
 * `spawn.lateRampStart` e sale a 1 su `spawn.lateRampDistance`.
 *
 * Serve perché la velocità massima si raggiunge a 169 secondi e la rampa di
 * densità finisce poco dopo: da lì in poi il gioco restava identico a se
 * stesso per sempre, e un endless runner vive sulla promessa contraria.
 * Alzare ancora la velocità non è un'opzione (a 40 u/s il margine di reazione
 * è già al limite), quindi ciò che cresce oltre questa soglia è la QUOTA di
 * ostacoli sospesi e la frequenza delle coppie strette (vedi spawner.ts).
 */
export function lateRampAt(distance: number): number {
  const { lateRampStart, lateRampDistance } = CONFIG.spawn;
  const ratio = (distance - lateRampStart) / lateRampDistance;
  if (ratio <= 0) return 0;
  return Math.min(1, ratio);
}
