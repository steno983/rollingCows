/** Ramo del tracciato a cui appartiene un'entità. */
export type Branch = 'main' | 'left' | 'right';

/** Ostacoli a terra: si saltano. */
export type GroundObstacleKind = 'rock' | 'log' | 'fence' | 'crevasse';
/** Ostacoli sospesi: ci si passa sotto scivolando. */
export type OverheadObstacleKind = 'branch' | 'arch' | 'cornice';
export type ObstacleKind = GroundObstacleKind | OverheadObstacleKind;

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
