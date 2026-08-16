# Rolling Cows

Endless runner voxel in cui una mucca rotola giù da una montagna, cresce
raccogliendo neve, fieno e altre mucche, e al culmine esplode in una valanga che
sfonda tutto a punteggio moltiplicato. Poi torna piccola e si ricomincia.

L'idea originale è di mia figlia.

Niente asset esterni: modelli, effetti e suoni sono generati da codice.

## Come si gioca

Obiettivo: andare il più lontano possibile e riempire la barra di carica.

| Comando | Telefono | Desktop |
|---|---|---|
| Cambia corsia | swipe a sinistra / a destra | frecce sinistra/destra, A/D |
| Salta | swipe verso l'alto | freccia su, W, barra spaziatrice |
| Schiacciata | swipe verso il basso | freccia giù, S |
| Pausa | bottone in pausa | Esc, P |

- Rocce e baite bloccano sempre. Alberi e staccionate si sfondano da taglia 3 in
  su. I crepacci vanno saltati, i rami sospesi vanno passati con la schiacciata.
- Fiocco di neve, balla di fieno e altra mucca caricano la barra; l'altra mucca
  fa anche crescere di una taglia.
- A barra piena parte la valanga: 8 secondi di invulnerabilità, distruzione
  totale e punteggio ×4. Negli ultimi 1,5 secondi l'interfaccia lampeggia: è il
  momento di rimettersi in una corsia libera.
- Alla fine della valanga carica e taglia tornano a zero. Lo sfogo si paga.
- Primo impatto perdonato: se la barra è almeno a metà, il primo colpo non
  uccide ma azzera la carica e toglie una taglia.

Il record è salvato in `localStorage`, sul dispositivo.

## Comandi npm

| Comando | Cosa fa |
|---|---|
| `npm install` | installa le dipendenze (Node 20+) |
| `npm run dev` | server di sviluppo su http://localhost:5173/rollingCows/ |
| `npm run dev -- --host` | come sopra, raggiungibile dal telefono sulla rete locale |
| `npm run build` | build di produzione in `dist/` |
| `npm run preview` | serve la build di produzione in locale |
| `npm run test` | test in watch |
| `npm run test:run` | test una volta sola (CI) |
| `npm run typecheck` | controllo dei tipi TypeScript |

## Struttura

```
src/
  core/    # loop a timestep fisso, bus eventi, macchina a stati, PRNG con seed
  game/    # regole di gioco: TypeScript puro, zero three, zero DOM, tutto testato
  render/  # three.js: scena, terreno, entità, pool di voxel, detriti, perf monitor
  ui/      # HUD e schermate in HTML/CSS sopra al canvas
  input/   # swipe e tastiera tradotti in azioni astratte
  audio/   # sintesi WebAudio, consumatore del bus eventi
```

Regole di progetto: `core/` e `game/` non importano mai `three` e non toccano il
DOM; ogni numero di bilanciamento sta in `src/game/config.ts`; nel loop non si
alloca (pool preallocati).

## Performance e fallback

- Un monitor interno (`src/render/perf-monitor.ts`) misura il framerate reale
  fra un frame renderizzato e l'altro. Se resta sotto soglia per qualche
  secondo consecutivo, il gioco abbassa automaticamente la qualità (ombre
  spente, meno particelle) e lo segnala in console. Il degrado è permanente
  per la sessione, non oscilla.
- Se il browser non espone WebGL, al posto dello schermo nero compare un
  messaggio leggibile e selezionabile (`src/render/webgl-support.ts`).
- Ogni pochi secondi la console stampa draw call e triangoli renderizzati, per
  controllare a occhio il budget grafico durante lo sviluppo.

## Deploy

Ogni push su `main` fa partire il workflow GitHub Actions
(`.github/workflows/deploy.yml`) che esegue test e build e pubblica `dist/` su
GitHub Pages. La `base` di Vite è `/rollingCows/`: se il repository viene
rinominato va aggiornata in `vite.config.ts`.

Per pubblicare a mano:

```bash
npm run build
npm run preview   # controlla la build prima di pubblicare
```
