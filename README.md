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
| Salta | tap, oppure swipe verso l'alto | freccia su, W, barra spaziatrice |
| Scivola / tuffati | swipe verso il basso | freccia giù, S |
| Scegli un ramo (solo ai bivi) | swipe a sinistra / a destra | frecce sinistra/destra, A/D |
| Pausa | bottone in pausa | Esc, P |

Il tap salta perché è il gesto che chiunque prova per primo su un telefono, e
lo swipe è riconosciuto fino a 600 ms: uno swipe deliberato e lento — quello di
un bambino — non viene più scartato come un tocco accidentale.

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
- **Serie**: ogni ostacolo superato senza prendere colpi allunga la serie, e
  ogni dieci ostacoli il moltiplicatore sale di un gradino — ×1, ×1,25, ×1,5,
  ×2. Qualunque impatto che non sia uno sfondamento la azzera. È il modo in cui
  il gioco paga chi schiva bene invece di pagare solo chi raccoglie.
- A barra piena parte la valanga: invulnerabilità e distruzione totale per
  6 secondi, punteggio ×4. Nell'ultimo secondo l'interfaccia lampeggia.
- Alla fine della valanga taglia e barra tornano a zero, ma non tutto è perduto:
  una parte dei fiocchi raccolti *durante* la valanga finisce in un serbatoio e
  si riversa sulla barra alla fine, fino a un massimo del 40% della soglia. Lo
  sfogo si paga, ma raccogliere mentre si sfonda non è più tempo buttato.
- **Impatto perdonato, e riguadagnabile**: il primissimo colpo di ogni corsa non
  uccide mai, così i primi secondi servono a imparare i comandi e non a morire.
  Dopo, il perdono torna disponibile ogni volta che la barra risale oltre metà:
  è una risorsa che si riguadagna giocando, non una vita gratis che sparisce
  proprio quando comincia a servire. Costa comunque caro — carica azzerata,
  serbatoio azzerato, una taglia in meno.

### Profili di difficoltà

Nel menu si scelgono tre andature: **Vitellino**, **Normale** e **Toro**.
Cambiano tre cose sole — la velocità di partenza, la velocità massima e quanto
sono distanziati gli ostacoli — perché il gioco nasce dall'idea di una bambina
e con la spaziatura normale una bambina piccola arriva a una decina di secondi,
ogni volta. Ogni profilo ha il proprio record: il più facile non cancella
quello fatto sul più difficile.

### Corsa del giorno

Un bottone nel menu avvia una corsa con un seed derivato dalla data: lo stesso
identico percorso per tutti, per tutto il giorno. Ha un record separato, perché
un punteggio fatto su un tracciato condiviso non è confrontabile con uno fatto
su un tracciato casuale.

### Missioni

Tre missioni al giorno («raccogli 80 fiocchi» e simili), estratte da un seed
giornaliero. Compaiono nel menu e nella schermata di fine corsa, con
l'avanzamento a fianco, e restano salvate in locale.

### Fine corsa

La schermata di game over non mostra più il solo punteggio: metri percorsi,
valanghe innescate, taglia massima raggiunta e fiocchi raccolti, con il
confronto in metri rispetto alla corsa precedente e a quella del record. Un
numero isolato non dice niente; una traiettoria fa premere RIGIOCA.

I record sono salvati in `localStorage`, sul dispositivo.

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
| `npm run lint` | regole del linter (Biome) — è quello che gira in CI |
| `npm run format` | riscrive i sorgenti nello stile del progetto |
| `npm run check` | lint + formattazione + ordine degli import, in sola lettura |

Lo stile (virgolette singole, punto e virgola, 2 spazi, virgole finali, 100
colonne) è descritto in `biome.jsonc`: è lo stile che il codice già aveva, non
uno nuovo. `npm run check` segnala anche le differenze di formattazione, che
`npm run format` applica.

## Struttura

```
src/
  core/      # loop a timestep fisso, bus eventi, macchina a stati, PRNG con seed
  game/      # regole di gioco: percorso a bivi, buff, niente più corsie — TypeScript puro
  render/    # three.js: scena, terreno, entità, pool di voxel, detriti, perf monitor
  ui/        # HUD e schermate in HTML/CSS sopra al canvas
  input/     # swipe e tastiera tradotti in azioni astratte
  audio/     # sintesi WebAudio, consumatore del bus eventi
  platform/  # persistenza: l'unica API di browser che non sia rendering o input
```

Regole di progetto: `core/` e `game/` non importano mai `three` e non toccano il
DOM; `render/` e `ui/` non si conoscono (il collante è `main.ts`); ogni numero di
bilanciamento sta in `src/game/config.ts`; nel loop di rendering non si alloca —
i voxel e i detriti vengono da pool preallocati e le entità sono disegnate con
`InstancedMesh` a capacità fissa. Le entità di gioco, invece, non sono pooled:
nascono e muoiono a ogni chunk.

Queste regole non sono solo scritte qui: `src/architecture.test.ts` le verifica
leggendo i sorgenti, e le deroghe stanno in un'allowlist esplicita invece che
in un'abitudine.

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
- `src/budget.test.ts` fa la stessa cosa senza occhio e senza WebGL: mette un
  tetto ai triangoli dei modelli e alle istanze allocate, così una geometria
  che raddoppia si vede in CI e non in un telefono altrui.

## Deploy

Ogni pull request verso `main` e ogni push su `main` fanno partire il workflow
GitHub Actions (`.github/workflows/deploy.yml`): typecheck, lint e test girano
sempre, su push a `main` seguono build, controllo del peso del bundle
(JS + CSS gzip) e pubblicazione di `dist/` su GitHub Pages. La `base` di Vite è
`/rollingCows/`: se il repository viene rinominato va aggiornata in
`vite.config.ts`.

Per pubblicare a mano:

```bash
npm run build
npm run preview   # controlla la build prima di pubblicare
```
