import * as THREE from 'three';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraFovFor,
  cameraHeightFor,
  decayShake,
  LOOK_AHEAD_Z,
  LOOK_AT_Y,
  slopeTiltY,
  slopeTiltZ,
  speedRatio,
} from './camera-rig';

/**
 * FIRMA PUBBLICA DEL MODULO (main.ts si ricabla su questa):
 *
 *   createScene(canvas: HTMLCanvasElement, reducedMotion?: boolean): SceneContext
 *     reducedMotion omesso = letto dalla media query prefers-reduced-motion.
 *
 *   view.update(frame: ViewFrame): void
 *     ViewFrame = { dt, size, speed, avalanche, roll }
 *     `speed` è la velocità del mondo (game.world.speed): l'inquadratura ora
 *     dipende da quanto si va forte, quindi non è più un dato opzionale.
 *   view.needsShadowUpdate(): void
 *     DA CHIAMARE ogni frame in cui la scena si muove. La shadow map non si
 *     aggiorna più da sola (autoUpdate = false): senza questa chiamata resta
 *     quella dell'ultimo frame richiesto — che è esattamente il
 *     comportamento voluto a menu, in pausa e a partita finita.
 *   view.setReducedMotion(reduced: boolean): void
 *     La media query può cambiare durante la partita.
 *   view.setQuality(low: boolean): void
 *   view.shake(amount: number): void
 *   view.resize(): void
 *   view.render(): void
 *   view.shadowsEnabled: boolean
 *     Profilo deciso all'AVVIO e mai più cambiato (vedi commento su
 *     coarsePointer): serve a chi deve sapere se le ombre esistono.
 */

/** Seed fisso del jitter dello shake: l'unica sorgente di casualità della vista
 *  passa anche lei dall'unico meccanismo di casualità della codebase (l'Rng con
 *  seed), invece di Math.random(). Non è l'Rng di gioco: uno shake non deve
 *  consumarne la sequenza né renderla dipendente dal frame rate della resa. */
const SHAKE_SEED = 0x5eed_c0de;

/** Tutto ciò che la vista deve sapere di un frame. Era una lista di quattro
 *  parametri posizionali: con l'aggiunta della velocità diventavano cinque, e
 *  tre di essi numeri — troppo facile scambiarli di posto senza che il
 *  compilatore se ne accorga. */
export interface ViewFrame {
  dt: number;
  /** Taglia della mucca (1..maxSize): governa distanza e altezza della camera. */
  size: number;
  /** Velocità del mondo in u/s: governa FOV e micro-vibrazione. */
  speed: number;
  avalanche: boolean;
  /** Rollio da bivio, in radianti (render/curve.ts, cameraRollFor). */
  roll: number;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Posizione (x, z) della camera SENZA lo shake: oggetto riusato ogni
   *  frame (zero allocazioni), da leggere dopo update(). Serve ad ancorare
   *  elementi che devono seguire la camera ma restare immobili quando questa
   *  trema (vedi render/backdrop.ts e la cupola del cielo qui sotto):
   *  camera.position include lo shake, questo no. */
  rigPosition: { x: number; z: number };
  /** Le ombre esistono in questa sessione? Deciso una volta all'avvio. */
  shadowsEnabled: boolean;
  resize(): void;
  update(frame: ViewFrame): void;
  shake(amount: number): void;
  render(): void;
  setQuality(low: boolean): void;
  needsShadowUpdate(): void;
  setReducedMotion(reduced: boolean): void;
}

/** Colori dell'ambiente: scelte estetiche, non numeri di bilanciamento. */
const SKY_TOP = 0x1f5fa8;
const SKY_MID = 0x7fb6e8;
const SKY_HORIZON = 0xe8f4ff;
const FOG_COLOR = 0xdfeeff;
const SUN_COLOR = 0xfff4e0;
/** Cielo e terra dell'emisferica. Il colore di terra era 0xf2f7ff, cioè quasi
 *  identico a quello di cielo: due colori uguali fanno dell'emisferica una
 *  banale luce ambientale, che pesava il 45% dell'illuminazione totale e
 *  appiattiva ogni voxel. Ora la terra è un azzurro spento (la neve in ombra
 *  riflette il cielo, non il sole) e le due direzioni si distinguono. */
const SKY_LIGHT = 0xcfe4ff;
const GROUND_LIGHT = 0x6d8cb5;
/** Verso dove vira il sole durante la valanga: stesso bianco caldo, spinto
 *  verso l'ambra. */
