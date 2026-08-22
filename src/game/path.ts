import type { EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Branch } from './types';

export type ForkPhase = 'none' | 'approaching' | 'committed' | 'realigning';

/** Nessun bivio in corso: il tracciato è dritto e se ne aspetta uno. */
export interface PathNone {
  phase: 'none';
  /** Distanza ancora da percorrere prima che il prossimo bivio COMPAIA. */
  nextForkIn: number;
}

/**
 * Il bivio è visibile.
 *
 * Fase più lunga di quanto il nome suggerisca: da `previewZ` fino alla
 * biforcazione se NESSUNO SCEGLIE. Chi sceglie passa a 'committed' al punto di
 * non ritorno (`commitZ`); chi non sceglie non ha alcun ramo da impegnare,
 * quindi resta qui, va dritto in mezzo ai due nastri e incontra il cartello
 * (design §4, regola nuova: l'indecisione costa la corsa, non il premio).
 * `forkZ` può quindi diventare negativa in questa fase, ed è normale.
 *
 * VEDERE E POTER SCEGLIERE SONO DUE COSE DIVERSE, e questa fase le contiene
 * entrambe: comincia quando il bivio diventa visibile, ma la scelta si apre
 * dopo (vedi `choiceOpen`).
 */
export interface PathApproaching {
  phase: 'approaching';
  /** Distanza della biforcazione dal giocatore. Positiva finché la scelta è
   *  possibile; se nessuno sceglie continua a calare e passa sotto zero. */
  forkZ: number;
  /**
   * La finestra di scelta è aperta.
   *
   * Si apre a `commitZ + speed * CONFIG.path.choiceWindowSeconds`, cioè a un
   * TEMPO fisso dal punto di non ritorno invece che a una distanza fissa: era
   * la stessa soglia della visibilità (`previewZ`), e una distanza fissa dura
   * tempi diversi a velocità diverse — 2,15 s al tetto di "Normale" ma 4,78 s
   * a velocità di partenza, cioè cinque secondi di bivio fermo davanti con la
   * decisione già presa. Il proprietario: «devo poter scegliere solo a ridosso
   * del bivio, non ore prima».
   *
   * È un campo e non una funzione perché `speed` non è nota a chi la
   * interroga: `chooseBranch` riceve solo il percorso. Il posto in cui la
   * velocità si conosce è `updatePath`, che infatti è l'unico a scriverlo.
   *
   * A SENSO UNICO: una volta aperta non si richiude. La velocità sale sempre,
   * quindi in pratica non potrebbe comunque; ma se un giorno potesse
   * scendere, una finestra che si richiude spegnerebbe il pannello delle
   * frecce sotto le dita del giocatore e rifarebbe partire 'fork:appeared'
   * al giro dopo.
   */
  choiceOpen: boolean;
  /** Ramo verso cui il giocatore è orientato: null finché non sceglie. */
  choice: 'left' | 'right' | null;
  /**
   * Scelta data PRIMA che la finestra si aprisse. Vale per tutto
   * l'avvicinamento e diventa effettiva nell'istante in cui la finestra apre.
   *
   * IL DIFETTO CHE CORREGGE. Il bivio si vede da `previewZ` = 110 unità, ma la
   * finestra si apre a ~61: a velocità di crociera sono più di due secondi in
   * cui chi guarda la strada — cioè chiunque, non l'interfaccia — preme e vede
   * la propria pressione sparire nel nulla. Il proprietario l'ha riportato
   * come «non funziona l'input della curva», ed era esatto: premeva appena
   * vedeva il bivio, l'unico momento in cui è naturale farlo.
   *
   * PERCHÉ NON CONTRADDICE «non farmi scegliere ore prima». Quella richiesta
   * riguardava il gioco che CHIEDE la scelta troppo presto: pannello acceso e
   * finestra lunga fino a 4,8 secondi. Qui non si chiede niente in anticipo —
   * l'interfaccia resta muta e il cartello si accende a ridosso — si evita
   * soltanto di buttare via un'intenzione già espressa. È la stessa cosa che
   * il buffer di salto fa da sempre: chi anticipa non va punito.
   *
   * Resta modificabile fino al punto di non ritorno: premere di nuovo
   * sovrascrive, come per una scelta normale.
   */
  pendingChoice: 'left' | 'right' | null;
  /** Quale dei due rami è quello ricco (più fiocchi e buff, più ostacoli). */
  richBranch: 'left' | 'right';
}

/** Punto di non ritorno superato: il ramo è deciso e già solido, ma la
 *  biforcazione non è ancora stata raggiunta. */
