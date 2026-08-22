import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { branchCenterAt, type PathState } from '../game/path';
import type { Entity, EntityKind } from '../game/types';
import { worldToViewX } from './camera-rig';
import { INSTANCE_CAPACITY } from './instancing';
import { buildGeometry, MODELS } from './models';

export interface EntitiesView {
  /**
   * `dt` è il tempo di gioco del frame, non quello da parete: è l'unico
   * ingresso di questa vista che avanza. Prima la rotazione dei raccoglibili
   * usava performance.now(), cioè l'orologio di sistema, e non poteva
   * accorgersi né del rallentatore della morte (pendio, detriti e camera
   * rallentano, i fiocchi continuavano a girare a velocità piena) né della
   * pausa (tutto fermo, i fiocchi giravano lo stesso). Il chiamante passa lo
   * STESSO dt già scalato che dà al resto del gioco, zero in pausa.
   */
  sync(entities: Entity[], path: PathState, dt: number): void;
  group: THREE.Group;
}

/**
 * Un'InstancedMesh per ogni EntityKind di v2. `cabin`, `tree`, `hay` e `cow`
 * NON sono più entità di gioco: restano modelli disponibili in models.ts,
 * questa vista non li istanzia.
 */
const ENTITY_KINDS: readonly EntityKind[] = [
  'rock',
  'log',
  'fence',
  'crevasse',
  'branch',
  'arch',
  'cornice',
  'snowflake',
  'crystal',
  'star',
  'magnet',
  'bell',
];

/** Il crepaccio è complanare alla neve: un pelo sopra per non sfarfallare. */
const CREVASSE_Y_BIAS = 0.02;

/** Giri al secondo (in radianti) dei raccoglibili. */
const PICKUP_SPIN_RATE = 2.2;

/** Tipi che proiettano ombra: gli ostacoli sì; i raccoglibili — piccoli e
 *  spesso numerosi in fila — no, per risparmiare draw call di shadow map
 *  senza perdita percepibile. */
const CASTS_SHADOW: Record<EntityKind, boolean> = {
  rock: true,
  log: true,
  fence: true,
  crevasse: false,
  branch: true,
  arch: true,
  cornice: true,
  snowflake: false,
  crystal: false,
  star: false,
  magnet: false,
  bell: false,
};

/**
 * Scostamento laterale di MONDO (non ancora convertito in coordinate vista)
 * a cui va disegnata un'entità: è il centro del pezzo di strada su cui
 * l'entità sta, alla SUA distanza — la stessa funzione che posiziona il nastro
 * sotto di lei (game/path.ts, branchCenterAt). La conversione in X di schermo
 * resta a worldToViewX, chiamata solo in sync.
 *
 * Che sia la stessa funzione non è una comodità: un'entità disegnata con una
 * formula diversa da quella del nastro galleggia di lato rispetto alla strada
 * su cui è appoggiata, ed è ciò che accadeva quando qui si sommava un offset
 * unico per tutte le z mentre l'apertura del nastro dipendeva da z. Oggi un
 * ostacolo del ramo scelto arriva addosso alla mucca disegnato a x = 0 esatto,
 * il che chiude anche la classe di morti «l'ostacolo mi ha ucciso mentre stava
 * di lato» (vedi path.branchClearanceAfterFork, nata per arginarla).
 *
 * `z` è opzionale e vale 0 — la quota della mucca — perché chi chiede questo
 * scostamento per un EVENTO (l'esplosione di cubetti su un impatto, in
 * main.ts) parla per definizione di qualcosa che sta succedendo lì.
 */
export function entityWorldOffsetX(
  path: PathState,
  entity: Pick<Entity, 'branch'> & Partial<Pick<Entity, 'z'>>,
): number {
  return branchCenterAt(path, entity.branch, entity.z ?? 0);
}

export function createEntitiesView(): EntitiesView {
  const group = new THREE.Group();
  // Un solo materiale per tutte le entità: i colori arrivano dai vertici,
  // quindi non c'è alcun motivo di cambiare stato fra un tipo e l'altro.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = new Map<EntityKind, THREE.InstancedMesh>();
  const dummy = new THREE.Object3D();

  // Contatori riusati fra i frame: un oggetto solo, riazzerato in testa a
  // sync. Serve a smistare le entità per tipo in UNA passata.
  const counters: Record<EntityKind, number> = {
    rock: 0,
    log: 0,
    fence: 0,
    crevasse: 0,
    branch: 0,
    arch: 0,
    cornice: 0,
    snowflake: 0,
    crystal: 0,
    star: 0,
    magnet: 0,
    bell: 0,
  };

  for (const kind of ENTITY_KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    const mesh = new THREE.InstancedMesh(geometry, material, INSTANCE_CAPACITY[kind]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Il bounding volume di un InstancedMesh non segue le istanze: senza
    // questo, gli ostacoli sparirebbero appena la geometria base esce dal frustum.
    mesh.frustumCulled = false;
    mesh.castShadow = CASTS_SHADOW[kind];
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.visible = false;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  /** Tempo di gioco accumulato: vedi la nota su `sync` nell'interfaccia. */
  let time = 0;

  function sync(entities: Entity[], path: PathState, dt: number): void {
    time += dt;
    const spin = time * PICKUP_SPIN_RATE;

    for (const kind of ENTITY_KINDS) counters[kind] = 0;

    // UNA sola passata sull'array. Prima ce n'erano due per ciascuno dei
    // dodici tipi (un pre-conteggio con instanceCountFor più la scrittura),
    // cioè 12 × 2 × N iterazioni: con un picco misurato di ~130 entità vive
    // sono ~3100 iterazioni per frame, metà delle quali servivano solo a
    // ricavare un tetto che è già una costante (vedi instancing.ts).
    for (let e = 0; e < entities.length; e += 1) {
      const entity = entities[e];
      // Le entità di un ramo non (ancora) attivo si disegnano comunque: è
      // il senso del bivio, mostrare cosa contiene ciascun ramo prima
      // della scelta. Il filtro per solidità (branchIsSolid) appartiene
      // alle collisioni/raccolta, non a questa vista.
      if (entity === undefined || !entity.alive) continue;

      const kind = entity.kind;
      const used = counters[kind];
      // Le eccedenti vengono ignorate dalla vista, non muoiono nel gioco.
      if (used >= INSTANCE_CAPACITY[kind]) continue;
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;

      const yBias = kind === 'crevasse' ? CREVASSE_Y_BIAS : 0;

      let yaw = 0;
      if (entity.category === 'pickup') yaw = spin;
      else if (kind === 'rock') yaw = (entity.id % 4) * (Math.PI / 2);

      dummy.position.set(
        worldToViewX(entityWorldOffsetX(path, entity)),
        entity.y + yBias,
        entity.z,
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(used, dummy.matrix);
      counters[kind] = used + 1;
    }

    for (const kind of ENTITY_KINDS) {
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;
      const count = counters[kind];
      mesh.count = count;
      // Con count 0 three risparmia già la draw call, ma non setProgram né
      // l'invio degli attributi: la mesh va tolta di mezzo del tutto.
      mesh.visible = count > 0;
      if (count === 0) continue;
      // Solo i tipi davvero riscritti, e solo la regione scritta: un
      // needsUpdate senza regioni ricarica l'intero attributo di istanza,
      // qualunque sia mesh.count (vedi WebGLAttributes.updateBuffer).
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { sync, group };
}
