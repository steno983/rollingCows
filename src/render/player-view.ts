import * as THREE from 'three';
import { CONFIG } from '../game/config';
import type { PlayerState } from '../game/player';
import { MODELS, buildGeometry } from './models';

export interface PlayerView {
  sync(player: PlayerState, size: number, speed: number, dt: number, shielded: boolean): void;
  group: THREE.Group;
}

/**
 * Crescita visiva per taglia. È una costante di resa, non di bilanciamento:
 * la collisione reale (game/collisions.ts, playerBox) non ha affatto una
 * larghezza laterale — verifica solo quota e profondità, perché il
 * giocatore è sempre al centro del ramo attivo — quindi non esiste un
 * equivalente in CONFIG.player da tenere sincronizzato con questa costante.
 */
const PLAYER_SCALE_PER_SIZE = 0.18;
/** Quanto il modello si allarga in scivolata, come frazione dell'altezza
 *  perduta: 0.5 vuol dire che metà del volume "schiacciato" via dall'altezza
 *  si ridistribuisce su larghezza e profondità — il classico squash-and-
 *  stretch, che evita che la mucca sembri solo compressa e basta. */
const SLIDE_WIDEN_RATIO = 0.5;
/** Velocità di rotazione (rad/s) dell'alone dello scudo: lenta, non deve
 *  distrarre dall'azione. */
const SHIELD_SPIN_SPEED = 1.4;
/** Quanto l'alone è più grande della sagoma della mucca (in scala). */
const SHIELD_SCALE = 1.35;
const SHIELD_COLOR = 0x9fd8ff;
const SHIELD_OPACITY = 0.32;

export interface PlayerScale {
  x: number;
  y: number;
  z: number;
}

/**
 * Fattore di scala (x, y, z) del modello dato la taglia e lo stato di
 * scivolata. Logica pura, testabile senza three: Y si schiaccia esattamente
 * di CONFIG.player.slideHeightRatio (la sagoma di collisione fa lo stesso,
 * vedi game/collisions.ts — playerBox), X e Z si allargano un poco per
 * compensare visivamente il volume perso.
 */
export function playerModelScale(size: number, sliding: boolean): PlayerScale {
  const base = 1 + (size - 1) * PLAYER_SCALE_PER_SIZE;
  if (!sliding) {
    return { x: base, y: base, z: base };
  }
  const lost = 1 - CONFIG.player.slideHeightRatio;
  const widened = base * (1 + lost * SLIDE_WIDEN_RATIO);
  return { x: widened, y: base * CONFIG.player.slideHeightRatio, z: widened };
}

export function createPlayerView(): PlayerView {
  const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
  const box = geometry.boundingBox;
  const halfHeight = box === null ? 0.5 : (box.max.y - box.min.y) / 2;

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Il modello poggia a y = 0: abbassandolo di mezza altezza, il centro
  // geometrico finisce esattamente sull'origine del perno (che ruota).
  mesh.position.y = -halfHeight;

  // Alone dello scudo: una sfera più grande della mucca, semitrasparente,
  // nascosta quando lo scudo non è attivo. Non è un contorno vero (che
  // richiederebbe un secondo passaggio con le normali invertite): questa
  // sfera "aurea" è la scelta più economica compatibile con il budget di
  // draw call, ed è comunque leggibile come "protezione attiva". È figlia
  // di `group`, non di `pivot`: non deve rotolare con la mucca, solo
  // ruotare lentamente per conto suo.
  const shieldGeometry = new THREE.SphereGeometry(1, 12, 8);
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: SHIELD_COLOR,
    transparent: true,
    opacity: SHIELD_OPACITY,
    depthWrite: false,
  });
  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.visible = false;

  const pivot = new THREE.Group();
  pivot.add(mesh);
  const group = new THREE.Group();
  group.add(pivot);
  group.add(shield);

  let roll = 0;
  let shieldSpin = 0;

  function sync(player: PlayerState, size: number, speed: number, dt: number, shielded: boolean): void {
    const scale = playerModelScale(size, player.sliding);
    pivot.scale.set(scale.x, scale.y, scale.z);

    const radius = Math.max(halfHeight * scale.y, 0.001);
    // Segno POSITIVO, non invertirlo (era il difetto segnalato in v1: la
    // mucca sembrava rotolare all'indietro). Il mondo scorre verso la
    // camera lungo -z mentre la mucca resta ferma a schermo, come su un
    // tapis roulant: perché rotoli in avanti senza slittare, il suo punto
    // di contatto deve muoversi in accordo con quello scorrimento.
    roll = (roll + (speed * dt) / radius) % (Math.PI * 2);
    pivot.rotation.x = roll;

    // La mucca del giocatore è sempre a x = 0 in v2 (è il tracciato che si
    // sposta, non lei): nessun worldToViewX qui, a differenza di v1.
    group.position.set(0, player.y + radius, 0);

    shield.visible = shielded;
    if (shielded) {
      shieldSpin += dt * SHIELD_SPIN_SPEED;
      shield.rotation.y = shieldSpin;
      // L'alone segue la sagoma reale (compresa la scivolata): un raggio
      // fisso sembrerebbe fluttuante quando la mucca si appiattisce.
      shield.scale.set(scale.x * SHIELD_SCALE, scale.y * SHIELD_SCALE, scale.z * SHIELD_SCALE);
    }
  }

  return { sync, group };
}
