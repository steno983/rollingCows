import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { cameraDistanceFor } from './camera-rig';
import { isSceneryVisible, type SceneryItem, sceneryForChunk, sceneryHalfSpread } from './scenery';

describe('sceneryForChunk', () => {
  it('genera sempre lo stesso layout per lo stesso chunk', () => {
    const a: SceneryItem[] = [];
    const b: SceneryItem[] = [];
    sceneryForChunk(3, a);
    sceneryForChunk(3, b);
    expect(a).toEqual(b);
    expect(a.length).toBe(CONFIG.render.scenery.itemsPerChunk);
  });

  it('genera layout diversi per chunk diversi', () => {
    const a: SceneryItem[] = [];
    const b: SceneryItem[] = [];
    sceneryForChunk(1, a);
    sceneryForChunk(2, b);
    expect(a).not.toEqual(b);
  });

  it('non mette MAI un oggetto dentro o vicino al corridoio giocabile', () => {
    const corridorHalf = CONFIG.world.trackWidth / 2;
    const items: SceneryItem[] = [];
    for (let chunk = 0; chunk < 500; chunk += 1) {
      items.length = 0;
      sceneryForChunk(chunk, items);
      for (const item of items) {
        expect(Math.abs(item.x)).toBeGreaterThanOrEqual(CONFIG.render.scenery.minLateral);
        expect(Math.abs(item.x)).toBeGreaterThan(corridorHalf);
        expect(Math.abs(item.x)).toBeLessThanOrEqual(CONFIG.render.scenery.maxLateral);
      }
    }
  });

  it('distribuisce gli oggetti su entrambi i lati', () => {
    const items: SceneryItem[] = [];
    let left = 0;
    let right = 0;
    for (let chunk = 0; chunk < 200; chunk += 1) {
      items.length = 0;
      sceneryForChunk(chunk, items);
      for (const item of items) {
        if (item.x < 0) left += 1;
        else right += 1;
      }
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    // nessuno dei due lati deve prendersi più del 70% degli oggetti
    const total = left + right;
    expect(left / total).toBeLessThan(0.7);
    expect(right / total).toBeLessThan(0.7);
  });

  it('tiene z dentro la lunghezza del chunk e la scala nei limiti', () => {
    const items: SceneryItem[] = [];
    sceneryForChunk(11, items);
    for (const item of items) {
      expect(item.z).toBeGreaterThanOrEqual(0);
      expect(item.z).toBeLessThan(CONFIG.world.chunkLength);
      expect(item.scale).toBeGreaterThanOrEqual(CONFIG.render.scenery.minScale);
      expect(item.scale).toBeLessThanOrEqual(CONFIG.render.scenery.maxScale);
    }
  });

  it('riusa l array passato senza allocarne uno nuovo', () => {
    const items: SceneryItem[] = [];
    sceneryForChunk(1, items);
    const first = items;
    sceneryForChunk(2, items);
    expect(items).toBe(first);
    expect(items.length).toBe(CONFIG.render.scenery.itemsPerChunk);
  });
});

describe('sceneryHalfSpread', () => {
  it("cresce con il fov e con il rapporto d'aspetto", () => {
    expect(sceneryHalfSpread(64, 1.78)).toBeGreaterThan(sceneryHalfSpread(56, 1.78));
    expect(sceneryHalfSpread(60, 1.78)).toBeGreaterThan(sceneryHalfSpread(60, 0.46));
  });

  it('a 90° e aspetto 1 la semiapertura vale esattamente la distanza', () => {
    expect(sceneryHalfSpread(90, 1)).toBeCloseTo(1, 6);
  });
});

describe('isSceneryVisible', () => {
  const spread = sceneryHalfSpread(60, 1.78);
  const cull = CONFIG.render.scenery;

  it('tiene ciò che sta davanti alla camera e dentro il cono', () => {
    expect(isSceneryVisible(0, 40, 1, 0, spread)).toBe(true);
    expect(isSceneryVisible(20, 40, 1, 0, spread)).toBe(true);
  });

  it('scarta ciò che è finito dietro la camera', () => {
    expect(isSceneryVisible(0, -cull.cullBehindZ + 1, 1, 0, spread)).toBe(true);
    expect(isSceneryVisible(0, -cull.cullBehindZ - 1, 1, 0, spread)).toBe(false);
  });

  it('scarta ciò che è oltre la nebbia, dove è comunque un blocco di colore', () => {
    expect(isSceneryVisible(0, CONFIG.render.fogFar - 1, 1, 0, spread)).toBe(true);
    expect(isSceneryVisible(0, CONFIG.render.fogFar + 1, 1, 0, spread)).toBe(false);
  });

  it('scarta ciò che è troppo di lato per la distanza a cui si trova', () => {
    // Vicino il cono è stretto: l'estremo laterale della scenografia (46) non
    // può starci dentro; lontano lo stesso x ci sta comodamente.
    expect(isSceneryVisible(CONFIG.render.scenery.maxLateral, 2, 1, 0, spread)).toBe(false);
    expect(isSceneryVisible(CONFIG.render.scenery.maxLateral, 80, 1, 0, spread)).toBe(true);
  });

  it('non toglie mai di scena ciò che la piegata del bivio sta portando dentro', () => {
    // Cono stretto (telefono in verticale) per avere un caso netto. Elemento
    // lontano e molto laterale, fuori campo a mondo dritto: la rotazione
    // massima del gruppo-mondo se lo porta davanti, e ignorarla lo farebbe
    // sparire proprio durante il bivio.
    const portrait = sceneryHalfSpread(60, 0.46);
    const yaw = (CONFIG.render.curve.maxWorldTiltDeg * Math.PI) / 180;
    const x = -60;
    const z = 100;
    expect(isSceneryVisible(x, z, 1, 0, portrait)).toBe(false);
    expect(isSceneryVisible(x, z, Math.cos(yaw), Math.sin(yaw), portrait)).toBe(true);
  });

  it('un margine laterale esplicito salva chi è appena fuori dal bordo', () => {
    // cullMarginX esiste perché un modello ha una larghezza: il suo centro può
    // uscire dal cono mentre metà della baita è ancora inquadrata.
    const z = 50;
    const edge = (z + cameraDistanceFor(CONFIG.avalanche.maxSize)) * spread;
    expect(isSceneryVisible(edge + cull.cullMarginX - 1, z, 1, 0, spread)).toBe(true);
    expect(isSceneryVisible(edge + cull.cullMarginX + 2, z, 1, 0, spread)).toBe(false);
  });
});
