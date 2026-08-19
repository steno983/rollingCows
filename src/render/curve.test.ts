import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPath, type PathState } from '../game/path';
import { worldToViewX } from './camera-rig';
import { cameraRollFor, playerTiltFor, worldYawFor } from './curve';
import { entityWorldOffsetX } from './entities-view';

/** Base da createPath, come le fixture di entities-view.test.ts: un campo
 *  nuovo di PathState non deve costringere a toccare questi test. */
function fixture(overrides: Partial<PathState> = {}): PathState {
  return { ...createPath(), nextForkIn: 100, ...overrides };
}

describe('worldYawFor', () => {
  it('è zero quando non c\'è alcun bivio in corso', () => {
    expect(worldYawFor(fixture({ phase: 'none' }))).toBe(0);
  });

  it('resta zero durante approaching, anche a bivio già scelto (si può ancora cambiare idea)', () => {
    expect(worldYawFor(fixture({ phase: 'approaching', choice: 'left' }))).toBe(0);
    expect(worldYawFor(fixture({ phase: 'approaching', choice: 'right' }))).toBe(0);
  });

  it('è negativo a ramo sinistro attivo e cresce avvicinandosi al bivio', () => {
    const early = worldYawFor(
      fixture({ phase: 'committed', activeBranch: 'left', forkZ: CONFIG.path.commitZ - 0.1 }),
    );
    const late = worldYawFor(fixture({ phase: 'committed', activeBranch: 'left', forkZ: 1 }));
    expect(early).toBeLessThan(0);
    expect(late).toBeLessThan(0);
    // Più vicini al bivio, più marcata la piegata (in valore assoluto).
    expect(Math.abs(late)).toBeGreaterThan(Math.abs(early));
  });

  it('è positivo a ramo destro attivo, speculare al sinistro', () => {
    const path = fixture({ phase: 'committed', activeBranch: 'right', forkZ: 6 });
    expect(worldYawFor(path)).toBeGreaterThan(0);
  });

  it('non supera mai il picco configurato', () => {
    const path = fixture({ phase: 'committed', activeBranch: 'left', forkZ: 0 });
    expect(Math.abs(worldYawFor(path))).toBeCloseTo(
      (CONFIG.render.curve.maxWorldTiltDeg * Math.PI) / 180,
      6,
    );
  });

  it('scende con realignProgress e torna esattamente a zero a riallineamento concluso', () => {
    const mid = worldYawFor(fixture({ phase: 'realigning', activeBranch: 'left', realignProgress: 0.5 }));
    const end = worldYawFor(fixture({ phase: 'realigning', activeBranch: 'left', realignProgress: 1 }));
    expect(mid).toBeLessThan(0);
    expect(end).toBe(0);
  });

  it('nessuno scatto brusco fra un frame e il successivo lungo tutto il ciclo del bivio', () => {
    // Ricalca esattamente la sequenza di fasi/valori che game/path.ts produce
    // durante un bivio scelto a sinistra: dentro 'committed' forkZ scende da
    // commitZ a 0, poi 'realigning' con realignProgress che sale da 0 a 1.
    const samples: number[] = [];
    const steps = 50;
    for (let i = 0; i <= steps; i += 1) {
      const forkZ = CONFIG.path.commitZ * (1 - i / steps);
      samples.push(worldYawFor(fixture({ phase: 'committed', activeBranch: 'left', forkZ })));
    }
    for (let i = 0; i <= steps; i += 1) {
      const realignProgress = i / steps;
      samples.push(worldYawFor(fixture({ phase: 'realigning', activeBranch: 'left', realignProgress })));
    }
    const maxStep = (CONFIG.render.curve.maxWorldTiltDeg * Math.PI) / 180 / steps;
    for (let i = 1; i < samples.length; i += 1) {
      const prev = samples[i - 1];
      const curr = samples[i];
      if (prev === undefined || curr === undefined) continue;
      // Tolleranza generosa (3x il passo "atteso" a step uniformi): qui
      // interessa escludere un salto, non pretendere un passo esattamente
      // costante (l'easing non è lineare).
      expect(Math.abs(curr - prev)).toBeLessThan(maxStep * 3);
    }
  });

  it(
    'a ramo sinistro scelto il mondo ruota nel verso che porta quel ramo davanti alla mucca ' +
      '(un\'entità del ramo sinistro, in coordinate di vista come le usa entities-view.ts, si avvicina al centro)',
    () => {
      const path = fixture({ phase: 'committed', activeBranch: 'left', forkZ: CONFIG.path.commitZ / 2 });
      const yaw = worldYawFor(path);
      expect(yaw).not.toBe(0);

      // Stessa X di vista che entities-view.ts calcola davvero per un'entità
      // del ramo sinistro (worldToViewX + entityWorldOffsetX), a una
      // profondità rappresentativa della zona del bivio.
      const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'left' }));
      const z = 15;
      // Stessa rotazione Y che subirà il gruppo-mondo in three.js
      // (convenzione standard: x' = x·cosθ + z·sinθ per rotation.y = θ).
      const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
      expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
    },
  );

  it('specularmente, a ramo destro scelto il ramo destro si avvicina al centro', () => {
    const path = fixture({ phase: 'committed', activeBranch: 'right', forkZ: CONFIG.path.commitZ / 2 });
    const yaw = worldYawFor(path);
    const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'right' }));
    const z = 15;
    const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
    expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
  });
});

describe('playerTiltFor', () => {
  it('è zero senza bivio e segue lo stesso verso/cadenza di worldYawFor', () => {
    expect(playerTiltFor(fixture({ phase: 'none' }))).toBe(0);
    const path = fixture({ phase: 'committed', activeBranch: 'left', forkZ: 6 });
    expect(playerTiltFor(path)).toBeLessThan(0);
    expect(Math.sign(playerTiltFor(path))).toBe(Math.sign(worldYawFor(path)));
  });

  it('non supera mai il picco configurato', () => {
    const path = fixture({ phase: 'committed', activeBranch: 'right', forkZ: 0 });
    expect(playerTiltFor(path)).toBeCloseTo((CONFIG.render.curve.maxPlayerTiltDeg * Math.PI) / 180, 6);
  });
});

describe('cameraRollFor', () => {
  it('è zero senza bivio e segue lo stesso verso/cadenza di worldYawFor', () => {
    expect(cameraRollFor(fixture({ phase: 'none' }))).toBe(0);
    const path = fixture({ phase: 'committed', activeBranch: 'left', forkZ: 6 });
    expect(cameraRollFor(path)).toBeLessThan(0);
    expect(Math.sign(cameraRollFor(path))).toBe(Math.sign(worldYawFor(path)));
  });

  it('resta un tocco leggero: il picco è più piccolo di quello del mondo e della mucca', () => {
    expect(CONFIG.render.curve.maxCameraRollDeg).toBeLessThan(CONFIG.render.curve.maxWorldTiltDeg);
    expect(CONFIG.render.curve.maxCameraRollDeg).toBeLessThan(CONFIG.render.curve.maxPlayerTiltDeg);
  });
});
