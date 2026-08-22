import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  contactShadowAlpha,
  createContactShadowMesh,
  createContactShadowTexture,
} from './contact-shadow';
import { PALETTE } from './models';

describe('contactShadowAlpha', () => {
  it('è piena al centro, nulla al bordo e non risale mai', () => {
    expect(contactShadowAlpha(0)).toBe(1);
    expect(contactShadowAlpha(1)).toBe(0);
    expect(contactShadowAlpha(1.4)).toBe(0);
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 40; i += 1) {
      const value = contactShadowAlpha(i / 40);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('tiene un nucleo pieno per metà raggio: è un contatto, non una nuvola', () => {
    // Una rampa lineare pura svanisce subito e legge come sporco sulla neve.
    expect(contactShadowAlpha(0.45)).toBeCloseTo(0.72, 6);
    expect(contactShadowAlpha(0.45)).toBeGreaterThan(1 - 0.45);
  });
});

describe('createContactShadowTexture', () => {
  const texture = createContactShadowTexture();
  const size = texture.image.width;
  const data = texture.image.data;

  function alphaAt(x: number, y: number): number {
    return data[(y * size + x) * 4 + 3] ?? -1;
  }

  it('non tocca il DOM: è una DataTexture, e i test girano senza document', () => {
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(size).toBe(texture.image.height);
    expect(data).toHaveLength(size * size * 4);
  });

  it('è opaca al centro e trasparente agli angoli', () => {
    expect(alphaAt(size / 2, size / 2)).toBeGreaterThan(240);
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(size - 1, size - 1)).toBe(0);
  });

  it('è simmetrica: il disco non è spostato di mezzo texel', () => {
    for (const [x, y] of [
      [4, size / 2],
      [size / 2, 4],
      [8, 8],
    ]) {
      expect(alphaAt(x ?? 0, y ?? 0)).toBe(alphaAt(size - 1 - (x ?? 0), size - 1 - (y ?? 0)));
    }
  });

  it("è del blu dell'ombra del ghiaccio, non grigia: su neve il grigio è sporco", () => {
    const hex = PALETTE[20] ?? 0;
    const i = ((size / 2) * size + size / 2) * 4;
    expect(data[i]).toBe((hex >> 16) & 0xff);
    expect(data[i + 1]).toBe((hex >> 8) & 0xff);
    expect(data[i + 2]).toBe(hex & 0xff);
  });

  it('è filtrata e con mipmap: da lontano un disco NEAREST scintilla', () => {
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.generateMipmaps).toBe(true);
  });
});

describe('createContactShadowMesh', () => {
  it('nasce vuota, fuori scena e senza frustum culling', () => {
    const mesh = createContactShadowMesh(12, 0.3);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
  });

  it('non scrive la profondità: due ombre sovrapposte devono leggersi', () => {
    const mesh = createContactShadowMesh(4, 0.25);
    const material = mesh.material;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBe(0.25);
  });

  it('il quad è orizzontale: sta sulla neve, non in piedi contro la camera', () => {
    const mesh = createContactShadowMesh(1, 0.3);
    const normal = mesh.geometry.getAttribute('normal');
    expect(normal.getY(0)).toBeCloseTo(1, 6);
  });
});
