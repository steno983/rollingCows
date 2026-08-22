import { CONFIG } from '../game/config';

/**
 * Rapporto fra altezza e distanza della camera. È una scelta di inquadratura,
 * non un numero di bilanciamento: tenendolo costante l'inclinazione della
 * camera resta identica a ogni taglia, e cambia solo quanto mondo si vede.
 *
 * A 0.42 la camera era quasi a filo del pendio (pitch ≈ -7.5°): tutto oltre
 * ~40 unità si schiacciava in pochi pixel verticali proprio dove iniziava la
 * nebbia, lasciando meno di un secondo di lettura utile su un ostacolo a 40
 * u/s. Alzata a 0.68 (pitch ≈ -12.7°) si vede più pendio davanti alla mucca:
 * vedi anche render.fogNear/fogFar in game/config.ts, spostati in coppia con
 * questo valore.
 */
export const CAMERA_HEIGHT_RATIO = 0.68;

/**
 * Punto verso cui la camera guarda: davanti alla mucca, poco sopra la neve.
 * Vive qui e non in render/scene.ts perché non è un dettaglio del renderer ma
 * la seconda metà della geometria dell'inquadratura: insieme a
 * CAMERA_HEIGHT_RATIO determina `cameraPitchFor`, che serve anche al fondale
 * (render/backdrop.ts) per sapere dov'è il bordo alto dello schermo.
 */
export const LOOK_AHEAD_Z = 9;
export const LOOK_AT_Y = 1.4;

/**
 * PENDENZA DELLA MONTAGNA, in gradi.
 *
 * Il gioco è una discesa, ma il mondo è sempre stato modellato piatto: il
 * pendio spariva esattamente sulla linea dell'orizzonte, cioè l'immagine di
 * una pianura infinita. La correzione è solo visiva e sta tutta in una
 * rotazione attorno all'asse X, con perno sull'origine (dove sta sempre la
 * mucca): il gruppo-mondo si inclina di questo angolo (main.ts), la mucca —
 * che sta fuori dal gruppo apposta — si inclina dello stesso (player-view.ts)
 * e il rig della camera pure (scene.ts, slopeTiltY/Z). Ruotando ANCHE il rig,
 * la geometria fra camera e pendio resta identica al millimetro: il corridoio
 * occupa gli stessi pixel di prima, la nebbia cade sulle stesse distanze, le
 * ombre coprono la stessa fascia. Nessun numero di gioco cambia, e nulla di
 * ciò che è stato tarato sul mondo piatto va rifatto.
 *
 * Quello che cambia è ciò che NON ruota: cielo e fondale restano orizzontali,
 * perché sono il mondo vero visto da lontano. L'orizzonte sale quindi di
 * questi gradi rispetto al punto in cui il pendio svanisce, e nella fascia che
 * si apre in mezzo — 1,5° prima, 8,5° adesso, cioè da un filo a un settimo
 * dell'altezza dello schermo — si vedono il fondovalle, il paese e la base
 * delle creste. È quella fascia, e solo quella, a dire «stai scendendo».
 *
 * Perché 6 e non di più: la camera scende con il pendio, quindi il cielo si
 * restringe di altrettanto (dal 24% al 13% dell'altezza dello schermo) e le
 * creste del fondale devono starci dentro. A 7° ci stanno ancora, a 8° il
 * fondale va abbassato tanto che il paese finisce dietro il pendio (vedi il
 * conto in backdrop.ts, backdropDrop). Oltre, servirebbe abbassare anche
 * render.backdrop.ridgePeakHeight.
 */
const WORLD_SLOPE_DEG = CONFIG.render.worldSlopeDeg;

/** La pendenza in radianti: è questa la forma in cui la usano tutti. */
export const WORLD_SLOPE = (WORLD_SLOPE_DEG * Math.PI) / 180;

/**
 * Le due componenti di un punto (y, z) ruotato di `slope` attorno all'asse X
 * — la stessa rotazione che main.ts applica al gruppo-mondo. Due funzioni
 * scalari invece di un Vector3 perché scene.ts le chiama a ogni frame sulla
 * posizione della camera, e lì il vincolo è zero allocazioni.
 *
 * Segno: con un angolo positivo un punto davanti (z > 0) scende, che è
 * esattamente il senso di una discesa. Vale per qualunque punto, quindi la
 * stessa coppia serve alla camera (che sta a z negativo, e quindi SALE), al
 * punto guardato e al sole.
 *
 * L'angolo è un parametro con valore predefinito perché il fondale
 * (render/backdrop.ts) deve poter rifare gli stessi conti a pendenza zero,
 * per sapere quanto la pendenza vera lo sposta rispetto al mondo piatto su
 * cui i suoi numeri sono tarati.
 */
export function slopeTiltY(y: number, z: number, slope: number = WORLD_SLOPE): number {
  return y * Math.cos(slope) - z * Math.sin(slope);
}