export interface PathCommitted {
  phase: 'committed';
  /** Ancora positiva: quanto manca alla biforcazione. */
  forkZ: number;
  choice: 'left' | 'right';
  richBranch: 'left' | 'right';
  /** Ramo solido. Non può più essere 'main': è per questo che il tipo lo
   *  restringe ai due lati invece di lasciarlo Branch. */
  activeBranch: 'left' | 'right';
}

/** Biforcazione superata: il mondo trasla lateralmente per riportare il ramo
 *  scelto al centro. */
export interface PathRealigning {
  phase: 'realigning';
  /** Da qui in giù è NEGATIVA: il suo valore assoluto è la distanza percorsa
   *  oltre la biforcazione, che a velocità nota si converte in "quanto tempo è
   *  passato" senza bisogno di un campo a parte. */
  forkZ: number;
  choice: 'left' | 'right';
  richBranch: 'left' | 'right';
  activeBranch: 'left' | 'right';
  /** Avanzamento del riallineamento, 0..1: frazione di `forkBlendZ` già
   *  percorsa oltre la biforcazione, quindi una DISTANZA normalizzata e non un
   *  tempo (vedi applyRealignment). Serve alla vista per far svanire il nastro
   *  scartato invece di vederlo saltare al centro nel frame in cui il bivio si
   *  chiude, e per far rientrare la piegata. È l'ingresso lineare
   *  dell'apertura: `branchSpreadAt(path, 0)` è la sua smoothstep. */
  realignProgress: number;
}

/**
 * Stato del percorso, come UNIONE DISCRIMINATA su `phase`.
 *
 * Era un record piatto con i campi condizionali documentati a parole («valido
 * se phase !== none», «segnaposto senza significato»): sei moduli facevano
 * ciascuno il proprio controllo di fase per sapere cosa potevano leggere, e chi
 * se ne dimenticava leggeva un segnaposto mentre il compilatore taceva. È
 * precisamente il punto in cui i bug del bivio erano già stati due volte. Ora
 * `forkZ` non esiste dove non c'è un bivio, `realignProgress` non esiste fuori
 * dal riallineamento, e `activeBranch` non esiste — né vale 'main' — prima del
 * punto di non ritorno: leggerli fuori posto non compila.
 *
 * Conseguenza inevitabile: il discriminante non si può cambiare mutando
 * l'oggetto, quindi `updatePath` RESTITUISCE lo stato nuovo e il chiamante lo
 * riassegna. Dentro una fase la mutazione in place resta (nessuna allocazione
 * per frame); si alloca solo nelle quattro transizioni di un bivio.
 */
export type PathState = PathNone | PathApproaching | PathCommitted | PathRealigning;

const SIDES: readonly ('left' | 'right')[] = ['left', 'right'];

export function createPath(): PathNone {
  return {
    phase: 'none',
    // Il primissimo bivio di una corsa usa la sua distanza dedicata
    // (firstForkIn), più vicina di minGap: senza questo, per vedere il primo
    // bivio bisognerebbe superare tre ostacoli, e chi non conosce ancora i
    // comandi spesso muore prima di arrivarci. I bivi successivi, alla
    // chiusura del riallineamento qui sotto, tornano a minGap/gapPerSpeed.
    nextForkIn: CONFIG.path.firstForkIn,
  };
}

/**
 * Ramo solido corrente, per chi ha in mano uno stato di fase ignota e non può
 * restringerla: fuori da un bivio impegnato la strada è il tronco. Prima
 * `activeBranch` esisteva sempre e valeva 'main' come segnaposto; ora quel
 * segnaposto è una funzione, cioè una cosa che si legge apposta invece di un
 * campo che si legge per sbaglio.
 */
export function activeBranchOf(path: PathState): Branch {
  if (path.phase === 'committed' || path.phase === 'realigning') return path.activeBranch;
  return 'main';
}

/** Distanza della biforcazione, o null se non c'è alcun bivio in corso. Stesso
 *  ruolo di `activeBranchOf`: rende esplicito il caso "non esiste". */
export function forkZOf(path: PathState): number | null {
  return path.phase === 'none' ? null : path.forkZ;
}

/** Avanzamento del riallineamento, 0 fuori dalla fase che lo possiede. Serve a
 *  chi deve confrontare lo stato del percorso con quello del frame precedente
 *  (la cache della geometria del nastro, in render/terrain.ts) e quindi legge
 *  tutti i campi senza poter restringere la fase. */
export function realignProgressOf(path: PathState): number {
  return path.phase === 'realigning' ? path.realignProgress : 0;
}

