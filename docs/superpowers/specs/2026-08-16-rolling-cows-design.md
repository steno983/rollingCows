# Rolling Cows — Design Document

**Data:** 2026-08-16
**Stato:** approvato in brainstorming, pronto per il piano di implementazione

## 1. Concept

Endless runner mobile-first in cui il giocatore controlla una mucca che rotola giù
da una montagna come una valanga. La mucca cresce raccogliendo neve, fieno e altre
mucche; al raggiungimento della soglia esplode in una fase di valanga in cui sfonda
tutto a punteggio moltiplicato, per poi tornare piccola e ricominciare il ciclo.

Il ciclo di gioco è: **accumulo → tensione → sfogo**, ripetuto.

Estetica **voxel**: ogni elemento è costruito da cubetti, e ogni cosa distrutta si
disintegra in una nuvola di cubetti. La distruzione è la ricompensa visiva
principale del gioco.

**Obiettivo del progetto:** prototipo di un gioco vero. L'architettura deve reggere
estensioni future (skin, leaderboard online, nuovi biomi) senza riscritture, ma la
prima versione resta minimale.

## 2. Decisioni prese

| Ambito | Decisione |
|---|---|
| Stack | TypeScript + Vite + three.js puro (no framework UI nel loop di render) |
| Architettura mondo | Tapis roulant: il giocatore è fermo, il mondo scorre |
| Fisica | Nessun motore fisico. Collisioni AABB su corsie + detriti balistici custom |
| Controlli | Swipe a 3 corsie (+ tastiera su desktop) |
| Rilascio valanga | Automatico al raggiungimento della soglia |
| Stile | Voxel, modelli generati da codice, nessun asset esterno |
| UI | HTML/CSS sopra al canvas |
| Persistenza | `localStorage` (solo record) |
| Deploy | GitHub Pages via GitHub Actions |

Approcci scartati e perché:

- **Motore fisico (Rapier/Cannon):** ~1MB di WASM, tuning lungo, non determinismo
  che mal si sposa con un runner a corsie, e consuma il budget CPU che serve ai
  voxel. Per 3 corsie è potenza sprecata.
- **React Three Fiber:** overhead nel loop di rendering proprio dove servono
  migliaia di istanze.
- **Ibrido (fisica solo per i detriti):** si paga tutto il peso del motore per un
  effetto ottenibile con una simulazione balistica di poche righe.

## 3. Architettura

### 3.1 Loop di gioco

Timestep fisso: la logica avanza a passi costanti di 1/60 s accumulando il tempo
reale; il rendering avviene una volta per frame. Motivo: la difficoltà e il
punteggio non devono dipendere dal frame rate del dispositivo.

Clamp del delta accumulato a un massimo (es. 0,25 s) per evitare la "spirale della
morte" dopo che la tab è rimasta in background.

### 3.2 Macchina a stati

`Boot → Menu → Playing → Paused → GameOver → Menu`

Ogni stato dichiara cosa aggiorna e cosa disegna. Pausa automatica su
`visibilitychange` e su perdita di focus.

### 3.3 Sistemi ed eventi

La logica è divisa in sistemi indipendenti che ricevono stato e delta time e non si
conoscono tra loro. Comunicano tramite un bus di eventi tipizzato:

- `pickup:collected` (tipo, valore)
- `obstacle:hit` (tipo, esito: morte / perdonato / sfondato)
- `avalanche:triggered`, `avalanche:ending`, `avalanche:ended`
- `size:changed` (nuova taglia)
- `run:started`, `run:ended` (punteggio, record battuto)

Audio, UI ed effetti visivi sono consumatori del bus: il sistema di collisioni non
sa che esistono.

### 3.4 Struttura dei file

```
src/
  main.ts                 # bootstrap, canvas, resize, visibilitychange
  core/
    loop.ts               # timestep fisso
    events.ts             # bus di eventi tipizzato
    state-machine.ts      # stati del gioco
    rng.ts                # PRNG con seed (run riproducibili nei test)
  game/
    game.ts               # orchestratore: possiede i sistemi, li aggiorna in ordine
    config.ts             # TUTTI i numeri di bilanciamento
    player.ts             # corsia, salto, taglia, stato della mucca
    world.ts              # chunk pooling del terreno, scorrimento
    spawner.ts            # generazione procedurale ostacoli e raccoglibili
    collisions.ts         # test AABB per corsia
    avalanche.ts          # carica, soglia, fase di sfogo
    score.ts              # punteggio, moltiplicatori, record su localStorage
  render/
    scene.ts              # camera, luci, nebbia, cielo
    voxel-pool.ts         # InstancedMesh + pool di cubetti liberi
    debris.ts             # particelle balistiche
    models.ts             # definizioni voxel di mucca, alberi, rocce, baite
  ui/
    hud.ts                # punteggio, barra di carica, indicatore di taglia
    screens.ts            # menu, game over, pausa
  input/
    input.ts              # swipe + tastiera -> azioni astratte
  audio/
    audio.ts              # sintesi WebAudio, consumatore del bus eventi
```

