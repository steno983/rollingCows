import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createSnowfall, injectSnowFragment, injectSnowVertex } from './snowfall';

const cfg = CONFIG.render.snowfall;

/** Le posizioni sono un BufferAttribute (non interleaved): la funzione lo
 *  verifica e restringe il tipo, così il test può leggere `version` senza
 *  nessun cast. */
function positionAttribute(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const attribute = geometry.getAttribute('position');
  if (!(attribute instanceof THREE.BufferAttribute)) {
    throw new Error('snowfall: la posizione dovrebbe essere un BufferAttribute');
  }
  return attribute;
}

describe('createSnowfall', () => {
  it('il gruppo contiene un solo oggetto disegnabile: una draw call', () => {
    const snow = createSnowfall();
    expect(snow.group.children).toHaveLength(1);
    expect(snow.group.children[0]).toBe(snow.points);
    expect(snow.points).toBeInstanceOf(THREE.Points);
  });

  it('crea count fiocchi dentro il volume dichiarato in config', () => {
    const snow = createSnowfall();
    const position = positionAttribute(snow.points.geometry);
    expect(position.count).toBe(cfg.count);
    for (let i = 0; i < position.count; i += 1) {
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(cfg.areaWidth / 2);
      expect(position.getY(i)).toBeGreaterThanOrEqual(0);
      expect(position.getY(i)).toBeLessThan(cfg.areaHeight);
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(cfg.areaDepth);
    }
  });

  it('la distribuzione è deterministica: due istanze sono identiche', () => {
    const a = positionAttribute(createSnowfall().points.geometry);
    const b = positionAttribute(createSnowfall().points.geometry);
    expect(Array.from(a.array)).toEqual(Array.from(b.array));
  });

  it('non è mai soggetto a frustum culling e non scrive profondità', () => {
    const snow = createSnowfall();
    expect(snow.points.frustumCulled).toBe(false);
    expect(snow.points.material.depthWrite).toBe(false);
    expect(snow.points.material.transparent).toBe(true);
    expect(snow.points.material.fog).toBe(false);
    expect(snow.points.material.sizeAttenuation).toBe(true);
  });
});

describe('snowfall update', () => {
  it('non ricrea geometrie o materiali e non tocca un solo buffer', () => {
    const snow = createSnowfall();
    const geometry = snow.points.geometry;
    const material = snow.points.material;
    const position = positionAttribute(geometry);
    const versionBefore = position.version;

    for (let i = 0; i < 120; i += 1) snow.update(1 / 60, 30, i * 0.1, i * 0.5);

    expect(snow.points.geometry).toBe(geometry);
    expect(snow.points.material).toBe(material);
    expect(positionAttribute(snow.points.geometry)).toBe(position);
    // `version` cresce solo quando qualcuno chiede un nuovo upload: se resta
    // al valore iniziale, in 120 frame la CPU non ha mandato nulla alla GPU.
    expect(position.version).toBe(versionBefore);
  });

  it('aggancia il volume alla camera sul piano orizzontale, mai in quota', () => {
    const snow = createSnowfall();
    snow.update(1 / 60, 30, 3.5, -12.25);
    expect(snow.group.position.x).toBe(3.5);
    expect(snow.group.position.z).toBe(-12.25);
    expect(snow.group.position.y).toBe(0);
  });

  it('la caduta accumulata resta avvolta dentro areaHeight', () => {
    const snow = createSnowfall();
    // Molto più di una partita intera: l'accumulatore non deve crescere mai.
    for (let i = 0; i < 5000; i += 1) snow.update(0.05, CONFIG.world.maxSpeed, 0, 0);
    expect(snow.uniforms.uFallen.value).toBeGreaterThanOrEqual(0);
    expect(snow.uniforms.uFallen.value).toBeLessThan(cfg.areaHeight);
    expect(snow.uniforms.uSwayTime.value).toBeGreaterThanOrEqual(0);
    expect(snow.uniforms.uSwayTime.value).toBeLessThan(Math.PI * 2);
  });

  it('a velocità di partenza la neve scende dritta, a velocità massima è inclinata', () => {
    const snow = createSnowfall();
    snow.update(1 / 60, CONFIG.world.startSpeed, 0, 0);
    expect(snow.uniforms.uTilt.value).toBe(0);
    snow.update(1 / 60, CONFIG.world.maxSpeed, 0, 0);
    expect(snow.uniforms.uTilt.value).toBeCloseTo(cfg.speedInfluence, 6);
  });

  it('più si va forte più i fiocchi cadono in fretta', () => {
    const slow = createSnowfall();
    const fast = createSnowfall();
    slow.update(0.1, CONFIG.world.startSpeed, 0, 0);
    fast.update(0.1, CONFIG.world.maxSpeed, 0, 0);
    expect(fast.uniforms.uFallen.value).toBeGreaterThan(slow.uniforms.uFallen.value);
    expect(slow.uniforms.uFallen.value).toBeCloseTo(cfg.fallSpeed * 0.1, 6);
  });
});

describe('snowfall setIntensity', () => {
  it('riduce davvero il numero di punti disegnati, senza ricostruire nulla', () => {
    const snow = createSnowfall();
    const geometry = snow.points.geometry;
    const position = positionAttribute(geometry);

    expect(geometry.drawRange.count).toBe(cfg.count);
    snow.setIntensity(0.5);
    expect(geometry.drawRange.count).toBe(Math.round(cfg.count / 2));
    expect(snow.points.geometry).toBe(geometry);
    expect(positionAttribute(geometry)).toBe(position);
    expect(position.version).toBe(0);
  });

  it('a zero il gruppo non disegna più nulla, e si torna indietro', () => {
    const snow = createSnowfall();
    snow.setIntensity(0);
    expect(snow.points.geometry.drawRange.count).toBe(0);
    expect(snow.points.visible).toBe(false);
    snow.setIntensity(1);
    expect(snow.points.geometry.drawRange.count).toBe(cfg.count);
    expect(snow.points.visible).toBe(true);
  });

  it('clampa i valori fuori intervallo invece di chiedere alla GPU assurdità', () => {
    const snow = createSnowfall();
    snow.setIntensity(4);
    expect(snow.points.geometry.drawRange.count).toBe(cfg.count);
    snow.setIntensity(-1);
    expect(snow.points.geometry.drawRange.count).toBe(0);
  });
});

describe('innesto sullo shader dei Points di three', () => {
  // Regressione contro un aggiornamento di three: se un include cambia nome,
  // la neve smetterebbe di cadere in silenzio e solo a runtime.
  it('il vertex shader vero di three accetta tutti e tre gli innesti', () => {
    const source = THREE.ShaderLib.points.vertexShader;
    const injected = injectSnowVertex(source);
    expect(injected).toContain('attribute vec2 aFlake;');
    expect(injected).toContain('uniform float uFallen;');
    expect(injected).toContain('mod(transformed.y - uFallen, SNOW_HEIGHT)');
    expect(injected).toContain('gl_PointSize = size * aFlake.x;');
    expect(injected).not.toContain('gl_PointSize = size;');
  });

  it('il fragment shader vero di three accetta la maschera tonda', () => {
    const injected = injectSnowFragment(THREE.ShaderLib.points.fragmentShader);
    expect(injected).toContain('gl_PointCoord');
    expect(injected).toContain('#include <color_fragment>');
  });

  it('se un marcatore sparisce fallisce subito e a voce alta', () => {
    expect(() => injectSnowVertex('void main() {}')).toThrow(/marcatore/);
    expect(() => injectSnowFragment('void main() {}')).toThrow(/marcatore/);
  });
});
