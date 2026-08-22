import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import {
  createPath,
  forkApproaching,
  forkCommitted,
  forkRealigning,
  type PathNone,
  type PathState,
} from '../game/path';
import { heightAt, trackCenterOffsets, trackHalfWidths } from './terrain';

/** Stessa zona sempre-piatta calcolata in terrain.ts: la separazione dei
 *  rami più mezza larghezza del tracciato, così il pendio resta piatto sotto
 *  qualunque ramo, in qualunque momento di un bivio. */
const FLAT_HALF_WIDTH = CONFIG.path.branchSeparation + CONFIG.world.trackWidth / 2;
const LENGTH = CONFIG.world.chunkLength;
/** Profondità della pista dinamica e passo delle sue righe di geometria,
 *  rispecchiati da render/terrain.ts (TRACK_DEPTH e TRACK_DEPTH /
 *  TRACK_SEGMENTS): servono a controllare la continuità del centro pista
 *  proprio dove la geometria la campiona, non su un continuo ideale. */
const TRACK_DEPTH = CONFIG.world.chunkLength * CONFIG.world.chunkCount;
const ROW_STEP = TRACK_DEPTH / 60;

describe('heightAt', () => {
  it('è 0 dentro la zona sempre piatta, per qualunque z', () => {
    for (const z of [0, 5, LENGTH / 4, LENGTH / 2, LENGTH, LENGTH * 3.7]) {
      for (const x of [0, 0.5, 1, -1, 2, -2, FLAT_HALF_WIDTH, -FLAT_HALF_WIDTH]) {
        expect(heightAt(x, z)).toBe(0);
      }
    }
  });

  it('è continua al bordo della zona piatta: heightAt(±FLAT_HALF_WIDTH, z) = 0', () => {
    for (const z of [0, 13, LENGTH / 3, LENGTH]) {
      expect(heightAt(FLAT_HALF_WIDTH, z)).toBe(0);
      expect(heightAt(-FLAT_HALF_WIDTH, z)).toBe(0);
    }
  });

  it('resta vicina a zero appena fuori dalla zona piatta (continuità)', () => {
    for (const z of [0, LENGTH / 4, LENGTH / 2]) {
      const justOutside = heightAt(FLAT_HALF_WIDTH + 0.05, z);
      expect(Math.abs(justOutside)).toBeLessThan(0.02);
    }
  });

  it('non scende mai sotto un minimo prossimo a zero, in nessun punto', () => {
    let min = Infinity;
    for (let x = 0; x <= 130; x += 0.5) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h < min) min = h;
      }
    }
    expect(min).toBeGreaterThan(-0.1);
  });

  it('satura al tetto (MAX_LATERAL_RISE) oltre una certa distanza laterale', () => {
    const farA = heightAt(60, 7);
    const farB = heightAt(120, 7);
    expect(Math.abs(farA - farB)).toBeLessThan(0.5);
  });

  it('è periodica su chunkLength: due chunk adiacenti combaciano', () => {
    for (const x of [10, 16, -30, 60]) {
      expect(heightAt(x, 0)).toBeCloseTo(heightAt(x, LENGTH), 10);
      expect(heightAt(x, 3.3)).toBeCloseTo(heightAt(x, 3.3 + LENGTH), 10);
    }
  });

  it('non supera mai il tetto teorico (~3.82 con la config di default)', () => {
    let max = -Infinity;
    for (let x = 0; x <= 130; x += 0.5) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h > max) max = h;
      }
    }
    expect(max).toBeLessThan(4);
  });
});

/** Percorso dritto. `PathState` è un'unione discriminata su `phase` (vedi
 *  game/path.ts): gli stati di bivio si costruiscono con i costruttori
 *  dedicati, che chiedono esattamente i campi che quella fase possiede — non
 *  esiste più un `{ phase: 'none', activeBranch: 'right' }`, cioè uno stato
 *  che il gioco non può produrre e su cui non ha senso testare la vista. */