export function slopeTiltZ(y: number, z: number, slope: number = WORLD_SLOPE): number {
  return y * Math.sin(slope) + z * Math.cos(slope);
}

/**
 * Inclinazione verso il basso dell'asse ottico, in radianti, alla taglia data.
 * Comprende la pendenza: il rig ruota con il pendio, quindi rispetto
 * all'ORIZZONTE la camera guarda in basso di WORLD_SLOPE in più di quanto
 * guardi in basso rispetto al pendio.
 *
 * Serve a chiunque debba sapere dove cade il bordo alto dello schermo: quel
 * bordo sta a `fov/2 - cameraPitchFor(size)` sopra l'orizzonte, ed è il
 * vincolo che decide quanto in alto possono arrivare le creste del fondale.
 * Cresce con la taglia perché il punto guardato è fisso mentre la camera si
 * allontana e si alza (rapporto costante): a taglia 5 la camera guarda in
 * basso ~3,7° più che a taglia 1.
 */
export function cameraPitchFor(size: number, slope: number = WORLD_SLOPE): number {
  const distance = cameraDistanceFor(size);
  return Math.atan((cameraHeightFor(size) - LOOK_AT_Y) / (distance + LOOK_AHEAD_Z)) + slope;
}

/** Distanza della camera dietro la mucca per la taglia data (1..maxSize). */
export function cameraDistanceFor(size: number): number {
  const clamped = Math.min(CONFIG.avalanche.maxSize, Math.max(1, size));
  return CONFIG.render.cameraBaseDistance + (clamped - 1) * CONFIG.render.cameraDistancePerSize;
}

/** Altezza della camera sopra il pendio per la taglia data. */
export function cameraHeightFor(size: number): number {
  return cameraDistanceFor(size) * CAMERA_HEIGHT_RATIO;
}

/**
 * Velocità del mondo normalizzata in [0,1] fra world.startSpeed e
 * world.maxSpeed. È il parametro con cui la vista reagisce a "quanto si sta
 * andando forte": FOV e micro-vibrazione escono entrambi da qui, così non
 * possono scollarsi l'uno dall'altra.
 *
 * Il riferimento è sempre il profilo normale (world.*) e non il profilo di
 * difficoltà in corso: su "Vitellino" (14 → 28 u/s) il rapporto si ferma a
 * ~0.45, ed è voluto — la vista deve dire quanto si va forte in assoluto, non
 * quanto ci si è avvicinati al proprio tetto personale.
 */
export function speedRatio(speed: number): number {
  const span = CONFIG.world.maxSpeed - CONFIG.world.startSpeed;
  if (span <= 0) return 0;
  const t = (speed - CONFIG.world.startSpeed) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * FOV OBIETTIVO dell'inquadratura: la transizione verso questo valore la fa
 * il rig (render/scene.ts) con la stessa costante di tempo di distanza e
 * altezza, quindi qui non c'è nessun avanzamento `t` da gestire.
 *
 * Due contributi che si SOMMANO, invece di sovrascriversi come faceva la
 * coppia cameraBaseFov/cameraAvalancheFov: la velocità apre l'obiettivo fra
 * cameraMinFov e cameraMaxFov, e la valanga ci aggiunge sopra
 * cameraAvalancheFovDelta. Prima la valanga imponeva un FOV assoluto, cioè
 * cancellava l'apertura da velocità proprio nel momento in cui si va più
 * forte di tutti.
 *
 * `avalancheScale` è il moltiplicatore della riduzione del movimento
 * (render.reducedMotion.fovDeltaScale): scala SOLO il contributo della
 * valanga, perché è la pompa di FOV a dare disagio vestibolare, non il
 * respiro lento legato alla velocità.
 */
export function cameraFovFor(speed: number, avalanche: boolean, avalancheScale = 1): number {
  const { cameraMinFov, cameraMaxFov, cameraAvalancheFovDelta } = CONFIG.render;
  const base = cameraMinFov + (cameraMaxFov - cameraMinFov) * speedRatio(speed);
  return avalanche ? base + cameraAvalancheFovDelta * avalancheScale : base;
}

/**
 * Smorzamento esponenziale dello scuotimento: indipendente dal frame rate,
 * con snap a zero sotto la soglia percettibile per non tenere la camera
 * perennemente "viva" con oscillazioni infinitesime.
 */
export function decayShake(current: number, dt: number): number {
  const next = current * Math.exp(-CONFIG.render.shakeDecay * dt);
  return next < 1e-4 ? 0 : next;
}

/**
 * Converte una X di mondo nella X della vista. La camera sta a z negativo e
 * guarda verso +z: in quell'inquadratura l'asse +X del mondo cade a sinistra
 * dello schermo. Questa è l'unica funzione autorizzata a specchiare l'asse.
 */
export function worldToViewX(x: number): number {
  // `+ 0` normalizza -0 a 0 (es. worldToViewX(0)): -x da solo produrrebbe -0,
  // che Object.is (e quindi toBe) distingue da 0.
  return -x + 0;
}
