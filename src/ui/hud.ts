import { CONFIG } from '../game/config';

/** Lato di un bivio, come lo nominano gli eventi del bus. */
export type ForkSide = 'left' | 'right';

/** I tre badge di buff che l'HUD sa mostrare. Non coincide con BuffKind di
 *  game/types: il cristallo diventa lo SCUDO e il campanaccio non ha badge
 *  (agisce sulla carica), quindi la traduzione la fa il chiamante. */
export type HudBuffKind = 'shield' | 'star' | 'magnet';

export interface Hud {
  setPoints(p: number): void;
  /** Moltiplicatore TOTALE già in vigore (stella × valanga × serie). È il
   *  numero su cui il giocatore decide se vale la pena rischiare: l'HUD
   *  mostrava i buff singoli e mai il loro prodotto. */
  setMultiplier(value: number): void;
  /** Distanza percorsa in metri. Il gioco la calcolava già e non la mostrava
   *  a nessuno: senza di essa non si sa mai se si sta andando bene. */
  setDistance(meters: number): void;
  /** Il record precedente è stato superato ADESSO, durante la corsa. */
  showRecordBeaten(): void;
  /** Azzera il marcatore di record: da chiamare all'inizio di ogni corsa. */
  clearRecordBeaten(): void;
  setCharge(ratio: number): void;
  setSize(size: number): void;
  /** Gradino di serie corrente; 0 nasconde l'indicatore. */
  setStreak(streak: number): void;
  setAvalanche(on: boolean, warning: boolean): void;
  /** Vignetta calda pulsante durante la valanga. Separata da setAvalanche
   *  perché è puro effetto: si spegne sotto riduzione del movimento e non
   *  deve trascinarsi dietro le altre classi di stato. */
  setAvalancheFx(on: boolean): void;
  /** Scudo acceso/spento, secondi residui di stella e calamita (0 o meno =
   *  badge spento). Stella e calamita possono essere attive insieme. */
  setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void;
  /** Segnala che un buff sta per scadere: il badge lampeggia (o cambia colore,
   *  sotto riduzione del movimento). Si spegne da solo quando setBuffs()
   *  dichiara quel buff non più attivo, così il chiamante non deve ricordarsi
   *  di annullarlo. */
  setBuffExpiring(kind: HudBuffKind, expiring?: boolean): void;
  /** Mostra o nasconde il pannello del bivio. Nasconderlo azzera anche la
   *  scelta e il lato di default. */
  setFork(visible: boolean): void;
  /** Lampeggia brevemente sul lato che si ottiene NON facendo nulla. È
   *  l'unica informazione che il mondo non può dare: quale ramo mi prende se
   *  resto fermo. (Il ramo ricco NON va evidenziato: quello si vede già dal
   *  pendio, che è pieno di fiocchi.) */
  setForkDefault(side: ForkSide | null): void;
  /** Illumina la freccia del lato scelto dal giocatore; null la spegne. */
  setForkChoice(side: ForkSide | null): void;
  /** L'HUD deve stare visibile SOLO in 'playing': senza questo, punteggio,
   *  barra di carica e taglia restano leggibili sopra menu, pausa e game
   *  over, spesso sovrapposti allo stesso numero mostrato dalla schermata. */
  setVisible(visible: boolean): void;
  /** Tap sul bottone di pausa dell'HUD. */
  onPause(fn: () => void): void;
}

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';

function strokeIcon(body: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${STROKE}>${body}</svg>`;
}

function solidIcon(body: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">${body}</svg>`;
}

/**
 * Icone dell'interfaccia, disegnate come SVG in linea: niente file esterni, è
 * una regola del progetto (e una richiesta a un CDN in più su una connessione
 * lenta significa un'interfaccia senza icone proprio al primo avvio).
 *
 * Servono perché il gioco nasce dall'idea di una bambina in età prescolare e
 * l'interfaccia parlava solo con parole: TAGLIA, SCUDO, CALAMITA, SINISTRA.
 * Le icone AFFIANCANO le etichette, non le sostituiscono — chi legge continua
 * a leggere, chi non legge riconosce comunque la forma.
 *
 * Vivono qui e non in un modulo a parte per non spargere frammenti di markup
 * in giro: ui/screens.ts le importa da questo file.
 */