/** Offset laterale a cui va disegnato un ramo A BIVIO COMPLETAMENTE APERTO, in
 *  unità di mondo. Pura geometria del bivio: non dipende dalla fase corrente.
 *  Va SEMPRE moltiplicato per `branchSpreadAt` alla z di interesse — da solo
 *  descrive solo il punto di arrivo dell'apertura, non dove il ramo si trova
 *  davvero a quella distanza. */
export function branchOffsetX(_path: PathState, branch: Branch): number {
  if (branch === 'left') return -CONFIG.path.branchSeparation;
  if (branch === 'right') return CONFIG.path.branchSeparation;
  return 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span <= 0) return x <= edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

/**
 * QUANTO sono aperti i due rami a una distanza z data: 0 = nastro unico
 * (tronco, o nessun bivio in corso), 1 = rami del tutto separati. È una
 * smoothstep fra la biforcazione (`forkZ`) e `forkZ + CONFIG.path.forkBlendZ`.
 *
 * Descrive la FORMA della Y e nient'altro: dove finisce ciascun nastro lo dice
 * `branchCenterAt`, che è l'unico punto in cui l'apertura si combina con il
 * raddrizzamento. Sta qui, in game/, e non nella vista, benché sia geometria
 * da disegnare: è l'unica definizione di apertura di tutto il progetto, e deve
 * esserlo — quando ne esistevano due (questa, allora privata di
 * render/terrain.ts, e una rampa a tempo dentro applyRealignment) la mucca
 * finiva fino a 4,01 unità fuori dal centro del proprio nastro.
 *
 * L'apertura graduale non è un abbellimento: con la separazione applicata di
 * colpo il centro di ciascun nastro salterebbe di branchSeparation = 6 unità
 * nello spazio di una riga di geometria, e il bivio si leggerebbe come due
 * piste parallele comparse di fianco alla propria invece che come una Y. Il
 * rapporto ~1:4,7 fra separazione e lunghezza è quello di uno svincolo reale.
 */
export function branchSpreadAt(path: PathState, z: number): number {
  if (path.phase === 'none') return 0;
  return smoothstep(path.forkZ, path.forkZ + CONFIG.path.forkBlendZ, z);
}

/**
 * Quanto il ramo scelto è già diventato "la strada principale": 0 = sta ancora
 * di lato come l'altro, 1 = è dritto davanti alla mucca e sarà l'altro a
 * scostarsi. Sale durante la fase IMPEGNATA — cioè fra il punto di non ritorno
 * e la biforcazione — e vale 1 per tutto il riallineamento.
 *
 * È il pezzo che mancava, e il difetto che ha corretto si vedeva così: «la
 * telecamera curva bene ma poi la strada si deforma e viene presa la strada di
 * sinistra come strada principale». Prima il ramo scelto restava disegnato di
 * lato (a `branchOffsetX * apertura`) e a riportarlo sotto la mucca ci pensava
 * una traslazione dell'intero mondo, unica per tutte le z. Ma l'apertura
 * dipende da z e la traslazione no: il conto tornava solo alla quota della
 * mucca. Alla quota della mucca la pista era centrata, otto unità più avanti
 * era già scostata di 1,3, e in mezzo c'era un GOMITO. Una strada con un
 * gomito davanti al muso, per giunta ruotata dal gruppo-mondo, non si legge
 * come una curva: si legge come una pista che si deforma.
 *
 * Facendo raddrizzare il ramo scelto PRIMA della biforcazione il problema
 * sparisce alla radice invece di essere ridistribuito: quando la mucca arriva
 * al bivio la sua strada è già dritta sotto di lei per tutta la lunghezza
 * visibile, e il bivio si legge per quello che è — la propria strada che
 * prosegue e l'altra che se ne va. Non serve più alcuna traslazione del mondo
 * (il campo `offsetX` è stato rimosso), e non c'è più niente che debba
 * "chiudersi" alla fine del riallineamento: nessuno scatto, a nessuna z.
 *
 * La finestra è quella impegnata e non un'altra perché è esattamente il tratto
 * in cui la scelta è irrevocabile (`chooseBranch` fallisce da lì in poi):
 * raddrizzare prima significherebbe mostrare come già presa una decisione che
 * il giocatore può ancora cambiare. Smoothstep e non rampa lineare perché agli
 * estremi la derivata deve essere nulla, altrimenti lo scorrimento laterale
 * del ramo parte e si ferma di scatto.
 */
