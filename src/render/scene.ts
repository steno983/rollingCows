import * as THREE from 'three';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraFovFor,
  cameraHeightFor,
  decayShake,
} from './camera-rig';

/** Seed fisso del jitter dello shake: l'unica sorgente di casualità della vista
 *  passa anche lei dall'unico meccanismo di casualità della codebase (l'Rng con
 *  seed), invece di Math.random(). Non è l'Rng di gioco: uno shake non deve
 *  consumarne la sequenza né renderla dipendente dal frame rate della resa. */
const SHAKE_SEED = 0x5eed_c0de;

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
  update(dt: number, size: number, avalanche: boolean): void;
  shake(amount: number): void;
  render(): void;
  setQuality(low: boolean): void;
}

/** Colori dell'ambiente: scelte estetiche, non numeri di bilanciamento. */
const SKY_TOP = '#1f5fa8';
const SKY_MID = '#7fb6e8';
const SKY_HORIZON = '#e8f4ff';
const FOG_COLOR = 0xdfeeff;
const SUN_COLOR = 0xfff4e0;
const SKY_LIGHT = 0xbfd9ff;
const GROUND_LIGHT = 0xf2f7ff;

/** Punto verso cui la camera guarda: davanti alla mucca, poco sopra la neve. */
const LOOK_AHEAD_Z = 9;
const LOOK_AT_Y = 1.4;
/** Velocità (1/s) con cui distanza, altezza e FOV raggiungono il valore obiettivo. */
const RIG_RATE = CONFIG.render.shakeDecay;
/** Tetto dello scuotimento accumulabile, in unità di mondo. */
const MAX_SHAKE = 1.2;

function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Contesto 2D non disponibile per la texture del cielo');
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(0.55, SKY_MID);
  gradient.addColorStop(1, SKY_HORIZON);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  return texture;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !coarsePointer,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = createSkyTexture();
  scene.fog = new THREE.Fog(FOG_COLOR, CONFIG.render.fogNear, CONFIG.render.fogFar);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.render.cameraBaseFov,
    1,
    0.1,
    CONFIG.render.fogFar + 60,
  );

  const hemisphere = new THREE.HemisphereLight(SKY_LIGHT, GROUND_LIGHT, 1.1);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.35);
  sun.position.set(14, 26, -10);
  sun.target.position.set(0, 0, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0015;
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const lookAt = new THREE.Vector3(0, LOOK_AT_Y, LOOK_AHEAD_Z);
  const shakeRng = createRng(SHAKE_SEED);
  let shakeAmount = 0;
  let fovT = 1;
  let lastAvalanche = false;
  let distance = cameraDistanceFor(1);
  let height = cameraHeightFor(1);

  function resize(): void {
    const width = Math.max(1, window.innerWidth);
    const heightPx = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio),
    );
    // updateStyle = false: la dimensione CSS del canvas la impone main.ts.
    renderer.setSize(width, heightPx, false);
    camera.aspect = width / heightPx;
    camera.updateProjectionMatrix();
  }

  function update(dt: number, size: number, avalanche: boolean): void {
    if (avalanche !== lastAvalanche) {
      lastAvalanche = avalanche;
      fovT = 0;
    }
    fovT = Math.min(1, fovT + dt * RIG_RATE);
    const fov = cameraFovFor(avalanche, fovT);
    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const k = Math.min(1, dt * RIG_RATE);
    distance += (cameraDistanceFor(size) - distance) * k;
    height += (cameraHeightFor(size) - height) * k;

    shakeAmount = decayShake(shakeAmount, dt);
    const offsetX = (shakeRng.next() * 2 - 1) * shakeAmount;
    const offsetY = (shakeRng.next() * 2 - 1) * shakeAmount;
    camera.position.set(offsetX, height + offsetY, -distance);
    camera.lookAt(lookAt);
  }

  function shake(amount: number): void {
    shakeAmount = Math.min(MAX_SHAKE, shakeAmount + amount);
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  function setQuality(low: boolean): void {
    sun.castShadow = !low;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.needsUpdate = true;
    hemisphere.intensity = low ? 1.35 : 1.1;
  }

  resize();
  camera.position.set(0, height, -distance);
  camera.lookAt(lookAt);

  return { renderer, scene, camera, resize, update, shake, render, setQuality };
}
