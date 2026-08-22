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
| Distanza a cui il bivio diventa visibile | 110 unità |
| Punto di non ritorno | 24 unità prima della biforcazione |
| Finestra di scelta | 2,0 s prima del punto di non ritorno (a tempo, non a distanza) |
| Lunghezza del riallineamento | 28 unità (una distanza, non un tempo) |
| Distanza minima fra due bivi | 120 unità, crescente con la velocità |

## 4. Il bivio

Tre tempi:

1. **Lettura.** A 110 unità il tracciato si sdoppia visibilmente. Entrambi i rami sono
   già popolati e visibili: il giocatore vede *cosa* contengono prima di scegliere.
   Un ramo è ricco (fila fitta di fiocchi, spesso un buff) e più ostacolato; l'altro è
   sgombro e povero. Quale dei due sia ricco è casuale (RNG con seed).
2. **Scelta.** Swipe laterale, ma **non per tutto l'avvicinamento**: la finestra di
   scelta si apre a ridosso del bivio, a `commitZ + velocità × choiceWindowSeconds`,
   e da lì al punto di non ritorno. La scelta è **reversibile**: finché non si supera
   il punto di non ritorno si può swipare di nuovo e la traslazione si inverte.
3. **Riallineamento.** Superato il punto di non ritorno il ramo scelto scivola al
   centro nell'arco di 28 unità, il ramo scartato si allontana e le sue entità vengono
   rimosse.

**Chi non sceglie si schianta.** *Regola rivista rispetto alla prima stesura di questo
documento, che diceva l'opposto: «chi non sceglie ottiene automaticamente il ramo più
sgombro; l'indecisione costa il premio, mai la corsa».*

Al punto di non ritorno senza input **non viene imboccato alcun ramo**. Non c'è un ramo
di default: la mucca prosegue dritta, in mezzo ai due nastri che si aprono, e nel cuneo
fra i due c'è un **cartello di scelta** con due frecce contro cui va a sbattere.
Colpirlo chiude sempre la corsa: nessuno scudo, nessun perdono, nessuno sfondamento in
valanga.

Il motivo del cambio è che la regola precedente rendeva la scelta al bivio l'unica
decisione del gioco che si poteva non prendere. Chi non sceglieva riceveva comunque
una strada percorribile, quindi il bivio non era un bivio: era un bonus opzionale, e
la meccanica di firma della v2 si poteva ignorare per intere partite senza pagare
niente di più che qualche punto. Con questa regola la scelta torna a essere una
decisione — c'è un costo per non prenderla, ed è il costo massimo.

Perché sia leale servono tre cose, tutte verificate:

- **La si vede arrivare.** Il cartello nasce insieme al bivio, a `previewZ` = 110
  unità, e resta visibile per tutta la discesa. La finestra in cui si può *scegliere*
  si apre più tardi (vedi sotto) e dura ~2 s a ogni velocità. Dopo il punto di non
  ritorno restano 24 unità (0,52-0,60 s) in cui l'esito è già deciso e lo si vede
  arrivare: non tempo di decisione, ma il preavviso che rende la morte leggibile.
- **Non c'è una scorciatoia.** Il cartello è alto 3,6 unità contro un apice di salto di
  3,2: non è scavalcabile a nessuna velocità e a nessuna taglia. Altrimenti «scegli o
  muori» diventerebbe «scegli o salta», cioè una terza opzione più facile delle altre
  due.
- **Non uccide chi ha scelto.** Il cartello sta sul tronco, al centro; nell'istante in
  cui la scelta viene registrata la mucca appartiene a un ramo e il cartello le passa
  accanto. Diventa quindi inerte, non sparisce: farlo svanire davanti al muso sarebbe
  una sparizione a vista.

**Vedere il bivio e poterlo scegliere sono due momenti diversi.** *Anche questo è
rivisto: nella prima stesura coincidevano.* La Y del tracciato si vede arrivare da
`previewZ` = 110 unità e deve continuare a farlo — serve a leggere il terreno e a
preparare la manovra. Ma 110 unità sono una **distanza**, e una distanza fissa dura
tempi diversi a velocità diverse: la finestra di scelta ne usciva lunga 2,15 s al tetto
di "Normale" e **4,78 s a velocità di partenza**, cioè cinque secondi con un bivio
fermo davanti e la decisione presa da un pezzo. Parole del proprietario: «devo poter
scegliere solo a ridosso del bivio con un minimo di buffer, non ore prima».

