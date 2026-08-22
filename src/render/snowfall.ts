import * as THREE from 'three';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import { speedRatio } from './camera-rig';

/**
 * FIRMA PUBBLICA DEL MODULO (main.ts si cabla su questa):
 *
 *   createSnowfall(): SnowfallView
 *
 *   view.group: THREE.Group
 *     Da aggiungere alla SCENA (non al gruppo-mondo: la neve non deve ruotare
 *     con il pendio durante un bivio, cade verticale comunque vada la pista).
 *     Contiene un solo oggetto disegnabile: UNA draw call, sempre.
 *   view.update(dt, worldSpeed, cameraX, cameraZ): void
 *     Da chiamare ogni frame. Scrive tre float (i tre uniform) e la posizione
 *     del gruppo: nessuna allocazione, nessun buffer riscritto.
 *     cameraX/cameraZ: passare `scene.rigPosition` (la posizione SENZA shake),
 *     come fa backdrop.sync — se il volume seguisse la camera tremante, la
 *     neve tremerebbe in blocco insieme a lei.
 *   view.setIntensity(scale): void
 *     scale in [0,1]: frazione di fiocchi effettivamente disegnati. Serve al
 *     monitor delle prestazioni (perf-monitor.ts) per alleggerire l'effetto
 *     senza spegnerlo.
 *   view.dispose(): void
 */

/** Seed fisso della distribuzione dei fiocchi: come per lo shake in scene.ts,
 *  l'unica sorgente di casualità della vista passa dall'Rng con seed della
 *  codebase e non da Math.random. Non è l'Rng di gioco: la decorazione non
 *  deve consumarne la sequenza. Il seed è costante, quindi la nevicata è la
 *  stessa a ogni partita — cosa che nessuno può notare (i fiocchi sono
 *  indistinguibili) ma che rende il modulo testabile. */
const SNOWFALL_SEED = 0xf10cc0;

const TAU = Math.PI * 2;

/** Ondeggio laterale: ampiezza in unità di mondo e frequenza in rad/s. Senza,
 *  i fiocchi scendono su binari verticali perfetti e si leggono come pioggia.
 *  L'ampiezza è deliberatamente piccola: a 0.35 unità il movimento si nota
 *  solo sui fiocchi vicini, che sono gli unici abbastanza grandi da mostrarlo. */
const SWAY_AMPLITUDE = 0.35;
const SWAY_RATE = 1.6;

/** Di quanto il volume è spostato IN AVANTI rispetto alla camera, in frazione
 *  di areaDepth. Centrarlo esattamente sulla camera sprecherebbe metà dei
 *  fiocchi dietro l'osservatore, dove non li vede nessuno ma la GPU li
 *  trasforma comunque. Lo spostamento resta piccolo perché una parte del
 *  volume deve restare dietro: sono i fiocchi che sfrecciano ai lati dello
 *  schermo, cioè quelli che danno davvero il senso della velocità. */
const FORWARD_BIAS = 0.3;

/** Variazione di taglia per fiocco. La sola sizeAttenuation dà profondità solo
 *  in funzione della distanza: variando anche la taglia base si ottengono
 *  fiocchi grossi vicini e polvere fine, come in una nevicata vera. */
const MIN_SIZE_SCALE = 0.6;
const MAX_SIZE_SCALE = 1.5;

/** Bianco appena azzurrato, come la nebbia (FOG_COLOR in scene.ts): un bianco
 *  puro su cielo chiaro sparisce, uno leggermente freddo si stacca. */
const SNOW_COLOR = 0xf4fbff;
const SNOW_OPACITY = 0.85;

const SNOW_VERTEX_DECLARATIONS = /* glsl */ `
attribute vec2 aFlake;
uniform float uFallen;
uniform float uSwayTime;
uniform float uTilt;

const float SNOW_HEIGHT = ${CONFIG.render.snowfall.areaHeight.toFixed(3)};
const float SNOW_SWAY = ${SWAY_AMPLITUDE.toFixed(3)};
`;

const SNOW_VERTEX_DISPLACEMENT = /* glsl */ `
  // La caduta vive TUTTA qui. JavaScript scrive un solo float (uFallen) e il
  // buffer delle posizioni non viene più toccato dopo la creazione: nessun
  // upload per frame, nessuna allocazione, nessun ciclo su 480 elementi.
  // mod() riporta in cima il fiocco che esce dal fondo; position.y (la quota
  // iniziale, casuale) fa da sfasamento, senza il quale tutti i fiocchi
  // cadrebbero allineati sullo stesso piano orizzontale.
  float snowY = mod(transformed.y - uFallen, SNOW_HEIGHT);
  // 0 appena nato in cima, 1 un istante prima di sparire in fondo.
  float snowFallen = 1.0 - snowY / SNOW_HEIGHT;
  transformed.y = snowY;
  transformed.x += sin(uSwayTime + aFlake.y) * SNOW_SWAY;
  // Inclinazione da velocità: lo spostamento cresce con la quota già persa,
  // quindi la traiettoria è una retta obliqua e non una traslazione rigida di
  // tutto il volume. Verso -z, che è il verso in cui scorre il mondo.
  transformed.z -= snowFallen * SNOW_HEIGHT * uTilt;
`;

