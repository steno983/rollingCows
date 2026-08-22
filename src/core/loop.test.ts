import { describe, expect, it, vi } from 'vitest';
import { createLoop } from './loop';

const STEP = 1 / 60;

function makeSpies(): {
  update: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
} {
  return { update: vi.fn(), render: vi.fn() };
}

describe('createLoop', () => {
  it('il primo advance inizializza il tempo e non esegue update', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(1000);

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.render).toHaveBeenCalledTimes(1);
  });

  it('avanzando di 16.7ms esegue un update con dt uguale allo step', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(16.7);

    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledWith(STEP);
  });

  it('avanzando di 100ms esegue sei update', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(100);

    expect(spies.update).toHaveBeenCalledTimes(6);
  });

  it('il tempo residuo si accumula tra chiamate successive', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(10);
    expect(spies.update).toHaveBeenCalledTimes(0);

    loop.advance(20);
    expect(spies.update).toHaveBeenCalledTimes(1);
  });

  it('un salto enorme viene clampato a maxAccumulated', () => {
    // Il numero atteso di passi si deriva dai parametri passati, invece di
    // ricalcare il valore di default: così il test protegge l'invariante
    // ("dopo uno stallo si eseguono al più maxAccumulated/step update, non
    // uno per ogni frame perso") e non si rompe quando il tetto viene tarato.
    const spies = makeSpies();
    const step = 1 / 60;
    const maxAccumulated = 0.1;
    const loop = createLoop(spies, { step, maxAccumulated });

    loop.advance(0);
    loop.advance(5000);

    const maxSteps = Math.floor(maxAccumulated / step);
    expect(spies.update.mock.calls.length).toBeLessThanOrEqual(maxSteps);
    expect(spies.update.mock.calls.length).toBeGreaterThanOrEqual(maxSteps - 1);
  });

  it('non disegna due volte lo stesso stato su un pannello ad alta frequenza', () => {
    // A 120 Hz il browser chiama il loop ogni 8,3 ms ma la simulazione avanza
    // a 60 passi al secondo: metà dei frame sarebbero identici al precedente.
    const spies = makeSpies();
    const loop = createLoop(spies, { minRenderInterval: 1 / 72 });

    loop.advance(0);
    for (let i = 1; i <= 12; i += 1) {
      loop.advance(i * (1000 / 120));
    }

    // Dodici chiamate a 120 Hz coprono 100 ms: a 72 fps sono al più 8 render.
    expect(spies.render.mock.calls.length).toBeLessThanOrEqual(8);
    expect(spies.render.mock.calls.length).toBeGreaterThan(0);
  });

  it('render viene chiamato una volta per advance con alpha in [0, 1)', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(10);
    loop.advance(27);
    loop.advance(41);

    expect(spies.render).toHaveBeenCalledTimes(4);
    for (const call of spies.render.mock.calls) {
      const alpha = call[0] as number;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('rispetta step e maxAccumulated passati via options', () => {
    const spies = makeSpies();
    const loop = createLoop(spies, { step: 0.1, maxAccumulated: 0.35 });

    loop.advance(0);
    loop.advance(1000);

    expect(spies.update).toHaveBeenCalledTimes(3);
    expect(spies.update).toHaveBeenCalledWith(0.1);
  });

  it('un timestamp che va indietro non produce update né errori', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(1000);
    loop.advance(900);

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.render).toHaveBeenCalledTimes(2);
  });

  it('running riflette start/stop', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });

  it('start() reimposta il tempo: il primo advance dopo start non esegue update', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(100);
    spies.update.mockClear();

    loop.start();
    loop.advance(5000);

    expect(spies.update).not.toHaveBeenCalled();
    loop.stop();
  });
});
