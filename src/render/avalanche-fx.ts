import * as THREE from 'three';
import { CONFIG } from '../game/config';

/**
 * FIRMA PUBBLICA DEL MODULO (main.ts si cabla su questa):
 *
 *   createAvalancheFx(): AvalancheFxView
 *
 *   view.object: THREE.Mesh
 *     Quad a schermo intero, UNA draw call, invisibile fuori dalla valanga.
 *     Va aggiunto alla SCENA (vedi la nota su renderOrder più sotto).
 *   view.update(dt, intensity): void
 *     Da chiamare ogni frame, anche quando la valanga non c'è: è update() a
 *     far scendere la rampa e a spegnere il quad. `intensity` in [0,1], di
 *     norma la taglia della mucca normalizzata su avalanche.maxSize.
 *   view.setReducedMotion(on): void
 *   view.dispose(): void
 *
 * PERCHÉ NON EffectComposer. Un post-process "vero" per queste strisce
 * costerebbe due render target a piena risoluzione più una catena di passaggi
 * a schermo pieno (copia, effetto, ricopia), e su GPU mobile il collo di
 * bottiglia è esattamente il fill rate — lo stesso motivo per cui il degrado
 * di qualità in scene.ts abbassa il pixel ratio. Qui l'effetto è puramente
 * additivo e non ha bisogno di leggere il colore già disegnato: un quad con
 * un fragment shader procedurale dà lo stesso risultato in una sola draw call,
 * senza un solo byte di memoria video in più.
 *
 * PERCHÉ IL QUAD È DISEGNATO IN CLIP SPACE. Il vertex shader scrive
 * direttamente `gl_Position = vec4(position.xy, 0, 1)` e non tocca né
 * modelViewMatrix né projectionMatrix. L'alternativa (un piano a distanza
 * fissa davanti alla camera, riscalato da FOV e aspect) andrebbe ricalcolata a
 * ogni frame, perché in questo gioco il FOV cambia sia con la velocità sia con
 * la valanga (camera-rig.ts, cameraFovFor) e non ha un valore a riposo: un
 * solo frame di ritardo fra FOV e riscalatura lascerebbe scoperti i bordi
 * dello schermo. In clip space la copertura è esatta per costruzione, a
 * qualunque aspect e a qualunque FOV, senza una riga di codice per frame.
 * Conseguenza: l'oggetto è indifferente al proprio genitore (le sue matrici
 * non vengono usate). Va agganciato alla scena e non alla camera perché in
 * questo progetto la camera NON è nel grafo di scena, quindi i suoi figli non
 * verrebbero mai disegnati.
 */

/** Tempo (s) per andare da spento a piena intensità e viceversa. La salita è
 *  più rapida della discesa: la valanga inizia di colpo — c'è lo scuotimento e
 *  lo strappo di FOV — mentre la fine è un rientro, e strisce che si spengono
 *  di scatto si notano più di quanto non facciano quando compaiono. */
const RAMP_UP_SECONDS = 0.35;
const RAMP_DOWN_SECONDS = 0.8;

/** Sotto questo raggio (in unità di NDC, cioè metà schermo = 1) non si disegna
 *  nulla: al centro c'è la mucca ed è lì che si guarda per schivare. */
const CENTER_CLEAR = 0.28;

/** Bianco caldo, coerente con il sole ambrato della valanga
 *  (SUN_AVALANCHE_COLOR in scene.ts). */
const LINE_COLOR = 0xfff0d8;

/** Disegnato per ultimo, sopra qualunque cosa trasparente della scena. Il
 *  cielo sta a -1, tutto il resto è a 0. */