const SUN_AVALANCHE_COLOR = 0xffd6a0;

/** Intensità delle luci. Erano tarate su three pre-r155, quando il renderer
 *  moltiplicava per π l'illuminazione delle luci punto/direzionali: quel
 *  fattore è stato rimosso e non c'è nulla che lo compensi, quindi la scena
 *  riceveva circa un terzo della luce prevista. Misurato riproducendo lo
 *  shader Lambert di r169: un voxel di neve al sole usciva RGB(186,195,206) —
 *  più scuro della nebbia (223,238,255) e del cielo — e fra le sei facce di un
 *  cubetto correvano appena 56 livelli su 255, cioè i voxel non avevano
 *  volume. Con questi valori l'escursione fra le facce sale a ~165 livelli e
 *  la neve al sole torna bianca. */
const HEMI_INTENSITY = 2.2;
const SUN_INTENSITY = 2.7;
/** Quando le ombre si spengono l'emisferica sale, per compensare la luce
 *  ambientale che l'occlusione non toglie più. Il rapporto è quello di prima
 *  (1.35 / 1.1); il valore assoluto NON va riscritto a mano, perché duplicarlo
 *  era il motivo per cui cambiare l'intensità base lasciava il degrado
 *  incoerente. */
const HEMI_LOW_BOOST = 1.23;

/** Velocità (1/s) con cui distanza, altezza, FOV e luce della valanga
 *  raggiungono il valore obiettivo. */
const RIG_RATE = CONFIG.render.shakeDecay;

/** Quota della cupola (seno dell'angolo sopra l'orizzonte) alla quale il
 *  gradiente arriva a SKY_TOP, e posizione dello stop intermedio dentro
 *  quell'intervallo.
 *
 *  Il conto va rifatto ogni volta che cambia quanto la camera guarda in
 *  basso, perché è quello a decidere quanta cupola entra in quadro. Con il
 *  rig inclinato sul pendio (WORLD_SLOPE) l'asse ottico scende di 20,7°
 *  (taglia 1) e 24,4° (taglia 5) sotto l'orizzonte, e il semi-FOV verticale
 *  va da 28° a 39°: il bordo alto dello schermo sta quindi fra 7,3° sopra
 *  l'orizzonte (gioco normale) e 14,6° (valanga, FOV spalancato), cioè fra
 *  0,127 e 0,25 di seno — contro i 15°-26° del mondo piatto.
 *
 *  Il valore era 0.38, tarato su quella fascia più alta: lasciandolo lì si
 *  vedrebbe solo il primo terzo del gradiente e il cielo diventerebbe una
 *  lastra pallida uniforme. A 0.21 il bordo alto dello schermo cade a t≈0,61
 *  come prima (era 0,60), e la valanga continua a spingere il quadro dentro
 *  SKY_TOP pieno: stessa lettura, su una finestra di cielo più stretta. */
const SKY_ZENITH_Y = 0.21;
const SKY_MID_STOP = 0.45;
/** Raggio della cupola in frazione di camera.far: dentro il far plane con
 *  margine anche nei punti dove la sfera a 16 lati taglia l'angolo. */
const SKY_RADIUS_RATIO = 0.9;

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    // La cupola viene solo TRASLATA (segue la camera; non ruota, non scala),
    // quindi la posizione in spazio oggetto normalizzata è già la direzione
    // di vista in spazio mondo: nessuna moltiplicazione di matrici per
    // ricavare quello che la geometria dice da sé.
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 horizonColor;
  varying vec3 vDirection;

  const float ZENITH_Y = ${SKY_ZENITH_Y.toFixed(3)};
  const float MID_STOP = ${SKY_MID_STOP.toFixed(3)};

  void main() {
    float t = clamp(vDirection.y / ZENITH_Y, 0.0, 1.0);
    vec3 color = t < MID_STOP
      ? mix(horizonColor, midColor, t / MID_STOP)
      : mix(midColor, topColor, (t - MID_STOP) / (1.0 - MID_STOP));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Dither DOPO la conversione allo spazio di uscita, dove un livello vale
    // esattamente 1/255: un gradiente continuo steso su ~900 px si quantizza
    // in bande larghe decine di pixel, visibilissime sugli OLED. Mezzo
    // livello di rumore per pixel le rompe e non si vede.
    float hash = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor.rgb += (hash - 0.5) / 255.0;
  }