Vincolo di progetto: **ogni numero di bilanciamento sta in `config.ts`**. Nessuna
costante magica sparsa nei sistemi.

## 4. Gameplay

### 4.1 Il pendio

- 3 corsie fisse, larghezza ~2 unità.
- Cambio corsia con transizione ease-out di ~0,12 s (non a scatto).
- Velocità del mondo: parte da ~18 u/s, cresce logaritmicamente, tetto ~40 u/s.
- Pendenza resa scenograficamente (camera inclinata, parallasse), non simulata.

### 4.2 La mucca

Stato: corsia, altezza (salto), taglia.

- **Taglia** da 1 a 5. Deriva dalla carica accumulata a soglie fisse
  (0 / 20 / 40 / 60 / 80), più eventuali scatti immediati dai raccoglibili "altra
  mucca". La taglia quindi sale insieme alla barra e crolla insieme a essa: una
  sola risorsa, due letture (numerica per il giocatore, fisica per il gioco).
- Taglia maggiore = modello più grande, leggero bonus di velocità, **hitbox più
  larga**. La crescita è un rischio/ricompensa, non un bonus gratuito.
- **Salto:** parabola scriptata di ~0,55 s.
- **Schiacciata (swipe giù):** discesa rapida da un salto; serve anche a passare
  sotto agli ostacoli sospesi.

### 4.3 Ostacoli

Tutti costruiti a voxel e distruttibili.

| Ostacolo | Comportamento |
|---|---|
| Roccia | Blocca sempre |
| Albero / staccionata | Sfondabile da taglia 3+ (esplode in cubetti); sotto taglia 3 blocca |
| Baita | Blocca sempre, occupa due corsie: obbliga a posizionarsi in anticipo |
| Crepaccio | Va saltato, indipendente dalla taglia |
| Ramo sospeso | Va passato sotto con la schiacciata |

### 4.4 Raccoglibili

| Raccoglibile | Effetto |
|---|---|
| Fiocco di neve | Carica +1 |
| Balla di fieno | Carica +5, più raro |
| Altra mucca | Carica +10 e taglia +1 |

### 4.5 La valanga

- Barra di carica 0→100.
- A 100 la fase parte **automaticamente**.
- Durata ~8 s: invulnerabilità, sfondamento di qualsiasi ostacolo, punteggio ×4,
  camera più larga con scuotimento, scia di cubetti di neve crescente.
- Negli ultimi 1,5 s la fase lampeggia e l'audio cala: la fine non deve cogliere
  di sorpresa dentro a un muro di ostacoli.
- Al termine: carica a 0 e taglia riportata a 1. Lo sfogo si paga con la crescita.

### 4.6 Morte e perdono

- Impatto con ostacolo bloccante = fine run. La mucca si disintegra in centinaia
  di cubetti sparati in avanti, con breve rallentatore.
- **Primo impatto perdonato:** se la barra di carica è almeno al 50%, l'impatto
  non uccide. Si perde tutta la carica e un livello di taglia, con forte feedback
  visivo. Riduce la frustrazione iniziale senza abbassare lo skill ceiling.
  Attivabile/disattivabile da `config.ts`.

### 4.7 Punteggio

`distanza + bonus raccolta + bonus distruzione durante la valanga`, con
moltiplicatore ×4 in fase valanga. Record persistito in `localStorage`.

Niente monete o valute: per un prototipo sono contenuto morto.

## 5. Rendering e performance

### 5.1 Modelli voxel

Definiti in `models.ts` come griglie di coordinate con indice colore (pixel-art in
3D; la mucca è circa 8×6×10 cubetti). Nessun file esterno: avvio istantaneo, peso
minimo, modifica banale.

Ogni modello viene "cotto" una volta all'avvio in una geometria unica con colori
nei vertici: un albero intero costa **una sola draw call**.

