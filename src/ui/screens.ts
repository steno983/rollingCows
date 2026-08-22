import type { GameStateName } from '../core/state-machine';
import { CONFIG } from '../game/config';
import { ICONS } from './hud';

/** I tre profili di difficoltà, presi direttamente dalla configurazione: se lì
 *  ne compare un quarto, il menu lo mostra e il tipo lo accetta senza toccare
 *  questo file. */
export type DifficultyId = keyof typeof CONFIG.difficultyProfiles;

/** Corsa libera (seed casuale) o corsa del giorno (seed condiviso da tutti). */
export type RunMode = 'free' | 'daily';

/** Record da mostrare nel menu. La corsa del giorno ha il suo, separato: con
 *  un seed fisso il punteggio non è confrontabile con quello di una corsa
 *  normale, e ogni profilo ha il proprio perché altrimenti "Vitellino"
 *  cancellerebbe di continuo il record fatto su "Toro". */
export interface MenuRecords {
  profiles: Readonly<Record<DifficultyId, number>>;
  daily: number;
}

/**
 * Vista minima di una missione del giorno. Volutamente NON è il tipo di
 * game/quests.ts: le schermate devono poter essere disegnate e testate senza
 * conoscere come le missioni vengono estratte, valutate o salvate.
 */
export interface QuestView {
  id: string;
  /** Testo già in italiano e già leggibile, es. "Raccogli 80 fiocchi". */
  label: string;
  /** Avanzamento corrente, nella stessa unità di `goal`. */
  progress: number;
  goal: number;
  completed: boolean;
}

/**
 * Riepilogo di fine corsa. La distanza era già nel payload di 'run:ended' e
 * veniva buttata via; i confronti (corsa precedente, record) sono il gancio
 * che fa premere RIGIOCA, perché trasformano un numero isolato in una
 * traiettoria.
 */
export interface GameOverStats {
  points: number;
  record: number;
  isRecord: boolean;
  /** Metri percorsi in questa corsa. */
  distance: number;
  /** Metri della corsa precedente; null alla primissima corsa. */
  previousDistance: number | null;
  /** Metri percorsi nella corsa che detiene il record; null se non noti. */
  recordDistance: number | null;
  /** Quante volte la valanga è partita. */
  avalanches: number;
  /** Taglia massima raggiunta (1..5). */
  maxSize: number;
  /** Fiocchi raccolti. */
  snowflakes: number;
}

export interface Screens {
  show(name: GameStateName): void;
  setRecords(records: MenuRecords): void;
  /** Seleziona il profilo mostrato come attivo (per ripristinare la scelta
   *  salvata all'avvio). Non invoca onProfileChange. */
  setProfile(profile: DifficultyId): void;
  setGameOver(stats: GameOverStats): void;
  /** Missioni del giorno: le stesse tre righe compaiono nel menu e nella
   *  schermata di fine corsa. Un elenco vuoto nasconde entrambe le sezioni. */
  setQuests(quests: readonly QuestView[]): void;
  /** Prompt grande sopra il pendio (SALTA / SCIVOLA / SCEGLI); null lo
   *  spegne. Resta visibile mentre si gioca, quindi vive fuori dalle
   *  schermate, che durante il gioco sono tutte display:none. */
  setPrompt(text: string | null): void;
  /** PARTI e CORSA DEL GIORNO: il profilo è quello selezionato nel menu. */
  onStart(fn: (profile: DifficultyId, mode: RunMode) => void): void;
  /** RIGIOCA: ripete profilo e modalità dell'ultima corsa avviata. */
  onRestart(fn: (profile: DifficultyId, mode: RunMode) => void): void;
  onProfileChange(fn: (profile: DifficultyId) => void): void;
  onResume(fn: () => void): void;
  onMenu(fn: () => void): void;
  onToggleMute(fn: (muted: boolean) => void): void;
}

const HIDDEN = 'screen--hidden';

/** Profilo di partenza: quello di mezzo, non il più facile né il più duro. */
const DEFAULT_PROFILE: DifficultyId = 'normal';

/** Stato del mute salvato dall'audio: il bottone deve nascere coerente. */
function readPersistedMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONFIG.audio.mutedKey) === '1';
  } catch {
    return false;
  }
}

function isDifficultyId(value: string): value is DifficultyId {
  return Object.hasOwn(CONFIG.difficultyProfiles, value);
}

