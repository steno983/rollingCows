# Rolling Cows v2 — Design Document

**Data:** 2026-08-19
**Stato:** approvato in brainstorming, pronto per il piano di implementazione
**Sostituisce (parzialmente):** `docs/superpowers/specs/2026-08-16-rolling-cows-design.md`

## 1. Perché un ridisegno

La v1 è un endless runner a tre corsie: si schiva di lato, si salta, si scivola.
Provandola è emerso che le tre corsie non rendono l'idea originale — una mucca che
rotola giù come una valanga — e disperdono l'attenzione su un asse che non serve al
concept.

La v2 riduce il gioco a **un percorso singolo che si biforca**. Non si schiva più di
lato: si salta, si scivola, e ogni tanto si sceglie una strada. La valanga diventa un
battito regolare invece di un evento raro.

Il resto del concept resta: mucca voxel che rotola, crescita, fase di sfogo
distruttiva, mobile-first, tutto generato da codice.

## 2. Decisioni prese

| Ambito | v1 | v2 |
|---|---|---|
| Movimento laterale | 3 corsie, swipe per cambiarle | Nessuno; il tracciato è unico |
| Struttura del percorso | Rettilineo | Rettilineo con bivi periodici |
| Ostacoli | Schivare, saltare, passare sotto | Solo saltare o passare sotto |
| Scivolata | Riduce la sagoma | Riduce la sagoma **e** rimpicciolisce visibilmente la mucca |
| Prezzo della crescita | Sagoma più larga, più difficile schivare | Nessuno: la crescita è ricompensa e spettacolo |
| Raccoglibili | Sparsi | In fila, come le monete di Temple Run o gli anelli di Sonic |
| Buff | Assenti | Quattro, posizionati sul percorso |
| Carica della valanga | Lenta, fase lunga (8 s) | Rapida, fase breve e intensa (4,5 s) |
| Camera | Dietro-sopra, fissa | Invariata: non ruota e non si decentra mai |

Approccio architetturale scelto: **il mondo resta monodimensionale e sono i rami a
traslare lateralmente**. Il tracciato ha uno scostamento laterale che si azzera dopo
ogni scelta, quindi la mucca è sempre al centro e la camera non si muove mai.

Approcci scartati:
- **Tracciato a spline curva:** costoso (terreno deformato lungo la curva, collisioni
  in spazio curvo) e soprattutto imporrebbe una camera che ruota, esclusa dal design.
- **Albero di segmenti pre-generati:** struttura dati pesante per scorciatoie e
  ricongiungimenti che non servono in questa versione.

## 3. Modello del percorso

Il mondo è una linea. Ogni entità ha:

- `z`: distanza davanti alla mucca, cala nel tempo;
- `y`: quota della base (0 = a terra);
- `branch`: a quale ramo appartiene (`main`, `left`, `right`).

La mucca è **sempre** a x = 0. Non esiste più una coordinata di corsia.

Il tracciato ha un **offset laterale** (`pathOffsetX`) che vale 0 quasi sempre. Durante
un bivio le entità del ramo sinistro sono disegnate a `-branchSeparation` e quelle del
ramo destro a `+branchSeparation`; dopo la scelta l'offset del mondo viene animato in
modo che il ramo scelto finisca a 0.

Le collisioni si riducono a due assi: sovrapposizione lungo `z` e lungo la quota. Non
esiste più il test laterale.

**Con cosa si collide.** Poiché il test laterale non esiste più, senza una regola
esplicita la mucca colliderebbe anche con gli ostacoli del ramo che non ha imboccato.
Vale quindi: si collide solo con le entità del **ramo attivo**. Durante
l'avvicinamento a un bivio nessun ramo è attivo, quindi le entità di entrambi sono
visibili ma inerti; il ramo scelto diventa attivo al superamento del punto di non
ritorno, e da lì le sue entità tornano solide. Le entità `main` sono sempre attive.
Questa regola vale anche per i raccoglibili: i fiocchi del ramo scartato non si
prendono, ed è ciò che rende la scelta al bivio una scelta vera.

Parametri (tutti in `config.ts`):

| Parametro | Valore |
|---|---|
| Larghezza del tracciato | 4 unità |
| Separazione dei rami al bivio | 6 unità |
| Distanza a cui il bivio diventa visibile | 90 unità |
| Punto di non ritorno | 12 unità prima della biforcazione |
| Durata del riallineamento | 0,6 s |
| Distanza minima fra due bivi | 120 unità, crescente con la velocità |

## 4. Il bivio

