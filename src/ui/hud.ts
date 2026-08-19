export interface Hud {
  setPoints(p: number): void;
  setCharge(ratio: number): void;
  setSize(size: number): void;
  setAvalanche(on: boolean, warning: boolean): void;
  /** Scudo acceso/spento, secondi residui di stella e calamita (0 o meno =
   *  badge spento). Stella e calamita possono essere attive insieme. */
  setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void;
  /** Ramo ricco da evidenziare mentre un bivio è in lettura; null nasconde
   *  del tutto il pannello (nessun bivio in corso). */
  setFork(richBranch: 'left' | 'right' | null): void;
  /** L'HUD deve stare visibile SOLO in 'playing': senza questo, punteggio,
   *  barra di carica e taglia restano leggibili sopra menu, pausa e game
   *  over, spesso sovrapposti allo stesso numero mostrato dalla schermata. */
  setVisible(visible: boolean): void;
}

/**
 * HUD in HTML sopra al canvas. Non legge lo stato di gioco: riceve solo numeri
 * già pronti, così resta un consumatore passivo e testabile.
 *
 * L'intero HUD è `pointer-events: none` (vedi style.css): se catturasse i touch,
 * gli swipe non arriverebbero al canvas e il gioco sarebbe ingiocabile. Lo
 * stesso vale per i nuovi pannelli di buff e bivio: nessuno di essi deve mai
 * ricevere `pointer-events: auto`.
 */
export function createHud(root: HTMLElement): Hud {
  const container = document.createElement('div');
  container.className = 'hud';
  container.innerHTML = `
    <div class="hud__points">0</div>
    <div class="hud__charge"><div class="hud__charge-fill"></div></div>
    <div class="hud__size">TAGLIA 1</div>
    <div class="hud__buffs">
      <div class="hud__buff hud__buff--shield" data-buff="shield">SCUDO</div>
      <div class="hud__buff hud__buff--star" data-buff="star"><span class="hud__buff-time"></span>s ×2</div>
      <div class="hud__buff hud__buff--magnet" data-buff="magnet"><span class="hud__buff-time"></span>s CALAMITA</div>
    </div>
    <div class="hud__fork">
      <div class="hud__fork-side" data-side="left">SINISTRA</div>
      <div class="hud__fork-side" data-side="right">DESTRA</div>
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

  const pointsEl = need('.hud__points');
  const fillEl = need('.hud__charge-fill');
  const sizeEl = need('.hud__size');
  const shieldEl = need('[data-buff="shield"]');
  const starEl = need('[data-buff="star"]');
  const starTimeEl = need('[data-buff="star"] .hud__buff-time');
  const magnetEl = need('[data-buff="magnet"]');
  const magnetTimeEl = need('[data-buff="magnet"] .hud__buff-time');
  const forkEl = need('.hud__fork');
  const forkLeftEl = need('[data-side="left"]');
  const forkRightEl = need('[data-side="right"]');

  return {
    setPoints(p: number): void {
      // Math.floor, non Math.round: come dichiarato in game/score.ts, la vista
      // non deve mai mostrare un punto non ancora davvero guadagnato.
      pointsEl.textContent = String(Math.floor(p));
    },

    setCharge(ratio: number): void {
      const clamped = Math.max(0, Math.min(1, ratio));
      // Un decimale basta e tiene la stringa pulita (50%, 33.3%).
      fillEl.style.width = `${Math.round(clamped * 1000) / 10}%`;
    },

    setSize(size: number): void {
      sizeEl.textContent = `TAGLIA ${Math.round(size)}`;
    },

    setAvalanche(on: boolean, warning: boolean): void {
      container.classList.toggle('hud--avalanche', on);
      container.classList.toggle('hud--warning', warning);
    },

    setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void {
      shieldEl.classList.toggle('hud__buff--active', shield);

      const starOn = starSeconds > 0;
      starEl.classList.toggle('hud__buff--active', starOn);
      starTimeEl.textContent = starOn ? String(Math.ceil(starSeconds)) : '';

      const magnetOn = magnetSeconds > 0;
      magnetEl.classList.toggle('hud__buff--active', magnetOn);
      magnetTimeEl.textContent = magnetOn ? String(Math.ceil(magnetSeconds)) : '';
    },

    setFork(richBranch: 'left' | 'right' | null): void {
      forkEl.classList.toggle('hud__fork--visible', richBranch !== null);
      forkLeftEl.classList.toggle('hud__fork-side--rich', richBranch === 'left');
      forkRightEl.classList.toggle('hud__fork-side--rich', richBranch === 'right');
    },

    setVisible(visible: boolean): void {
      container.classList.toggle('hud--hidden', !visible);
    },
  };
}