export function straightenProgress(path: PathState): number {
  if (path.phase === 'realigning') return 1;
  if (path.phase !== 'committed') return 0;
  // Distanza già percorsa dentro la fase impegnata, non `forkZ` grezza: gli
  // estremi di una smoothstep vanno in ordine crescente, e passarli al
  // contrario la fa restituire zero per sempre senza che niente lo segnali —
  // il raddrizzamento scattava tutto in un frame alla biforcazione, cioè uno
  // spostamento laterale di branchSeparation in 1/60 di secondo.
  return smoothstep(0, CONFIG.path.commitZ, CONFIG.path.commitZ - path.forkZ);
}

/**
 * Scostamento laterale del CENTRO di un ramo a una distanza z data: l'unica
 * risposta alla domanda "dov'è questo pezzo di strada", per chiunque —
 * la pista (render/terrain.ts), le entità che ci stanno sopra
 * (render/entities-view.ts) e i test.
 *
 * Due soli fattori, e nessun termine additivo: l'apertura della Y a quella z,
 * e il fatto che il ramo scelto si stia raddrizzando. Il ramo scartato non si
 * raddrizza — resta dov'è la geometria del bivio — quindi durante la fase
 * impegnata la distanza fra i due nastri si dimezza mentre il proprio scivola
 * al centro: è la lettura giusta, "la mia strada diventa la strada", e tiene
 * entrambi i nastri dentro la fascia di terreno piatto (|x| <= 8, vedi
 * render/terrain.ts, FLAT_HALF_WIDTH). Portare via il ramo scartato invece di
 * far scivolare il proprio conserverebbe la larghezza della Y ma lo
 * spingerebbe a 12 unità di lato, cioè fuori dal piatto e sopra i banchi.
 *
 * Il ramo 'main' ha scostamento nullo per costruzione, qualunque cosa succeda:
 * il tronco è il riferimento, non una delle strade che si spostano.
 */
export function branchCenterAt(path: PathState, branch: Branch, z: number): number {
  const straightening = branch === activeBranchOf(path) ? 1 - straightenProgress(path) : 1;
  // `+ 0` normalizza -0 a 0 (un ramo sinistro moltiplicato per un'apertura
  // nulla produce -0): stessa cautela di worldToViewX in camera-rig.ts e di
  // turnAmount in curve.ts, per lo stesso motivo — Object.is, e quindi toBe
  // nei test, distingue -0 da 0, e "la pista è dritta" deve poter essere
  // asserito come uguaglianza esatta.
  return branchOffsetX(path, branch) * straightening * branchSpreadAt(path, z) + 0;
}

/** true se le entità di quel ramo sono solide (collidono e si raccolgono). */
export function branchIsSolid(path: PathState, branch: Branch): boolean {
  if (branch === 'main') return true;
  return activeBranchOf(path) === branch;
}

/**
 * Registra o cambia la scelta. Restituisce false se non c'è un bivio
 * scegliibile (nessun bivio in corso, o punto di non ritorno gia' superato).
 * Non emette eventi: la firma non riceve il bus, quindi 'fork:chosen' e'
 * responsabilita' del chiamante (l'orchestratore), che lo emette quando questa
 * funzione restituisce true.
 *
 * Il controllo su `commitZ` e' esplicito e prima non serviva: finche' chi non
 * sceglieva riceveva d'ufficio il ramo sgombro, al punto di non ritorno la fase
 * diventava 'committed' da sola e il solo test sulla fase bastava a chiudere la
 * finestra. Ora la fase 'approaching' sopravvive al punto di non ritorno
 * proprio nel caso in cui nessuno ha scelto (vedi advanceApproaching), quindi
 * senza questa riga la scelta resterebbe possibile fino al cartello — cioe' il
 * punto di non ritorno sparirebbe esattamente nel caso per cui esiste.
 */
export function chooseBranch(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'approaching') return false;
  // Punto di non ritorno superato: non c'è più niente da scegliere, e non ha
  // senso nemmeno ricordarlo.
  if (path.forkZ <= CONFIG.path.commitZ) return false;
  if (!path.choiceOpen) {
    // Finestra non ancora aperta: si tiene da parte l'intenzione invece di
    // buttarla. Vale poco (choiceGraceSeconds) e solo qui dentro.
    path.pendingChoice = side;
    return false;
  }
  path.choice = side;
  return true;
}

/**
 * La finestra di scelta e' aperta ADESSO, cioe' uno swipe laterale farebbe
 * qualcosa? E' `chooseBranch` senza l'effetto: serve a chi deve mostrare le
 * frecce o spiegare perche' uno swipe non ha fatto nulla, e sta qui perche' le
 * due condizioni devono restare una sola definizione.
 */
export function choiceIsOpen(path: PathState): boolean {
  return path.phase === 'approaching' && path.choiceOpen && path.forkZ > CONFIG.path.commitZ;
}

