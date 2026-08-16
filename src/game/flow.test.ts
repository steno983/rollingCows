import { describe, expect, it } from 'vitest';
import { createStateMachine, type GameStateName } from '../core/state-machine';
import {
  armDeath,
  commitGameOver,
  createFlow,
  isDying,
  requestExternalPause,
  resetFlow,
  tickDeath,
  type GameOverPayload,
} from './flow';

const PAYLOAD: GameOverPayload = { points: 42, distance: 100, isRecord: false };
const DEATH_SLOW_SECONDS = 0.8;
const STEP = 1 / 60;

describe('createFlow / resetFlow', () => {
  it('parte senza rallentatore né payload in sospeso', () => {
    const flow = createFlow();
    expect(isDying(flow)).toBe(false);
    expect(flow.pendingGameOver).toBeNull();
  });

  it('azzera un rallentatore residuo (inizio di una nuova run)', () => {
    const flow = createFlow();
    armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);
    resetFlow(flow);
    expect(isDying(flow)).toBe(false);
    expect(flow.pendingGameOver).toBeNull();
  });
});

describe('tickDeath', () => {
  it('resta false finché il rallentatore non è scaduto', () => {
    const flow = createFlow();
    armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);

    let done = false;
    for (let i = 0; i < 47; i += 1) {
      done = tickDeath(flow, STEP);
    }
    expect(done).toBe(false);
    expect(isDying(flow)).toBe(true);
  });

  it('diventa true esattamente nel frame in cui il rallentatore scade', () => {
    const flow = createFlow();
    armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);

    let trueCount = 0;
    for (let i = 0; i < 60; i += 1) {
      if (tickDeath(flow, STEP)) trueCount += 1;
    }
    expect(trueCount).toBe(1);
  });

  it('senza un rallentatore armato non fa nulla', () => {
    const flow = createFlow();
    expect(tickDeath(flow, STEP)).toBe(false);
  });
});

describe('commitGameOver', () => {
  it('azzera pendingGameOver SOLO se la transizione riesce', () => {
    const machine = createStateMachine('playing');
    const flow = createFlow();
    armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);

    const result = commitGameOver(machine, flow);

    expect(result).toEqual(PAYLOAD);
    expect(machine.current).toBe('gameover');
    expect(flow.pendingGameOver).toBeNull();
  });

  it('con la macchina in uno stato che vieta gameover, lascia il payload intatto', () => {
    const machine = createStateMachine('menu');
    const flow = createFlow();
    armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);

    const result = commitGameOver(machine, flow);

    expect(result).toBeNull();
    expect(machine.current).toBe('menu');
    // Il payload NON è andato perso: un tentativo successivo può ancora riuscire.
    expect(flow.pendingGameOver).toEqual(PAYLOAD);
  });

  it('senza payload in sospeso non tocca la macchina', () => {
    const machine = createStateMachine('playing');
    const flow = createFlow();

    expect(commitGameOver(machine, flow)).toBeNull();
    expect(machine.current).toBe('playing');
  });
});

describe('requestExternalPause', () => {
  it('mette in pausa da playing quando non si sta morendo', () => {
    const machine = createStateMachine('playing');
    const flow = createFlow();

    expect(requestExternalPause(machine, flow)).toBe(true);
    expect(machine.current).toBe('paused');
  });

  it('viene ignorata mentre il rallentatore della morte è attivo', () => {
    const machine = createStateMachine('playing');
    const flow = createFlow();
    armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);

    expect(requestExternalPause(machine, flow)).toBe(false);
    expect(machine.current).toBe('playing');
  });

  it('è un no-op fuori da playing', () => {
    const machine = createStateMachine('menu');
    const flow = createFlow();

    expect(requestExternalPause(machine, flow)).toBe(false);
    expect(machine.current).toBe('menu');
  });
});

describe('invariante: dopo run:ended il gioco raggiunge sempre gameover', () => {
  /**
   * Matrice stato × evento. Due tipi di richiesta di pausa durante il
   * rallentatore:
   *  - "esterna" (blur/visibilitychange) → passa da requestExternalPause,
   *    che il fix ignora sempre finché dyingSeconds > 0;
   *  - "manuale" (Esc/tasto P, gestita in main.ts da togglePause) → NON è
   *    filtrata da isDying, quindi PUÒ mettere la macchina in 'paused' anche
   *    durante il rallentatore. È esattamente lo scenario del bug originale:
   *    prima della correzione la tabella vietava paused → gameover e il
   *    payload spariva. Qui verifichiamo che qualunque combinazione di questi
   *    eventi lasci comunque il gioco in 'gameover' col payload corretto.
   */
  const scenarios: Array<{
    name: string;
    externalPauseFrames: number[];
    manualPauseFrames: number[];
    expectPausedBeforeCommit: boolean;
  }> = [
    {
      name: 'nessuna richiesta di pausa durante il rallentatore',
      externalPauseFrames: [],
      manualPauseFrames: [],
      expectPausedBeforeCommit: false,
    },
    {
      name: 'pause esterne ripetute (blur + visibilitychange + focus flap): sempre ignorate',
      externalPauseFrames: [0, 5, 5, 20, 40, 46],
      manualPauseFrames: [],
      expectPausedBeforeCommit: false,
    },
    {
      name: 'pausa manuale (Esc) a metà rallentatore: la macchina resta in paused fino al game over',
      externalPauseFrames: [],
      manualPauseFrames: [24],
      expectPausedBeforeCommit: true,
    },
    {
      name: 'pausa manuale seguita da blur/visibilitychange (ignorati, resta paused)',
      externalPauseFrames: [30, 40],
      manualPauseFrames: [10],
      expectPausedBeforeCommit: true,
    },
    {
      name: 'pausa manuale proprio nell ultimo frame prima dello scadere',
      externalPauseFrames: [],
      manualPauseFrames: [46],
      expectPausedBeforeCommit: true,
    },
  ];

  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const machine = createStateMachine('playing');
      const flow = createFlow();

      armDeath(flow, PAYLOAD, DEATH_SLOW_SECONDS);

      let frame = 0;
      let done = false;
      while (!done) {
        if (scenario.externalPauseFrames.includes(frame)) {
          requestExternalPause(machine, flow);
        }
        if (scenario.manualPauseFrames.includes(frame) && machine.current === 'playing') {
          // Simula togglePause() in main.ts: non è filtrata da isDying.
          machine.transition('paused');
        }
        done = tickDeath(flow, STEP);
        frame += 1;
      }

      if (scenario.expectPausedBeforeCommit) {
        expect(machine.current).toBe('paused');
      } else {
        expect(machine.current).toBe('playing');
      }

      const result = commitGameOver(machine, flow);

      const reachedGameOver: GameStateName = machine.current;
      expect(reachedGameOver).toBe('gameover');
      expect(result).toEqual(PAYLOAD);
      expect(flow.pendingGameOver).toBeNull();
    });
  }
});