export const ICONS = {
  /** Campanaccio: la carica che porta alla valanga. */
  bell: strokeIcon(
    '<path d="M10.5 3.5h3l2 11h-7z"/><path d="M7.5 14.5h9"/><path d="M12 17.5a1.6 1.6 0 100 3 1.6 1.6 0 100-3z"/>',
  ),
  star: solidIcon(
    '<path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.4l-5.8 3.1 1.1-6.45-4.7-4.6 6.5-.95z"/>',
  ),
  /** Calamita a ferro di cavallo, poli in basso. */
  magnet: strokeIcon(
    '<path d="M4.5 14.5v-2a7.5 7.5 0 0115 0v2"/><path d="M9.5 14.5v-2a2.5 2.5 0 015 0v2"/><path d="M4.5 14.5h5M14.5 14.5h5"/>',
  ),
  shield: strokeIcon(
    '<path d="M12 3l7.5 2.8v5.4c0 4.6-3.1 8-7.5 9.3-4.4-1.3-7.5-4.7-7.5-9.3V5.8z"/>',
  ),
  /** Testa di mucca: l'indicatore di taglia. */
  cow: strokeIcon(
    '<path d="M4 6.5c2.2 0 3.3 1.1 3.8 2.3M20 6.5c-2.2 0-3.3 1.1-3.8 2.3"/><path d="M6.2 11.2c0-2.6 2.6-4.2 5.8-4.2s5.8 1.6 5.8 4.2c0 4.2-2.6 7.3-5.8 7.3s-5.8-3.1-5.8-7.3z"/><path d="M9.7 11.4h.01M14.3 11.4h.01M10.6 15h.01M13.4 15h.01"/>',
  ),
  arrowLeft: strokeIcon('<path d="M15.5 4.5l-7.5 7.5 7.5 7.5" stroke-width="2.6"/>'),
  arrowRight: strokeIcon('<path d="M8.5 4.5l7.5 7.5-7.5 7.5" stroke-width="2.6"/>'),
  play: solidIcon('<path d="M7.5 4.5l12 7.5-12 7.5z"/>'),
  pause: solidIcon(
    '<rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/>',
  ),
  /** Tocco secco: il salto. */
  tap: strokeIcon(
    '<path d="M12 8.5a3.2 3.2 0 100 6.4 3.2 3.2 0 100-6.4z"/><path d="M6.4 5.9a8 8 0 000 11.6M17.6 5.9a8 8 0 010 11.6"/>',
  ),
  /** Giù: la scivolata. */
  swipeDown: strokeIcon('<path d="M12 4.5v13"/><path d="M6.5 12.5L12 18l5.5-5.5"/>'),
  /** Serie di ostacoli superati senza colpi. */
  flame: solidIcon(
    '<path d="M12.6 2.4c.4 3-1.2 4.3-2.6 5.6C8.3 9.5 6.7 11 6.7 13.8a5.3 5.3 0 1010.6 0c0-2.6-1.3-4.2-2.3-5.6-.3 1.2-1 1.9-1.7 1.9-1 0-1.3-1-1-2.6.2-1.5.6-3.3.3-5.1z"/>',
  ),
  /** Fiocco di neve: la raccolta che carica la valanga. */
  snowflake: strokeIcon(
    '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.4 4.6L12 7.2l2.6-2.6M9.4 19.4L12 16.8l2.6 2.6"/>',
  ),
  /** Bandierina: distanza e record. */
  flag: strokeIcon('<path d="M6.5 3.5v17"/><path d="M6.5 4.5h11l-2.3 3.6 2.3 3.6h-11z"/>'),
} as const;

/** Quanto resta acceso il lampo sul ramo di default all'apparire del bivio. */
const FORK_DEFAULT_FLASH_MS = 400;
/** Quanto resta a video l'avviso di record superato durante la corsa. */
const RECORD_BANNER_MS = 2200;

/** Il moltiplicatore di serie ha gradini frazionari (1,25 / 1,5): mostrarlo
 *  come "×1.25" e non "×1" o "×1.2500000000000002". */
function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `×${rounded}`;
  }
  return `×${rounded.toFixed(2).replace(/0$/, '')}`;
}

/**
 * HUD in HTML sopra al canvas. Non legge lo stato di gioco: riceve solo numeri
 * già pronti, così resta un consumatore passivo e testabile.
 *
 * L'intero HUD è `pointer-events: none` (vedi style.css): se catturasse i touch,
 * gli swipe non arriverebbero al canvas e il gioco sarebbe ingiocabile. L'UNICA
 * eccezione è il bottone di pausa, che riattiva `pointer-events: auto` solo su
 * se stesso e vive nell'angolo in alto a destra, fuori dalla zona centrale
 * dove si swipa. Nessun altro elemento dell'HUD deve mai farlo.
 */
