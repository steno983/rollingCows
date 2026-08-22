// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import { CONFIG } from '../game/config';
import { createAudio } from './audio';

/* ---------------------------------------------------- finto WebAudio -- */

class FakeParam {
  value = 0;
  /** Storico delle scritture: `value` da solo mostra sempre l'ULTIMA (di
   *  norma la coda a 0.0001), mentre quasi tutte le scelte timbriche stanno
   *  nella prima — il livello di partenza, la nota iniziale. */
  readonly history: number[] = [];

  setValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    this.history.push(value);
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

  createBuffer(
    numberOfChannels: number,
    length: number,
    _sampleRate: number,
  ): { numberOfChannels: number; length: number; getChannelData(): Float32Array } {
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

  it('buff:gained suona un tono acuto (chime), qualunque sia il buff raccolto', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('buff:gained', { kind: 'star' });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('triangle');
    expect(fake.oscillators[0]?.started).toBe(true);
  });

  it('buff:gained (crystal) suona un singolo oscillatore triangolare (lo stesso zap breve)', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('buff:gained', { kind: 'crystal' });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('triangle');
  });

  it('buff:gained (magnet) suona un oscillatore sinusoidale che scende invece di salire', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('buff:gained', { kind: 'magnet' });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('sine');
    expect(fake.oscillators[0]?.frequency.value).toBe(CONFIG.audio.magnetPull.lowHz);
  });

  it('buff:gained (bell) suona come un campanaccio: due oscillatori non armonici, non il chime generico', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('buff:gained', { kind: 'bell' });

    expect(fake.oscillators.length).toBe(2);
    expect(fake.oscillators[0]?.type).toBe('square');
    expect(fake.oscillators[1]?.type).toBe('triangle');
    expect(fake.oscillators[1]?.frequency.value).toBe(
      CONFIG.audio.cowbell.fundamentalHz * CONFIG.audio.cowbell.overtoneRatio,
    );
  });

  it('shield:consumed suona un rumore passa-alto, distinto dall impatto normale (passa-basso)', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('shield:consumed', {});

    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.started).toBe(true);
    expect(fake.filters[0]?.type).toBe('highpass');
  });

  it('fork:appeared suona un richiamo, distinto dai suoni di raccolta', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('fork:appeared', { richBranch: 'left' });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.started).toBe(true);
  });

  it('fork:chosen suona lo stesso richiamo del bivio, trasposto piu in alto', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('fork:chosen', { side: 'left' });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('sine');
    // L'ultimo valore scritto e' la meta' della rampa: la nota alta trasposta.
    expect(fake.oscillators[0]?.frequency.value).toBeCloseTo(
      CONFIG.audio.forkAppear.highHz * CONFIG.audio.forkChosen.pitchRatio,
    );
  });

  /* --------------------------------------- salto, atterraggio, scivolata -- */

  it('player:jumped suona un soffio passa-alto (la neve che schizza)', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('player:jumped', {});

    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.started).toBe(true);
    expect(fake.filters[0]?.type).toBe('highpass');
    expect(fake.filters[0]?.frequency.value).toBe(CONFIG.audio.jump.cutoffHz);
  });

  it('player:landed suona un tonfo passa-basso dosato su airborneSeconds', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('player:landed', { airborneSeconds: CONFIG.player.jumpSeconds });
    bus.emit('player:landed', { airborneSeconds: 0 });

    expect(fake.filters[0]?.type).toBe('lowpass');
    expect(fake.filters[0]?.frequency.value).toBe(CONFIG.audio.land.cutoffHz);
    // gains[0] e' il master, poi una gain per ogni tonfo. Il salto pieno
    // atterra col tonfo intero, il tocco a terra istantaneo pesa quanto il
    // soffio dello stacco: i due estremi sono voci gia' esistenti.
    expect(fake.gains[1]?.gain.history[0]).toBeCloseTo(CONFIG.audio.land.gain);
    expect(fake.gains[2]?.gain.history[0]).toBeCloseTo(CONFIG.audio.jump.gain);
  });

  it('player:slid avvia un rumore IN LOOP con risonanza e player:slideEnded lo chiude', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('player:slid', {});

    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.loop).toBe(true);
    expect(fake.sources[0]?.started).toBe(true);
    expect(fake.sources[0]?.stopped).toBe(false);
    expect(fake.filters[0]?.Q.value).toBe(CONFIG.audio.slide.resonance);

    bus.emit('player:slideEnded', {});

    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('due player:slid di fila non impilano due loop', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('player:slid', {});
    bus.emit('player:slid', {});

    expect(fake.sources.length).toBe(1);
  });

  it('run:ended chiude anche la scivolata, non solo il rombo', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('player:slid', {});
    bus.emit('run:ended', { points: 0, distance: 0, isRecord: false });

    expect(fake.sources[0]?.stopped).toBe(true);
  });

  /* ------------------------------------------------ scala della raccolta -- */

  it('la raccolta sale di un semitono per fiocco preso di seguito', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 1 });
    const first = fake.oscillators[0]?.frequency.value;
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 2 });
    const second = fake.oscillators[1]?.frequency.value;
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 3 });
    const third = fake.oscillators[2]?.frequency.value;

    // L'ultimo valore scritto e' la nota alta della coppia.
    expect(first).toBeCloseTo(CONFIG.audio.pickup.highHz);
    expect(second).toBeCloseTo(CONFIG.audio.pickup.highHz * 2 ** (1 / 12));
    expect(third).toBeCloseTo(CONFIG.audio.pickup.highHz * 2 ** (2 / 12));
  });

  it('la scala si azzera dopo una pausa piu lunga di streakResetSeconds', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 1 });
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 2 });
    fake.currentTime += CONFIG.audio.pickup.streakResetSeconds * 2;
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 3 });

    expect(fake.oscillators[2]?.frequency.value).toBeCloseTo(CONFIG.audio.pickup.highHz);
  });

  it('la scala non sale oltre streakMaxSteps: riparte dal basso', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    const steps = CONFIG.audio.pickup.streakMaxSteps;
    for (let i = 0; i <= steps + 1; i += 1) {
      bus.emit('pickup:collected', { kind: 'snowflake', charge: i });
    }

    expect(fake.oscillators[steps]?.frequency.value).toBeCloseTo(
      CONFIG.audio.pickup.highHz * 2 ** (steps / 12),
    );
    expect(fake.oscillators[steps + 1]?.frequency.value).toBeCloseTo(CONFIG.audio.pickup.highHz);
  });

  /* ------------------------------------------------ gli altri eventi muti -- */

  it('size:changed muggisce piu acuto a ogni taglia', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('size:changed', { size: 3, previous: 2 });

    const ratio = 1 + CONFIG.audio.sizeUp.pitchPerSize * 3;
    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('sawtooth');
    expect(fake.oscillators[0]?.frequency.value).toBeCloseTo(CONFIG.audio.moo.endHz * ratio);
  });

  it('buff:expiring suona due note DISCENDENTI, il contrario del suono di arrivo', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('buff:expiring', { kind: 'star' });

    expect(fake.oscillators.length).toBe(1);
    // L'ultima nota scritta e' la piu grave: il gesto scende.
    expect(fake.oscillators[0]?.frequency.value).toBe(CONFIG.audio.buffExpire.lowHz);
    expect(CONFIG.audio.buffExpire.lowHz).toBeLessThan(CONFIG.audio.buffExpire.highHz);
  });

  it('avalanche:ended sgonfia con un tono discendente oltre a spegnere il rombo', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    bus.emit('avalanche:ended', {});

    const last = fake.oscillators[fake.oscillators.length - 1];
    expect(last?.type).toBe('triangle');
    expect(last?.frequency.value).toBe(CONFIG.audio.avalancheEnd.endHz);
    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('record:beaten suona un jingle: la stella trasposta piu in alto', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('record:beaten', { points: 100 });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.frequency.value).toBeCloseTo(
      CONFIG.audio.sparkle.highHz * CONFIG.audio.forkChosen.pitchRatio,
    );
  });

  it('streak:changed suona un tocco discreto, piu corto e piu leggero di una raccolta', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('streak:changed', { streak: 10, multiplier: 1.25 });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.frequency.value).toBeCloseTo(
      CONFIG.audio.pickup.highHz * CONFIG.audio.forkChosen.pitchRatio,
    );
    // Piu' leggero di una raccolta: e' un tocco, non un premio.
    expect(fake.gains[1]?.gain.history[0]).toBeLessThan(CONFIG.audio.pickup.gain);
  });

  it('streak:changed NON suona quando la serie crolla: il premio e solo in salita', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    // score.breakStreak emette lo stesso evento con streak 0 dopo un colpo.
    bus.emit('streak:changed', { streak: 0, multiplier: 1 });

    expect(fake.oscillators.length).toBe(0);
  });

  it('avalanche:ending scandisce l ultimo secondo con tocchi udibili, non solo col duck', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    const before = fake.oscillators.length;

    bus.emit('avalanche:ending', {});

    // Tre campanacci, due oscillatori ciascuno: il preavviso e' un segnale
    // attivo e non la semplice ASSENZA del rombo.
    expect(fake.oscillators.length - before).toBe(6);
    expect(fake.oscillators[before]?.started).toBe(true);
  });

  /* --------------------------------------------------------- sblocco e mute -- */

  it('da muto unlock non apre alcun contesto, e lo sblocco viene onorato alla riattivazione', () => {
    const audio = createAudio(factory);
    audio.setMuted(true);

    audio.unlock();

    expect(factoryCalls).toBe(0);
    expect(fake.resumeCalls).toBe(0);

    audio.setMuted(false);

    expect(factoryCalls).toBe(1);
    expect(fake.resumeCalls).toBe(1);
  });

  it('riattivare l audio senza che nessuno abbia mai sbloccato non apre nulla', () => {
    const audio = createAudio(factory);
    audio.setMuted(true);
    audio.setMuted(false);

    expect(factoryCalls).toBe(0);
  });
});