const RENDER_ORDER = 900;

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vNdc;

  void main() {
    // Il quad è una PlaneGeometry(2, 2): le sue x,y sono GIÀ le coordinate
    // normalizzate dello schermo. Nessuna matrice, quindi nessuna dipendenza
    // da FOV, aspect, near/far o posizione della camera (vedi il commento in
    // testa al modulo). z = 0 perché deve solo cadere dentro [-1, 1]: il
    // materiale non fa né test né scrittura di profondità.
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vNdc;

  const float TAU = 6.283185307;
  const float LINE_COUNT = ${CONFIG.render.avalancheFx.speedLineCount.toFixed(1)};
  const float LINE_SPEED = ${CONFIG.render.avalancheFx.speedLineSpeed.toFixed(3)};
  const float CENTER_CLEAR = ${CENTER_CLEAR.toFixed(3)};

  /** Valore stabile in [0,1) per indice di striscia. Deterministico e senza
   *  stato: è lo stesso identico idioma del dither della cupola del cielo
   *  (scene.ts), e non ha bisogno del PRNG con seed della codebase perché non
   *  genera contenuto di gioco — restituisce sempre lo stesso numero per la
   *  stessa striscia, su qualunque macchina e a qualunque frame. */
  float stripeHash(float id) {
    return fract(sin(id * 127.1 + 311.7) * 43758.5453);
  }

  void main() {
    float radius = length(vNdc);
    // atan sulle NDC non corrette per l'aspect: le strisce restano radiali
    // rispetto al centro dello schermo a qualunque proporzione, ed è
    // esattamente ciò che serve. Correggere l'aspect distribuirebbe le
    // strisce uniformemente sull'angolo reale, addensandole sui bordi corti.
    float angle = atan(vNdc.y, vNdc.x) / TAU + 0.5;
    float n = angle * LINE_COUNT;
    // mod() sull'indice: senza, la striscia a cavallo della cucitura angolare
    // (angle che passa da 1 a 0) avrebbe due identità diverse ai suoi due
    // lati, e si vedrebbe una sola striscia sbagliata, sempre nello stesso
    // punto dello schermo.
    float id = mod(floor(n), LINE_COUNT);
    float rnd = stripeHash(id);

    // Larghezza angolare diversa per striscia: una raggiera regolare si legge
    // come un mirino, non come velocità. Gli smoothstep hanno sempre
    // edge0 < edge1 perché con edge0 >= edge1 la specifica GLSL non
    // garantisce nulla.
    float halfWidth = mix(0.06, 0.34, rnd);
    float stripe = 1.0 - smoothstep(0.0, halfWidth, abs(fract(n) - 0.5));

    // Testa che corre verso l'esterno: è il movimento lungo il raggio, non le
    // strisce in sé, a dare la sensazione di stare precipitando in avanti.
    float flow = fract(radius * 0.9 - uTime * LINE_SPEED * (0.55 + rnd));
    float head = smoothstep(0.0, 0.45, flow) * (1.0 - smoothstep(0.55, 1.0, flow));

    float alpha = stripe * head * smoothstep(CENTER_CLEAR, 1.0, radius) * uIntensity;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Gli UNICI dati che update() scrive: due float. */
export interface AvalancheFxUniforms {
  /** Secondi dall'accensione dell'effetto. Azzerato ogni volta che il quad
   *  torna invisibile, quindi non supera mai la durata di una valanga: nessun
   *  problema di precisione float e nessun bisogno di avvolgerlo. */
  uTime: { value: number };
  /** Opacità di picco delle strisce, già moltiplicata per speedLineIntensity. */
  uIntensity: { value: number };
  uColor: { value: THREE.Color };
}

export interface AvalancheFxView {
  object: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  uniforms: AvalancheFxUniforms;
  update(dt: number, intensity: number): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

export function createAvalancheFx(): AvalancheFxView {
  const cfg = CONFIG.render.avalancheFx;

  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uColor: { value: new THREE.Color(LINE_COLOR) },
  };

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    // Additivo: le strisce SCHIARISCONO ciò che c'è sotto invece di coprirlo,
    // quindi non nascondono mai un ostacolo — cosa inaccettabile in una fase
    // in cui si continua a schivare.
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });

  const object = new THREE.Mesh(geometry, material);
  object.renderOrder = RENDER_ORDER;
  // Obbligatorio: il volume di bounding del quad vive nell'origine della
  // scena, mentre il vertex shader lo disegna a schermo intero ignorando ogni
  // matrice. Con il culling attivo sparirebbe non appena la camera si
  // allontana dall'origine, cioè quasi sempre.
  object.frustumCulled = false;
  // Fuori dalla valanga non paga nulla: né draw call né frammenti.
  object.visible = false;

  /** Intensità corrente in [0,1], PRIMA di speedLineIntensity. Vive qui e non
   *  nell'uniform perché la rampa deve poter arrivare esattamente a 0 (è quel
   *  valore a spegnere il quad), cosa che uno smorzamento esponenziale come
   *  quello del rig non fa mai. */
  let current = 0;
  let reduced = false;

  function update(dt: number, intensity: number): void {
    const clamped = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
    // Con la riduzione del movimento attiva l'effetto passa dallo stesso
    // moltiplicatore del micro-tremolio da velocità: sono la stessa cosa
    // (un indizio di velocità continuo e periferico), ed è già la voce di
    // config che decide quanto di quella classe di stimoli sopravvive —
    // meglio che inventare un secondo numero che poi diverge dal primo.
    const target = clamped * (reduced ? CONFIG.render.reducedMotion.speedJitterScale : 1);

    if (target > current) {
      current = Math.min(target, current + dt / RAMP_UP_SECONDS);
    } else if (target < current) {
      current = Math.max(target, current - dt / RAMP_DOWN_SECONDS);
    }

    if (current <= 0) {
      current = 0;
      uniforms.uIntensity.value = 0;
      uniforms.uTime.value = 0;
      object.visible = false;
      return;
    }

    uniforms.uTime.value += dt;
    uniforms.uIntensity.value = current * cfg.speedLineIntensity;
    object.visible = true;
  }

  function setReducedMotion(on: boolean): void {
    // Non spegne di colpo: cambia solo l'obiettivo, la rampa fa il resto. La
    // media query può cambiare a partita in corso (vedi scene.setReducedMotion).
    reduced = on;
  }

  function dispose(): void {
    geometry.dispose();
    material.dispose();
  }

  return { object, uniforms, update, setReducedMotion, dispose };
}
