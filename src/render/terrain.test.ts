import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { heightAt } from './terrain';

/** Stessa semilarghezza del corridoio calcolata in terrain.ts. */
const CORRIDOR_HALF = (CONFIG.world.laneCount * CONFIG.world.laneWidth) / 2;
const LENGTH = CONFIG.world.chunkLength;

describe('heightAt', () => {
  it('è 0 dentro il corridoio, per qualunque z', () => {
    for (const z of [0, 5, LENGTH / 4, LENGTH / 2, LENGTH, LENGTH * 3.7]) {
      for (const x of [0, 0.5, 1, -1, 2, -2, CORRIDOR_HALF, -CORRIDOR_HALF]) {
        expect(heightAt(x, z)).toBe(0);
      }
    }
  });

  it('è continua al bordo del corridoio: heightAt(±CORRIDOR_HALF, z) = 0', () => {
    for (const z of [0, 13, LENGTH / 3, LENGTH]) {
      expect(heightAt(CORRIDOR_HALF, z)).toBe(0);
      expect(heightAt(-CORRIDOR_HALF, z)).toBe(0);
    }
  });

  it('resta vicina a zero appena fuori dal corridoio (continuità)', () => {
    // Il termine ondulato dipende anche da x (non solo da z), quindi non è
    // garantito che sia >= 0 esattamente al bordo: ma con "outside" piccolo
    // (0.05 / CORRIDOR_HALF) il suo contributo resta minuscolo, quindi il
    // valore non può allontanarsi molto da 0 — niente salto discontinuo.
    for (const z of [0, LENGTH / 4, LENGTH / 2]) {
      const justOutside = heightAt(CORRIDOR_HALF + 0.05, z);
      expect(Math.abs(justOutside)).toBeLessThan(0.02);
    }
  });

  it('non scende mai sotto un minimo prossimo a zero, in nessun punto', () => {
    // Anche nel caso peggiore di fase dell'onda, il pendio non scava sotto lo
    // zero del corridoio se non di un'inezia (vedi commento in config.ts).
    let min = Infinity;
    for (let x = 0; x <= 120; x += 0.25) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h < min) min = h;
      }
    }
    expect(min).toBeGreaterThan(-0.1);
  });

  it('satura al tetto (MAX_LATERAL_RISE) oltre una certa distanza laterale: il termine quadratico non cresce più', () => {
    // Oltre la distanza di saturazione, "outside" resta fisso al tetto: le
    // uniche differenze residue fra due x lontani vengono dal termine
    // ondulato (che dipende anche da x, non solo da z), il cui contributo
    // massimo possibile è comunque limitato (2 * 0.09 * MAX_LATERAL_RISE *
    // WAVE_COEF ≈ 0.43) — molto meno di quanto il termine quadratico
    // crescerebbe se "outside" non fosse saturo.
    const farA = heightAt(50, 7);
    const farB = heightAt(113, 7);
    expect(Math.abs(farA - farB)).toBeLessThan(0.5);
  });

  it('è periodica su chunkLength: due chunk adiacenti combaciano', () => {
    for (const x of [4, 10, -30, 60]) {
      expect(heightAt(x, 0)).toBeCloseTo(heightAt(x, LENGTH), 10);
      expect(heightAt(x, 3.3)).toBeCloseTo(heightAt(x, 3.3 + LENGTH), 10);
    }
  });

  it('non supera mai il tetto teorico (~3.82 con la config di default)', () => {
    let max = -Infinity;
    for (let x = 0; x <= 120; x += 0.25) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h > max) max = h;
      }
    }
    expect(max).toBeLessThan(4);
  });
});