const SNOW_FRAGMENT_MASK = /* glsl */ `
  // Fiocco tondo e sfumato ricavato da gl_PointCoord: un punto quadrato si
  // legge come un pixel morto sullo schermo, e una texture costerebbe un
  // asset da caricare e un campionamento per frammento per ottenere
  // esattamente la stessa cosa. Lo smoothstep NON è invertito (edge0 < edge1)
  // perché con edge0 >= edge1 il risultato è indefinito da specifica GLSL.
  float snowDist = length(gl_PointCoord - vec2(0.5));
  diffuseColor.a *= 1.0 - smoothstep(0.18, 0.5, snowDist);
  // Scartare l'anello completamente trasparente costa meno che mandarlo al
  // blending: questi punti non scrivono depth, quindi il discard non fa
  // perdere nessun early-z.
  if (diffuseColor.a < 0.02) discard;
`;

/**
 * Sostituzione singola con marcatore obbligatorio. Innestarsi sullo shader di
 * three per stringa è fragile per definizione: se un aggiornamento della
 * libreria rinomina un include, senza questo controllo la neve smetterebbe
 * semplicemente di cadere, in silenzio e solo a runtime. Così invece salta
 * subito, e il test lo verifica contro il sorgente vero di three.
 * Il rimpiazzo è passato come funzione perché `String.replace` interpreta le
 * sequenze `$&`/`$1` in una stringa letterale.
 */
function replaceOnce(source: string, marker: string, replacement: string): string {
  if (!source.includes(marker)) {
    throw new Error(`snowfall: marcatore "${marker}" assente dallo shader di three`);
  }
  return source.replace(marker, () => replacement);
}

/** Innesta la caduta nel vertex shader dei Points di three. Esportata per
 *  poterla verificare nel test senza costruire un WebGLRenderer. */
export function injectSnowVertex(source: string): string {
  let out = replaceOnce(
    source,
    '#include <common>',
    `${SNOW_VERTEX_DECLARATIONS}\n#include <common>`,
  );
  out = replaceOnce(
    out,
    '#include <begin_vertex>',
    `#include <begin_vertex>\n${SNOW_VERTEX_DISPLACEMENT}`,
  );
  // Taglia per fiocco: `size` è un uniform scalare, la varietà arriva da qui.
  // La moltiplicazione va PRIMA della sizeAttenuation di three, che divide per
  // la profondità: così la variazione resta proporzionale anche in lontananza.
  return replaceOnce(out, 'gl_PointSize = size;', 'gl_PointSize = size * aFlake.x;');
}

/** Innesta la maschera tonda nel fragment shader dei Points di three. */
export function injectSnowFragment(source: string): string {
  return replaceOnce(
    source,
    '#include <color_fragment>',
    `#include <color_fragment>\n${SNOW_FRAGMENT_MASK}`,
  );
}

/** Gli UNICI dati che update() scrive. Esposti per rendere il contratto
 *  "zero aggiornamenti di buffer" verificabile dall'esterno. */
export interface SnowfallUniforms {
  /** Distanza di caduta accumulata, avvolta su areaHeight. */
  uFallen: { value: number };
  /** Fase dell'ondeggio, avvolta su 2π. */
  uSwayTime: { value: number };
  /** Spostamento in -z per unità di caduta: l'inclinazione da velocità. */
  uTilt: { value: number };
}

export interface SnowfallView {
  group: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  uniforms: SnowfallUniforms;
  update(dt: number, worldSpeed: number, cameraX: number, cameraZ: number): void;
  setIntensity(scale: number): void;
  dispose(): void;
}

