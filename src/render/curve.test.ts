import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPath, forkApproaching, forkCommitted, forkRealigning } from '../game/path';
import { worldToViewX } from './camera-rig';
import { cameraRollFor, curveMotionScale, playerTiltFor, worldYawFor } from './curve';
import { entityWorldOffsetX } from './entities-view';

/** Percorso dritto, come nelle altre fixture di vista. Gli stati di bivio
 *  arrivano dai costruttori di game/path.ts: `PathState` è un'unione
 *  discriminata su `phase`, quindi ogni fase ha esattamente i campi che le
 *  competono e non uno di più. */
function straight(): ReturnType<typeof createPath> {
  return { ...createPath(), nextForkIn: 100 };
}

describe('worldYawFor', () => {
  it("è zero quando non c'è alcun bivio in corso", () => {
    expect(worldYawFor(straight())).toBe(0);
  });

  it('resta zero durante approaching, anche a bivio già scelto (si può ancora cambiare idea)', () => {
    expect(worldYawFor(forkApproaching({ forkZ: 40, choice: 'left' }))).toBe(0);
    expect(worldYawFor(forkApproaching({ forkZ: 40, choice: 'right' }))).toBe(0);
  });

  it('è negativo a ramo sinistro attivo e cresce avvicinandosi al bivio', () => {
    const early = worldYawFor(
      forkCommitted({ forkZ: CONFIG.path.commitZ - 0.1, activeBranch: 'left' }),
    );
    const late = worldYawFor(forkCommitted({ forkZ: 1, activeBranch: 'left' }));
    expect(early).toBeLessThan(0);
    expect(late).toBeLessThan(0);
    // Più vicini al bivio, più marcata la piegata (in valore assoluto).
    expect(Math.abs(late)).toBeGreaterThan(Math.abs(early));
  });

  it('è positivo a ramo destro attivo, speculare al sinistro', () => {
    const path = forkCommitted({ forkZ: 6, activeBranch: 'right' });
    expect(worldYawFor(path)).toBeGreaterThan(0);
  });

  it('non supera mai il picco configurato', () => {
    const path = forkCommitted({ forkZ: 0, activeBranch: 'left' });
    expect(Math.abs(worldYawFor(path))).toBeCloseTo(
      (CONFIG.render.curve.maxWorldTiltDeg * Math.PI) / 180,
      6,
    );
  });

  it('scende con realignProgress e torna esattamente a zero a riallineamento concluso', () => {
    const mid = worldYawFor(forkRealigning({ activeBranch: 'left', realignProgress: 0.5 }));
    const end = worldYawFor(forkRealigning({ activeBranch: 'left', realignProgress: 1 }));
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
      samples.push(worldYawFor(forkCommitted({ forkZ, activeBranch: 'left' })));
    }
    for (let i = 0; i <= steps; i += 1) {
      const realignProgress = i / steps;
      samples.push(worldYawFor(forkRealigning({ activeBranch: 'left', realignProgress })));
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
      "(un'entità del ramo sinistro, in coordinate di vista come le usa entities-view.ts, si avvicina al centro)",
    () => {
      const path = forkCommitted({
        forkZ: CONFIG.path.commitZ / 2,
        activeBranch: 'left',
      });
      const yaw = worldYawFor(path);
      expect(yaw).not.toBe(0);

      // Stessa X di vista che entities-view.ts calcola davvero per un'entità
      // del ramo sinistro (worldToViewX + entityWorldOffsetX). La z va
      // passata, ed è la stessa usata nella rotazione: lo scostamento di
      // un'entità dipende da dove sta il suo pezzo di strada a QUELLA
      // distanza, e a monte della biforcazione i due rami coincidono ancora
      // col tronco. Si sceglie un punto oltre la fine dell'apertura, dove il
      // ramo esiste come strada separata.
      const z = CONFIG.path.commitZ / 2 + CONFIG.path.forkBlendZ + 10;
      const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'left', z }));
      // Stessa rotazione Y che subirà il gruppo-mondo in three.js
      // (convenzione standard: x' = x·cosθ + z·sinθ per rotation.y = θ).
      const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
      expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
    },
  );

  it('specularmente, a ramo destro scelto il ramo destro si avvicina al centro', () => {
    const path = forkCommitted({
      forkZ: CONFIG.path.commitZ / 2,
      activeBranch: 'right',
    });
    const yaw = worldYawFor(path);
    const z = CONFIG.path.commitZ / 2 + CONFIG.path.forkBlendZ + 10;
    const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'right', z }));
    const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
    expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
  });
});

