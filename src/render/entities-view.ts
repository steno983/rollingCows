import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { branchCenterAt, choiceIsOpen, type PathState } from '../game/path';
import type { Entity, EntityKind } from '../game/types';
import { worldToViewX } from './camera-rig';
import { createContactShadowMesh } from './contact-shadow';
import { INSTANCE_CAPACITY } from './instancing';
import {
  buildGeometry,
  MODELS,
  SIGNPOST_GLOWS,
  SIGNPOST_STATES,
  SIGNPOST_VARIANTS,
  type SignpostGlow,
  type SignpostState,
} from './models';

/**
 * I tipi che questa vista sa disegnare. Oggi è `EntityKind` più i due tipi
 * nuovi — il crepaccio e il cartello del bivio — che arrivano in game/types.ts
 * insieme alle meccaniche che li usano: nominarli qui fa compilare il file sia
 * prima sia dopo quel passaggio, e a unione fatta i due letterali si
 * riassorbono senza lasciare traccia.
 */
export type ViewKind = EntityKind | 'chasm' | 'signpost';

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
  /**
   * `prefers-reduced-motion`. Riguarda una cosa sola in questa vista: la
   * pulsazione del cartello quando la scelta è aperta (vedi
   * `signpostGlowFor`). Con la riduzione attiva il cartello non lampeggia e
   * non si gonfia, ma resta ACCESO al gradino più profondo: l'informazione
   * "puoi scegliere adesso" non è un abbellimento e non si toglie, si rende
   * ferma. Stessa firma di scene.setReducedMotion e
   * avalancheFx.setReducedMotion, perché la media query può cambiare a
   * partita in corso e main.ts la ridistribuisce a tutti allo stesso modo.
   */
  setReducedMotion(on: boolean): void;
  group: THREE.Group;
}

/**
 * Un'InstancedMesh per ogni EntityKind di v2. `cabin`, `tree`, `hay` e `cow`
 * NON sono più entità di gioco: restano modelli disponibili in models.ts,
 * questa vista non li istanzia.
 */
const ENTITY_KINDS: readonly ViewKind[] = [
  'rock',
  'log',
  'fence',
  'crevasse',
  'chasm',
  'signpost',
  'branch',
  'arch',
  'cornice',
  'snowflake',
  'crystal',
  'star',
  'magnet',
  'bell',
];

/** Il crepaccio piatto è complanare alla neve: un pelo sopra per non
 *  sfarfallare. */
const CREVASSE_Y_BIAS = 0.02;

/**
 * Il crepaccio VERO va invece AFFONDATO di una cella: il suo strato di fondo
 * è spesso una cella come tutto il resto, e appoggiarlo sulla neve ne farebbe
 * una piattaforma scura sopraelevata invece di un buco. Sprofondandolo, la
 * faccia superiore del fondo combacia col pendio (a meno dello stesso pelo di
 * bias della lastra piatta, che evita lo z-fighting) e sopra la neve resta
 * solo il bordo di ghiaccio. La cella si legge dal modello: se un giorno
 * cambia CHASM_CELL_SCALE, questo la segue.
 */
export const CHASM_Y_BIAS =
  CREVASSE_Y_BIAS - CONFIG.render.voxelSize * (MODELS.chasm.cellScale ?? 1);

/** Scostamento verticale per i tipi che non si appoggiano semplicemente sulla
 *  neve. Assente = 0. */
const Y_BIAS: Readonly<Partial<Record<ViewKind, number>>> = {
  crevasse: CREVASSE_Y_BIAS,
  chasm: CHASM_Y_BIAS,
};

/** Giri al secondo (in radianti) dei raccoglibili. */
const PICKUP_SPIN_RATE = 2.2;

/** Tipi che proiettano ombra: gli ostacoli sì; i raccoglibili — piccoli e
 *  spesso numerosi in fila — no, per risparmiare draw call di shadow map
 *  senza perdita percepibile. Il crepaccio VERO sì, a differenza della lastra
 *  piatta: ha un bordo rialzato, e l'ombra che il bordo getta all'interno è
 *  metà di quello che fa sembrare il buco un buco. */
