import type { EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Branch } from './types';

export type ForkPhase = 'none' | 'approaching' | 'committed' | 'realigning';

/**
 * Campi che esistono in OGNI fase, e che quindi si possono leggere senza
 * chiedersi a che punto sia il bivio.
 */
interface PathCommon {
  /** Scelta data FUORI dalla finestra di avvicinamento (design §4: "uno swipe
   *  dato appena prima che il bivio compaia vale come scelta anticipata").
   *  Vale solo finché `pendingChoiceTimeLeft` è positivo. */
  pendingChoice: 'left' | 'right' | null;
  pendingChoiceTimeLeft: number;
}

/** Nessun bivio in corso: il tracciato è dritto e se ne aspetta uno. */
export interface PathNone extends PathCommon {
  phase: 'none';
  /** Distanza ancora da percorrere prima che il prossimo bivio COMPAIA. */
  nextForkIn: number;
}

/** Il bivio è visibile e la scelta è ancora cambiabile. */
export interface PathApproaching extends PathCommon {
  phase: 'approaching';
  /** Distanza della biforcazione dal giocatore: positiva, cala a ogni frame. */
  forkZ: number;
  /** Ramo verso cui il giocatore è orientato: null finché non sceglie. */
  choice: 'left' | 'right' | null;
  /** Quale dei due rami è quello ricco (più fiocchi e buff, più ostacoli). */
  richBranch: 'left' | 'right';
}

/** Punto di non ritorno superato: il ramo è deciso e già solido, ma la
 *  biforcazione non è ancora stata raggiunta. */
export interface PathCommitted extends PathCommon {
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
export interface PathRealigning extends PathCommon {
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
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
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
 * scegliibile (nessun bivio in corso, o punto di non ritorno già superato).
 * Non emette eventi: la firma non riceve il bus, quindi 'fork:chosen' è
 * responsabilità del chiamante (l'orchestratore), che lo emette quando questa
 * funzione restituisce true.
 */
export function chooseBranch(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'approaching') return false;
  path.choice = side;
  path.pendingChoice = null;
  path.pendingChoiceTimeLeft = 0;
  return true;
}

/**
 * Memorizza uno swipe laterale dato quando NON c'è un bivio scegliibile — ma
 * SOLO se il prossimo bivio è imminente, cioè se manca al massimo
 * `CONFIG.path.earlyChoiceWindowZ` alla sua comparsa. Restituisce true se la
 * scelta è stata davvero memorizzata.
 *
 * La finestra non è un dettaglio di taratura: senza, uno swipe dato in mezzo
 * al nulla restava valido 0,6 s e veniva applicato a qualunque bivio nascesse
 * in quel lasso, senza che il giocatore lo sapesse. Combinato col fatto che
 * uno swipe diagonale veniva letto come laterale (vedi
 * input.horizontalDominance), un salto malriuscito diventava una scelta di
 * ramo silenziosa — e la scelta al bivio è LA decisione del gioco.
 *
 * Le fasi diverse da 'none' escono subito, e ora è il tipo stesso a spiegare
 * perché: `nextForkIn` esiste SOLO in `PathNone`. Durante un bivio in corso
 * non c'è alcuna distanza dal prossimo bivio da confrontare con la finestra.
 */
export function rememberChoice(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'none') return false;
  if (path.nextForkIn > CONFIG.path.earlyChoiceWindowZ) return false;
  path.pendingChoice = side;
  path.pendingChoiceTimeLeft = CONFIG.path.earlyChoiceSeconds;
  return true;
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
  // La scelta anticipata scade nel TEMPO, non nella distanza (design §4: "per
  // un breve istante"). Il dt non è un parametro perché updatePath ragiona in
  // distanze, ma si ricava esatto: updateWorld calcola travelled = speed * dt
  // con la stessa `speed` passata qui.
  if (path.pendingChoiceTimeLeft > 0) {
    const dt = speed > 0 ? travelled / speed : 0;
    path.pendingChoiceTimeLeft = Math.max(0, path.pendingChoiceTimeLeft - dt);
    if (path.pendingChoiceTimeLeft === 0) path.pendingChoice = null;
  }

  switch (path.phase) {
    case 'none':
      return advanceNone(path, travelled, rng, bus);
    case 'approaching':
      return advanceApproaching(path, travelled, bus);
    case 'committed':
      return advanceCommitted(path, travelled, speed);
    case 'realigning':
      path.forkZ -= travelled;
      return applyRealignment(path, speed);
  }
}

/** Attesa del prossimo bivio, e sua nascita. */
function advanceNone(path: PathNone, travelled: number, rng: Rng, bus: EventBus): PathState {
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
    choice: null,
    richBranch,
    // La scelta anticipata si consuma qui, in un modo o nell'altro: o diventa
    // la scelta del bivio appena nato, o non serve più a niente.
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
  };
  bus.emit('fork:appeared', { richBranch });

  // Scelta anticipata: lo swipe dato poco prima che il bivio comparisse
  // vale come scelta, ed è a tutti gli effetti una scelta del giocatore,
  // quindi emette 'fork:chosen' come se fosse arrivata adesso.
  const pending = path.pendingChoice;
  if (pending !== null) {
    next.choice = pending;
    bus.emit('fork:chosen', { side: pending });
  }
  return next;
}

/** Avvicinamento, e punto di non ritorno. */
function advanceApproaching(path: PathApproaching, travelled: number, bus: EventBus): PathState {
  path.forkZ -= travelled;
  if (path.forkZ > CONFIG.path.commitZ) return path;

  // Punto di non ritorno: chi non ha scelto imbocca il ramo più sgombro,
  // cioè quello NON ricco. L'indecisione costa il premio, mai la corsa.
  const resolved = path.choice ?? (path.richBranch === 'left' ? 'right' : 'left');
  const next: PathCommitted = {
    phase: 'committed',
    forkZ: path.forkZ,
    choice: resolved,
    richBranch: path.richBranch,
    activeBranch: resolved,
    pendingChoice: path.pendingChoice,
    pendingChoiceTimeLeft: path.pendingChoiceTimeLeft,
  };
  bus.emit('fork:resolved', { side: resolved });
  return next;
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
    pendingChoice: path.pendingChoice,
    pendingChoiceTimeLeft: path.pendingChoiceTimeLeft,
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
    pendingChoice: path.pendingChoice,
    pendingChoiceTimeLeft: path.pendingChoiceTimeLeft,
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
}): PathApproaching {
  return {
    phase: 'approaching',
    forkZ: options.forkZ,
    choice: options.choice ?? null,
    richBranch: options.richBranch ?? 'left',
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
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
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
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
    pendingChoice: null,
    pendingChoiceTimeLeft: 0,
    realignProgress: options.realignProgress,
  };
}
