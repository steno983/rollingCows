import { CONFIG } from '../game/config';
import { branchOffsetX, type PathState } from '../game/path';

const DEG_TO_RAD = Math.PI / 180;
const MAX_WORLD_YAW = CONFIG.render.curve.maxWorldTiltDeg * DEG_TO_RAD;
const MAX_PLAYER_TILT = CONFIG.render.curve.maxPlayerTiltDeg * DEG_TO_RAD;
const MAX_CAMERA_ROLL = CONFIG.render.curve.maxCameraRollDeg * DEG_TO_RAD;

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
 * Intensità 0..1 della piegata, indipendente dal verso. Sale durante
 * 'committed' (la biforcazione si avvicina da commitZ a 0: il ramo è già
 * bloccato, chooseBranch non può più cambiarlo) e ridiscende durante
 * 'realigning', riusando `path.realignProgress` già calcolato da
 * game/path.ts — stessa base temporale della traslazione offsetX, quindi le
 * due animazioni restano sincronizzate. Zero in 'none' e 'approaching': è
 * cruciale restare a zero durante 'approaching', perché lì la scelta può
 * ancora cambiare idea (chooseBranch funziona solo in quella fase) e offsetX
 * stesso resta a 0 — se l'intensità iniziasse a crescere già lì, cambiare
 * ramo produrrebbe uno scatto di segno a metà salita. Bloccando la crescita
 * a 'committed' in poi (ramo ormai irrevocabile) l'unico punto in cui il
 * segno può cambiare è quando l'intensità è già a zero: nessuno scatto
 * possibile.
 */
function turnIntensity(path: PathState): number {
  if (path.phase === 'committed') {
    const commitZ = CONFIG.path.commitZ;
    if (commitZ <= 0) return 1;
    return ease((commitZ - path.forkZ) / commitZ);
  }
  if (path.phase === 'realigning') {
    return ease(1 - path.realignProgress);
  }
  return 0;
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
  if (path.phase !== 'committed' && path.phase !== 'realigning') return 0;
  const offset = branchOffsetX(path, path.activeBranch);
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
 * quando non c'è un bivio in corso (fasi 'none' e 'approaching'), positiva
 * per il ramo destro, negativa per il sinistro (vedi turnSign), torna
 * esattamente a 0 quando il riallineamento è completo.
 */
export function worldYawFor(path: PathState): number {
  return turnAmount(path) * MAX_WORLD_YAW;
}

/**
 * Inclinazione (radianti) della mucca sul fianco, attorno all'asse Z del suo
 * gruppo (non del pivot che rotola in avanti: vedi player-view.ts). Stesso
 * verso e stessa cadenza temporale di worldYawFor: la mucca si piega DENTRO
 * la curva nello stesso momento in cui il mondo comincia a ruotarle intorno,
 * così le due animazioni si leggono come un solo movimento coordinato invece
 * di due effetti scollegati.
 */
export function playerTiltFor(path: PathState): number {
  return turnAmount(path) * MAX_PLAYER_TILT;
}

/**
 * Rollio (radianti) della camera attorno al proprio asse di vista: il tocco
 * che inclina l'orizzonte. Stesso verso e stessa cadenza di worldYawFor, ma
 * ampiezza molto più piccola (CONFIG.render.curve.maxCameraRollDeg): è un
 * accento, non deve disorientare come farebbe un rollio marcato applicato
 * proprio all'inquadratura.
 */
export function cameraRollFor(path: PathState): number {
  return turnAmount(path) * MAX_CAMERA_ROLL;
}
