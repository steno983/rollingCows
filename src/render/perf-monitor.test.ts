import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPerfMonitor } from './perf-monitor';

const FRAME_60 = 1 / 60;
const FRAME_30 = 1 / 30;

describe('createPerfMonitor', () => {
  it('a 60fps non chiede mai il degrado', () => {
    const monitor = createPerfMonitor();

    let triggered = false;
    for (let i = 0; i < 600; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }

    expect(triggered).toBe(false);
    expect(monitor.degraded).toBe(false);
  });

  it('a 30fps scatta dopo circa lowFpsSeconds e una sola volta', () => {
    const monitor = createPerfMonitor();

    let triggerFrame = -1;
    let triggerCount = 0;
    for (let i = 0; i < 600; i += 1) {
      if (monitor.sample(FRAME_30)) {
        triggerCount += 1;
        if (triggerFrame < 0) {
          triggerFrame = i;
        }
      }
    }

    const expectedFrame = CONFIG.perf.lowFpsSeconds / FRAME_30;
    expect(triggerCount).toBe(1);
    expect(triggerFrame).toBeGreaterThan(expectedFrame - 5);
    expect(triggerFrame).toBeLessThan(expectedFrame + 5);
    expect(monitor.degraded).toBe(true);
  });

  it('un calo isolato e breve non fa scattare il degrado', () => {
    const monitor = createPerfMonitor();

    let triggered = false;
    for (let i = 0; i < 20; i += 1) {
      triggered = monitor.sample(FRAME_30) || triggered;
    }
    for (let i = 0; i < 600; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }

    expect(triggered).toBe(false);
  });

  it('un dt enorme isolato dopo campioni sani non fa scattare il degrado (tab ripresa da sospensione)', () => {
    const monitor = createPerfMonitor();

    for (let i = 0; i < 300; i += 1) monitor.sample(FRAME_60);

    // 8 secondi: la tab è stata sospesa e ripresa. Prima della correzione un
    // solo campione così superava da solo lowFpsSeconds (3s) e spegneva la
    // qualità per sempre.
    const triggeredByHugeSample = monitor.sample(8);
    expect(triggeredByHugeSample).toBe(false);
    expect(monitor.degraded).toBe(false);

    let triggered = false;
    for (let i = 0; i < 300; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }
    expect(triggered).toBe(false);
    expect(monitor.degraded).toBe(false);
  });

  it('ignora i delta non positivi', () => {
    const monitor = createPerfMonitor();

    expect(monitor.sample(0)).toBe(false);
    expect(monitor.sample(-1)).toBe(false);
    expect(monitor.degraded).toBe(false);
  });

  it('reset riporta il monitor allo stato iniziale', () => {
    const monitor = createPerfMonitor();
    for (let i = 0; i < 300; i += 1) {
      monitor.sample(FRAME_30);
    }
    expect(monitor.degraded).toBe(true);

    monitor.reset();
    expect(monitor.degraded).toBe(false);

    let triggered = false;
    for (let i = 0; i < 600; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }
    expect(triggered).toBe(false);
  });
});
