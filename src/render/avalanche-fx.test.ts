import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../game/config';
import { createAvalancheFx } from './avalanche-fx';

const cfg = CONFIG.render.avalancheFx;
const MAX_INTENSITY = cfg.speedLineIntensity;

/** Fa scorrere `seconds` secondi a 60 fps con la stessa intensità richiesta. */
function run(fx: ReturnType<typeof createAvalancheFx>, seconds: number, intensity: number): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) fx.update(dt, intensity);
}

describe('createAvalancheFx', () => {
  it('nasce spento: fuori dalla valanga non paga nulla', () => {
    const fx = createAvalancheFx();
    expect(fx.object.visible).toBe(false);
    expect(fx.uniforms.uIntensity.value).toBe(0);
  });

  it('è un quad additivo, senza profondità, disegnato per ultimo', () => {
    const fx = createAvalancheFx();
    expect(fx.object.material.blending).toBe(THREE.AdditiveBlending);
    expect(fx.object.material.transparent).toBe(true);
    expect(fx.object.material.depthTest).toBe(false);
    expect(fx.object.material.depthWrite).toBe(false);
    expect(fx.object.renderOrder).toBeGreaterThan(0);
    // Il vertex shader ignora ogni matrice: senza questo il quad sparirebbe
    // appena la camera si allontana dall'origine.
    expect(fx.object.frustumCulled).toBe(false);
  });

  it('copre lo schermo a qualunque aspect e FOV perché disegna in clip space', () => {
    const fx = createAvalancheFx();
    const vertexShader = fx.object.material.vertexShader;
    // La proprietà che rende l'effetto indipendente da FOV e aspect è proprio
    // questa: nessuna matrice nel calcolo di gl_Position.
    expect(vertexShader).toContain('gl_Position = vec4(position.xy, 0.0, 1.0);');
    expect(vertexShader).not.toContain('projectionMatrix');
    expect(vertexShader).not.toContain('modelViewMatrix');
    // ...e il quad copre esattamente [-1,1] in NDC.
    fx.object.geometry.computeBoundingBox();
    const box = fx.object.geometry.boundingBox;
    expect(box?.min.x).toBeCloseTo(-1, 6);
    expect(box?.max.x).toBeCloseTo(1, 6);
    expect(box?.min.y).toBeCloseTo(-1, 6);
    expect(box?.max.y).toBeCloseTo(1, 6);
  });
});

describe('avalanche-fx update', () => {
  it('sale con una rampa invece di accendersi di scatto', () => {
    const fx = createAvalancheFx();
    fx.update(1 / 60, 1);
    expect(fx.object.visible).toBe(true);
    expect(fx.uniforms.uIntensity.value).toBeGreaterThan(0);
    expect(fx.uniforms.uIntensity.value).toBeLessThan(MAX_INTENSITY * 0.2);

    run(fx, 1, 1);
    expect(fx.uniforms.uIntensity.value).toBeCloseTo(MAX_INTENSITY, 6);
  });

  it('scende con una rampa e finisce esattamente a zero, spegnendo il quad', () => {
    const fx = createAvalancheFx();
    run(fx, 1, 1);

    fx.update(1 / 60, 0);
    expect(fx.object.visible).toBe(true);
    expect(fx.uniforms.uIntensity.value).toBeLessThan(MAX_INTENSITY);
    expect(fx.uniforms.uIntensity.value).toBeGreaterThan(0);

    run(fx, 2, 0);
    // Zero esatto, non "quasi zero": è quel valore a spegnere il quad.
    expect(fx.uniforms.uIntensity.value).toBe(0);
    expect(fx.object.visible).toBe(false);
    // Il tempo riparte da zero a ogni valanga: non cresce mai abbastanza da
    // perdere precisione.
    expect(fx.uniforms.uTime.value).toBe(0);
  });

  it("l'intensità richiesta è clampata a [0,1]", () => {
    const fx = createAvalancheFx();
    run(fx, 2, 12);
    expect(fx.uniforms.uIntensity.value).toBeCloseTo(MAX_INTENSITY, 6);

    const half = createAvalancheFx();
    run(half, 2, 0.5);
    expect(half.uniforms.uIntensity.value).toBeCloseTo(MAX_INTENSITY * 0.5, 6);

    const negative = createAvalancheFx();
    run(negative, 1, -3);
    expect(negative.uniforms.uIntensity.value).toBe(0);
    expect(negative.object.visible).toBe(false);
  });

  it("il tempo avanza solo mentre l'effetto è acceso", () => {
    const fx = createAvalancheFx();
    run(fx, 0.5, 0);
    expect(fx.uniforms.uTime.value).toBe(0);
    run(fx, 0.5, 1);
    expect(fx.uniforms.uTime.value).toBeGreaterThan(0.4);
  });

  it('non alloca: geometria e materiale restano gli stessi oggetti', () => {
    const fx = createAvalancheFx();
    const geometry = fx.object.geometry;
    const material = fx.object.material;
    const color = fx.uniforms.uColor.value;
    run(fx, 3, 1);
    run(fx, 3, 0);
    expect(fx.object.geometry).toBe(geometry);
    expect(fx.object.material).toBe(material);
    expect(fx.uniforms.uColor.value).toBe(color);
  });
});

describe('avalanche-fx e riduzione del movimento', () => {
  it("attenua l'effetto con lo stesso moltiplicatore degli altri indizi di velocità", () => {
    const scale = CONFIG.render.reducedMotion.speedJitterScale;
    const fx = createAvalancheFx();
    fx.setReducedMotion(true);
    run(fx, 3, 1);
    expect(fx.uniforms.uIntensity.value).toBeCloseTo(MAX_INTENSITY * scale, 6);
    // Con il moltiplicatore a 0 (valore attuale di config) il quad deve
    // proprio sparire dal rendering, non restare acceso a intensità nulla.
    expect(fx.object.visible).toBe(scale > 0);
  });

  it("riaccendendo il movimento l'effetto torna, sempre con la rampa", () => {
    const fx = createAvalancheFx();
    fx.setReducedMotion(true);
    run(fx, 2, 1);
    fx.setReducedMotion(false);
    fx.update(1 / 60, 1);
    expect(fx.uniforms.uIntensity.value).toBeLessThan(MAX_INTENSITY);
    run(fx, 1, 1);
    expect(fx.uniforms.uIntensity.value).toBeCloseTo(MAX_INTENSITY, 6);
  });
});

describe('avalanche-fx dispose', () => {
  it('libera geometria e materiale', () => {
    const fx = createAvalancheFx();
    const geometry = vi.spyOn(fx.object.geometry, 'dispose');
    const material = vi.spyOn(fx.object.material, 'dispose');
    fx.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });
});