export function createSnowfall(): SnowfallView {
  const cfg = CONFIG.render.snowfall;
  const rng = createRng(SNOWFALL_SEED);

  // Due attributi, scritti una volta sola e mai più: la posizione iniziale nel
  // volume e, per fiocco, taglia e fase dell'ondeggio.
  const positions = new Float32Array(cfg.count * 3);
  const flakes = new Float32Array(cfg.count * 2);
  for (let i = 0; i < cfg.count; i += 1) {
    positions[i * 3] = (rng.next() - 0.5) * cfg.areaWidth;
    positions[i * 3 + 1] = rng.next() * cfg.areaHeight;
    positions[i * 3 + 2] = (rng.next() - 0.5 + FORWARD_BIAS) * cfg.areaDepth;
    flakes[i * 2] = MIN_SIZE_SCALE + rng.next() * (MAX_SIZE_SCALE - MIN_SIZE_SCALE);
    flakes[i * 2 + 1] = rng.next() * TAU;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aFlake', new THREE.BufferAttribute(flakes, 2));
  geometry.setDrawRange(0, cfg.count);

  const uniforms = {
    uFallen: { value: 0 },
    uSwayTime: { value: 0 },
    uTilt: { value: 0 },
  };

  // PointsMaterial + onBeforeCompile invece di uno ShaderMaterial scritto da
  // zero: la size attenuation di three ha bisogno dell'uniform `scale`, che il
  // renderer aggiorna da sé SOLO per i PointsMaterial. Con uno ShaderMaterial
  // dovremmo ricalcolarla noi a ogni resize e a ogni cambio di FOV — e qui il
  // FOV cambia di continuo, sia con la velocità sia in valanga.
  const material = new THREE.PointsMaterial({
    color: SNOW_COLOR,
    size: cfg.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: SNOW_OPACITY,
    // Niente scrittura di profondità: centinaia di punti trasparenti che si
    // sovrappongono non devono occludersi a vicenda né tagliare la scena.
    depthWrite: false,
    // Nebbia disattivata: la nevicata è alta 16 unità e profonda 44, cioè vive
    // tutta ben prima di fogNear (95). Sbiancarla non aggiungerebbe nulla e la
    // toglierebbe dalla lettura della velocità, che è il suo unico compito.
    fog: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectSnowVertex(shader.vertexShader);
    shader.fragmentShader = injectSnowFragment(shader.fragmentShader);
    // Gli oggetti uniform sono gli STESSI di `uniforms`: da qui in poi
    // aggiornarne il campo `value` basta a far muovere la neve.
    Object.assign(shader.uniforms, uniforms);
  };

  const points = new THREE.Points(geometry, material);
  // Stesso motivo di scenery/terrain, più uno: il volume di bounding viene
  // calcolato dalle posizioni a riposo e ignora lo spostamento fatto nel
  // vertex shader. In ogni caso il volume avvolge la camera, quindi è sempre
  // inquadrato: il test di frustum sarebbe solo lavoro sprecato.
  points.frustumCulled = false;
  points.castShadow = false;
  points.receiveShadow = false;

  const group = new THREE.Group();
  group.add(points);

  function update(dt: number, worldSpeed: number, cameraX: number, cameraZ: number): void {
    const ratio = speedRatio(worldSpeed);

    // A velocità di partenza la neve scende piano e dritta; a 40 u/s cade più
    // in fretta e si inclina, che è il secondo indizio di velocità (il primo è
    // il FOV) — l'unico però che si vede anche in un fotogramma fermo.
    const fallSpeed = cfg.fallSpeed * (1 + cfg.speedInfluence * ratio);

    // Avvolgere l'accumulatore invece di lasciar crescere un tempo assoluto:
    // mod() nello shader ha periodo areaHeight, quindi l'avvolgimento è esatto
    // e la caduta non ha nessuno scatto. Senza, dopo qualche minuto di
    // partita un float32 perderebbe risoluzione proprio sulla cifra che
    // decide la posizione del fiocco.
    let fallen = (uniforms.uFallen.value + fallSpeed * dt) % cfg.areaHeight;
    if (fallen < 0) fallen += cfg.areaHeight;
    uniforms.uFallen.value = fallen;

    // Stessa logica per la fase dell'ondeggio, periodica di 2π.
    let sway = (uniforms.uSwayTime.value + SWAY_RATE * dt) % TAU;
    if (sway < 0) sway += TAU;
    uniforms.uSwayTime.value = sway;

    uniforms.uTilt.value = cfg.speedInfluence * ratio;

    // Il volume segue la camera sul piano orizzontale e mai in altezza: così
    // non si esaurisce mai da nessuna parte e non c'è niente da rigenerare,
    // mentre la neve resta ancorata al terreno invece di salire con la camera.
    group.position.set(cameraX, 0, cameraZ);
  }

  function setIntensity(scale: number): void {
    const clamped = scale < 0 ? 0 : scale > 1 ? 1 : scale;
    const drawn = Math.round(cfg.count * clamped);
    // setDrawRange non tocca né la geometria né la GPU: cambia solo quanti
    // vertici verranno chiesti al prossimo draw. Ricostruire la geometria
    // costerebbe un'allocazione e un upload di 2400 float proprio nel frame
    // peggiore possibile, quello in cui il monitor ha appena stabilito che il
    // dispositivo non sta al passo.
    geometry.setDrawRange(0, drawn);
    points.visible = drawn > 0;
  }

  function dispose(): void {
    geometry.dispose();
    material.dispose();
  }

  return { group, points, uniforms, update, setIntensity, dispose };
}
