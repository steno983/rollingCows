import * as THREE from 'three';
import { PALETTE } from './models';

/**
 * Ombra di contatto finta: un quad orizzontale con un gradiente radiale,
 * istanziato una volta per oggetto che deve "toccare" il terreno.
 *
 * Nasce per la scenografia (render/scenery.ts) e serve ora anche agli ostacoli
 * SOSPESI (render/entities-view.ts), che sono il caso in cui informa di più:
 * un'ombra esattamente sotto un oggetto staccato dal suolo dice due cose
 * insieme — che l'oggetto è in quota e a che distanza si trova — e sono
 * proprio le due cose che su una distesa bianca e piatta non si leggono.
 *
 * Perché non l'ombra VERA: la shadow map del sole copre una fascia stretta
 * (vedi CONFIG.render.shadow, ±16 in x e fino a z = 80) ed è proiettata dalla
 * direzione del sole, quindi cade di lato e più lontano dell'oggetto — utile
 * per il volume, inutile per dire "questo sta sopra di te". Oltre gli 80 di
 * profondità non c'è affatto, ed è esattamente la distanza da cui un sospeso
 * va letto.
 */

/** Lato della texture, in texel. Potenza di due: serve per le mipmap, che a
 *  distanza sono ciò che tiene l'ombra un disco morbido invece di un disco
 *  scintillante. */
const TEXTURE_SIZE = 64;

/** Gli stop del gradiente: opaco al centro, ancora al 72% a metà raggio, nullo
 *  al bordo. La caduta lenta nella prima metà è ciò che dà il nucleo scuro;
 *  una rampa lineare pura legge come una nuvola, non come un contatto. */
const CORE_STOP = 0.45;
const CORE_ALPHA = 0.72;

/** Alfa del gradiente a distanza `r` dal centro, in raggi (0 al centro, 1 al
 *  bordo del quad). */
export function contactShadowAlpha(r: number): number {
  if (r >= 1) return 0;
  if (r <= CORE_STOP) return 1 - (r / CORE_STOP) * (1 - CORE_ALPHA);
  return CORE_ALPHA * (1 - (r - CORE_STOP) / (1 - CORE_STOP));
}

/**
 * La texture del gradiente, calcolata a mano in una DataTexture invece che
 * disegnata su un canvas 2D. Due motivi: non serve il DOM (i test girano in
 * ambiente `node`, dove document non esiste), e la rampa resta un pezzo di
 * codice verificabile — vedi contactShadowAlpha, che i test controllano.
 *
 * Il colore non è nero ma il blu di PALETTE[20], l'ombra del ghiaccio: su una
 * distesa di neve un'ombra grigia legge come sporco.
 */
export function createContactShadowTexture(): THREE.DataTexture {
  const hex = PALETTE[20] ?? 0x2b4a63;
  const red = (hex >> 16) & 0xff;
  const green = (hex >> 8) & 0xff;
  const blue = hex & 0xff;

  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const half = TEXTURE_SIZE / 2;
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      // +0.5: si campiona il CENTRO del texel, altrimenti il disco esce
      // spostato di mezzo texel verso l'origine e non è più simmetrico.
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const i = (y * TEXTURE_SIZE + x) * 4;
      data[i] = red;
      data[i + 1] = green;
      data[i + 2] = blue;
      data[i + 3] = Math.round(contactShadowAlpha(Math.hypot(dx, dy)) * 255);
    }
  }

  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE);
  texture.colorSpace = THREE.SRGBColorSpace;
  // DataTexture nasce con il filtro NEAREST e senza mipmap: lasciarlo così
  // vorrebbe dire un'ombra a scalini da vicino e un lampeggio da lontano.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * L'InstancedMesh delle ombre: UNA draw call per tutta la famiglia, qualunque
 * sia il numero di oggetti a schermo. Chi la usa scrive le matrici e poi
 * `count`, come per ogni altra InstancedMesh del progetto.
 *
 * Il quad nasce orizzontale (PlaneGeometry è verticale) e si scala in x e z:
 * una scala non uniforme è voluta, perché l'impronta di un cornicione largo
 * quattro unità e profondo una non è un disco.
 */
export function createContactShadowMesh(capacity: number, opacity: number): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    opacity,
    // Il quad è appoggiato sul pendio e va letto attraverso: scrivere la
    // profondità farebbe sparire le ombre che si sovrappongono fra loro.
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  // Come per ogni altra InstancedMesh della scena: il volume di delimitazione
  // non segue le istanze, che vivono fuori dalla geometria base.
  mesh.frustumCulled = false;
  return mesh;
}
