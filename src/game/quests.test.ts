import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus, type GameEvents } from '../core/events';
import { CONFIG } from './config';
import {
  attachQuests,
  completedQuestIds,
  createQuests,
  dailyQuestSeed,
  type Quest,
  type QuestKind,
  type QuestsState,
  trackDistance,
} from './quests';

function completions(bus: EventBus): GameEvents['quest:completed'][] {
  const seen: GameEvents['quest:completed'][] = [];
  bus.on('quest:completed', (payload) => {
    seen.push(payload);
  });
  return seen;
}

/**
 * Le missioni del giorno sono estratte a sorte, quindi un test che vuole
 * verificare UN tipo preciso non può sperare che esca: si costruisce lo stato
 * con la missione voluta. È lo stesso motivo per cui `createQuests` accetta un
 * seed invece di leggere l'orologio.
 */
function questState(kind: QuestKind, target: number): QuestsState {
  const quest: Quest = {
    id: `${kind}-${target}`,
    kind,
    target,
    label: `test ${kind}`,
    progress: 0,
    done: false,
  };
  const base = createQuests(1);
  return { quests: [quest], counters: base.counters };
}

describe('dailyQuestSeed', () => {
  it('è stabile nel giorno e cambia il giorno dopo', () => {
    const morning = dailyQuestSeed(new Date(Date.UTC(2026, 7, 22, 6, 0, 0)));
    const evening = dailyQuestSeed(new Date(Date.UTC(2026, 7, 22, 23, 59, 0)));
    const tomorrow = dailyQuestSeed(new Date(Date.UTC(2026, 7, 23, 6, 0, 0)));

    expect(morning).toBe(evening);
    expect(tomorrow).not.toBe(morning);
  });
});

describe('createQuests', () => {
  it('estrae CONFIG.quests.count missioni, tutte di tipo diverso', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = createQuests(seed);
      expect(state.quests).toHaveLength(CONFIG.quests.count);
      const kinds = new Set(state.quests.map((quest) => quest.kind));
      expect(kinds.size).toBe(CONFIG.quests.count);
    }
  });

  it('a parità di seed dà esattamente le stesse missioni', () => {
    const a = createQuests(12345);
    const b = createQuests(12345);
    expect(a.quests).toEqual(b.quests);
    expect(createQuests(12346).quests).not.toEqual(a.quests);
  });

  it('riconosce come già completate le missioni ricevute dalla persistenza', () => {
    const first = createQuests(7);
    const target = first.quests[0];
    if (target === undefined) throw new Error('nessuna missione estratta');

    const restored = createQuests(7, [target.id]);
    expect(restored.quests[0]?.done).toBe(true);
    expect(completedQuestIds(restored)).toEqual([target.id]);
  });
});