`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function createScene(
  canvas: HTMLCanvasElement,
  reducedMotion: boolean = prefersReducedMotion(),
): SceneContext {
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    // Sempre acceso, anche su mobile: la scena è fatta al 100% di spigoli ad
    // alto contrasto e si muove sempre, cioè lo scenario peggiore per
    // l'aliasing temporale, e sulle GPU a tile l'MSAA si risolve nella tile
    // memory — molto meno caro che raddoppiare la risoluzione. Il baratto
    // giusto è quello opposto a quello di prima (`antialias: !coarsePointer`):
    // MSAA acceso e pixel ratio più basso (render.coarsePixelRatio).
    antialias: true,
    alpha: false,
    // Già il default da r163: esplicito perché un aggiornamento di three non
    // possa reintrodurre in silenzio un buffer che nessun effetto qui usa.
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Tone mapping filmico: con le intensità ricalibrate qui sopra la neve al
  // sole arriva a saturare, e senza curva i bianchi si tagliano piatti.
  // Vincolato alla cupola del cielo: three impone toneMapped = false a un
  // background che sia una Texture sRGB, quindi finché il cielo era una
  // texture piatta sarebbe rimasto FUORI dal tone mapping mentre la scena ci
  // entrava, con un salto di valore visibile lungo tutto l'orizzonte.
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;

  /** Le ombre si accendono (o no) una volta sola, qui. Cambiare a runtime il
   *  numero di luci che proiettano ombre cambia la chiave di cache dei
   *  programmi e obbliga TUTTI i materiali della scena a ricompilare: decine
   *  di ms per shader su GPU mobile, cioè centinaia di ms di stallo proprio su
   *  un dispositivo che sta già arrancando. Meglio partire già senza. */
  const shadowsEnabled = !coarsePointer;
  renderer.shadowMap.enabled = shadowsEnabled;
  // Con texel fini (vedi render.shadow) il PCF duro scaletta contro la neve
  // bianca, dove non c'è texture a nascondere il gradino.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // La shadow map veniva ridisegnata a ogni frame anche a scena ferma (menu,
  // pausa, game over). Ora la ridisegna solo chi sa che qualcosa si è mosso,
  // via needsShadowUpdate().
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, CONFIG.render.fogNear, CONFIG.render.fogFar);

  const camera = new THREE.PerspectiveCamera(
    cameraFovFor(CONFIG.world.startSpeed, false),
    1,
    // near a 1 (era 0.1): la geometria più vicina sta a 6-9 unità e il far è a
    // 260, quindi 0.1 buttava via un fattore dieci di precisione del depth
    // buffer senza guadagnare nulla.
    1,
    CONFIG.render.fogFar + 60,
  );

  // Cupola al posto di scene.background. Il background era una CanvasTexture
  // disegnata in coordinate normalizzate di schermo: la camera veniva
  // semplicemente ignorata. In un gioco in cui la camera rolla fino a 9° a
  // ogni bivio, le bande del cielo restavano orizzontali mentre tutto il resto
  // si inclinava; e quando in valanga il FOV si apre, il cielo non si apriva,
  // perdendo metà della spinta dello zoom.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(camera.far * SKY_RADIUS_RATIO, 16, 12),
    new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(SKY_TOP) },
        midColor: { value: new THREE.Color(SKY_MID) },
        horizonColor: { value: new THREE.Color(SKY_HORIZON) },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  // Disegnata per prima e senza scrivere il depth: fa da sfondo a tutto il
  // resto esattamente come faceva scene.background.
  sky.renderOrder = -1;
  scene.add(sky);

  const hemisphere = new THREE.HemisphereLight(SKY_LIGHT, GROUND_LIGHT, HEMI_INTENSITY);
  scene.add(hemisphere);

  const sunColor = new THREE.Color(SUN_COLOR);
  const sunAvalancheColor = new THREE.Color(SUN_AVALANCHE_COLOR);
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  // Il sole è inclinato insieme al pendio, come il rig della camera. Non è
  // realismo (il sole vero non si piega con la montagna): è il modo di NON
  // rimettere in discussione due tarature fatte a mano sul mondo piatto.
  // L'incidenza su ogni faccia di ogni voxel resta quella misurata per
  // HEMI_INTENSITY/SUN_INTENSITY qui sopra, e soprattutto il frustum della
  // shadow map — misurato per coprire z ∈ [-39, 80] al suolo, vedi
  // render.shadow in game/config.ts — continua a coprire esattamente quella
  // fascia di pendio invece di scivolarci sopra man mano che il terreno
  // scende. Nessuno può accorgersene: in cielo non c'è un disco solare, e il
  // gradiente della cupola è simmetrico attorno alla verticale.
  sun.position.set(14, slopeTiltY(26, -10), slopeTiltZ(26, -10));
  sun.target.position.set(0, slopeTiltY(0, 12), slopeTiltZ(0, 12));
  sun.castShadow = shadowsEnabled;
  const shadowCfg = CONFIG.render.shadow;
  sun.shadow.mapSize.set(shadowCfg.mapSize, shadowCfg.mapSize);
  sun.shadow.bias = shadowCfg.bias;
  // Senza normalBias il bias grande valeva mezzo voxel di offset, cioè
  // peter-panning garantito sui modelli piccoli (vedi il commento su
  // render.shadow in game/config.ts).
  sun.shadow.normalBias = shadowCfg.normalBias;
  sun.shadow.camera.left = -shadowCfg.halfWidth;
  sun.shadow.camera.right = shadowCfg.halfWidth;
  sun.shadow.camera.top = shadowCfg.halfDepth;
  sun.shadow.camera.bottom = -shadowCfg.halfDepth;
  sun.shadow.camera.near = shadowCfg.near;
  sun.shadow.camera.far = shadowCfg.far;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  // Anche il punto guardato scende lungo il pendio: è l'altra metà della
  // rotazione rigida del rig (vedi WORLD_SLOPE). Con il lookAt fermo sul
  // vecchio punto la camera guarderebbe un pezzo di cielo sopra il pendio.
  const lookAt = new THREE.Vector3(
    0,
    slopeTiltY(LOOK_AT_Y, LOOK_AHEAD_Z),
    slopeTiltZ(LOOK_AT_Y, LOOK_AHEAD_Z),
  );
  const shakeRng = createRng(SHAKE_SEED);
  let shakeAmount = 0;
  let lowQuality = false;
  let reduced = reducedMotion;
  let distance = cameraDistanceFor(1);
  let height = cameraHeightFor(1);
  /** Quota della camera DOPO l'inclinazione del rig sul pendio, senza shake:
   *  `height` resta la quota misurata sul pendio (quella che dipende dalla
   *  taglia), questa è dove finisce davvero la camera nel mondo. Dietro la
   *  mucca il pendio sale, quindi è sempre più alta di `height`. */
  let rigY = slopeTiltY(height, -distance);
  // La camera non si sposta mai lateralmente (lookAt è fisso a x = 0): l'unica
  // sua x diversa da 0 è lo shake, che qui va apposta ignorato.
  const rigPosition = { x: 0, z: slopeTiltZ(height, -distance) };

  /** Applica un moltiplicatore di render.reducedMotion solo se la riduzione
   *  del movimento è richiesta. */
  function motionScale(scale: number): number {
    return reduced ? scale : 1;
  }

  /** Tetto al pixel ratio nello stato corrente. Su puntatore grosso si parte
   *  già più bassi (coarsePixelRatio) e nel degrado si scende ancora: su GPU
   *  mobile il collo di bottiglia è il fill rate, quindi la risoluzione è la
   *  leva più forte — ed era l'unica che il degrado non toccava. */
  function pixelRatioCap(): number {
    if (lowQuality) return CONFIG.render.lowQualityPixelRatio;
    return coarsePointer ? CONFIG.render.coarsePixelRatio : CONFIG.render.maxPixelRatio;
  }

  function resize(): void {
    const width = Math.max(1, window.innerWidth);
    const heightPx = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap()));
    // updateStyle = false: la dimensione CSS del canvas la impone main.ts.
    renderer.setSize(width, heightPx, false);
    camera.aspect = width / heightPx;
    camera.updateProjectionMatrix();
  }

  function update(frame: ViewFrame): void {
    const { dt, size, speed, avalanche, roll } = frame;
    const k = Math.min(1, dt * RIG_RATE);

    const targetFov = cameraFovFor(
      speed,
      avalanche,
      motionScale(CONFIG.render.reducedMotion.fovDeltaScale),
    );
    const fov = camera.fov + (targetFov - camera.fov) * k;
    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    distance += (cameraDistanceFor(size) - distance) * k;
    height += (cameraHeightFor(size) - height) * k;
    // Il rig scivola sul pendio invece che su un piano orizzontale: stessa
    // posizione di prima RISPETTO AL PENDIO, ruotata di WORLD_SLOPE come il
    // gruppo-mondo. È questa coppia di righe a garantire che il corridoio
    // resti inquadrato esattamente come prima.
    rigY = slopeTiltY(height, -distance);
    rigPosition.z = slopeTiltZ(height, -distance);

    // La valanga vira tutta l'inquadratura invece di appiccicarci sopra un
    // effetto: il sole si scalda e si intensifica, e torna indietro alla fine.
    // Due lerp per frame, costo nullo.
    const sunTarget = avalanche
      ? SUN_INTENSITY * CONFIG.render.avalancheFx.sunIntensityBoost
      : SUN_INTENSITY;
    sun.intensity += (sunTarget - sun.intensity) * k;
    sun.color.lerp(avalanche ? sunAvalancheColor : sunColor, k);

    shakeAmount = decayShake(shakeAmount, dt);
    if (avalanche) {
      // Pavimento sostenuto: l'impulso d'ingresso si spegne in meno di un
      // secondo su una fase che ne dura sei. sustainedShake è il valore alla
      // taglia massima — che in pratica è sempre quella, perché la soglia
      // della valanga sta oltre l'ultima soglia di taglia.
      const sizeRatio = Math.min(1, Math.max(0, size / CONFIG.avalanche.maxSize));
      const sustained =
        CONFIG.render.avalancheFx.sustainedShake *
        sizeRatio *
        motionScale(CONFIG.render.reducedMotion.shakeScale);
      if (shakeAmount < sustained) shakeAmount = sustained;
    }

    // Micro-vibrazione continua proporzionale alla velocità: impercettibile
    // da fermi, "motore su di giri" a velocità massima. Sommata all'ampiezza
    // invece che allo stato, così non viene né clampata né smorzata: non è un
    // evento, è una condizione.
    const jitter =
      CONFIG.render.speedJitter *
      speedRatio(speed) *
      motionScale(CONFIG.render.reducedMotion.speedJitterScale);
    const amplitude = shakeAmount + jitter;
    const offsetX = (shakeRng.next() * 2 - 1) * amplitude;
    const offsetY = (shakeRng.next() * 2 - 1) * amplitude;
    camera.position.set(offsetX, rigY + offsetY, rigPosition.z);
    camera.lookAt(lookAt);
    // Rollio da bivio (render/curve.ts, cameraRollFor): lookAt sopra
    // ricalcola l'orientamento da zero a ogni chiamata (asse "up" sempre
    // verticale), quindi va riapplicato qui, ogni frame, DOPO lookAt — non
    // è uno stato che si accumula. rotateZ ruota attorno all'asse di vista
    // locale della camera: inclina l'orizzonte senza spostare il punto
    // guardato (lookAt), a differenza di un roll ottenuto inclinando `up`.
    if (roll !== 0) camera.rotateZ(roll);

    // La cupola resta centrata sul rig e NON sullo shake: se seguisse la
    // camera tremante, il cielo tremerebbe insieme a lei e lo scuotimento
    // sparirebbe dalla metà alta dello schermo (stessa scelta di
    // render/backdrop.ts).
    sky.position.set(rigPosition.x, rigY, rigPosition.z);
  }

  function shake(amount: number): void {
    shakeAmount = Math.min(
      CONFIG.feel.maxShake,
      shakeAmount + amount * motionScale(CONFIG.render.reducedMotion.shakeScale),
    );
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  function needsShadowUpdate(): void {
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
  }

  function setReducedMotion(value: boolean): void {
    reduced = value;
  }

  function setQuality(low: boolean): void {
    if (low === lowQuality) return;
    lowQuality = low;
    // Se le ombre non ci sono mai state, non si toccano: accenderle o
    // spegnerle qui costerebbe la ricompilazione di tutti i materiali proprio
    // mentre il monitor delle prestazioni sta dicendo che il dispositivo non
    // ce la fa.
    if (shadowsEnabled) {
      sun.castShadow = !low;
      renderer.shadowMap.enabled = !low;
      renderer.shadowMap.needsUpdate = true;
    }
    hemisphere.intensity = low ? HEMI_INTENSITY * HEMI_LOW_BOOST : HEMI_INTENSITY;
    // Il degrado deve toccare anche la risoluzione, non solo ombre e
    // particelle (vedi pixelRatioCap).
    resize();
  }

  resize();
  camera.position.set(0, rigY, rigPosition.z);
  camera.lookAt(lookAt);
  sky.position.set(rigPosition.x, rigY, rigPosition.z);

  return {
    renderer,
    scene,
    camera,
    rigPosition,
    shadowsEnabled,
    resize,
    update,
    shake,
    render,
    setQuality,
    needsShadowUpdate,
    setReducedMotion,
  };
}
