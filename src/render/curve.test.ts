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

  it('resta zero durante approaching finché nessuno sceglie, e SOLO finché nessuno sceglie', () => {
    // Il cambio di regola: prima la piegata restava a zero per tutto
    // l'avvicinamento anche a scelta già data, perché era legata al punto di
    // non ritorno. Ora è legata alla scelta, quindi zero vuol dire una cosa
    // sola — nessuno ha scelto — e chi non sceglierà mai va dritto sul
    // cartello senza che il mondo si muova di un grado.
    expect(worldYawFor(forkApproaching({ forkZ: 40 }))).toBe(0);
    // Appena scelto la piegata è ancora a zero (parte da lì e cresce), ma
    // dallo stesso avvicinamento, a piegata avviata, non lo è più.
    expect(worldYawFor(forkApproaching({ forkZ: 40, choice: 'left', turn: 0 }))).toBe(0);
    expect(worldYawFor(forkApproaching({ forkZ: 40, choice: 'left', turn: -0.4 }))).toBeLessThan(0);
    expect(worldYawFor(forkApproaching({ forkZ: 40, choice: 'right', turn: 0.4 }))).toBeGreaterThan(
      0,
    );
  });

  it('è negativo a ramo sinistro scelto e cresce col crescere della piegata', () => {
    const early = worldYawFor(forkApproaching({ forkZ: 40, choice: 'left', turn: -0.2 }));
    const late = worldYawFor(forkApproaching({ forkZ: 8, choice: 'left', turn: -0.9 }));
    expect(early).toBeLessThan(0);
    expect(late).toBeLessThan(0);
    // Più avanti nella piegata, più marcata (in valore assoluto).
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
    // Ricalca la sequenza di fasi/valori che game/path.ts produce durante un
    // bivio scelto a sinistra: la piegata sale da 0 a -1 durante
    // l'avvicinamento (è la scelta a farla partire, non il punto di non
    // ritorno), attraversa la biforcazione e rientra durante 'realigning'.
    const samples: number[] = [];
    const steps = 50;
    for (let i = 0; i <= steps; i += 1) {
      const turn = -i / steps;
      samples.push(worldYawFor(forkApproaching({ forkZ: 40 - i / 2, choice: 'left', turn })));
    }
    samples.push(worldYawFor(forkCommitted({ forkZ: 0, activeBranch: 'left' })));
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

  it('CAMBIARE IDEA passa per lo zero: nessun salto di segno, nessuno scatto', () => {
    // È il caso che aveva motivato di far partire la piegata solo al punto di
    // non ritorno, ed è quello che ora va gestito davvero. Il giocatore ha
    // piegato a sinistra fino a metà e cambia ramo: la piegata torna indietro
    // fino a zero e riparte dall'altra parte, alla stessa velocità (il valore
    // è uno solo, con segno: game/path.ts, advanceTurn). Fra due frame
    // consecutivi il segno non può quindi invertirsi saltando l'ampiezza.
    const samples: number[] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i += 1) {
      // Da -0.6 a +0.6 a passo costante, cioè quello che advanceTurn produce.
      const turn = -0.6 + (1.2 * i) / steps;
      samples.push(worldYawFor(forkApproaching({ forkZ: 24, choice: 'right', turn })));
    }
    const maxStep = (CONFIG.render.curve.maxWorldTiltDeg * Math.PI) / 180 / steps;
    let crossed = false;
    for (let i = 1; i < samples.length; i += 1) {
      const prev = samples[i - 1];
      const curr = samples[i];
      if (prev === undefined || curr === undefined) continue;
      if (Math.sign(prev) !== Math.sign(curr)) {
        // L'inversione di segno può avvenire SOLO passando per zero, cioè con
        // entrambi i campioni piccolissimi: è la derivata nulla della
        // smoothstep nell'origine a garantirlo.
        crossed = true;
        expect(Math.abs(prev)).toBeLessThan(maxStep * 3);
        expect(Math.abs(curr)).toBeLessThan(maxStep * 3);
      }
      expect(Math.abs(curr - prev)).toBeLessThan(maxStep * 3);
    }
    expect(crossed).toBe(true);
  });

  it(
    'a ramo sinistro scelto il mondo ruota nel verso che porta quel ramo davanti alla mucca ' +
      "(un'entità del ramo sinistro, in coordinate di vista come le usa entities-view.ts, si avvicina al centro)",
    () => {
      // Piegata a metà: il ramo scelto è già scivolato verso il centro ma non
      // ci è ancora arrivato, che è l'unico stato in cui questa verifica ha
      // qualcosa da misurare (a piegata completa il ramo È il centro).
      const path = forkApproaching({ forkZ: 30, choice: 'left', turn: -0.5 });
      const yaw = worldYawFor(path);
      expect(yaw).not.toBe(0);

      // Stessa X di vista che entities-view.ts calcola davvero per un'entità
      // del ramo sinistro (worldToViewX + entityWorldOffsetX). La z va
      // passata, ed è la stessa usata nella rotazione: lo scostamento di
      // un'entità dipende da dove sta il suo pezzo di strada a QUELLA
      // distanza, e a monte della biforcazione i due rami coincidono ancora
      // col tronco. Si sceglie un punto oltre la fine dell'apertura, dove il
      // ramo esiste come strada separata.
      const z = 30 + CONFIG.path.forkBlendZ + 10;
      const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'left', z }));
      // Stessa rotazione Y che subirà il gruppo-mondo in three.js
      // (convenzione standard: x' = x·cosθ + z·sinθ per rotation.y = θ).
      const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
      expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
    },
  );

  it('specularmente, a ramo destro scelto il ramo destro si avvicina al centro', () => {
    const path = forkApproaching({ forkZ: 30, choice: 'right', turn: 0.5 });
    const yaw = worldYawFor(path);
    const z = 30 + CONFIG.path.forkBlendZ + 10;
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
  /** Un bivio a piegata mezza fatta: ben diversa da zero, così la riduzione ha
   *  qualcosa da ridurre, e con il ramo ancora scostato dal centro, così la
   *  verifica geometrica in fondo a questo blocco ha qualcosa da misurare. */
  const path = forkApproaching({ forkZ: 30, choice: 'left', turn: -0.5 });

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
    const z = 30 + CONFIG.path.forkBlendZ + 10;
    const sceneX = worldToViewX(entityWorldOffsetX(path, { branch: 'left', z }));
    const rotatedX = sceneX * Math.cos(yaw) + z * Math.sin(yaw);
    expect(Math.abs(rotatedX)).toBeLessThan(Math.abs(sceneX));
  });
});
