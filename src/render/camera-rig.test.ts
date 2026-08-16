import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraFovFor,
  cameraHeightFor,
  decayShake,
  worldToViewX,
} from './camera-rig';

describe('cameraDistanceFor', () => {
  it('a taglia 1 usa la distanza base', () => {
    expect(cameraDistanceFor(1)).toBeCloseTo(CONFIG.render.cameraBaseDistance, 10);
  });

  it('cresce di cameraDistancePerSize per ogni taglia', () => {
    expect(cameraDistanceFor(3)).toBeCloseTo(
      CONFIG.render.cameraBaseDistance + 2 * CONFIG.render.cameraDistancePerSize,
      10,
    );
    expect(cameraDistanceFor(5)).toBeCloseTo(
      CONFIG.render.cameraBaseDistance + 4 * CONFIG.render.cameraDistancePerSize,
      10,
    );
  });

  it('clampa fuori dall intervallo delle taglie valide', () => {
    expect(cameraDistanceFor(0)).toBeCloseTo(cameraDistanceFor(1), 10);
    expect(cameraDistanceFor(99)).toBeCloseTo(cameraDistanceFor(CONFIG.avalanche.maxSize), 10);
  });
});

describe('cameraHeightFor', () => {
  it('è proporzionale alla distanza, così l inclinazione resta costante', () => {
    const ratio1 = cameraHeightFor(1) / cameraDistanceFor(1);
    const ratio5 = cameraHeightFor(5) / cameraDistanceFor(5);
    expect(ratio1).toBeCloseTo(ratio5, 10);
    expect(cameraHeightFor(1)).toBeGreaterThan(0);
  });
});

describe('cameraFovFor', () => {
  it('parte dal FOV di partenza e arriva a quello di destinazione', () => {
    expect(cameraFovFor(true, 0)).toBeCloseTo(CONFIG.render.cameraBaseFov, 10);
    expect(cameraFovFor(true, 1)).toBeCloseTo(CONFIG.render.cameraAvalancheFov, 10);
    expect(cameraFovFor(false, 0)).toBeCloseTo(CONFIG.render.cameraAvalancheFov, 10);
    expect(cameraFovFor(false, 1)).toBeCloseTo(CONFIG.render.cameraBaseFov, 10);
  });

  it('a metà transizione sta strettamente in mezzo', () => {
    const mid = cameraFovFor(true, 0.5);
    expect(mid).toBeGreaterThan(CONFIG.render.cameraBaseFov);
    expect(mid).toBeLessThan(CONFIG.render.cameraAvalancheFov);
  });

  it('è monotona crescente entrando in valanga', () => {
    let previous = cameraFovFor(true, 0);
    for (let i = 1; i <= 10; i += 1) {
      const current = cameraFovFor(true, i / 10);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('clampa t fuori da [0,1]', () => {
    expect(cameraFovFor(true, -5)).toBeCloseTo(CONFIG.render.cameraBaseFov, 10);
    expect(cameraFovFor(true, 5)).toBeCloseTo(CONFIG.render.cameraAvalancheFov, 10);
  });
});

describe('decayShake', () => {
  it('con dt = 0 non cambia nulla', () => {
    expect(decayShake(0.5, 0)).toBeCloseTo(0.5, 10);
  });

  it('è indipendente dal frame rate', () => {
    const oneStep = decayShake(1, 0.5);
    const twoSteps = decayShake(decayShake(1, 0.25), 0.25);
    expect(twoSteps).toBeCloseTo(oneStep, 10);
  });

  it('decade secondo shakeDecay', () => {
    expect(decayShake(1, 1)).toBeCloseTo(Math.exp(-CONFIG.render.shakeDecay), 10);
  });

  it('arriva esattamente a zero e ci resta', () => {
    let value = 1;
    for (let i = 0; i < 600; i += 1) value = decayShake(value, 1 / 60);
    expect(value).toBe(0);
    expect(decayShake(0, 1 / 60)).toBe(0);
  });
});

describe('worldToViewX', () => {
  it('specchia l asse X una volta sola', () => {
    expect(worldToViewX(-2)).toBe(2);
    expect(worldToViewX(0)).toBe(0);
    expect(worldToViewX(worldToViewX(1.5))).toBe(1.5);
  });
});
