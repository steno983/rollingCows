export interface Hud {
  setPoints(p: number): void;
  setCharge(ratio: number): void;
  setSize(size: number): void;
  setAvalanche(on: boolean, warning: boolean): void;
}

/**
 * HUD in HTML sopra al canvas. Non legge lo stato di gioco: riceve solo numeri
 * già pronti, così resta un consumatore passivo e testabile.
 *
 * L'intero HUD è `pointer-events: none` (vedi style.css): se catturasse i touch,
 * gli swipe non arriverebbero al canvas e il gioco sarebbe ingiocabile.
 */
export function createHud(root: HTMLElement): Hud {
  const container = document.createElement('div');
  container.className = 'hud';
  container.innerHTML = `
    <div class="hud__points">0</div>
    <div class="hud__charge"><div class="hud__charge-fill"></div></div>
    <div class="hud__size">TAGLIA 1</div>
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

  return {
    setPoints(p: number): void {
      pointsEl.textContent = String(Math.round(p));
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
  };
}