/**
 * DOVE va piantato il cartello, in unita' OLTRE la biforcazione.
 *
 * IL DIFETTO CHE QUESTO NUMERO CORREGGE. Il cartello stava a `forkZ` esatta,
 * cioe' sulla biforcazione. Ma li' l'apertura della Y vale zero — i due nastri
 * sono ancora perfettamente sovrapposti, `branchSpreadAt(path, forkZ) = 0` per
 * costruzione — quindi non c'era nessun cuneo in cui stare: il cartello era un
 * palo largo 3,5 unita' piantato in mezzo a una carreggiata larga 4, prima
 * ancora che il bivio esistesse visivamente. Parole del proprietario: «il
 * cartello al bivio e' posizionato prima della curva e non permette quindi di
 * cambiare direzione».
 *
 * IL CONTO. A `d` unita' oltre la biforcazione i due centri stanno a
 * ±`branchSeparation · spread(d)` e ogni nastro e' largo `trackWidth`, quindi
 * lo spazio libero fra i due bordi interni vale, per lato:
 *
 *     semiCuneo(d) = branchSeparation · smoothstep(0, forkBlendZ, d) − trackWidth/2
 *
 * che con i valori attuali fa −2,00 a d = 0 (il cartello INVADE la pista di 2
 * unita' per lato), 0,36 a d = 12, 2,25 a d = 18, 4,00 a d = 28. Serve
 * `semiCuneo ≥ signpostHalfWidth + aria`, misurato non al centro del cartello
 * ma sul suo BORDO VICINO (`d − depth/2`), che e' il punto in cui il cuneo e'
 * piu' stretto.
 *
 * L'aria e' mezza sagoma della mucca e non un numero scelto: `player.depth` e'
 * la sua misura in z, ma la mucca e' grossomodo quadrata in pianta, quindi
 * meta' di quel valore e' il margine che impedisce a chi passa di sfiorarla.
 * Stesso criterio di `PICKUP_CLEARANCE` in spawner.ts, e per lo stesso motivo:
 * due modelli voxel che si toccano sono indistinguibili da due incastrati.
 *
 * Risolto per bisezione e non a mano perche' `smoothstep` non si inverte in
 * forma chiusa e perche' il risultato deve restare corretto se domani cambiano
 * `branchSeparation`, `trackWidth`, `forkBlendZ` o la larghezza del cartello.
 * Una volta sola, all'avvio: il valore non dipende dallo stato.
 */
function computeSignpostOffsetZ(): number {
  const { branchSeparation, forkBlendZ, signpostHalfWidth } = CONFIG.path;
  const needed = signpostHalfWidth + CONFIG.player.depth / 2;
  const nearEdge = CONFIG.collisions.entityBox.signpost.depth / 2;
  const fits = (d: number): boolean =>
    branchSeparation * smoothstep(0, forkBlendZ, d - nearEdge) - CONFIG.world.trackWidth / 2 >=
    needed;
  // Il cuneo cresce in modo monotono con la distanza e a forkBlendZ e' aperto
  // del tutto: se non basta nemmeno li', nessuna distanza dentro lo svincolo
  // basterebbe, e si sceglie il punto piu' largo disponibile invece di
  // cercarne uno che non esiste.
  let low = 0;
  let high = forkBlendZ + nearEdge;
  if (!fits(high)) return high;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  return high;
}

/** Distanza del cartello OLTRE la biforcazione. Vedi il conto sopra: con i
 *  valori attuali vale ~19,2 unita'. */
export const SIGNPOST_OFFSET_Z = computeSignpostOffsetZ();

/**
 * Il CARTELLO del bivio e' solido?
 *
 * Il cartello sta nel cuneo fra i due rami (vedi SIGNPOST_OFFSET_Z), ed e'
 * solido solo finche' nessuno ha scelto.
 *
 * La condizione e' una sola espressione, e questo e' il punto: la solidita' del
 * cartello NON e' uno stato da mantenere in sincrono con la scelta (un flag da
 * spegnere, un ordine di operazioni da rispettare), e' una FUNZIONE della
 * scelta. Non esiste alcun frame in cui i due possano divergere, perche' non
 * c'e' niente da aggiornare.
 *
 * A questa regola si affianca, in game.ts, la rimozione dell'entita' nello
 * stesso istante, e le due cose non sono ridondanti: la rimozione esiste per
 * una ragione GEOMETRICA — appena la scelta e' registrata il ramo scelto
 * comincia a scivolare al centro (`straightenProgress`) e il cuneo si chiude,
 * fino a lasciare 0,30 unita' di semi-spazio contro le 1,75 che il cartello
 * occupa: restando li', a raddrizzamento completo, finirebbe esattamente sotto
 * la mucca. Questa funzione invece e' la REGOLA, e vale anche se un giorno la
 * rimozione venisse dimenticata: chi ha scelto non muore contro il cartello.
 *
 * Nelle fasi 'committed' e 'realigning' una scelta esiste per costruzione (il
 * tipo lo garantisce: `choice` non e' nullable la'), quindi inerte. In 'none'
 * non c'e' alcun bivio, quindi nemmeno alcun cartello.
 */