describe('playerTiltFor', () => {
  it('è zero senza bivio e segue lo stesso verso/cadenza di worldYawFor', () => {
    expect(playerTiltFor(straight())).toBe(0);
    const path = forkCommitted({ forkZ: 6, activeBranch: 'left' });
    expect(playerTiltFor(path)).toBeLessThan(0);
    expect(Math.sign(playerTiltFor(path))).toBe(Math.sign(worldYawFor(path)));
  });

  it('non supera mai il picco configurato', () => {
    const path = forkCommitted({ forkZ: 0, activeBranch: 'right' });
    expect(playerTiltFor(path)).toBeCloseTo(
      (CONFIG.render.curve.maxPlayerTiltDeg * Math.PI) / 180,
      6,
    );
  });
});

describe('cameraRollFor', () => {
  it('è zero senza bivio e segue lo stesso verso/cadenza di worldYawFor', () => {
    expect(cameraRollFor(straight())).toBe(0);
    const path = forkCommitted({ forkZ: 6, activeBranch: 'left' });
    expect(cameraRollFor(path)).toBeLessThan(0);
    expect(Math.sign(cameraRollFor(path))).toBe(Math.sign(worldYawFor(path)));
  });

  it('resta un tocco leggero: il picco è più piccolo di quello del mondo e della mucca', () => {
    expect(CONFIG.render.curve.maxCameraRollDeg).toBeLessThan(CONFIG.render.curve.maxWorldTiltDeg);
    expect(CONFIG.render.curve.maxCameraRollDeg).toBeLessThan(CONFIG.render.curve.maxPlayerTiltDeg);
  });
});

describe('riduzione del movimento', () => {
  /** Un bivio a metà della fase impegnata: piegata ben diversa da zero, così
   *  la riduzione ha qualcosa da ridurre. */
  const path = forkCommitted({
    forkZ: CONFIG.path.commitZ / 2,
    activeBranch: 'left',
  });

  it('curveMotionScale vale 1 senza riduzione e curveScale con la riduzione attiva', () => {
    expect(curveMotionScale(false)).toBe(1);
    expect(curveMotionScale(true)).toBe(CONFIG.render.reducedMotion.curveScale);
  });

  it('omettere il moltiplicatore equivale a passare 1 (nessun cambio di comportamento)', () => {
    expect(worldYawFor(path, 1)).toBe(worldYawFor(path));
    expect(playerTiltFor(path, 1)).toBe(playerTiltFor(path));
    expect(cameraRollFor(path, 1)).toBe(cameraRollFor(path));
  });

  it('scala i tre angoli esattamente del fattore chiesto', () => {
    const scale = curveMotionScale(true);
    expect(worldYawFor(path, scale)).toBeCloseTo(worldYawFor(path) * scale, 10);
    expect(playerTiltFor(path, scale)).toBeCloseTo(playerTiltFor(path) * scale, 10);
    expect(cameraRollFor(path, scale)).toBeCloseTo(cameraRollFor(path) * scale, 10);
  });

  it('riduce davvero il disagio: al 25% il rollio della camera scende sotto i 3 gradi', () => {
    const peak = forkCommitted({ forkZ: 0, activeBranch: 'right' });
    const reducedRoll = Math.abs(cameraRollFor(peak, curveMotionScale(true)));
    expect((reducedRoll * 180) / Math.PI).toBeLessThan(3);
  });

  it('non tocca il verso né il ritorno esatto a zero', () => {
    const scale = curveMotionScale(true);
    expect(Math.sign(worldYawFor(path, scale))).toBe(Math.sign(worldYawFor(path)));
    const closed = forkRealigning({ activeBranch: 'left', realignProgress: 1 });
    expect(worldYawFor(closed, scale)).toBe(0);
    expect(playerTiltFor(closed, scale)).toBe(0);
    expect(cameraRollFor(closed, scale)).toBe(0);
  });

  it('il bivio resta leggibile: il mondo ruota ancora nel verso del ramo scelto', () => {
    // Stessa verifica geometrica del test a piena ampiezza: la riduzione
    // cambia quanto, mai cosa.
    const yaw = worldYawFor(path, curveMotionScale(true));
    const z = CONFIG.path.commitZ / 2 + CONFIG.path.forkBlendZ + 10;
    const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'left', z }));
    const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
    expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
  });
});
