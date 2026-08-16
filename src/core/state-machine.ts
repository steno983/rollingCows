export type GameStateName = 'boot' | 'menu' | 'playing' | 'paused' | 'gameover';

export interface StateMachine {
  readonly current: GameStateName;
  can(to: GameStateName): boolean;
  /** Esegue la transizione se permessa; restituisce true se avvenuta. */
  transition(to: GameStateName): boolean;
  onEnter(state: GameStateName, fn: () => void): void;
  onExit(state: GameStateName, fn: () => void): void;
}

/** Tabella chiusa: tutto ciò che non è elencato è vietato. */
const TRANSITIONS: Record<GameStateName, readonly GameStateName[]> = {
  boot: ['menu'],
  menu: ['playing'],
  playing: ['paused', 'gameover'],
  paused: ['playing', 'menu'],
  gameover: ['playing', 'menu'],
};

type Listener = () => void;

function createListenerMap(): Record<GameStateName, Listener[]> {
  return {
    boot: [],
    menu: [],
    playing: [],
    paused: [],
    gameover: [],
  };
}

export function createStateMachine(initial: GameStateName = 'boot'): StateMachine {
  let current: GameStateName = initial;
  const enterListeners = createListenerMap();
  const exitListeners = createListenerMap();

  const can = (to: GameStateName): boolean => TRANSITIONS[current].includes(to);

  const transition = (to: GameStateName): boolean => {
    if (!can(to)) {
      return false;
    }

    const from = current;
    for (const listener of exitListeners[from]) {
      listener();
    }

    current = to;

    for (const listener of enterListeners[to]) {
      listener();
    }

    return true;
  };

  const onEnter = (state: GameStateName, fn: Listener): void => {
    enterListeners[state].push(fn);
  };

  const onExit = (state: GameStateName, fn: Listener): void => {
    exitListeners[state].push(fn);
  };

  return {
    get current(): GameStateName {
      return current;
    },
    can,
    transition,
    onEnter,
    onExit,
  };
}
