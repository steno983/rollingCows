/** Ramo del tracciato a cui appartiene un'entità. */
export type Branch = 'main' | 'left' | 'right';

/** Ostacoli a terra: si saltano.
 *
 *  `chasm` è il crepaccio VERO, e non va confuso con `crevasse`: la crepa è
 *  larga 4 unità e uccide per impatto come tutti gli altri, il crepaccio è
 *  largo 7 e uccide per CADUTA (vedi `isUnforgiving` e game.ts, hitObstacle).
 *  Restano due tipi distinti perché sono due letture diverse dello stesso
 *  gesto: la crepa è una delle quattro cose che si saltano, il crepaccio è
 *  l'unico buco del gioco in cui si può sparire. */
export type GroundObstacleKind = 'rock' | 'log' | 'fence' | 'crevasse' | 'chasm';
/** Ostacoli sospesi: ci si passa sotto scivolando. */
export type OverheadObstacleKind = 'branch' | 'arch' | 'cornice';
/**
 * Ostacoli che NON nascono dalla generazione ritmica: li piazza il bivio.
 *
 * Uno solo, per ora: il cartello di scelta nel cuneo fra i due rami. Ha un
 * tipo suo e non sta fra quelli a terra per una ragione operativa, non
 * estetica — gli elenchi esaustivi dello spawner (`satisfies`) sono ciò che
 * garantisce che ogni tipo dichiarato venga prima o poi estratto, e il
 * cartello è esattamente il tipo che NON deve esserlo mai.
 */
export type ForkObstacleKind = 'signpost';
export type ObstacleKind = GroundObstacleKind | OverheadObstacleKind | ForkObstacleKind;

/** Raccoglibili. 'snowflake' è il fiocco; gli altri sono buff. */
export type BuffKind = 'crystal' | 'star' | 'magnet' | 'bell';
export type PickupKind = 'snowflake' | BuffKind;

export type EntityKind = ObstacleKind | PickupKind;

export type Action = 'CHOOSE_LEFT' | 'CHOOSE_RIGHT' | 'JUMP' | 'SLIDE' | 'PAUSE';

/** Un ostacolo o raccoglibile posizionato sul percorso. */
export interface Entity {
  id: number;
  kind: EntityKind;
  category: 'obstacle' | 'pickup';
  /** Ramo di appartenenza. Le entità 'main' sono sempre solide. */
  branch: Branch;
  /** Distanza davanti al giocatore lungo l'asse di scorrimento. Cala nel tempo. */
  z: number;
  /** Quota della base dell'entità (0 = a terra). Gli ostacoli sospesi stanno in alto. */
  y: number;
  alive: boolean;
  /** Vero mentre la calamita sta TRASCINANDO questo fiocco verso la mucca
   *  (vedi game.ts, applyMagnet): la sua z scende più in fretta dello
   *  scorrimento del mondo. Serve alla vista, che può disegnarlo diverso
   *  (scia, rotazione) senza dover indovinare perché quel fiocco corre.
   *
   *  È opzionale, non obbligatorio, per una ragione precisa: le entità
   *  nascono tutte dal letterale in spawner.ts, che è di un altro modulo;
   *  un campo obbligatorio in più lo avrebbe costretto a dichiararlo su ogni
   *  entità del gioco per descrivere una condizione che riguarda solo i
   *  fiocchi, e solo mentre una calamita è accesa. */
  attracted?: boolean;
}

const OVERHEAD_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(['branch', 'arch', 'cornice']);

/** Vero per gli ostacoli sospesi, che richiedono la scivolata. */
export function isOverhead(kind: EntityKind): boolean {
  return OVERHEAD_KINDS.has(kind);
}

/**
 * Le DUE SOLE ECCEZIONI alle reti di sicurezza del gioco.
 *
 * Ogni altro ostacolo può essere assorbito dallo scudo (buffs.ts), perdonato
 * (forgiveness) o sfondato in valanga (avalanche.ts, canSmash). Questi due no,
 * mai, in nessuna condizione:
 *
 * - `chasm`: non è un urto ma una CADUTA. Uno scudo che ti tiene a galla sopra
 *   un buco largo sette metri non si legge come una regola, si legge come un
 *   bug; e una valanga che "sfonda" il vuoto non vuole dire niente. L'unica
 *   risposta al crepaccio è saltarlo, ed è per questo che esiste.
 * - `signpost`: è il cartello del bivio, e il suo intero scopo è rendere
 *   costosa l'indecisione (design §4, regola nuova). Se lo scudo lo assorbisse,
 *   non scegliere tornerebbe a essere gratis ogni volta che si ha uno scudo
 *   addosso — cioè proprio nei momenti in cui si gioca di più.
 *
 * Vive qui, accanto a `isOverhead`, perché è una proprietà del TIPO di
 * ostacolo e non dello stato di gioco: chiunque debba decidere se una rete si
 * applica legge questa funzione invece di riscrivere l'elenco.
 */
const UNFORGIVING_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(['chasm', 'signpost']);

/** Vero per gli ostacoli che nessuna rete di sicurezza può salvare. */
export function isUnforgiving(kind: EntityKind): boolean {
  return UNFORGIVING_KINDS.has(kind);
}