export function signpostIsSolid(path: PathState): boolean {
  return path.phase === 'approaching' && path.choice === null;
}

/**
 * Avanza il percorso di `travelled` unità e restituisce lo stato risultante,
 * che è lo STESSO oggetto se la fase non è cambiata e uno nuovo se lo è. Il
 * chiamante deve riassegnare: `game.path = updatePath(game.path, ...)`.
 */
export function updatePath(
  path: PathState,
  travelled: number,
  speed: number,
  rng: Rng,
  bus: EventBus,
): PathState {
  switch (path.phase) {
    case 'none':
      return advanceNone(path, travelled, speed, rng, bus);
    case 'approaching':
      return advanceApproaching(path, travelled, speed, bus);
    case 'committed':
      return advanceCommitted(path, travelled, speed);
    case 'realigning':
      path.forkZ -= travelled;
      return applyRealignment(path, speed);
  }
}

/**
 * Apre la finestra di scelta quando e' ora, e annuncia il bivio.
 *
 * 'fork:appeared' e' emesso QUI e non alla nascita del bivio, ed e' un
 * cambio voluto: quell'evento accende il pannello con le due frecce, e il
 * pannello deve comparire quando si puo' davvero scegliere. Il bivio, di suo,
 * si vede arrivare molto prima — la Y del tracciato da `previewZ` e il
 * cartello piantato in mezzo — ed e' giusto cosi': il cartello e' il segnale
 * diegetico che «qui bisogna decidere», le frecce sono il momento in cui lo si
 * puo' fare.
 *
 * La soglia e' il MINIMO fra il tempo concesso e cio' che la visibilita'
 * permette, e non serve scriverlo: se `commitZ + speed * choiceWindowSeconds`
 * supera `previewZ` la condizione e' gia' vera al primo frame del bivio, e la
 * finestra si apre alla nascita. Succede sopra i 43 u/s, cioe' solo per "Toro"
 * vicino al suo tetto.
 */
function openChoiceIfDue(path: PathApproaching, speed: number, bus: EventBus): void {
  if (path.choiceOpen) return;
  if (path.forkZ > CONFIG.path.commitZ + speed * CONFIG.path.choiceWindowSeconds) return;
  path.choiceOpen = true;
  // Chi ha premuto poco prima ha già scelto: la sua pressione non è andata
  // persa, aspettava qui.
  if (path.pendingChoice !== null) {
    path.choice = path.pendingChoice;
    path.pendingChoice = null;
  }
  bus.emit('fork:appeared', { richBranch: path.richBranch });
}

/** Attesa del prossimo bivio, e sua nascita. */
function advanceNone(
  path: PathNone,
  travelled: number,
  speed: number,
  rng: Rng,
  bus: EventBus,
): PathState {
  path.nextForkIn -= travelled;
  if (path.nextForkIn > 0) return path;

  // L'eccesso di questo passo appartiene già al bivio appena nato: senza
  // scalarlo da previewZ, ogni bivio nascerebbe un po' più lontano di
  // quanto dovrebbe, un errore che si accumulerebbe run dopo run.
  const overshoot = -path.nextForkIn;
  const richBranch = rng.pick(SIDES);
  const next: PathApproaching = {
    phase: 'approaching',
    forkZ: CONFIG.path.previewZ - overshoot,
    // Il bivio nasce VISIBILE ma non ancora scegliibile: la finestra si apre
    // a ridosso, e a farlo e' openChoiceIfDue, che e' anche l'unico posto da
    // cui esce 'fork:appeared'. Alle velocita' piu' alte le due cose
    // coincidono, ed e' lo stesso codice a stabilirlo.
    choiceOpen: false,
    pendingChoice: null,
    // Nessuna scelta ereditata: la scelta ANTICIPATA non esiste piu'.
    // Consentiva di decidere prima ancora di vedere i due rami, il che era in
    // contraddizione col primo dei tre tempi del bivio (design §4, "lettura":
    // il giocatore vede COSA contengono prima di scegliere) e, con lo swipe
    // diagonale letto come laterale, trasformava un salto malriuscito in una
    // scelta silenziosa. Ora la scelta si fa solo mentre il bivio e' in
    // avvicinamento, cioe' solo quando c'e' qualcosa da leggere.
    choice: null,
    richBranch,
  };
  // Sopra i 43 u/s la finestra e' gia' dovuta nel frame in cui il bivio nasce
  // (commitZ + speed * choiceWindowSeconds supera previewZ): va aperta subito,
  // o 'fork:appeared' arriverebbe con un frame di ritardo e, peggio, uno swipe
  // dato in quel frame verrebbe buttato via.
  openChoiceIfDue(next, speed, bus);
  return next;
}

