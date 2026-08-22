// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreens } from './screens';

let root: HTMLElement;

function need(selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`Elemento mancante nelle schermate: ${selector}`);
  }
  return el;
}

function visible(name: string): boolean {
  return !need(`[data-screen="${name}"]`).classList.contains('screen--hidden');
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('createScreens', () => {
  it('mostra una sola schermata alla volta', () => {
    const screens = createScreens(root);

    screens.show('menu');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([true, false, false]);

    screens.show('paused');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, true, false]);

    screens.show('gameover');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, false, true]);
  });

  it('durante il gioco nasconde tutte le schermate', () => {
    const screens = createScreens(root);

    screens.show('menu');
    screens.show('playing');

    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('invoca onStart al click su PARTI', () => {
    const screens = createScreens(root);
    const onStart = vi.fn();
    screens.onStart(onStart);

    need('[data-action="start"]').click();

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('invoca onRestart al click su RIGIOCA e onResume su RIPRENDI', () => {
    const screens = createScreens(root);
    const onRestart = vi.fn();
    const onResume = vi.fn();
    screens.onRestart(onRestart);
    screens.onResume(onResume);

    need('[data-action="restart"]').click();
    need('[data-action="resume"]').click();

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('BUG: dopo il click su PARTI/RIGIOCA/RIPRENDI il focus non deve restare sul bottone (altrimenti la tastiera smette di arrivare al gioco)', () => {
    const screens = createScreens(root);
    screens.onStart(() => {});
    screens.onRestart(() => {});
    screens.onResume(() => {});

    const start = need('[data-action="start"]');
    start.focus();
    expect(document.activeElement).toBe(start);
    start.click();
    expect(document.activeElement).not.toBe(start);

    const restart = need('[data-action="restart"]');
    restart.focus();
    expect(document.activeElement).toBe(restart);
    restart.click();
    expect(document.activeElement).not.toBe(restart);

    const resume = need('[data-action="resume"]');
    resume.focus();
    expect(document.activeElement).toBe(resume);
    resume.click();
    expect(document.activeElement).not.toBe(resume);
  });

  it('invoca onMenu da entrambi i bottoni MENU', () => {
    const screens = createScreens(root);
    const onMenu = vi.fn();
    screens.onMenu(onMenu);

    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-action="menu"]');
    expect(buttons.length).toBe(2);
    buttons.forEach((button) => {
      button.click();
    });

    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it('notifica il toggle del mute alternando lo stato', () => {
    const screens = createScreens(root);
    const onToggleMute = vi.fn();
    screens.onToggleMute(onToggleMute);

    const button = need('[data-action="mute"]');
    button.click();
    button.click();

    expect(onToggleMute).toHaveBeenNthCalledWith(1, true);
    expect(onToggleMute).toHaveBeenNthCalledWith(2, false);
  });

  it('mostra il record del profilo selezionato e quello della corsa del giorno', () => {
    const screens = createScreens(root);

    screens.setRecords({ profiles: { calf: 100.9, normal: 1234.6, bull: 50 }, daily: 777.2 });
    expect(need('[data-menu-record]').textContent).toBe('1234');
    expect(need('[data-daily-record]').textContent).toBe('777');

    // Cambiare profilo cambia il record mostrato: con un record solo, il più
    // facile cancellerebbe di continuo quello fatto sul più difficile.
    need('[data-profile="bull"]').click();
    expect(need('[data-menu-record]').textContent).toBe('50');
  });

  it('parte da un profilo selezionato e ne segnala il cambio una sola volta', () => {
    const screens = createScreens(root);
    const onProfileChange = vi.fn();
    screens.onProfileChange(onProfileChange);

    expect(need('[data-profile="normal"]').getAttribute('aria-pressed')).toBe('true');

    need('[data-profile="calf"]').click();
    expect(need('[data-profile="calf"]').getAttribute('aria-pressed')).toBe('true');
    expect(need('[data-profile="normal"]').getAttribute('aria-pressed')).toBe('false');
    expect(onProfileChange).toHaveBeenCalledTimes(1);
    expect(onProfileChange).toHaveBeenCalledWith('calf');

    // Ri-cliccare lo stesso profilo non è un cambio.
    need('[data-profile="calf"]').click();
    expect(onProfileChange).toHaveBeenCalledTimes(1);
  });

  it('setProfile ripristina la scelta salvata senza rilanciare la callback', () => {
    const screens = createScreens(root);
    const onProfileChange = vi.fn();
    screens.onProfileChange(onProfileChange);

    screens.setProfile('bull');

    expect(need('[data-profile="bull"]').getAttribute('aria-pressed')).toBe('true');
    expect(onProfileChange).not.toHaveBeenCalled();
  });

  it('PARTI e CORSA DEL GIORNO avviano con il profilo scelto e la modalità giusta', () => {
    const screens = createScreens(root);
    const onStart = vi.fn();
    screens.onStart(onStart);

    need('[data-profile="calf"]').click();
    need('[data-action="start"]').click();
    expect(onStart).toHaveBeenNthCalledWith(1, 'calf', 'free');

    need('[data-action="daily"]').click();
    expect(onStart).toHaveBeenNthCalledWith(2, 'calf', 'daily');
  });

  it('RIGIOCA ripete profilo e modalità dell ultima corsa avviata', () => {
    const screens = createScreens(root);
    const onRestart = vi.fn();
    screens.onRestart(onRestart);

    need('[data-profile="bull"]').click();
    need('[data-action="daily"]').click();
    need('[data-action="restart"]').click();

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith('bull', 'daily');
  });

  it('scrive punteggio, record e statistiche di fine corsa', () => {
    const screens = createScreens(root);

    screens.setGameOver({
      points: 880.2,
      record: 1235,
      isRecord: false,
      distance: 1240.8,
      previousDistance: 900,
      recordDistance: 1252,
      avalanches: 3,
      maxSize: 4,
      snowflakes: 128,
    });

    expect(need('[data-final-points]').textContent).toBe('880');
    expect(need('[data-final-record]').textContent).toBe('1235');
    expect(need('[data-stat-distance]').textContent).toBe('1240');
    expect(need('[data-stat-avalanches]').textContent).toBe('3');
    expect(need('[data-stat-size]').textContent).toBe('4');
    expect(need('[data-stat-snowflakes]').textContent).toBe('128');
  });

  it('confronta la corsa con la precedente e con il record', () => {
    const screens = createScreens(root);

    screens.setGameOver({
      points: 100,
      record: 500,
      isRecord: false,
      distance: 1240,
      previousDistance: 900,
      recordDistance: 1252,
      avalanches: 0,
      maxSize: 1,
      snowflakes: 0,
    });

    const previous = need('[data-compare-previous]');
    expect(previous.textContent).toBe('+340 m rispetto alla corsa precedente');
    expect(previous.classList.contains('compare--up')).toBe(true);
    expect(need('[data-compare-record]').textContent).toBe('−12 m dal record');
  });

  it('alla prima corsa non c è nulla con cui confrontarsi', () => {
    const screens = createScreens(root);

    screens.setGameOver({
      points: 100,
      record: 100,
      isRecord: true,
      distance: 300,
      previousDistance: null,
      recordDistance: null,
      avalanches: 0,
      maxSize: 1,
      snowflakes: 0,
    });

    expect(need('[data-compare-previous]').classList.contains('screen--hidden')).toBe(true);
    expect(need('[data-compare-record]').classList.contains('screen--hidden')).toBe(true);
  });

  it('dopo un record non si mostra la distanza che manca al record', () => {
    const screens = createScreens(root);

    screens.setGameOver({
      points: 900,
      record: 900,
      isRecord: true,
      distance: 1300,
      previousDistance: 1300,
      recordDistance: 1300,
      avalanches: 1,
      maxSize: 2,
      snowflakes: 10,
    });

    expect(need('[data-compare-record]').classList.contains('screen--hidden')).toBe(true);
    expect(need('[data-compare-previous]').textContent).toBe(
      'Esattamente come la corsa precedente',
    );
  });

  it('mostra NUOVO RECORD solo quando isRecord è true', () => {
    const screens = createScreens(root);
    const banner = need('[data-new-record]');

    function finish(isRecord: boolean): void {
      screens.setGameOver({
        points: 100,
        record: 500,
        isRecord,
        distance: 0,
        previousDistance: null,
        recordDistance: null,
        avalanches: 0,
        maxSize: 1,
        snowflakes: 0,
      });
    }

    finish(false);
    expect(banner.classList.contains('screen--hidden')).toBe(true);

    finish(true);
    expect(banner.classList.contains('screen--hidden')).toBe(false);
    expect(banner.textContent).toBe('NUOVO RECORD!');
  });

  it('mostra le missioni del giorno nel menu e nella fine corsa', () => {
    const screens = createScreens(root);

    screens.setQuests([
      { id: 'flakes', label: 'Raccogli 80 fiocchi', progress: 42, goal: 80, completed: false },
      { id: 'size', label: 'Arriva a taglia 4', progress: 4, goal: 4, completed: true },
    ]);

    const sections = root.querySelectorAll<HTMLElement>('[data-quests]');
    expect(sections.length).toBe(2);
    sections.forEach((section) => {
      expect(section.classList.contains('screen--hidden')).toBe(false);
      const rows = section.querySelectorAll('.quest');
      expect(rows.length).toBe(2);
      expect(rows[0]?.querySelector('.quest__label')?.textContent).toBe('Raccogli 80 fiocchi');
      expect(rows[0]?.querySelector('.quest__value')?.textContent).toBe('42/80');
      expect(rows[1]?.classList.contains('quest--done')).toBe(true);
      expect(rows[1]?.querySelector('.quest__value')?.textContent).toBe('FATTO');
    });
  });

  it('senza missioni le due sezioni spariscono', () => {
    const screens = createScreens(root);

    screens.setQuests([{ id: 'a', label: 'x', progress: 0, goal: 1, completed: false }]);
    screens.setQuests([]);

    root.querySelectorAll<HTMLElement>('[data-quests]').forEach((section) => {
      expect(section.classList.contains('screen--hidden')).toBe(true);
      expect(section.querySelectorAll('.quest').length).toBe(0);
    });
  });

  it('l etichetta di una missione non può iniettare markup', () => {
    const screens = createScreens(root);

    screens.setQuests([
      { id: 'x', label: '<img src=x onerror="1">', progress: 0, goal: 1, completed: false },
    ]);

    const label = need('.quest__label');
    expect(label.querySelector('img')).toBeNull();
    expect(label.textContent).toBe('<img src=x onerror="1">');
  });

  it('il prompt del tutorial si accende e si spegne', () => {
    const screens = createScreens(root);
    const prompt = need('[data-prompt]');

    screens.setPrompt('SALTA');
    expect(prompt.classList.contains('prompt--visible')).toBe(true);
    expect(prompt.textContent).toBe('SALTA');

    screens.setPrompt(null);
    expect(prompt.classList.contains('prompt--visible')).toBe(false);
  });

  it('uscire dal gioco spegne il prompt, che altrimenti resterebbe sopra un pannello', () => {
    const screens = createScreens(root);
    const prompt = need('[data-prompt]');

    screens.show('playing');
    screens.setPrompt('SCEGLI');
    screens.show('paused');

    expect(prompt.classList.contains('prompt--visible')).toBe(false);
  });
});
