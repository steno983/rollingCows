/**
 * Rilevamento del supporto WebGL. Il canvas è iniettabile per poterlo testare
 * in jsdom, dove `getContext('webgl')` restituisce sempre null.
 */
export function isWebGLAvailable(
  canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  try {
    const canvas = canvasFactory();
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return context !== null && context !== undefined;
  } catch {
    // Alcuni browser lanciano invece di restituire null quando l'accelerazione
    // è disattivata o la lista nera delle GPU colpisce il dispositivo.
    return false;
  }
}

/** Messaggio pulito al posto dello schermo nero quando WebGL manca. */
export function showWebGLError(root: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = `
    <h1 class="fatal__title">Rolling Cows non può partire</h1>
    <p class="fatal__text">
      Questo browser non espone WebGL, che serve a disegnare il gioco in 3D.
    </p>
    <p class="fatal__text">
      Prova ad aggiornare il browser, oppure ad attivare l'accelerazione hardware
      nelle impostazioni. Su desktop funziona con Chrome, Firefox, Edge e Safari
      aggiornati.
    </p>
  `;
  root.appendChild(box);
}