/**
 * Avvicinamento, punto di non ritorno, e il caso di chi non ha scelto.
 *
 * REGOLA NUOVA (design §4): non esiste piu' un ramo di default. Chi arriva al
 * punto di non ritorno senza avere scelto non imbocca il ramo sgombro, non
 * imbocca NIENTE: resta in mezzo, la fase non cambia, e la biforcazione gli
 * arriva addosso insieme al cartello che ci sta piantato davanti. Prima
 * l'indecisione costava il premio, ora costa la corsa — perche' un bivio in cui
 * non scegliere e' comunque una mossa giocabile non e' una decisione, e la
 * scelta al bivio e' LA decisione di questo gioco.
 *
 * Notare che qui non muore nessuno e non si emette nulla: la morte e' una
 * collisione come le altre, contro un'entita' vera che sta sul percorso (vedi
 * game.ts, il cartello piazzato alla nascita del bivio). Questa funzione si
 * limita a non inventare una scelta che il giocatore non ha dato.
 */
function advanceApproaching(
  path: PathApproaching,
  travelled: number,
  speed: number,
  bus: EventBus,
): PathState {
  path.forkZ -= travelled;
  openChoiceIfDue(path, speed, bus);
  if (path.forkZ > CONFIG.path.commitZ) return path;

  const resolved = path.choice;
  if (resolved === null) return advanceUnchosen(path, speed);

  const next: PathCommitted = {
    phase: 'committed',
    forkZ: path.forkZ,
    choice: resolved,
    richBranch: path.richBranch,
    activeBranch: resolved,
  };
  bus.emit('fork:resolved', { side: resolved });
  return next;
}

/**
 * RETE DI SICUREZZA, non una regola di gioco: chiude un bivio mai scelto una
 * volta che la biforcazione e' del tutto alle spalle.
 *
 * In una partita non ci si arriva mai. Il cartello e' alto piu' dell'apice del
 * salto (vedi collisions.entityBox.signpost), nessuna rete lo assorbe (vedi
 * types.ts, isUnforgiving) e la finestra di collisione e' larga 8,4 unita'
 * contro gli 0,77 che il mondo percorre nel frame piu' veloce possibile: chi
 * arriva qui senza avere scelto e' gia' morto da un pezzo.
 *
 * Esiste comunque perche' una macchina a stati non deve poter restare bloccata
 * per una ragione che vive in un altro modulo. Senza, se un giorno il cartello
 * non venisse piazzato — un bug, un test che monta lo stato a mano — la fase
 * resterebbe 'approaching' per sempre: mai piu' un bivio, mai piu' un
 * riallineamento, `forkZ` a scendere all'infinito. `game.ts` sa gestire questa
 * chiusura senza ramo vincente (vedi handleForkTransitions).
 */
function advanceUnchosen(path: PathApproaching, speed: number): PathState {
  // Non basta `forkBlendZ`: il cartello sta OLTRE la biforcazione, quindi il
  // bivio non e' davvero alle spalle finche' non e' passato anche lui. Chiudere
  // prima significherebbe togliere di mezzo il cartello (la chiusura rimuove le
  // entita' del tronco) proprio mentre sta arrivando addosso a chi non ha
  // scelto, cioe' annullare la regola con la sua stessa rete di sicurezza.
  if (path.forkZ > -(CONFIG.path.forkBlendZ + SIGNPOST_OFFSET_Z)) return path;
  return {
    phase: 'none',
    nextForkIn: CONFIG.path.minGap + CONFIG.path.gapPerSpeed * speed,
  };
}

/** Ultimo tratto prima della biforcazione vera e propria: il ramo è già solido
 *  ed è QUI che scivola al centro diventando la strada principale (vedi
 *  straightenProgress). */