/** Segno tipografico, non il trattino della tastiera: "−12 m" si legge come un
 *  numero negativo, "-12 m" come un elenco puntato. */
function formatDelta(meters: number): string {
  const rounded = Math.round(meters);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded)} m`;
}

/**
 * Menu, pausa e game over in HTML/CSS sopra al canvas.
 *
 * Solo le schermate visibili ricevono i tap (`pointer-events: auto` sul singolo
 * `.screen`, mentre il contenitore #ui-root resta `none`): quando si gioca sono
 * tutte `display: none`, quindi nulla può rubare gli swipe al canvas. Il prompt
 * del tutorial è l'unico elemento vivo durante il gioco ed è per questo
 * `pointer-events: none`.
 */
export function createScreens(root: HTMLElement): Screens {
  const layer = document.createElement('div');
  layer.className = 'screens';

  const profileButtons = Object.entries(CONFIG.difficultyProfiles)
    .map(
      ([id, profile]) =>
        `<button class="profile" type="button" data-profile="${id}" aria-pressed="false">${profile.label}</button>`,
    )
    .join('');

  layer.innerHTML = `
    <section class="screen ${HIDDEN}" data-screen="menu">
      <div class="panel">
        <h1 class="title">Rolling Cows</h1>
        <p class="subtitle">Rotola, cresci, travolgi tutto.</p>
        <div class="profiles" role="group" aria-label="Difficoltà">${profileButtons}</div>
        <p class="record">Record: <span data-menu-record>0</span></p>
        <button class="button button--primary" type="button" data-action="start">${ICONS.play}PARTI</button>
        <button class="button button--ghost" type="button" data-action="daily">${ICONS.flag}CORSA DEL GIORNO <span class="button__note" data-daily-record>0</span></button>
        <section class="quests ${HIDDEN}" data-quests="menu">
          <h3 class="quests__title">Missioni di oggi</h3>
          <ul class="quests__list" data-quest-list></ul>
        </section>
        <ul class="controls">
          <li class="control">${ICONS.tap}<span>Tocca: SALTA</span></li>
          <li class="control">${ICONS.swipeDown}<span>Trascina giù: SCIVOLA</span></li>
          <li class="control">${ICONS.arrowLeft}${ICONS.arrowRight}<span>Trascina di lato: SCEGLI</span></li>
          <li class="control">${ICONS.pause}<span>In alto a destra: PAUSA</span></li>
        </ul>
        <button class="button button--ghost" type="button" data-action="mute" aria-pressed="false">Audio: ON</button>
      </div>
    </section>
    <section class="screen ${HIDDEN}" data-screen="paused">
      <div class="panel">
        <h2 class="title title--small">Pausa</h2>
        <button class="button button--primary" type="button" data-action="resume">${ICONS.play}RIPRENDI</button>
        <button class="button button--ghost" type="button" data-action="menu">MENU</button>
      </div>
    </section>
    <section class="screen ${HIDDEN}" data-screen="gameover">
      <div class="panel">
        <h2 class="title title--small">Fine corsa</h2>
        <p class="record record--new ${HIDDEN}" data-new-record>NUOVO RECORD!</p>
        <p class="score">Punteggio: <span data-final-points>0</span></p>
        <p class="record">Record: <span data-final-record>0</span></p>
        <ul class="stats">
          <li class="stat">${ICONS.flag}<span class="stat__value" data-stat-distance>0</span><span class="stat__label">metri</span></li>
          <li class="stat">${ICONS.bell}<span class="stat__value" data-stat-avalanches>0</span><span class="stat__label">valanghe</span></li>
          <li class="stat">${ICONS.cow}<span class="stat__value" data-stat-size>1</span><span class="stat__label">taglia max</span></li>
          <li class="stat">${ICONS.snowflake}<span class="stat__value" data-stat-snowflakes>0</span><span class="stat__label">fiocchi</span></li>
        </ul>
        <p class="compare ${HIDDEN}" data-compare-previous></p>
        <p class="compare ${HIDDEN}" data-compare-record></p>
        <section class="quests ${HIDDEN}" data-quests="gameover">
          <h3 class="quests__title">Missioni di oggi</h3>
          <ul class="quests__list" data-quest-list></ul>
        </section>
        <button class="button button--primary" type="button" data-action="restart">${ICONS.play}RIGIOCA</button>
        <button class="button button--ghost" type="button" data-action="menu">MENU</button>
      </div>
    </section>
    <p class="prompt" data-prompt aria-live="polite"></p>
  `;
  root.appendChild(layer);

  function need(selector: string): HTMLElement {
    const el = layer.querySelector<HTMLElement>(selector);
    if (el === null) {
      throw new Error(`Elemento mancante nelle schermate: ${selector}`);
    }
    return el;
  }

  const menuEl = need('[data-screen="menu"]');
  const pausedEl = need('[data-screen="paused"]');
  const gameoverEl = need('[data-screen="gameover"]');
  const menuRecordEl = need('[data-menu-record]');
  const dailyRecordEl = need('[data-daily-record]');
  const finalPointsEl = need('[data-final-points]');
  const finalRecordEl = need('[data-final-record]');
  const newRecordEl = need('[data-new-record]');
  const distanceEl = need('[data-stat-distance]');
  const avalanchesEl = need('[data-stat-avalanches]');
  const maxSizeEl = need('[data-stat-size]');
  const snowflakesEl = need('[data-stat-snowflakes]');
  const comparePreviousEl = need('[data-compare-previous]');
  const compareRecordEl = need('[data-compare-record]');
  const promptEl = need('[data-prompt]');
  const muteButton = need('[data-action="mute"]');
  const questSections = layer.querySelectorAll<HTMLElement>('[data-quests]');

  const noop = (): void => {};
  let startFn: (profile: DifficultyId, mode: RunMode) => void = noop;
  let restartFn: (profile: DifficultyId, mode: RunMode) => void = noop;
  let profileChangeFn: (profile: DifficultyId) => void = noop;
  let resumeFn: () => void = noop;
  let menuFn: () => void = noop;
  let muteFn: (muted: boolean) => void = noop;

  let muted = readPersistedMuted();
  let profile: DifficultyId = DEFAULT_PROFILE;
  /** Profilo e modalità dell'ultima corsa avviata: è ciò che RIGIOCA ripete. */
  let lastMode: RunMode = 'free';
  let records: MenuRecords = {
    profiles: { calf: 0, normal: 0, bull: 0 },
    daily: 0,
  };

  function bind(action: string, handler: () => void): void {
    layer.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`).forEach((button) => {
      button.addEventListener('click', handler);
    });
  }

  /** Come bind(), ma toglie anche il focus dal bottone dopo il click: PARTI,
   *  RIGIOCA e RIPRENDI riportano tutti alla schermata 'playing', e il focus
   *  del browser resterebbe altrimenti appeso al bottone, facendo scartare a
   *  input.ts ogni tasto premuto per la corsa (vedi input/input.ts). */
  function bindAndBlur(action: string, handler: () => void): void {
    bind(action, () => {
      handler();
      layer.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`).forEach((button) => {
        if (document.activeElement === button) {
          button.blur();
        }
      });
    });
  }

  function renderMuteButton(): void {
    muteButton.textContent = muted ? 'Audio: OFF' : 'Audio: ON';
    muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  function renderRecords(): void {
    // Math.floor come in game/score.ts e ui/hud.ts: mai un punto mostrato che
    // non sia stato davvero guadagnato.
    menuRecordEl.textContent = String(Math.floor(records.profiles[profile]));
    dailyRecordEl.textContent = String(Math.floor(records.daily));
  }

  function renderProfile(): void {
    layer.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => {
      const selected = button.dataset.profile === profile;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.classList.toggle('profile--selected', selected);
    });
    renderRecords();
  }

  layer.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.profile;
      if (id === undefined || !isDifficultyId(id) || id === profile) {
        return;
      }
      profile = id;
      renderProfile();
      profileChangeFn(profile);
    });
  });

  bindAndBlur('start', () => {
    lastMode = 'free';
    startFn(profile, 'free');
  });
  bindAndBlur('daily', () => {
    lastMode = 'daily';
    startFn(profile, 'daily');
  });
  bindAndBlur('restart', () => restartFn(profile, lastMode));
  bindAndBlur('resume', () => resumeFn());
  bind('menu', () => menuFn());
  bind('mute', () => {
    muted = !muted;
    renderMuteButton();
    muteFn(muted);
  });

  renderMuteButton();
  renderProfile();

  return {
    show(name: GameStateName): void {
      menuEl.classList.toggle(HIDDEN, name !== 'menu');
      pausedEl.classList.toggle(HIDDEN, name !== 'paused');
      gameoverEl.classList.toggle(HIDDEN, name !== 'gameover');
      // Il prompt appartiene alla corsa: se si esce dal gioco (pausa, morte,
      // menu) resterebbe altrimenti appeso sopra a un pannello.
      if (name !== 'playing') {
        promptEl.classList.remove('prompt--visible');
      }
    },

    setRecords(next: MenuRecords): void {
      records = next;
      renderRecords();
    },

    setProfile(next: DifficultyId): void {
      profile = next;
      renderProfile();
    },

    setGameOver(stats: GameOverStats): void {
      finalPointsEl.textContent = String(Math.floor(stats.points));
      finalRecordEl.textContent = String(Math.floor(stats.record));
      newRecordEl.classList.toggle(HIDDEN, !stats.isRecord);

      distanceEl.textContent = String(Math.floor(Math.max(0, stats.distance)));
      avalanchesEl.textContent = String(Math.max(0, Math.floor(stats.avalanches)));
      maxSizeEl.textContent = String(Math.max(1, Math.round(stats.maxSize)));
      snowflakesEl.textContent = String(Math.max(0, Math.floor(stats.snowflakes)));

      const previous = stats.previousDistance;
      comparePreviousEl.classList.toggle(HIDDEN, previous === null);
      if (previous !== null) {
        const delta = stats.distance - previous;
        comparePreviousEl.textContent =
          Math.round(delta) === 0
            ? 'Esattamente come la corsa precedente'
            : `${formatDelta(delta)} rispetto alla corsa precedente`;
        comparePreviousEl.classList.toggle('compare--up', delta > 0);
      }

      // Quanto manca al record ha senso solo se il record NON è appena stato
      // battuto: dopo un record, "−0 m dal record" è una frase priva di senso
      // accanto al cartello NUOVO RECORD.
      const recordDistance = stats.recordDistance;
      const showRecordGap = recordDistance !== null && !stats.isRecord;
      compareRecordEl.classList.toggle(HIDDEN, !showRecordGap);
      if (showRecordGap && recordDistance !== null) {
        compareRecordEl.textContent = `${formatDelta(stats.distance - recordDistance)} dal record`;
      }
    },

    setQuests(quests: readonly QuestView[]): void {
      questSections.forEach((section) => {
        section.classList.toggle(HIDDEN, quests.length === 0);
        const list = section.querySelector<HTMLElement>('[data-quest-list]');
        if (list === null) {
          return;
        }
        list.replaceChildren();
        for (const quest of quests) {
          list.appendChild(buildQuestRow(quest));
        }
      });
    },

    setPrompt(text: string | null): void {
      promptEl.classList.toggle('prompt--visible', text !== null);
      if (text !== null) {
        promptEl.textContent = text;
      }
    },

    onStart(fn: (profile: DifficultyId, mode: RunMode) => void): void {
      startFn = fn;
    },

    onRestart(fn: (profile: DifficultyId, mode: RunMode) => void): void {
      restartFn = fn;
    },

    onProfileChange(fn: (profile: DifficultyId) => void): void {
      profileChangeFn = fn;
    },

    onResume(fn: () => void): void {
      resumeFn = fn;
    },

    onMenu(fn: () => void): void {
      menuFn = fn;
    },

    onToggleMute(fn: (muted: boolean) => void): void {
      muteFn = fn;
    },
  };
}

/** Riga di missione. Costruita con textContent e non con innerHTML: l'etichetta
 *  arriva da un altro modulo e non deve mai poter iniettare markup. */
function buildQuestRow(quest: QuestView): HTMLLIElement {
  const row = document.createElement('li');
  row.className = quest.completed ? 'quest quest--done' : 'quest';
  row.dataset.quest = quest.id;

  const label = document.createElement('span');
  label.className = 'quest__label';
  label.textContent = quest.label;

  const value = document.createElement('span');
  value.className = 'quest__value';
  const goal = Math.max(1, quest.goal);
  const done = Math.max(0, Math.min(quest.progress, goal));
  value.textContent = quest.completed ? 'FATTO' : `${Math.floor(done)}/${Math.floor(goal)}`;

  const bar = document.createElement('span');
  bar.className = 'quest__bar';
  const fill = document.createElement('span');
  fill.className = 'quest__bar-fill';
  fill.style.width = `${quest.completed ? 100 : Math.round((done / goal) * 100)}%`;
  bar.appendChild(fill);

  row.append(label, value, bar);
  return row;
}