function straight(): PathNone {
  return { ...createPath(), nextForkIn: 100 };
}

/** Un bivio in una delle tre fasi, alla distanza data: serve ai test che
 *  spazzano tutte le fasi con lo stesso corpo. */
function forkAt(phase: 'approaching' | 'committed' | 'realigning', forkZ: number): PathState {
  if (phase === 'approaching') return forkApproaching({ forkZ });
  if (phase === 'committed') return forkCommitted({ forkZ, activeBranch: 'left' });
  return forkRealigning({ forkZ, activeBranch: 'left', realignProgress: 0 });
}

describe('trackCenterOffsets', () => {
  it('senza bivio i due nastri coincidono al centro, a qualunque distanza', () => {
    const path = straight();
    for (const z of [0, 10, 90, 200]) {
      expect(trackCenterOffsets(path, z)).toEqual([0, 0]);
    }
  });

  it('con un bivio in corso ma prima della biforcazione (z <= forkZ), resta un solo nastro', () => {
    const path = forkApproaching({ forkZ: 40 });
    expect(trackCenterOffsets(path, 0)).toEqual([0, 0]);
    expect(trackCenterOffsets(path, 40)).toEqual([0, 0]);
  });

  it('a fine apertura (forkZ + forkBlendZ) i due nastri sono ai due rami', () => {
    const path = forkApproaching({ forkZ: 40 });
    const [left, right] = trackCenterOffsets(path, 40 + CONFIG.path.forkBlendZ);
    expect(left).toBeCloseTo(-CONFIG.path.branchSeparation, 6);
    expect(right).toBeCloseTo(CONFIG.path.branchSeparation, 6);
  });

  it('subito dopo la biforcazione i due nastri sono ancora quasi coincidenti', () => {
    // Il difetto che l'apertura graduale corregge: qui i nastri valevano già
    // ±branchSeparation, cioè il bivio nasceva come due piste parallele
    // comparse di fianco alla propria invece che come una Y.
    const path = forkApproaching({ forkZ: 40 });
    const [left, right] = trackCenterOffsets(path, 41);
    expect(Math.abs(left)).toBeLessThan(CONFIG.world.trackWidth / 2);
    expect(Math.abs(right)).toBeLessThan(CONFIG.world.trackWidth / 2);
  });

  it('i due rami si aprono in modo monotono, senza mai tornare indietro', () => {
    const path = forkApproaching({ forkZ: 30 });
    let previous = 0;
    for (let z = 30; z <= 30 + CONFIG.path.forkBlendZ + 10; z += 0.5) {
      const separation = trackCenterOffsets(path, z)[1] - trackCenterOffsets(path, z)[0];
      expect(separation).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = separation;
    }
    expect(previous).toBeCloseTo(2 * CONFIG.path.branchSeparation, 6);
  });

  it('due righe adiacenti di geometria non scostano mai il centro di più di mezza pista', () => {
    // L'invariante che mancava: la pista è fatta di righe distanti ROW_STEP, e
    // fra una riga e la successiva il centro di un nastro non può spostarsi
    // tanto da non sovrapporsi più a sé stesso — altrimenti quello che si vede
    // non è una piega ma uno scalino, con neve non battuta scoperta in mezzo.
    // Vale per QUALUNQUE posizione della biforcazione, anche già superata.
    const maxJump = CONFIG.world.trackWidth / 2;
    for (const phase of ['approaching', 'committed', 'realigning'] as const) {
      for (let forkZ = -60; forkZ <= 120; forkZ += 1) {
        const path = forkAt(phase, forkZ);
        let [previousLeft, previousRight] = trackCenterOffsets(path, 0);
        for (let z = ROW_STEP; z <= TRACK_DEPTH; z += ROW_STEP) {
          const [left, right] = trackCenterOffsets(path, z);
          expect(Math.abs(left - previousLeft)).toBeLessThanOrEqual(maxJump);
          expect(Math.abs(right - previousRight)).toBeLessThanOrEqual(maxJump);
          previousLeft = left;
          previousRight = right;
        }
      }
    }
  });

  it('nella fase impegnata il ramo scelto scivola al centro e lo SCARTATO resta dov-è', () => {
    // È il cuore della correzione: alla biforcazione (forkZ 0) la strada
    // scelta deve essere già dritta sotto la mucca, così il bivio si legge
    // come "la mia strada prosegue e l'altra se ne va" invece che come una
    // pista che si deforma. Il ramo scartato non viene portato via — resta
    // alla propria distanza geometrica — altrimenti finirebbe a 12 unità di
    // lato, fuori dalla fascia di terreno piatto e sopra i banchi.
    const start = forkCommitted({ forkZ: CONFIG.path.commitZ, activeBranch: 'left' });
    const [startLeft, startRight] = trackCenterOffsets(start, 90);
    expect(startLeft).toBeCloseTo(-CONFIG.path.branchSeparation, 6);
    expect(startRight).toBeCloseTo(CONFIG.path.branchSeparation, 6);

    const end = forkCommitted({ forkZ: 0, activeBranch: 'left' });
    const [endLeft, endRight] = trackCenterOffsets(end, 90);
    expect(endLeft).toBe(0);
    expect(endRight).toBeCloseTo(CONFIG.path.branchSeparation, 6);
  });

  it('durante il riallineamento il ramo scelto è dritto a OGNI distanza', () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const forkZ = -progress * CONFIG.path.forkBlendZ;
      const path = forkRealigning({ forkZ, activeBranch: 'left', realignProgress: progress });
      for (let z = 0; z <= TRACK_DEPTH; z += ROW_STEP) {
        expect(trackCenterOffsets(path, z)[0]).toBe(0);
      }
    }
  });
});