const CASTS_SHADOW: Record<ViewKind, boolean> = {
  rock: true,
  log: true,
  fence: true,
  crevasse: false,
  chasm: true,
  signpost: true,
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
 * I tipi che ricevono un'ombra di CONTATTO finta, disegnata a terra
 * esattamente sotto di loro: i tre ostacoli sospesi, e solo quelli.
 *
 * Che l'insieme coincida con `isOverhead` non è un caso ed è verificato dai
 * test: l'ombra qui non è rifinitura ma informazione: è il segno che dice "non
 * tocca terra, ci passi sotto". Darla anche agli ostacoli a terra la
 * svuoterebbe di senso — smetterebbe di distinguere alcunché — e su un pendio
 * bianco e piatto quel pallone d'ombra è anche l'unico riferimento che dica a
 * che DISTANZA sia un oggetto che galleggia contro il cielo.
 */
const CONTACT_SHADOW_KINDS: ReadonlySet<ViewKind> = new Set<ViewKind>([
  'branch',
  'arch',
  'cornice',
]);

/**
 * Quanto è più larga l'ombra dell'oggetto che la getta, e la sua misura
 * minima. Un'ombra grande quanto la sagoma sarebbe sbagliata due volte: il
 * gradiente radiale svanisce prima del bordo del quad (il nucleo visibile è
 * poco più di metà), e un'ombra a 1,6 unità dal suolo è per forza più larga e
 * più sfocata dell'oggetto. Il minimo serve al ramo, profondo mezza unità:
 * un'ombra spessa mezza unità sarebbe un trattino, non un contatto.
 */
const CONTACT_SHADOW_SPREAD = 1.4;
const CONTACT_SHADOW_MIN_SIZE = 1.2;

/** Lato dell'ombra per un ingombro `extent` del modello. */
export function contactShadowSize(extent: number): number {
  return Math.max(extent * CONTACT_SHADOW_SPREAD, CONTACT_SHADOW_MIN_SIZE);
}

/** Opacità dell'ombra dei sospesi. Più marcata di quella della scenografia
 *  (CONFIG.render.scenery.contactShadowOpacity, 0.22) perché lì è rifinitura e
 *  qui è un'informazione su cui si decide se scivolare. */
const CONTACT_SHADOW_OPACITY = 0.3;

/**
 * Quale delle tre facce del cartello disegnare (vedi models.ts,
 * SIGNPOST_VARIANTS): nessuna scelta, scelta a sinistra, scelta a destra.
 *
 * Il cartello è l'unico riscontro di "cosa ho scelto" rimasto nel gioco, da
 * quando le frecce dell'interfaccia sono sparite: senza, il giocatore swipa,
 * non vede cambiare niente, riswipa e finisce dalla parte opposta.
 *
 * `path.choice` non si può leggere dall'unione così com'è — la fase 'none' non
 * ha nessuna scelta perché non ha nessun bivio — e discriminare sulla fase è
 * il modo giusto di dirlo, non un giro di parole per accontentare il
 * compilatore. Nelle fasi impegnata e di riallineamento la scelta esiste per
 * costruzione, quindi il cartello che sfila accanto alla mucca continua a
 * mostrarla.
 */
export function signpostStateFor(path: PathState): SignpostState {
  return path.phase === 'none' ? 'none' : (path.choice ?? 'none');
}

/**
 * La rampa della pulsazione: quali gradini di accensione si susseguono, in
 * ordine, mentre la finestra di scelta è aperta.
 *
 * È triangolare e non un lampeggio fra due estremi: il gradino medio compare
 * due volte per ciclo, in salita e in discesa, e il risultato si legge come un
 * respiro invece che come una spia rotta. Non passa MAI da `dormant`, perché
 * il fondo del respiro deve restare distinguibile da spento anche fermando
 * l'immagine su un fotogramma qualunque.
 */
const SIGNPOST_PULSE: readonly SignpostGlow[] = ['lit1', 'lit2', 'lit3', 'lit2'];

/**
 * Durata di un ciclo completo. 1,2 s significa 0,3 s per gradino: abbastanza
 * lento da leggersi come pulsazione e non come sfarfallio, e abbastanza veloce
 * da compiere quasi due cicli interi dentro la finestra di scelta, che dura
 * ~2 s (game/config.ts, path.choiceWindowSeconds). Un ciclo solo non basta:
 * chi guarda la strada un istante dopo l'apertura ne vedrebbe metà.
 */
const SIGNPOST_PULSE_SECONDS = 1.2;

/**
 * Quanto il cartello si "gonfia" in altezza al culmine della pulsazione: +10%
 * su 3,75 unità, cioè 0,37 unità di corsa dell'apice.
 *
 * PERCHÉ SOLO IN ALTEZZA. Il cartello sta in un cuneo largo quanto basta e non
 * un dito di più: SIGNPOST_OFFSET_Z (game/path.ts) è risolto per bisezione
 * esattamente sulla condizione «semicuneo ≥ mezzo cartello + mezza mucca».
 * Allargarlo, anche del 10% e anche solo per un istante, mangerebbe quell'aria
 * e rimetterebbe la tavola sopra la pista — cioè il difetto che quel numero è
 * nato per correggere. In y invece non c'è niente da rubare, e il verso è
 * l'unico sicuro: si cresce, non si accorcia mai sotto la sagoma di collisione
 * (che è la promessa «non c'è quota a cui passarci sotto»).
 *
 * PERCHÉ AGGIUNGERE MOVIMENTO A UN CAMBIO DI COLORE. A 40-70 unità la tavola è
 * alta una decina di pixel: un movimento di 0,37 unità è meno di cinque pixel,
 * quindi da solo non basterebbe. Ma arriva in fase con lo scurirsi del legno —
 * il massimo del gonfiore cade dentro il gradino più profondo — e due segnali
 * concordi si notano molto prima di ciascuno dei due. Costa zero: la matrice
 * dell'istanza viene riscritta ogni frame comunque.
 */
const SIGNPOST_SWELL = 0.1;

/**
 * Quanto il cartello è ACCESO in questo istante: `dormant` quando non c'è
 * niente da decidere, un gradino della rampa quando la scelta è aperta.
 *
 * La sorgente è `choiceIsOpen(path)` e non la fase: la finestra è vera SOLO in
 * avvicinamento e solo prima del punto di non ritorno, quindi il cartello che
 * sfila accanto alla mucca dopo l'impegno smette di pulsare da sé. È giusto
 * così — lì non c'è più niente da scegliere, e un cartello che continuasse a
 * chiamare mentre la decisione è già presa sarebbe una bugia.
 *
 * `time` è il tempo di GIOCO accumulato (vedi la nota su `sync`): in pausa la
 * pulsazione si ferma, come tutto il resto.
 */
export function signpostGlowFor(
  path: PathState,
  time: number,
  reducedMotion: boolean,
): SignpostGlow {
  if (!choiceIsOpen(path)) return 'dormant';
  // Riduzione del movimento: niente rampa, si resta fermi sul gradino più
  // profondo, che è quello con più contrasto contro la neve.
  if (reducedMotion) return 'lit3';
  const step = SIGNPOST_PULSE_SECONDS / SIGNPOST_PULSE.length;
  const slot = Math.floor(time / step) % SIGNPOST_PULSE.length;
  return SIGNPOST_PULSE[slot] ?? 'lit1';
}

/**
 * Fattore di scala in Y del cartello, 1 a riposo (vedi SIGNPOST_SWELL).
 *
 * Continua e non a gradini, al contrario del colore: la matrice si riscrive
 * comunque a ogni frame, quindi qui una sinusoide non costa niente, e il
 * movimento fluido copre lo scatto della rampa dei colori invece di
 * sommarcisi. Il coseno parte da 1, cresce fino a 1 + SIGNPOST_SWELL a metà
 * ciclo — cioè dentro il gradino `lit3` — e torna: gonfiore massimo e legno
 * più scuro cadono insieme.
 */
export function signpostSwell(path: PathState, time: number, reducedMotion: boolean): number {
  if (reducedMotion || !choiceIsOpen(path)) return 1;
  const phase = (2 * Math.PI * time) / SIGNPOST_PULSE_SECONDS;
  return 1 + SIGNPOST_SWELL * (0.5 - 0.5 * Math.cos(phase));
}

/** Aspetto completo del cartello: la scelta E l'accensione, che sono due assi
 *  indipendenti e vanno combinati per pescare il buffer di colori giusto. */
type SignpostLook = `${SignpostState}:${SignpostGlow}`;

function signpostLook(state: SignpostState, glow: SignpostGlow): SignpostLook {
  return `${state}:${glow}`;
}

/** Quota dell'ombra sopra la neve. Il corridoio è piatto a y = 0 (vedi
 *  terrain.heightAt: dentro la zona centrale il pendio è esattamente zero),
 *  quindi non serve campionare nulla; il pelo di stacco è appena sopra quello
 *  della lastra del crepaccio, così un'ombra che gli cade sopra si vede. */
const CONTACT_SHADOW_Y = CREVASSE_Y_BIAS + 0.01;

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
  const meshes = new Map<ViewKind, THREE.InstancedMesh>();
  const dummy = new THREE.Object3D();

  // Contatori riusati fra i frame: un oggetto solo, riazzerato in testa a
  // sync. Serve a smistare le entità per tipo in UNA passata.
  const counters: Record<ViewKind, number> = {
    rock: 0,
    log: 0,
    fence: 0,
    crevasse: 0,
    chasm: 0,
    signpost: 0,
    branch: 0,
    arch: 0,
    cornice: 0,
    snowflake: 0,
    crystal: 0,
    star: 0,
    magnet: 0,
    bell: 0,
  };

  /** Lati (x, z) dell'ombra di contatto per tipo, derivati UNA volta
   *  dall'ingombro del modello: un'ombra uguale sotto un ramo largo due unità
   *  e sotto un arco largo quattro tradirebbe subito il trucco. La scala non è
   *  uniforme apposta — l'impronta di un cornicione non è un disco. */
  const shadowSizes = new Map<ViewKind, THREE.Vector2>();

  /**
   * I colori dei vertici delle dodici facce del cartello: tre scelte × quattro
   * gradini di accensione. Tutte hanno la STESSA geometria (models.ts,
   * SIGNPOST_VARIANTS), quindi accendere una freccia — o accendere il cartello
   * intero — costa lo scambio di un attributo: non una mesh in più, non un
   * materiale in più, non una draw call in più.
   *
   * Lo scambio avviene solo quando la coppia (scelta, accensione) cambia:
   * qualche volta per bivio per la scelta, tre volte al secondo mentre la
   * finestra è aperta per la pulsazione, e mai nel resto della corsa. three
   * tiene in cache i buffer per identità dell'attributo, quindi dopo il primo
   * giro di rampa nessuno dei dodici viene più ricaricato sulla GPU: lo
   * scambio è un cambio di puntatore, non un upload.
   */
  const signpostColors = new Map<SignpostLook, THREE.BufferAttribute>();

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

    if (kind === 'signpost') {
      // La coppia ('none', 'dormant') è già quella con cui il modello è stato
      // costruito: si riusa l'attributo della mesh invece di ricostruirlo.
      for (const state of SIGNPOST_STATES) {
        for (const glow of SIGNPOST_GLOWS) {
          const source =
            state === 'none' && glow === 'dormant'
              ? geometry
              : buildGeometry(SIGNPOST_VARIANTS[state][glow], CONFIG.render.voxelSize);
          const colors = source.getAttribute('color');
          if (colors instanceof THREE.BufferAttribute) {
            signpostColors.set(signpostLook(state, glow), colors);
          }
        }
      }
    }

    if (CONTACT_SHADOW_KINDS.has(kind)) {
      // buildGeometry lascia già il bounding box calcolato.
      const box = geometry.boundingBox;
      const width = box === null ? 1 : box.max.x - box.min.x;
      const depth = box === null ? 1 : box.max.z - box.min.z;
      shadowSizes.set(kind, new THREE.Vector2(contactShadowSize(width), contactShadowSize(depth)));
    }
  }

  // UNA sola InstancedMesh per tutte e tre le famiglie di sospesi, aggiunta in
  // coda alle altre: una draw call in più per l'intero gioco, e la capienza è
  // la somma esatta dei tre tipi, cioè il caso peggiore possibile.
  const shadowCapacity =
    INSTANCE_CAPACITY.branch + INSTANCE_CAPACITY.arch + INSTANCE_CAPACITY.cornice;
  const shadows = createContactShadowMesh(shadowCapacity, CONTACT_SHADOW_OPACITY);
  group.add(shadows);

  /** Tempo di gioco accumulato: vedi la nota su `sync` nell'interfaccia. */
  let time = 0;
  /** Faccia del cartello attualmente montata: scelta più accensione. */
  let signpostLookNow: SignpostLook = signpostLook('none', 'dormant');
  /** Vedi setReducedMotion. Falso finché main.ts non dice il contrario, che è
   *  anche il valore giusto se nessuno lo dicesse mai. */
  let reducedMotion = false;

  function setReducedMotion(on: boolean): void {
    reducedMotion = on;
  }

  function sync(entities: Entity[], path: PathState, dt: number): void {
    time += dt;
    const spin = time * PICKUP_SPIN_RATE;

    for (const kind of ENTITY_KINDS) counters[kind] = 0;
    let shadowCount = 0;

    // Un confronto per frame; il lavoro vero solo quando la scelta o
    // l'accensione cambiano.
    const wantedLook = signpostLook(
      signpostStateFor(path),
      signpostGlowFor(path, time, reducedMotion),
    );
    if (wantedLook !== signpostLookNow) {
      const colors = signpostColors.get(wantedLook);
      const mesh = meshes.get('signpost');
      if (colors !== undefined && mesh !== undefined) {
        mesh.geometry.setAttribute('color', colors);
        signpostLookNow = wantedLook;
      }
    }
    // Una sinusoide per frame, non una per cartello: la pulsazione è dello
    // stato del bivio, non della singola istanza.
    const swell = signpostSwell(path, time, reducedMotion);

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

      const yBias = Y_BIAS[kind] ?? 0;

      let yaw = 0;
      if (entity.category === 'pickup') yaw = spin;
      else if (kind === 'rock') yaw = (entity.id % 4) * (Math.PI / 2);

      const viewX = worldToViewX(entityWorldOffsetX(path, entity));
      dummy.position.set(viewX, entity.y + yBias, entity.z);
      dummy.rotation.set(0, yaw, 0);
      // Solo il cartello si gonfia, e solo mentre la scelta è aperta: per
      // tutto il resto `swell` non viene nemmeno letto.
      if (kind === 'signpost') dummy.scale.set(1, swell, 1);
      else dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(used, dummy.matrix);
      counters[kind] = used + 1;

      // L'ombra di contatto va scritta DOPO la matrice dell'ostacolo, perché
      // riusa lo stesso dummy: è alla stessa (x, z), ma a terra. È quello lo
      // scarto verticale che il giocatore legge come quota.
      const size = shadowSizes.get(kind);
      if (size !== undefined && shadowCount < shadowCapacity) {
        dummy.position.set(viewX, CONTACT_SHADOW_Y, entity.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(size.x, 1, size.y);
        dummy.updateMatrix();
        shadows.setMatrixAt(shadowCount, dummy.matrix);
        shadowCount += 1;
      }
    }

    for (const kind of ENTITY_KINDS) {
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;
      writeCount(mesh, counters[kind]);
    }
    writeCount(shadows, shadowCount);
  }

  function writeCount(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    // Con count 0 three risparmia già la draw call, ma non setProgram né
    // l'invio degli attributi: la mesh va tolta di mezzo del tutto.
    mesh.visible = count > 0;
    if (count === 0) return;
    // Solo i tipi davvero riscritti, e solo la regione scritta: un
    // needsUpdate senza regioni ricarica l'intero attributo di istanza,
    // qualunque sia mesh.count (vedi WebGLAttributes.updateBuffer).
    mesh.instanceMatrix.addUpdateRange(0, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { sync, setReducedMotion, group };
}
