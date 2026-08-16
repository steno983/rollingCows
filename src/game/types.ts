export type Lane = 0 | 1 | 2;

export type ObstacleKind = 'rock' | 'tree' | 'fence' | 'cabin' | 'crevasse' | 'branch';
export type PickupKind = 'snowflake' | 'hay' | 'cow';
export type EntityKind = ObstacleKind | PickupKind;

export type Action = 'MOVE_LEFT' | 'MOVE_RIGHT' | 'JUMP' | 'SLAM' | 'PAUSE';

/** Un ostacolo o raccoglibile posizionato sul pendio. */
export interface Entity {
  id: number;
  kind: EntityKind;
  category: 'obstacle' | 'pickup';
  /** Corsia occupata. Per entità larghe 2, è la corsia più a sinistra. */
  lane: Lane;
  /** Corsie occupate. Solo 'cabin' usa 2. */
  width: 1 | 2;
  /** Distanza davanti al giocatore lungo l'asse di scorrimento. Cala nel tempo. */
  z: number;
  /** Quota della base dell'entità (0 = a terra). 'branch' è sospeso. */
  y: number;
  alive: boolean;
}
