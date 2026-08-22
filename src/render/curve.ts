import { CONFIG } from '../game/config';
import { branchOffsetX, type PathState, straightenProgress, turnSideOf } from '../game/path';

const DEG_TO_RAD = Math.PI / 180;
const MAX_WORLD_YAW = CONFIG.render.curve.maxWorldTiltDeg * DEG_TO_RAD;
const MAX_PLAYER_TILT = CONFIG.render.curve.maxPlayerTiltDeg * DEG_TO_RAD;
const MAX_CAMERA_ROLL = CONFIG.render.curve.maxCameraRollDeg * DEG_TO_RAD;

/**
 * Moltiplicatore da passare alle tre funzioni di questo modulo quando il
 * sistema chiede di ridurre il movimento (`prefers-reduced-motion`, letto in
 * render/scene.ts). Non è uno stato globale nascosto qui dentro apposta: la
 * preferenza la conosce chi costruisce la vista, e una funzione che cambia
 * risposta a seconda di un flag di modulo è impossibile da testare senza
 * ordinare i test.
 *
 * Perché serve: la media query CSS disattivava quattro animazioni
 * dell'interfaccia e non toccava NULLA della piegata — rotazione del mondo,
 * inclinazione della mucca e rollio della camera insieme (vedi
 * CONFIG.render.curve), con un bivio ogni ~12 secondi — cioè esattamente ciò
 * che causa disagio vestibolare. I tre angoli sono stati poi ridimensionati
 * (38/32/9 → 16/18/5 gradi) perché la piegata era diventata lunga il doppio,
 * ma sommati restano il movimento più forte del gioco. Il bivio resta perfettamente leggibile anche al 25%
 * (render.reducedMotion.curveScale), perché la rotazione è dichiaratamente
 * estetica e a somma zero: il lavoro geometrico lo fa la pista stessa, che
 * durante un bivio porta il ramo scelto sotto la mucca (game/path.ts,
 * branchCenterAt), e questo fattore non la tocca.
 */