Tre tempi:

1. **Lettura.** A 90 unità il tracciato si sdoppia visibilmente. Entrambi i rami sono
   già popolati e visibili: il giocatore vede *cosa* contengono prima di scegliere.
   Un ramo è ricco (fila fitta di fiocchi, spesso un buff) e più ostacolato; l'altro è
   sgombro e povero. Quale dei due sia ricco è casuale (RNG con seed).
2. **Scelta.** Swipe laterale durante la finestra di avvicinamento. La scelta è
   **reversibile**: finché non si supera il punto di non ritorno si può swipare di
   nuovo e la traslazione si inverte.
3. **Riallineamento.** Superato il punto di non ritorno il ramo scelto scivola al
   centro in 0,6 s, il ramo scartato si allontana e le sue entità vengono rimosse.

**Chi non sceglie non muore:** al punto di non ritorno senza input, il gioco imbocca
automaticamente il ramo **più sgombro**, cioè quello con meno ostacoli (a parità,
quello con meno raccoglibili). L'indecisione costa il premio, mai la corsa.

**Fuori da un bivio** lo swipe laterale non fa nulla, ma viene ricordato per un breve
istante: uno swipe dato appena prima che il bivio compaia vale come scelta anticipata.

Vincolo di leggibilità: fra la fine di un riallineamento e l'inizio del bivio
successivo deve esserci il margine minimo, che cresce con la velocità. Due bivi non
possono mai sovrapporsi.

## 5. Azioni e ostacoli

### Azioni

| Gesto | Effetto |
|---|---|
| Swipe su | Salto: parabola scriptata, ~0,55 s, apice 3,2 unità |
| Swipe giù (a terra) | Scivolata: ~0,55 s, la mucca si appiattisce e la sagoma si dimezza in altezza |
| Swipe giù (in aria) | Tuffo rapido: atterra subito e prosegue in scivolata |
| Swipe laterale | Solo ai bivi |

Il tuffo che concatena salto e scivolata è ciò che permette di superare ostacoli
ravvicinati: è la manovra che dà senso di padronanza quando la si impara.

### Ostacoli

Due sole domande: ci salto sopra o ci passo sotto?

| Tipo | Categoria | Azione richiesta |
|---|---|---|
| Masso | A terra | Saltare |
| Tronco caduto | A terra | Saltare |
| Staccionata | A terra | Saltare |
| Crepaccio | A terra, largo | Saltare al momento giusto |
| Ramo di abete | Sospeso | Scivolare |
| Arco di roccia | Sospeso | Scivolare |
| Cornicione di ghiaccio | Sospeso | Scivolare |

Baite e alberi interi non spariscono dal gioco: diventano **scenografia laterale**
lungo il tracciato, così i modelli voxel già costruiti continuano a essere usati.

Il ritmo nasce dalle combinazioni: un masso seguito a breve distanza da un ramo basso
obbliga a saltare e scivolare subito dopo.

## 6. La taglia della mucca

La taglia va da 1 a 5 e deriva dalla carica accumulata, come in v1. **Non comporta
alcuna penalità**: è ricompensa e spettacolo.

Per non tradire ciò che si vede a schermo, la sagoma di collisione **cresce insieme al
modello**. Il design garantisce però che l'azione richiesta non cambi mai con la
taglia: gli ostacoli sospesi sono posizionati in modo che **una mucca in scivolata ci
passi sotto a qualunque taglia**, perché scivolando torna piccola. Crescere quindi non
introduce nuove punizioni; richiede solo un po' più di precisione nei tempi.

## 7. Fiocchi e buff

### Fiocchi in fila

I fiocchi non sono solo punti: sono il **suggerimento di cosa fare**.

| Pattern | Significato per il giocatore |
|---|---|
| Fila dritta a terra | Qui si respira |
| Fila in arco | Qui si salta |
| Fila bassa sotto un ostacolo sospeso | Qui si scivola |
| Fila che scavalca un ostacolo a terra | Salta e prendi tutto |

Una fila contiene da 6 a 10 fiocchi. Ogni fiocco dà 4 punti di carica (in v1 dava 1):
è questa la leva principale che rende la valanga frequente.

### Buff

Quattro, posizionati **sul percorso** come i fiocchi. Il valore è correlato a quanto
costa prenderli: i comuni stanno a terra sul tracciato e si raccolgono correndo, i
rari stanno in cima a un arco o nel ramo fitto di un bivio.

