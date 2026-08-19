import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { sceneryForChunk, type SceneryItem } from './scenery';

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