describe('trackHalfWidths', () => {
  const full = CONFIG.world.trackWidth / 2;

  it('fuori dal riallineamento i due nastri sono larghi uguale', () => {
    const paths: readonly PathState[] = [
      straight(),
      forkApproaching({ forkZ: 40 }),
      forkCommitted({ forkZ: 5, activeBranch: 'left' }),
    ];
    for (const path of paths) {
      expect([...trackHalfWidths(path)]).toEqual([full, full]);
    }
  });

  it('durante il riallineamento il nastro SCARTATO si assottiglia, quello scelto no', () => {
    const path = forkRealigning({ activeBranch: 'left', realignProgress: 0.5 });
    const [left, right] = trackHalfWidths(path);
    expect(left).toBe(full);
    expect(right).toBeCloseTo(full * 0.5, 10);

    const mirrored = forkRealigning({ activeBranch: 'right', realignProgress: 0.5 });
    const [mirroredLeft, mirroredRight] = trackHalfWidths(mirrored);
    expect(mirroredLeft).toBeCloseTo(full * 0.5, 10);
    expect(mirroredRight).toBe(full);
  });

  it('a riallineamento completo il nastro scartato ha larghezza nulla: la sua sparizione non si vede', () => {
    // Nel frame successivo la fase torna 'none' e i due nastri tornano a
    // coincidere al centro. Se il nastro scartato fosse ancora largo, quel
    // ritorno sarebbe uno scatto laterale di 2 * branchSeparation.
    const path = forkRealigning({ activeBranch: 'right', realignProgress: 1 });
    expect(trackHalfWidths(path)[0]).toBe(0);
    expect(trackHalfWidths(path)[1]).toBe(full);
  });

  it('non scende mai sotto zero, nemmeno con un avanzamento oltre 1', () => {
    const path = forkRealigning({ activeBranch: 'left', realignProgress: 1.5 });
    expect(trackHalfWidths(path)[1]).toBe(0);
  });
});