export function createHud(root: HTMLElement): Hud {
  const container = document.createElement('div');
  container.className = 'hud';
  container.innerHTML = `
    <div class="hud__vignette" aria-hidden="true"></div>
    <button class="hud__pause" type="button" data-action="pause" aria-label="Pausa">${ICONS.pause}</button>
    <div class="hud__points">0</div>
    <div class="hud__multiplier">×1</div>
    <div class="hud__distance">${ICONS.flag}<span class="hud__distance-value">0</span> m</div>
    <p class="hud__record" data-record-beaten>${ICONS.flag}RECORD SUPERATO!</p>
    <div class="hud__charge-row">
      ${ICONS.bell}
      <div class="hud__charge"><div class="hud__charge-fill"></div></div>
    </div>
    <div class="hud__tags">
      <div class="hud__size">${ICONS.cow}<span class="hud__size-value">TAGLIA 1</span></div>
      <div class="hud__streak">${ICONS.flame}<span class="hud__streak-value">SERIE 0</span></div>
    </div>
    <div class="hud__buffs">
      <div class="hud__buff hud__buff--shield" data-buff="shield">${ICONS.shield}SCUDO</div>
      <div class="hud__buff hud__buff--star" data-buff="star">${ICONS.star}<span class="hud__buff-time"></span>×2</div>
      <div class="hud__buff hud__buff--magnet" data-buff="magnet">${ICONS.magnet}<span class="hud__buff-time"></span>CALAMITA</div>
    </div>
    <div class="hud__fork">
      <div class="hud__fork-side" data-side="left">${ICONS.arrowLeft}<span class="hud__fork-label">SINISTRA</span></div>
      <div class="hud__fork-side" data-side="right"><span class="hud__fork-label">DESTRA</span>${ICONS.arrowRight}</div>
    </div>
  `;
  root.appendChild(container);

  function need(selector: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(selector);
    if (el === null) {
      throw new Error(`Elemento mancante nel HUD: ${selector}`);
    }
    return el;
  }

  const pauseEl = need('[data-action="pause"]');
  const pointsEl = need('.hud__points');
  const multiplierEl = need('.hud__multiplier');
  const distanceEl = need('.hud__distance-value');
  const recordEl = need('[data-record-beaten]');
  const fillEl = need('.hud__charge-fill');
  const sizeEl = need('.hud__size-value');
  const streakEl = need('.hud__streak');
  const streakValueEl = need('.hud__streak-value');
  const vignetteEl = need('.hud__vignette');
  const forkEl = need('.hud__fork');
  const forkSides: Readonly<Record<ForkSide, HTMLElement>> = {
    left: need('[data-side="left"]'),
    right: need('[data-side="right"]'),
  };
  const buffEls: Readonly<Record<HudBuffKind, HTMLElement>> = {
    shield: need('[data-buff="shield"]'),
    star: need('[data-buff="star"]'),
    magnet: need('[data-buff="magnet"]'),
  };
  const starTimeEl = need('[data-buff="star"] .hud__buff-time');
  const magnetTimeEl = need('[data-buff="magnet"] .hud__buff-time');

  // La vignetta legge i suoi due numeri dalla configurazione della valanga: il
  // CSS li usa come variabili, così la taratura resta in un posto solo.
  vignetteEl.style.setProperty(
    '--vignette-opacity',
    String(CONFIG.render.avalancheFx.vignetteOpacity),
  );
  vignetteEl.style.setProperty(
    '--vignette-period',
    `${1 / CONFIG.render.avalancheFx.vignettePulseHz}s`,
  );

  let pauseFn: () => void = (): void => {};
  pauseEl.addEventListener('click', () => {
    pauseFn();
    // Come per i bottoni delle schermate: se il focus restasse qui, input.ts
    // lascerebbe Spazio/Invio al bottone e il salto da tastiera si perderebbe
    // subito dopo una pausa.
    if (document.activeElement === pauseEl) {
      pauseEl.blur();
    }
  });

  let forkDefaultTimer: ReturnType<typeof setTimeout> | null = null;
  let recordTimer: ReturnType<typeof setTimeout> | null = null;

  function clearForkDefault(): void {
    if (forkDefaultTimer !== null) {
      clearTimeout(forkDefaultTimer);
      forkDefaultTimer = null;
    }
    forkSides.left.classList.remove('hud__fork-side--default');
    forkSides.right.classList.remove('hud__fork-side--default');
  }

  return {
    setPoints(p: number): void {
      // Math.floor, non Math.round: come dichiarato in game/score.ts, la vista
      // non deve mai mostrare un punto non ancora davvero guadagnato.
      pointsEl.textContent = String(Math.floor(p));
    },

    setMultiplier(value: number): void {
      multiplierEl.textContent = formatMultiplier(value);
      // Sopra ×1 il numero si accende: a ×1 è rumore, sopra è la ragione per
      // cui si sta correndo in quel modo.
      multiplierEl.classList.toggle('hud__multiplier--boosted', value > 1);
    },

    setDistance(meters: number): void {
      distanceEl.textContent = String(Math.floor(Math.max(0, meters)));
    },

    showRecordBeaten(): void {
      recordEl.classList.add('hud__record--visible');
      // Il numero resta marcato per tutto il resto della corsa: l'avviso passa,
      // ma "sto già oltre il mio record" è un'informazione che vale sempre.
      pointsEl.classList.add('hud__points--record');
      if (recordTimer !== null) {
        clearTimeout(recordTimer);
      }
      recordTimer = setTimeout(() => {
        recordEl.classList.remove('hud__record--visible');
        recordTimer = null;
      }, RECORD_BANNER_MS);
    },

    clearRecordBeaten(): void {
      if (recordTimer !== null) {
        clearTimeout(recordTimer);
        recordTimer = null;
      }
      recordEl.classList.remove('hud__record--visible');
      pointsEl.classList.remove('hud__points--record');
    },

    setCharge(ratio: number): void {
      const clamped = Math.max(0, Math.min(1, ratio));
      // Un decimale basta e tiene la stringa pulita (50%, 33.3%).
      fillEl.style.width = `${Math.round(clamped * 1000) / 10}%`;
    },

    setSize(size: number): void {
      sizeEl.textContent = `TAGLIA ${Math.round(size)}`;
    },

    setStreak(streak: number): void {
      const on = streak > 0;
      streakEl.classList.toggle('hud__streak--visible', on);
      if (on) {
        streakValueEl.textContent = `SERIE ${Math.round(streak)}`;
      }
    },

    setAvalanche(on: boolean, warning: boolean): void {
      container.classList.toggle('hud--avalanche', on);
      container.classList.toggle('hud--warning', warning);
    },

    setAvalancheFx(on: boolean): void {
      vignetteEl.classList.toggle('hud__vignette--on', on);
    },

    setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void {
      const starOn = starSeconds > 0;
      const magnetOn = magnetSeconds > 0;

      buffEls.shield.classList.toggle('hud__buff--active', shield);
      buffEls.star.classList.toggle('hud__buff--active', starOn);
      buffEls.magnet.classList.toggle('hud__buff--active', magnetOn);

      // Un badge spento non può stare "in scadenza": si spegne qui, così chi
      // chiama deve solo accendere l'avviso e mai ricordarsi di toglierlo.
      if (!shield) buffEls.shield.classList.remove('hud__buff--expiring');
      if (!starOn) buffEls.star.classList.remove('hud__buff--expiring');
      if (!magnetOn) buffEls.magnet.classList.remove('hud__buff--expiring');

      // Il tempo residuo (e la "s" dei secondi) compare SOLO mentre il buff è
      // attivo: da spento il badge deve mostrare solo il proprio nome (×2,
      // CALAMITA), non un tempo formattato che non corrisponde a nulla.
      starTimeEl.textContent = starOn ? `${Math.ceil(starSeconds)}s ` : '';
      magnetTimeEl.textContent = magnetOn ? `${Math.ceil(magnetSeconds)}s ` : '';
    },

    setBuffExpiring(kind: HudBuffKind, expiring = true): void {
      buffEls[kind].classList.toggle('hud__buff--expiring', expiring);
    },

    setFork(visible: boolean): void {
      forkEl.classList.toggle('hud__fork--visible', visible);
      if (!visible) {
        clearForkDefault();
        forkSides.left.classList.remove('hud__fork-side--chosen');
        forkSides.right.classList.remove('hud__fork-side--chosen');
      }
    },

    setForkDefault(side: ForkSide | null): void {
      clearForkDefault();
      if (side === null) {
        return;
      }
      forkSides[side].classList.add('hud__fork-side--default');
      forkDefaultTimer = setTimeout(() => {
        forkSides[side].classList.remove('hud__fork-side--default');
        forkDefaultTimer = null;
      }, FORK_DEFAULT_FLASH_MS);
    },

    setForkChoice(side: ForkSide | null): void {
      forkSides.left.classList.toggle('hud__fork-side--chosen', side === 'left');
      forkSides.right.classList.toggle('hud__fork-side--chosen', side === 'right');
    },

    setVisible(visible: boolean): void {
      container.classList.toggle('hud--hidden', !visible);
    },

    onPause(fn: () => void): void {
      pauseFn = fn;
    },
  };
}
