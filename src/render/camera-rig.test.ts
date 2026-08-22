import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraFovFor,
  cameraHeightFor,
  decayShake,
  speedRatio,
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

describe('speedRatio', () => {
  it('vale 0 a velocità di partenza e 1 a velocità massima', () => {
    expect(speedRatio(CONFIG.world.startSpeed)).toBeCloseTo(0, 10);
    expect(speedRatio(CONFIG.world.maxSpeed)).toBeCloseTo(1, 10);
  });

  it('clampa fuori dall intervallo, così i profili più lenti o più veloci non lo sfondano', () => {
    expect(speedRatio(CONFIG.world.startSpeed - 10)).toBe(0);
    expect(speedRatio(CONFIG.world.maxSpeed + 10)).toBe(1);
  });

  it('cresce con la velocità', () => {
    const mid = (CONFIG.world.startSpeed + CONFIG.world.maxSpeed) / 2;
    expect(speedRatio(mid)).toBeGreaterThan(speedRatio(CONFIG.world.startSpeed));
    expect(speedRatio(mid)).toBeLessThan(speedRatio(CONFIG.world.maxSpeed));
  });
});

describe('cameraFovFor', () => {
  it('apre l obiettivo con la velocità, fra i due estremi', () => {
    expect(cameraFovFor(CONFIG.world.startSpeed, false)).toBeCloseTo(
      CONFIG.render.cameraMinFov,
      10,
    );
    expect(cameraFovFor(CONFIG.world.maxSpeed, false)).toBeCloseTo(CONFIG.render.cameraMaxFov, 10);
  });

  it('è monotono crescente nella velocità', () => {
    const span = CONFIG.world.maxSpeed - CONFIG.world.startSpeed;
    let previous = cameraFovFor(CONFIG.world.startSpeed, false);
    for (let i = 1; i <= 10; i += 1) {
      const current = cameraFovFor(CONFIG.world.startSpeed + (span * i) / 10, false);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('la valanga AGGIUNGE gradi invece di sostituire il FOV', () => {
    // Il difetto che questo test blocca: con un FOV assoluto per la valanga,
    // l'apertura da velocità spariva proprio quando si andava più forte.
    const slow = cameraFovFor(CONFIG.world.startSpeed, true);
    const fast = cameraFovFor(CONFIG.world.maxSpeed, true);
    expect(fast).toBeGreaterThan(slow);
    expect(slow - cameraFovFor(CONFIG.world.startSpeed, false)).toBeCloseTo(
      CONFIG.render.cameraAvalancheFovDelta,
      10,
    );
    expect(fast - cameraFovFor(CONFIG.world.maxSpeed, false)).toBeCloseTo(
      CONFIG.render.cameraAvalancheFovDelta,
      10,
    );
  });

  it('la riduzione del movimento scala solo il contributo della valanga', () => {
    const base = cameraFovFor(CONFIG.world.maxSpeed, false);
    expect(cameraFovFor(CONFIG.world.maxSpeed, true, 0)).toBeCloseTo(base, 10);
    const halved = cameraFovFor(CONFIG.world.maxSpeed, true, 0.5);
    expect(halved - base).toBeCloseTo(CONFIG.render.cameraAvalancheFovDelta / 2, 10);
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