function advanceCommitted(path: PathCommitted, travelled: number, speed: number): PathState {
  path.forkZ -= travelled;
  if (path.forkZ > 0) return path;

  const next: PathRealigning = {
    phase: 'realigning',
    forkZ: path.forkZ,
    choice: path.choice,
    richBranch: path.richBranch,
    activeBranch: path.activeBranch,
    realignProgress: 0,
  };
  // Nessuna uscita anticipata: l'eccedenza di questo passo è già distanza
  // percorsa OLTRE la biforcazione, quindi appartiene al riallineamento, e
  // `realignProgress` deve tenerne conto già dal primo frame.
  return applyRealignment(next, speed);
}

/**
 * Avanzamento del riallineamento, e chiusura del bivio quando è completo.
 * Legge solo `forkZ`, già aggiornato dal chiamante.
 *
 * Non sposta più niente: quando la mucca arriva qui il ramo scelto è già
 * dritto sotto di lei per tutta la lunghezza visibile (vedi
 * straightenProgress, che completa alla biforcazione). Questa fase esiste per
 * ciò che resta da consumare DIETRO di lei — il ramo scartato che si
 * assottiglia fino a sparire (render/terrain.ts, trackHalfWidths) e la piegata
 * che rientra (render/curve.ts) — e per non dichiarare chiuso un bivio che si
 * sta ancora vedendo.
 *
 * Dura `forkBlendZ`, cioè la lunghezza dello svincolo: a quel punto la Y è
 * completamente alle spalle. È una DISTANZA e non un tempo (c'era un
 * `realignSeconds`, rimosso) perché è un pezzo di strada: 0,70 s a velocità
 * massima, 1,55 s a velocità di partenza.
 */
function applyRealignment(path: PathRealigning, speed: number): PathState {
  // Avanzamento LINEARE lungo l'apertura, non la smoothstep: chi lo legge
  // (render/curve.ts, render/terrain.ts) ci applica già la propria easing, e
  // un avanzamento già smussato la applicherebbe due volte.
  const blend = CONFIG.path.forkBlendZ;
  const t = blend > 0 ? Math.min(1, Math.max(0, -path.forkZ / blend)) : 1;
  path.realignProgress = t;
  if (t < 1) return path;

  // Bivio chiuso: il ramo scelto è il nuovo tronco. I campi del bivio non
  // vengono "azzerati", semplicemente non esistono più in questa fase.
  return {
    phase: 'none',
    nextForkIn: CONFIG.path.minGap + CONFIG.path.gapPerSpeed * speed,
  };
}

/**
 * Costruttori di stati di bivio, per i test.
 *
 * Prima i test di vista si fabbricavano lo stato con
 * `{ ...createPath(), phase: 'committed', activeBranch: 'left' }`: con
 * l'unione quel letterale non ha più un tipo (lo spread produce un `phase`
 * incerto), ma soprattutto non lo aveva mai davvero — permetteva un
 * `{ phase: 'none', activeBranch: 'right' }`, cioè uno stato che il gioco non
 * può produrre e su cui non ha senso testare la vista. Questi costruttori
 * chiedono esattamente i campi che quella fase possiede, e nulla di più.
 */
export function forkApproaching(options: {
  forkZ: number;
  richBranch?: 'left' | 'right';
  choice?: 'left' | 'right' | null;
  /** Default true: il costruttore produce un bivio GIA' scegliibile, che e' lo
   *  stato su cui quasi tutti i test vogliono lavorare. Chi verifica
   *  l'apertura della finestra passa esplicitamente false. */
  choiceOpen?: boolean;
}): PathApproaching {
  return {
    phase: 'approaching',
    forkZ: options.forkZ,
    choiceOpen: options.choiceOpen ?? true,
    choice: options.choice ?? null,
    pendingChoice: null,
    richBranch: options.richBranch ?? 'left',
  };
}

export function forkCommitted(options: {
  forkZ: number;
  activeBranch: 'left' | 'right';
  richBranch?: 'left' | 'right';
}): PathCommitted {
  return {
    phase: 'committed',
    forkZ: options.forkZ,
    choice: options.activeBranch,
    richBranch: options.richBranch ?? 'left',
    activeBranch: options.activeBranch,
  };
}

export function forkRealigning(options: {
  activeBranch: 'left' | 'right';
  realignProgress: number;
  forkZ?: number;
  richBranch?: 'left' | 'right';
}): PathRealigning {
  return {
    phase: 'realigning',
    // Oltre la biforcazione forkZ è negativa; il valore preciso non serve a
    // chi legge realignProgress, che è già la conversione in avanzamento.
    forkZ: options.forkZ ?? 0,
    choice: options.activeBranch,
    richBranch: options.richBranch ?? 'left',
    activeBranch: options.activeBranch,
    realignProgress: options.realignProgress,
  };
}