export function curveMotionScale(reducedMotion: boolean): number {
  return reducedMotion ? CONFIG.render.reducedMotion.curveScale : 1;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smoothstep: stessa easing di cameraFovFor (camera-rig.ts), per coerenza
 *  di "sensazione" fra le transizioni della vista. */
function ease(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Intensità 0..1 della piegata, indipendente dal verso. Sale dall'istante in
 * cui il giocatore SCEGLIE — anche in piena fase di avvicinamento — e
 * ridiscende durante 'realigning', riusando `path.realignProgress` già
 * calcolato da game/path.ts: una frazione di distanza percorsa e non un tempo
 * a parte (vedi applyRealignment), quindi la piegata rientra alla stessa
 * cadenza a qualunque velocità. Zero in 'none' e per chi non sceglie mai.
 *
 * PRIMA RESTAVA A ZERO DURANTE 'approaching', e la ragione era che lì la
 * scelta può ancora cambiare: un'intensità già cresciuta avrebbe cambiato
 * segno di scatto a metà salita. Il conto tornava, la conseguenza no — il
 * riscontro visivo della scelta arrivava solo quando la scelta non era più
 * modificabile, e teneva inchiodata a 20 unità dal bivio la scadenza per
 * darglielo. Ora il cambio di verso è gestito dove va gestito: la piegata è
 * un valore CON SEGNO che per cambiare ramo deve passare per lo zero alla sua
 * velocità (game/path.ts, advanceTurn), quindi non scatta, si raddrizza e
 * ripiega dall'altra parte.
 */
function turnIntensity(path: PathState): number {
  // È ESATTAMENTE il raddrizzamento del ramo scelto (game/path.ts): non una
  // curva parallela con la stessa forma, la stessa funzione. È lì che la
  // strada si muove davvero — scivola sotto la mucca diventando la principale
  // — e la piegata deve crescere con quel movimento, non per conto proprio. Le
  // due copie della stessa easing erano già una di troppo la prima volta che
  // una delle due è stata cambiata.
  const straightening = straightenProgress(path);
  // Oltre la biforcazione il raddrizzamento resta a 1 (la strada è dritta e ci
  // resta) mentre la piegata deve tornare a zero: è il PRODOTTO delle due, non
  // il solo rientro, così chi arriva al bivio con la piegata a metà — scelta
  // all'ultimo istante, o cambio di idea — la vede rientrare da metà e non
  // saltare prima a uno.
  if (path.phase === 'realigning') return straightening * ease(1 - path.realignProgress);
  return straightening;
}

/**
 * Verso della piegata: stesso segno di branchOffsetX per il ramo attivo
 * (-1 a sinistra, +1 a destra, in coordinate di MONDO — non quelle di
 * schermo). Va così, e non al contrario, per via dello specchiamento che
 * worldToViewX applica fra mondo e vista (camera-rig.ts): un'entità del ramo
 * sinistro vive in vista a scena-x = worldToViewX(branchOffsetX('left')) =
 * +branchSeparation (positivo), e in QUESTA inquadratura (camera che guarda
 * verso +z da z negativo) una scena-x positiva proietta a sinistra dello
 * schermo — quindi il ramo sinistro appare correttamente a sinistra, come
 * atteso. Applicando al gruppo-mondo una rotation.y con lo stesso segno di
 * branchOffsetX('left') (negativo), un punto lontano davanti (scena-x
 * positivo, z grande) si sposta con x' = x·cosθ + z·sinθ: per θ negativo il
 * termine z·sinθ è negativo e RIDUCE x', portando il ramo sinistro verso il
 * centro/avanti — esattamente "il mondo che curva verso il ramo scelto".
 * Verificato numericamente (proiezione reale via three.js) prima di
 * scriverlo, non per intuito: è lo stesso tipo di trappola già scattata una
 * volta con il verso di rotolamento della mucca (vedi player-view.ts).
 */
function turnSign(path: PathState): number {
  // Il ramo verso cui si sta piegando, non quello attivo: durante
  // l'avvicinamento nessun ramo è ancora attivo eppure la piegata c'è già
  // (game/path.ts, turnSideOf). Il verso continua a leggersi da
  // `branchOffsetX` e non da un -1/+1 scritto qui: è la geometria del bivio a
  // dire da che parte sta un ramo, e deve dirlo in un posto solo.
  const side = turnSideOf(path);
  if (side === null) return 0;
  const offset = branchOffsetX(path, side);
  if (offset < 0) return -1;
  if (offset > 0) return 1;
  return 0;
}

/** Ampiezza con segno (-1..1) della piegata: fattore comune ai tre angoli.
 *  `+ 0` normalizza -0 a 0 (segno -1 per intensità 0 produce -0): stessa
 *  cautela di worldToViewX in camera-rig.ts, per lo stesso motivo (Object.is,
 *  e quindi toBe nei test, distingue -0 da 0). */
function turnAmount(path: PathState): number {
  return turnSign(path) * turnIntensity(path) + 0;
}

/**
 * Rotazione (radianti) del gruppo-mondo attorno all'asse Y, con perno
 * sull'origine — dove sta sempre la mucca (x=0, z=0): vedi main.ts. Zero
 * finché nessuno ha scelto (compreso tutto l'avvicinamento di chi non
 * sceglierà mai), positiva per il ramo destro, negativa per il sinistro (vedi
 * turnSign), torna esattamente a 0 quando il riallineamento è completo.
 *
 * `motionScale` scala l'ampiezza senza toccare la cadenza temporale: vedi
 * curveMotionScale. Il default 1 è il comportamento pieno.
 */
export function worldYawFor(path: PathState, motionScale = 1): number {
  return turnAmount(path) * MAX_WORLD_YAW * motionScale;
}

/**
 * Inclinazione (radianti) della mucca sul fianco, attorno all'asse Z del suo
 * gruppo (non del pivot che rotola in avanti: vedi player-view.ts). Stesso
 * verso e stessa cadenza temporale di worldYawFor: la mucca si piega DENTRO
 * la curva nello stesso momento in cui il mondo comincia a ruotarle intorno,
 * così le due animazioni si leggono come un solo movimento coordinato invece
 * di due effetti scollegati. Stesso `motionScale` di worldYawFor: deve essere
 * lo STESSO valore nella stessa chiamata, altrimenti mondo e mucca si
 * piegherebbero di quantità diverse e il movimento tornerebbe a leggersi
 * come due effetti scollegati.
 */
export function playerTiltFor(path: PathState, motionScale = 1): number {
  return turnAmount(path) * MAX_PLAYER_TILT * motionScale;
}

/**
 * Rollio (radianti) della camera attorno al proprio asse di vista: il tocco
 * che inclina l'orizzonte. Stesso verso e stessa cadenza di worldYawFor, ma
 * ampiezza molto più piccola (CONFIG.render.curve.maxCameraRollDeg): è un
 * accento, non deve disorientare come farebbe un rollio marcato applicato
 * proprio all'inquadratura. Stesso `motionScale` degli altri due (vedi
 * curveMotionScale): è il più importante dei tre da ridurre, perché è
 * l'unico che inclina davvero l'orizzonte.
 */
export function cameraRollFor(path: PathState, motionScale = 1): number {
  return turnAmount(path) * MAX_CAMERA_ROLL * motionScale;
}
