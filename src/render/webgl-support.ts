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
  showFatal(
    root,
    'Rolling Cows non può partire',
    `<p class="fatal__text">
      Questo browser non espone WebGL, che serve a disegnare il gioco in 3D.
    </p>
    <p class="fatal__text">
      Prova ad aggiornare il browser, oppure ad attivare l'accelerazione hardware
      nelle impostazioni. Su desktop funziona con Chrome, Firefox, Edge e Safari
      aggiornati.
    </p>`,
  );
}

/**
 * Pannello di errore generico, con lo stesso aspetto di quello di WebGL.
 *
 * Serve perché `main()` gira senza rete: il caso "niente WebGL" era gestito con
 * cura, ma canvas mancante, contenitore UI mancante, contesto 2D non
 * disponibile, merge di geometrie fallito e selettori dell'interfaccia non
 * trovati lanciano tutti — e producono esattamente lo schermo nero che questo
 * messaggio esiste per evitare, con in più un errore in console che su un
 * telefono nessuno leggerà mai.
 */
export function showFatalError(root: HTMLElement, detail?: string): void {
  const extra =
    detail === undefined ? '' : `<p class="fatal__text fatal__detail">${escapeHtml(detail)}</p>`;
  showFatal(
    root,
    'Rolling Cows si è fermato',
    `<p class="fatal__text">
      Qualcosa è andato storto durante l'avvio del gioco.
    </p>
    <p class="fatal__text">
      Prova a ricaricare la pagina. Se succede di nuovo, il dispositivo
      potrebbe essere a corto di memoria: chiudere le altre schede aiuta.
    </p>${extra}`,
  );
}

/**
 * Perdita del contesto WebGL. Su mobile è un evento ORDINARIO, non un caso
 * limite: memoria sotto pressione, applicazione lasciata in background a
 * lungo, cambio di GPU. Senza un listener il gioco diventa uno schermo nero
 * silenzioso, perché il controllo iniziale copre solo l'assenza di WebGL
 * all'avvio e non la sua sparizione dopo.
 *
 * `preventDefault` sull'evento è ciò che dice al browser che proveremo a
 * ripristinare: senza, `webglcontextrestored` non arriva mai.
 */
export function watchContextLoss(
  canvas: HTMLCanvasElement,
  handlers: { onLost(): void; onRestored(): void },
): () => void {
  const lost = (event: Event): void => {
    event.preventDefault();
    handlers.onLost();
  };
  const restored = (): void => {
    handlers.onRestored();
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return (): void => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}

/** Avviso non fatale: il contesto è andato perso ma può tornare. */
export function showContextLostNotice(root: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'fatal fatal--transient';
  box.innerHTML = `
    <h1 class="fatal__title">Un attimo…</h1>
    <p class="fatal__text">
      La scheda grafica ha interrotto il disegno, di solito perché il
      dispositivo era a corto di memoria.
    </p>
    <p class="fatal__text">Sto provando a riprendere. Se resta fermo, ricarica la pagina.</p>
  `;
  root.appendChild(box);
  return box;
}

function showFatal(root: HTMLElement, title: string, body: string): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = `<h1 class="fatal__title">${title}</h1>${body}`;
  root.appendChild(box);
}

/** Il dettaglio arriva da un errore, quindi non è testo fidato. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
