# Rolling Cows

Endless runner voxel in cui una mucca rotola giù da una montagna, cresce
raccogliendo fiocchi di neve e cristalli di ghiaccio (più stella, calamita e
campanaccio come buff temporanei) lungo un tracciato che si biforca di tanto
in tanto, e al culmine esplode in una valanga che sfonda tutto a punteggio
moltiplicato. Poi torna piccola e si ricomincia.

L'idea originale è di mia figlia.

Niente asset esterni: modelli, effetti e suoni sono generati da codice.

## Come si gioca

Obiettivo: andare il più lontano possibile, riempire in fretta la barra di
carica e scegliere bene ai bivi.

| Comando | Telefono | Desktop |
|---|---|---|
| Salta | swipe verso l'alto | freccia su, W, barra spaziatrice |
| Scivola / tuffati | swipe verso il basso | freccia giù, S |
| Scegli un ramo (solo ai bivi) | swipe a sinistra / a destra | frecce sinistra/destra, A/D |
| Pausa | bottone in pausa | Esc, P |

- Massi, tronchi caduti, staccionate e crepacci si saltano. Rami di abete,
  archi di roccia e cornicioni di ghiaccio sono sospesi: ci si passa sotto
  scivolando. Un tuffo (swipe giù mentre si è in aria) concatena salto e
  scivolata: è la manovra che salva quando due ostacoli sono vicini.
- Ogni tanto il tracciato si biforca. Il ramo più ricco di fiocchi e buff è
  anche il più ostacolato; l'altro è sgombro. Si legge il bivio prima di
  arrivarci, si sceglie con uno swipe laterale (la scelta si può cambiare
  finché non si supera il punto di non ritorno), e chi non sceglie ottiene
  automaticamente il ramo più sgombro: l'indecisione costa il premio, non la
  corsa.
- I fiocchi in fila caricano la barra (4 punti l'uno) e suggeriscono cosa
  fare: dritti si corre, ad arco si salta, bassi sotto un ostacolo si scivola.
- Quattro buff, sul percorso come i fiocchi: il cristallo di ghiaccio dà
  carica in un colpo, la stella raddoppia i punti per 8 secondi, la calamita
  attira i fiocchi per 8 secondi, il campanaccio dà uno scudo che assorbe un
  impatto (non si accumula: raccoglierne un altro lo ricarica soltanto).
- A barra piena parte la valanga: invulnerabilità e distruzione totale per
  4,5 secondi, punteggio ×5. Nell'ultimo secondo l'interfaccia lampeggia.
- Alla fine della valanga carica e taglia tornano a zero: lo sfogo si paga,
  ma dura poco e torna in fretta.
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
  game/    # regole di gioco: percorso a bivi, buff, niente più corsie — TypeScript puro
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
