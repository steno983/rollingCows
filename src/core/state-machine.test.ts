import { describe, expect, it } from 'vitest';
import { createStateMachine } from './state-machine';

describe('createStateMachine', () => {
  it('parte da boot per default', () => {
    const machine = createStateMachine();

    expect(machine.current).toBe('boot');
  });

  it('accetta uno stato iniziale esplicito', () => {
    const machine = createStateMachine('menu');

    expect(machine.current).toBe('menu');
  });

  it('esegue una transizione permessa e aggiorna current', () => {
    const machine = createStateMachine();

    expect(machine.transition('menu')).toBe(true);
    expect(machine.current).toBe('menu');
    expect(machine.transition('playing')).toBe(true);
    expect(machine.current).toBe('playing');
  });

  it('permette paused → gameover (morte durante il rallentatore in pausa)', () => {
    const machine = createStateMachine('paused');

    expect(machine.transition('gameover')).toBe(true);
    expect(machine.current).toBe('gameover');
  });

  it('rifiuta una transizione vietata senza cambiare stato', () => {
    const machine = createStateMachine();

    expect(machine.transition('playing')).toBe(false);
    expect(machine.current).toBe('boot');
    expect(machine.transition('gameover')).toBe(false);
    expect(machine.current).toBe('boot');
  });

  it('rifiuta la transizione verso sé stesso', () => {
    const machine = createStateMachine('playing');

    expect(machine.transition('playing')).toBe(false);
    expect(machine.current).toBe('playing');
  });

  it('can() riflette esattamente la tabella delle transizioni', () => {
    const boot = createStateMachine('boot');
    expect(boot.can('menu')).toBe(true);
    expect(boot.can('playing')).toBe(false);
    expect(boot.can('paused')).toBe(false);
    expect(boot.can('gameover')).toBe(false);

    const menu = createStateMachine('menu');
    expect(menu.can('playing')).toBe(true);
    expect(menu.can('paused')).toBe(false);
    expect(menu.can('gameover')).toBe(false);
    expect(menu.can('boot')).toBe(false);

    const playing = createStateMachine('playing');
    expect(playing.can('paused')).toBe(true);
    expect(playing.can('gameover')).toBe(true);
    expect(playing.can('menu')).toBe(false);
    expect(playing.can('boot')).toBe(false);

    const paused = createStateMachine('paused');
    expect(paused.can('playing')).toBe(true);
    expect(paused.can('menu')).toBe(true);
    // Si può morire mentre si è in pausa: il rallentatore alla morte continua a
    // scorrere in background e può scadere dopo che blur/visibilitychange hanno
    // messo in pausa la partita (vedi game/flow.ts).
    expect(paused.can('gameover')).toBe(true);
    expect(paused.can('boot')).toBe(false);

    const gameover = createStateMachine('gameover');
    expect(gameover.can('playing')).toBe(true);
    expect(gameover.can('menu')).toBe(true);
    expect(gameover.can('paused')).toBe(false);
    expect(gameover.can('boot')).toBe(false);
  });

  it('invoca onExit del vecchio stato prima di onEnter del nuovo', () => {
    const machine = createStateMachine();
    const calls: string[] = [];

    machine.onExit('boot', () => {
      calls.push('exit:boot');
    });
    machine.onEnter('menu', () => {
      calls.push('enter:menu');
    });

    machine.transition('menu');

    expect(calls).toEqual(['exit:boot', 'enter:menu']);
  });

  it('durante onEnter il current è già il nuovo stato', () => {
    const machine = createStateMachine();
    const observed: string[] = [];

    machine.onExit('boot', () => {
      observed.push(machine.current);
    });
    machine.onEnter('menu', () => {
      observed.push(machine.current);
    });

    machine.transition('menu');

    expect(observed).toEqual(['boot', 'menu']);
  });

  it('non invoca alcun listener se la transizione è vietata', () => {
    const machine = createStateMachine();
    const calls: string[] = [];

    machine.onExit('boot', () => {
      calls.push('exit:boot');
    });
    machine.onEnter('playing', () => {
      calls.push('enter:playing');
    });

    expect(machine.transition('playing')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('supporta più listener sullo stesso stato, in ordine di registrazione', () => {
    const machine = createStateMachine();
    const calls: string[] = [];

    machine.onEnter('menu', () => {
      calls.push('enter-a');
    });
    machine.onEnter('menu', () => {
      calls.push('enter-b');
    });
    machine.onExit('menu', () => {
      calls.push('exit-a');
    });
    machine.onExit('menu', () => {
      calls.push('exit-b');
    });

    machine.transition('menu');
    machine.transition('playing');

    expect(calls).toEqual(['enter-a', 'enter-b', 'exit-a', 'exit-b']);
  });

  it('copre il ciclo completo boot → menu → playing → paused → playing → gameover → menu', () => {
    const machine = createStateMachine();
    const path: string[] = [];

    for (const state of ['menu', 'playing', 'paused', 'playing', 'gameover', 'menu'] as const) {
      expect(machine.transition(state)).toBe(true);
      path.push(machine.current);
    }

    expect(path).toEqual(['menu', 'playing', 'paused', 'playing', 'gameover', 'menu']);
  });
});