La finestra è quindi **a tempo**: si apre quando `forkZ <= commitZ + velocità ×
choiceWindowSeconds`, con `choiceWindowSeconds` = 2,0 s. Dura uguale a ogni velocità,
che è esattamente ciò che serviva. Il tetto vero è il minimo fra quel tempo e ciò che
la visibilità concede — non si apre la scelta su un bivio che non si vede — e il
pareggio cade a (110 − 24) / 2 = **43 u/s**: sotto comanda il tempo, sopra comanda
`previewZ`.

| | velocità | finestra misurata |
|---|---|---|
| primo bivio, "Vitellino" | 17,2 u/s | 1,95 s *(prima: 5,00 s)* |
| primo bivio, "Normale" | 21,0 u/s | 1,97 s *(prima: 4,10 s)* |
| crociera | 30-34 u/s | 2,00 s *(prima: 2,53-2,87 s)* |
| tetto "Vitellino" | 28 u/s | 2,00 s *(prima: 3,07 s)* |
| tetto "Normale" | 40 u/s | 2,00 s *(prima: 2,15 s)* |
| tetto "Toro" | 46 u/s | 1,87 s *(invariata: comanda `previewZ`)* |

*(Le finestre a bassa velocità sono un pelo sotto i 2,0 s nominali perché la
velocità sale mentre la finestra viene percorsa: la soglia di apertura si fissa con
la velocità di quell'istante, e la distanza che ne risulta si copre poi un po' più
in fretta.)*

Il cambio quindi **accorcia solo dove era troppo lungo** e non tocca il caso già
stretto. Che 2,0 s bastino non è un'opinione: un pilota automatico che gioca gli
ostacoli correttamente e ritarda la scelta sopravvive con un ritardo di reazione fino
a **1,90-1,93 s** su tutti e tre i profili, cioè quasi l'intera finestra — schivare
non la mangia.

**`fork:appeared` è emesso all'apertura della finestra**, non alla comparsa del bivio:
quell'evento accende il pannello con le due frecce, e il pannello deve comparire quando
si può davvero scegliere. Il cartello, invece, si vede da lontano insieme alla Y — è il
segnale diegetico che «qui bisogna decidere», mentre le frecce sono il momento in cui
lo si può fare.

**Fuori da un bivio** lo swipe laterale non fa **nulla**, e non viene nemmeno
ricordato. *La scelta anticipata, prevista dalla prima stesura, è stata rimossa.*
Permetteva di decidere prima di vedere il contenuto dei due rami, cioè saltava il primo
dei tre tempi qui sopra — la lettura, che è l'informazione su cui la scelta si fa — e,
dato che uno swipe diagonale viene letto come laterale, trasformava un salto
malriuscito in una scelta di ramo silenziosa data mezzo secondo dopo. Con l'indecisione
che ora costa la corsa, una scelta che il giocatore non sa di avere dato sarebbe
intollerabile.

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
| Crepaccio | A terra, largo (4 unità) | Saltare al momento giusto |
| Crepaccio vero | A terra, larghissimo (7 unità) | Saltare, o si **precipita** |
| Cartello del bivio | A terra, non scavalcabile | Nessuna: si evita **scegliendo** |
| Ramo di abete | Sospeso | Scivolare |
| Arco di roccia | Sospeso | Scivolare |
| Cornicione di ghiaccio | Sospeso | Scivolare |

**Le due eccezioni.** Ogni ostacolo può essere assorbito dallo scudo, perdonato al
primo impatto o sfondato in valanga. Due no, mai: il **crepaccio vero**, perché una
caduta non è un urto — uno scudo che tiene a galla sopra un buco largo sette metri non
si legge come una regola, si legge come un bug — e il **cartello del bivio**, perché il
suo intero scopo è rendere costosa l'indecisione, e uno scudo che lo assorbisse
renderebbe di nuovo gratis il non scegliere proprio nei momenti in cui si gioca meglio.

Il crepaccio vero è **raro e riservato alla parte avanzata** della corsa, e non solo
per ritmo: un buco largo si salta soltanto sopra i 15,5 u/s (più si corre, meno tempo
si passa sospesi sul vuoto — è l'unico ostacolo del gioco per cui il nemico è la
velocità bassa), e la rampa tardiva è il punto in cui quella velocità è garantita in
tutti e tre i profili di difficoltà.

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
- chi non sceglie non ottiene alcun ramo e si schianta contro il cartello;
- la finestra di scelta dura lo stesso tempo a ogni velocità e su ogni profilo;
- chi reagisce entro 1,5 s dall'apertura della finestra sopravvive, pur continuando
  a schivare;
- il cartello diventa inerte nell'istante esatto in cui la scelta viene registrata;
- il cartello non è scavalcabile a nessuna velocità e a nessuna taglia;
- né lo scudo né il perdono né la valanga salvano dal cartello o dal crepaccio vero;
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