describe('verifica tramite gli eventi già esistenti sul bus', () => {
  it('conta i fiocchi raccolti, non gli altri raccoglibili', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('flakes', 3);
    attachQuests(state, bus);

    bus.emit('pickup:collected', { kind: 'crystal', charge: 20 });
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    expect(state.quests[0]?.progress).toBe(2);
    expect(done).toHaveLength(0);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    expect(state.quests[0]?.done).toBe(true);
    expect(done).toEqual([{ id: 'flakes-3', label: 'test flakes' }]);
  });

  it('annuncia il completamento UNA SOLA VOLTA, anche continuando a raccogliere', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('flakes', 2);
    attachQuests(state, bus);

    for (let i = 0; i < 10; i++) bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    expect(done).toHaveLength(1);
    // Il progresso mostrato non supera il bersaglio: una barra al 500% non è
    // un'informazione.
    expect(state.quests[0]?.progress).toBe(2);
  });

  it('conta le valanghe attivate', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('avalanches', 2);
    attachQuests(state, bus);

    bus.emit('avalanche:triggered', { size: 5 });
    expect(done).toHaveLength(0);
    bus.emit('avalanche:ended', {});
    bus.emit('avalanche:triggered', { size: 5 });
    expect(done).toHaveLength(1);
  });

  it('registra la taglia massima raggiunta, che poi può ridiscendere', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('size', CONFIG.avalanche.maxSize);
    attachQuests(state, bus);

    bus.emit('size:changed', { size: 3, previous: 2 });
    expect(done).toHaveLength(0);
    bus.emit('size:changed', { size: CONFIG.avalanche.maxSize, previous: 4 });
    expect(done).toHaveLength(1);
    // La valanga finisce e la taglia torna a 1: la missione resta fatta.
    bus.emit('size:changed', { size: 1, previous: CONFIG.avalanche.maxSize });
    expect(state.quests[0]?.done).toBe(true);
    expect(done).toHaveLength(1);
  });

  it('conta le scelte del ramo ricco, una per bivio anche cambiando idea', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('richBranch', 2);
    attachQuests(state, bus);

    // Primo bivio: il giocatore tentenna, poi resta sul ramo ricco.
    bus.emit('fork:appeared', { richBranch: 'left' });
    bus.emit('fork:chosen', { side: 'left' });
    bus.emit('fork:chosen', { side: 'right' });
    bus.emit('fork:chosen', { side: 'left' });
    bus.emit('fork:resolved', { side: 'left' });
    expect(state.quests[0]?.progress).toBe(1);

    // Secondo bivio: sceglie il ramo sgombro. Non conta.
    bus.emit('fork:appeared', { richBranch: 'right' });
    bus.emit('fork:resolved', { side: 'left' });
    expect(state.quests[0]?.progress).toBe(1);

    bus.emit('fork:appeared', { richBranch: 'right' });
    bus.emit('fork:resolved', { side: 'right' });
    expect(done).toHaveLength(1);
  });

  it('conta gli sfondamenti dentro UNA SOLA valanga, e solo quelli in valanga', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('smashes', 3);
    attachQuests(state, bus);

    // Staccionata sfondata a taglia 3 FUORI dalla valanga: non conta.
    for (let i = 0; i < 5; i++) {
      bus.emit('obstacle:hit', { kind: 'fence', outcome: 'smashed', branch: 'main', z: 0 });
    }
    expect(state.quests[0]?.progress).toBe(0);

    bus.emit('avalanche:triggered', { size: 5 });
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'smashed', branch: 'main', z: 0 });
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'smashed', branch: 'main', z: 0 });
    bus.emit('avalanche:ended', {});
    expect(done).toHaveLength(0);

    // Due in una valanga e due in un'altra non fanno quattro: la missione
    // chiede tre nella STESSA.
    bus.emit('avalanche:triggered', { size: 5 });
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'smashed', branch: 'main', z: 0 });
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'smashed', branch: 'main', z: 0 });
    expect(done).toHaveLength(0);
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'smashed', branch: 'main', z: 0 });
    expect(done).toHaveLength(1);
  });

  it('la distanza pulita torna a zero quando arriva un perdono', () => {
    const bus = createEventBus();
    const done = completions(bus);
    const state = questState('cleanDistance', 500);
    attachQuests(state, bus);

    trackDistance(state, 400, bus);
    expect(state.quests[0]?.progress).toBe(400);

    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'forgiven', branch: 'main', z: 0 });
    expect(state.quests[0]?.progress).toBe(0);

    // Da qui in poi la corsa non può più completarla, per quanto vada lontano.
    trackDistance(state, 5000, bus);
    expect(done).toHaveLength(0);
    expect(state.quests[0]?.progress).toBe(0);

    // La corsa successiva riparte pulita.
    bus.emit('run:started', { seed: 1 });
    trackDistance(state, 600, bus);
    expect(done).toHaveLength(1);
  });

  it('run:started azzera i progressi ma non i completamenti', () => {
    const bus = createEventBus();
    const state = questState('flakes', 2);
    attachQuests(state, bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    expect(state.quests[0]?.done).toBe(true);

    bus.emit('run:started', { seed: 2 });
    expect(state.quests[0]?.progress).toBe(0);
    expect(state.quests[0]?.done).toBe(true);
    expect(completedQuestIds(state)).toEqual(['flakes-2']);
  });

  it('staccare le missioni le rende sorde: due insiemi agganciati non contano due volte', () => {
    const bus = createEventBus();
    const state = questState('flakes', 5);
    const detach = attachQuests(state, bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    expect(state.quests[0]?.progress).toBe(1);

    detach();
    bus.emit('pickup:collected', { kind: 'snowflake', charge: 4 });
    expect(state.quests[0]?.progress).toBe(1);
  });
});