### 5.2 Pool di voxel liberi

Tutto ciò che si muove come cubetto singolo (detriti, scia della valanga,
disintegrazione della mucca) vive in **un unico `InstancedMesh`** da ~4000 istanze
allocato una volta all'avvio.

- Ogni istanza è libera o attiva.
- Attivazione: si prendono N slot liberi e si assegnano posizione, velocità, vita.
- Integrazione per frame: gravità + rimbalzo smorzato sul terreno + rotazione
  casuale.
- Alla morte lo slot torna nel pool.

**Invariante:** zero allocazioni durante il gioco. È il fattore che più incide sui
micro-scatti da garbage collector su mobile.

I detriti sono volutamente "gommosi" (rimbalzo alto, colori saturi): la distruzione
deve far ridere, non essere realistica.

### 5.3 Budget di performance

Tetto da rispettare e verificare: **< 60 draw call** e **< 150k triangoli** per
frame, a 60fps su telefono di fascia media.

Leve: chunk di terreno riciclati, `InstancedMesh` per ogni tipo di ostacolo
ripetuto, nebbia che nasconde il piano di taglio a ~120 unità, `pixelRatio` limitato
a 2, ombre da una sola luce direzionale con shadow map piccola (fallback: ombre
finte a macchia sotto le entità se il costo è eccessivo nei test).

### 5.4 Look

Luce fredda di alta montagna, cielo a gradiente, nebbia bianca come profondità,
palette limitata a ~12 colori. Camera dietro-sopra la mucca, si allontana al
crescere della taglia, va grandangolo durante la valanga.

### 5.5 Degradazione e fallback

- WebGL non disponibile: messaggio pulito, non schermo nero.
- Rilevamento di frame rate basso: dopo alcuni secondi sotto soglia si spengono le
  ombre e si riduce il numero di particelle.

## 6. Input

Un solo modulo traduce gesti e tasti in azioni astratte: `MOVE_LEFT`, `MOVE_RIGHT`,
`JUMP`, `SLAM`, `PAUSE`. Il resto del gioco ignora la provenienza.

- **Swipe:** soglia in pixel + tempo massimo, direzione dominante vincente.
- **Buffer di un'azione:** un input dato poco prima che l'azione sia eseguibile
  (es. swipe un istante prima dell'atterraggio) viene eseguito invece che scartato.
- **Desktop:** frecce/WASD, spazio per saltare, Esc per la pausa.

Requisiti mobile: `touch-action: none`, viewport a schermo intero, prevenzione del
pull-to-refresh, gestione del resize dovuto alla barra degli indirizzi iOS.

## 7. Schermate

Tutte in HTML/CSS sopra al canvas.

- **Menu:** titolo, record, PARTI, mute.
- **Gioco (HUD):** punteggio, barra di carica, indicatore di taglia.
- **Pausa.**
- **Game Over:** punteggio, record, RIGIOCA immediato (un tap, senza passare dal
  menu — nell'endless runner la ripetizione veloce è tutto).

## 8. Audio

Modulo consumatore del bus eventi, con **suoni sintetizzati via WebAudio** (nessun
file): muggito, impatto, raccolta, rombo della valanga generati con oscillatori e
rumore. Mute persistente e sblocco del contesto audio al primo tap.

Sostituibili in seguito con campioni veri senza toccare il resto.

## 9. Testing

Vitest sui sistemi puri, dove i bug sono invisibili a occhio:

- progressione della velocità nel tempo;
- logica di carica, soglia, durata e chiusura della valanga;
- riciclo dei chunk del mondo (nessun buco, nessuna sovrapposizione);
- test di collisione per corsia e altezza;
- pool dei voxel: **nessun leak di slot** dopo N cicli di attivazione/morte;
- calcolo del punteggio e aggiornamento del record.

Il PRNG è a seed proprio per rendere una run riproducibile in un test.

Il rendering non è testato automaticamente: verifica visiva nel browser.

## 10. Deploy

Vite con `base: '/rollingCows/'`, workflow GitHub Actions che builda e pubblica su
GitHub Pages a ogni push su `main`. URL condivisibile fin dai primi giorni di
sviluppo.

## 11. Fuori scope (prima versione)

Leaderboard online, skin sbloccabili, power-up multipli, biomi aggiuntivi,
tutorial, PWA offline, salvataggio in cloud, monetizzazione.

L'architettura lascia il posto per tutti, ma nessuno entra nella prima versione.