| Buff | Effetto | Rarità | Posizione tipica |
|---|---|---|---|
| Cristallo di ghiaccio | +20 di carica in un colpo | Comune | A terra sul tracciato |
| Stella | Punti ×2 per 8 s | Medio | In cima a un arco di fiocchi |
| Calamita | Attira i fiocchi per 8 s | Medio | A terra, spesso prima di una fila lunga |
| Campanaccio | Scudo: assorbe un impatto | Raro | Ramo difficile di un bivio |

Stella e calamita possono essere attivi insieme. Lo scudo è uno stato acceso/spento
con un contorno visibile addosso alla mucca. Raccogliere uno scudo mentre se ne ha già
uno non li accumula: ricarica solo quello.

## 8. Valanga e ritmo

La barra si riempie **molto più in fretta** che in v1, grazie ai fiocchi in fila e ai
cristalli. Perché non diventi invincibilità perpetua, il costo si sposta sulla durata:

| Parametro | v1 | v2 |
|---|---|---|
| Soglia | 100 | 100 |
| Carica per fiocco | 1 | 4 |
| Durata della fase | 8 s | 4,5 s |
| Preavviso di fine | 1,5 s | 1 s |
| Moltiplicatore | ×4 | ×5 |

Il ciclo diventa un battito regolare: accumuli, esplodi, riparti. Durante la fase tutti
gli ostacoli si sfondano e non c'è nulla da schivare: è il momento dello spettacolo. Se
capita un bivio durante la valanga, la scelta resta e conviene il ramo difficile, che
non fa più paura.

Al termine: carica a 0, taglia a 1, come in v1.

## 9. Punteggio

Distanza + fiocchi + buff + bonus di distruzione durante la valanga, con il
moltiplicatore della fase e quello della stella che si moltiplicano fra loro. Record
persistito in `localStorage`. Nessuna valuta.

## 10. Impatto sul codice esistente

Questo ridisegno **cancella parte del lavoro della v1**. Il conto va detto chiaramente:
si butta circa un terzo della logica di gioco e se ne riscrive altrettanta.

**Sparisce:**
- `src/game/lanes.ts` (geometria delle corsie);
- l'invariante di solvibilità dello spawner (nessuna riga può bloccare tutte le
  corsie): senza corsie non ha più senso;
- il test laterale in `collisions.ts`;
- le entità larghe due corsie (`width: 2`);
- la penalità di sagoma legata alla taglia in `config.ts`.

**Nasce:**
- `src/game/path.ts`: tracciato, bivi, offset laterale, riallineamento;
- `src/game/buffs.ts`: buff attivi, durate, scudo.

**Si semplifica:** `spawner.ts` (genera pattern lungo una linea invece che righe su
corsie), `collisions.ts` (due assi invece di tre), `player.ts` (niente cambio corsia),
`game.ts`, `entities-view.ts`.

**Resta intatto:** pool di voxel e detriti, modelli voxel, terreno e fondale, camera,
audio, HUD e schermate, macchina a stati, loop a timestep fisso, RNG, bus di eventi,
punteggio, deploy. È la parte più costosa dell'infrastruttura e non viene toccata.

Il terreno va adattato: il corridoio piatto diventa più stretto (4 unità invece di 6) e
deve poter essere disegnato in due rami durante un bivio.

## 11. Testing

Lo spirito resta quello della v1: la logica di gioco è pura e testabile senza grafica.

Test essenziali sul percorso:
- un bivio si chiude sempre: dopo il riallineamento l'offset è esattamente 0;
- due bivi non si sovrappongono mai, a nessuna velocità;
- chi non sceglie ottiene il ramo più sgombro;
- una scelta cambiata prima del punto di non ritorno inverte la traslazione;
- dopo il riallineamento le entità del ramo scartato non esistono più (nessun leak).

Test sul ritmo, nello stile del test statistico che in v1 ha scoperto il pendio
iniziale vuoto:
- su 300 partenze simulate con seed diversi, la prima azione richiesta al giocatore
  arriva entro pochi secondi;
- **nessuna coppia di ostacoli consecutivi è impossibile da superare** alla velocità di
  quel momento, tenendo conto della durata di salto e scivolata. È l'invariante di
  giocabilità che sostituisce quella di solvibilità delle corsie.

Test sui buff: durate che scadono, scudo che assorbe un solo impatto, buff che non si
accumulano oltre il previsto, tutto azzerato all'inizio di una nuova corsa.

## 12. Fuori scope

Scorciatoie che si ricongiungono, percorsi disegnati a mano, biomi diversi per ramo,
boss di fine discesa, leaderboard online, skin, monete e negozio.
