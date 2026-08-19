// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import { CONFIG } from '../game/config';
import { createAudio } from './audio';

/* ---------------------------------------------------- finto WebAudio -- */

class FakeParam {
  value = 0;

  setValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    return this;
  }

  cancelScheduledValues(_time: number): FakeParam {
    return this;
  }
}

class FakeNode {
  connect(target: unknown): unknown {
    return target;
  }

  disconnect(): void {}
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = false;
  stopped = false;

  start(_time?: number): void {
    this.started = true;
  }

  stop(_time?: number): void {
    this.stopped = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;

  start(_time?: number): void {
    this.started = true;
  }

  stop(_time?: number): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  sources: FakeBufferSource[] = [];
  resumeCalls = 0;

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, _sampleRate: number): { numberOfChannels: number; length: number; getChannelData(): Float32Array } {
    return {
      numberOfChannels,
      length,
      getChannelData: () => new Float32Array(length),
    };
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

/* --------------------------------------------------------------- test -- */

let fake: FakeAudioContext;
let factoryCalls = 0;

const factory = (): AudioContext => {
  factoryCalls += 1;
  return fake as unknown as AudioContext;
};

beforeEach(() => {
  fake = new FakeAudioContext();
  factoryCalls = 0;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('createAudio', () => {
  it('suona la raccolta creando un oscillatore su pickup:collected', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 1 });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('triangle');
    expect(fake.oscillators[0]?.started).toBe(true);
  });

  it('avvia il rombo su avalanche:triggered e lo spegne su avalanche:ended', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.loop).toBe(true);
    expect(fake.sources[0]?.started).toBe(true);

    bus.emit('avalanche:ended', {});
    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('run:started spegne un rombo lasciato acceso da una valanga precedente (si torna al menu o si ricomincia a metà valanga)', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.stopped).toBe(false);

    bus.emit('run:started', { seed: 1 });

    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('run:ended spegne il rombo se il giocatore muore mentre la valanga sta ancora suonando', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    expect(fake.sources.length).toBe(1);

    bus.emit('run:ended', { points: 0, distance: 0, isRecord: false });

    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('run:stopped spegne il rombo se la run viene abbandonata da viva (Esc → MENU a metà valanga)', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.stopped).toBe(false);

    bus.emit('run:stopped', {});

    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('con muted non crea nessun nodo e non apre nemmeno il contesto', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.setMuted(true);
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 5 });
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'death', branch: 'main', z: 0 });

    expect(audio.muted).toBe(true);
    expect(factoryCalls).toBe(0);
    expect(fake.oscillators.length).toBe(0);
    expect(fake.sources.length).toBe(0);
  });

  it('persiste il mute e lo rilegge alla creazione successiva', () => {
    const first = createAudio(factory);
    first.setMuted(true);
    expect(localStorage.getItem(CONFIG.audio.mutedKey)).toBe('1');

    const second = createAudio(factory);
    expect(second.muted).toBe(true);

    second.setMuted(false);
    expect(localStorage.getItem(CONFIG.audio.mutedKey)).toBe('0');
    expect(createAudio(factory).muted).toBe(false);
  });

  it('unlock chiama resume una sola volta', () => {
    const audio = createAudio(factory);

    audio.unlock();
    audio.unlock();
    audio.unlock();

    expect(fake.resumeCalls).toBe(1);
    expect(factoryCalls).toBe(1);
  });
});
