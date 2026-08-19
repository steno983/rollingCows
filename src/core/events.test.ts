import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from './events';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEventBus', () => {
  it('consegna il payload all\'handler registrato', () => {
    const bus = createEventBus();
    const received: number[] = [];
    bus.on('run:started', (payload) => {
      received.push(payload.seed);
    });

    bus.emit('run:started', { seed: 4242 });

    expect(received).toEqual([4242]);
  });

  it('consegna lo stesso evento a più handler, nell\'ordine di registrazione', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.on('size:changed', () => {
      calls.push('first');
    });
    bus.on('size:changed', () => {
      calls.push('second');
    });

    bus.emit('size:changed', { size: 3, previous: 2 });

    expect(calls).toEqual(['first', 'second']);
  });

  it('la funzione restituita da on() disiscrive solo quell\'handler', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    const off = bus.on('avalanche:triggered', () => {
      calls.push('removed');
    });
    bus.on('avalanche:triggered', () => {
      calls.push('kept');
    });

    off();
    bus.emit('avalanche:triggered', { size: 5 });

    expect(calls).toEqual(['kept']);
  });

  it('chiamare due volte la funzione di disiscrizione non lancia', () => {
    const bus = createEventBus();
    const off = bus.on('avalanche:ended', () => undefined);

    off();

    expect(() => {
      off();
    }).not.toThrow();
  });

  it('clear() rimuove tutti gli handler di tutti gli eventi', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.on('run:started', () => {
      calls.push('started');
    });
    bus.on('run:ended', () => {
      calls.push('ended');
    });

    bus.clear();
    bus.emit('run:started', { seed: 1 });
    bus.emit('run:ended', { points: 10, distance: 20, isRecord: false });

    expect(calls).toEqual([]);
  });

  it('emit su un evento senza handler non lancia', () => {
    const bus = createEventBus();

    expect(() => {
      bus.emit('avalanche:ending', {});
    }).not.toThrow();
  });

  it('un handler che lancia non impedisce agli altri di ricevere l\'evento', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = createEventBus();
    const calls: string[] = [];

    bus.on('obstacle:hit', () => {
      calls.push('before');
    });
    bus.on('obstacle:hit', () => {
      throw new Error('handler esploso');
    });
    bus.on('obstacle:hit', () => {
      calls.push('after');
    });

    expect(() => {
      bus.emit('obstacle:hit', { kind: 'rock', outcome: 'death', branch: 'main', z: 12 });
    }).not.toThrow();

    expect(calls).toEqual(['before', 'after']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('gli eventi sono indipendenti fra loro', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.on('pickup:collected', () => {
      calls.push('pickup');
    });
    bus.on('avalanche:ended', () => {
      calls.push('ended');
    });

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 5 });

    expect(calls).toEqual(['pickup']);
  });
});
