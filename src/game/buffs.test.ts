import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus, type EventName, type GameEvents } from '../core/events';
import { CONFIG } from './config';
import {
  applyBuff,
  buffMultiplier,
  consumeShield,
  createBuffs,
  magnetActive,
  resetBuffs,
  updateBuffs,
} from './buffs';

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = ['buff:gained', 'buff:expired', 'shield:consumed'];

function recordEvents(bus: EventBus): Recorded[] {
  const seen: Recorded[] = [];
  for (const name of ALL_EVENTS) {
    bus.on(name, (payload: unknown) => {
      seen.push({ name, payload });
    });
  }
  return seen;
}

function countOf(events: readonly Recorded[], name: EventName): number {
  return events.filter((event) => event.name === name).length;
}

function payloadsOf<K extends EventName>(
  events: readonly Recorded[],
  name: K,
): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

describe('createBuffs', () => {
  it('parte tutto spento/azzerato', () => {
    expect(createBuffs()).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
  });
});

describe('applyBuff', () => {
  it('star imposta la durata piena ed emette buff:gained', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'star', bus);

    expect(state.starTimeLeft).toBe(CONFIG.buffs.starSeconds);
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'star' }]);
  });

  it('magnet imposta la durata piena ed emette buff:gained', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'magnet', bus);

    expect(state.magnetTimeLeft).toBe(CONFIG.buffs.magnetSeconds);
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'magnet' }]);
  });

  it('raccogliere star o magnet mentre sono già attivi RICARICA la durata, non la somma', () => {
    const bus = createEventBus();
    const state = createBuffs();

    applyBuff(state, 'star', bus);
    updateBuffs(state, CONFIG.buffs.starSeconds - 1, bus);
    expect(state.starTimeLeft).toBeCloseTo(1, 6);

    applyBuff(state, 'star', bus);
    expect(state.starTimeLeft).toBe(CONFIG.buffs.starSeconds);

    applyBuff(state, 'magnet', bus);
    updateBuffs(state, CONFIG.buffs.magnetSeconds - 2, bus);
    expect(state.magnetTimeLeft).toBeCloseTo(2, 6);

    applyBuff(state, 'magnet', bus);
    expect(state.magnetTimeLeft).toBe(CONFIG.buffs.magnetSeconds);
  });

  it('bell accende lo scudo ed emette buff:gained', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'bell', bus);

    expect(state.shield).toBe(true);
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'bell' }]);
  });

  it('raccogliere bell con lo scudo già attivo non accumula nulla', () => {
    const bus = createEventBus();
    const state = createBuffs();

    applyBuff(state, 'bell', bus);
    applyBuff(state, 'bell', bus);

    expect(state.shield).toBe(true);
    expect(consumeShield(state, bus)).toBe(true);
    expect(state.shield).toBe(false);
    // Un solo scudo, non due: un secondo consumo trova la scorta già vuota.
    expect(consumeShield(state, bus)).toBe(false);
  });

  it('crystal non tocca lo stato dei buff (la carica è di avalanche.ts) ma annuncia comunque la raccolta', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'crystal', bus);

    expect(state).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    // Senza questo evento il cristallo sarebbe l'unico raccoglibile muto: il
    // suo timbro audio (CONFIG.audio.chime) resterebbe codice morto.
    expect(events).toEqual([{ name: 'buff:gained', payload: { kind: 'crystal' } }]);
  });
});

describe('updateBuffs', () => {
  it('scala i tempi residui del delta time', () => {
    const bus = createEventBus();
    const state = createBuffs();
    applyBuff(state, 'star', bus);
    applyBuff(state, 'magnet', bus);

    updateBuffs(state, 1, bus);

    expect(state.starTimeLeft).toBeCloseTo(CONFIG.buffs.starSeconds - 1, 6);
    expect(state.magnetTimeLeft).toBeCloseTo(CONFIG.buffs.magnetSeconds - 1, 6);
  });

  it('emette buff:expired UNA SOLA VOLTA per buff, anche richiamata molte volte dopo la scadenza', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();
    applyBuff(state, 'star', bus);

    updateBuffs(state, CONFIG.buffs.starSeconds, bus);
    expect(state.starTimeLeft).toBe(0);
    expect(countOf(events, 'buff:expired')).toBe(1);
    expect(payloadsOf(events, 'buff:expired')).toEqual([{ kind: 'star' }]);

    for (let i = 0; i < 50; i++) updateBuffs(state, 1, bus);
    expect(countOf(events, 'buff:expired')).toBe(1);
  });

  it('star e magnet scadono in modo indipendente, ciascuno col proprio evento', () => {
    // Applicati in istanti diversi (star subito, magnet 2s dopo) così la
    // scadenza indipendente si verifica anche quando, come in CONFIG oggi,
    // starSeconds e magnetSeconds coincidono: altrimenti scadrebbero nello
    // stesso updateBuffs e il test non distinguerebbe "un evento per buff"
    // da "un evento unico per entrambi".
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();
    applyBuff(state, 'star', bus);

    updateBuffs(state, 2, bus);
    applyBuff(state, 'magnet', bus);

    updateBuffs(state, CONFIG.buffs.starSeconds - 2, bus);
    expect(payloadsOf(events, 'buff:expired')).toEqual([{ kind: 'star' }]);

    updateBuffs(state, CONFIG.buffs.magnetSeconds, bus);
    expect(payloadsOf(events, 'buff:expired')).toEqual([{ kind: 'star' }, { kind: 'magnet' }]);
  });

  it('non fa nulla se nessun buff è attivo', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    updateBuffs(state, 5, bus);

    expect(state).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    expect(events).toHaveLength(0);
  });
});

describe('consumeShield', () => {
  it('restituisce false e non emette nulla se lo scudo non è attivo', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    expect(consumeShield(state, bus)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('restituisce true, spegne lo scudo ed emette shield:consumed se era attivo', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();
    applyBuff(state, 'bell', bus);

    expect(consumeShield(state, bus)).toBe(true);
    expect(state.shield).toBe(false);
    expect(countOf(events, 'shield:consumed')).toBe(1);
  });
});

describe('buffMultiplier / magnetActive', () => {
  it('il moltiplicatore vale starMultiplier con la stella attiva, altrimenti 1', () => {
    const bus = createEventBus();
    const state = createBuffs();
    expect(buffMultiplier(state)).toBe(1);

    applyBuff(state, 'star', bus);
    expect(buffMultiplier(state)).toBe(CONFIG.buffs.starMultiplier);

    updateBuffs(state, CONFIG.buffs.starSeconds, bus);
    expect(buffMultiplier(state)).toBe(1);
  });

  it('magnetActive segue magnetTimeLeft', () => {
    const bus = createEventBus();
    const state = createBuffs();
    expect(magnetActive(state)).toBe(false);

    applyBuff(state, 'magnet', bus);
    expect(magnetActive(state)).toBe(true);

    updateBuffs(state, CONFIG.buffs.magnetSeconds, bus);
    expect(magnetActive(state)).toBe(false);
  });
});

describe('resetBuffs', () => {
  it('riporta tutto a zero', () => {
    const bus = createEventBus();
    const state = createBuffs();
    applyBuff(state, 'star', bus);
    applyBuff(state, 'magnet', bus);
    applyBuff(state, 'bell', bus);

    resetBuffs(state);

    expect(state).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
  });
});
